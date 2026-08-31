import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runAgent } from "./agent";
import { DEFAULT_INSPECT_GOAL, parseAsk, parseGoal } from "./console-api";
import {
  attachBody,
  inferResourceType,
  MAX_NETWORK,
  normalizeHar,
  parseNetworkFilter,
  summarizeHar,
  summarizeResources,
} from "./observe";
import { isAbortError } from "./errors";
import { executeJs, runEval } from "./eval-wrapper";
import { isPageStubInstalled } from "./page-stub-guard";
import { serialize } from "./serialize";
import {
  DEFAULT_MODEL,
  DEFAULT_SETTINGS,
  MODELS,
  normalizeSettings,
  resolveModel,
} from "./settings";

describe("AC1-key-isolation", () => {
  it("MAIN-world stub source has no API key handling", () => {
    const src = readFileSync(resolve(__dirname, "page-stub.ts"), "utf8");
    expect(src).not.toMatch(/apiKey|x-api-key|sk-ant/i);
  });
});

describe("AC2-serialize", () => {
  it("bounds Window, Element, circular, and long arrays", () => {
    const windowLike = { document: { title: "t" } };
    Object.defineProperty(windowLike, "constructor", { value: { name: "Window" } });
    const el = { tagName: "VIDEO", id: "p", className: "x", innerText: "hi", outerHTML: "<video>" };
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const long = Array.from({ length: 200 }, (_, i) => i);

    expect(serialize(windowLike)).toMatchObject({ type: "Window" });
    expect(serialize(el)).toMatchObject({ type: "Element", tag: "VIDEO" });
    expect(serialize(circular)).toEqual({ self: "[Circular]" });
    expect(serialize(long)).toHaveLength(100);
    expect(serialize(new Date("2026-08-28T00:00:00.000Z"))).toEqual({
      type: "Date",
      iso: "2026-08-28T00:00:00.000Z",
    });
  });
});

describe("AC3-stop", () => {
  it("does not eval after abort", async () => {
    const evals: string[] = [];
    const ctrl = new AbortController();
    let completes = 0;
    const run = runAgent("go", {
      signal: ctrl.signal,
      runTool: async (_name, input) => {
        evals.push(String(input.code ?? ""));
        return { ok: true, result: 1 };
      },
      complete: async () => {
        completes += 1;
        if (completes === 1) {
          ctrl.abort();
          return {
            content: [{ type: "tool_use", name: "eval_js", id: "1", input: { code: "1" } }],
          };
        }
        return {
          content: [{ type: "tool_use", name: "eval_js", id: "2", input: { code: "2" } }],
        };
      },
    });
    await expect(run).resolves.toMatchObject({ outcome: "stopped" });
    expect(evals).not.toContain("2");
  });
});

describe("AC4-confirm-deny", () => {
  it("skips page JS and returns denied", async () => {
    let ran = false;
    const result = await executeJs("1", {
      allowed: false,
      evalFn: () => {
        ran = true;
        return 1;
      },
    });
    expect(ran).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: "Execution denied by user.",
    });
  });
});

describe("AC5-eval-wrapper", () => {
  it("runs expression and statement bodies", async () => {
    expect(await runEval("1+1")).toEqual({ ok: true, result: 2 });
    expect(await runEval("const x = 2; return x")).toEqual({ ok: true, result: 2 });
  });
});

describe("AC6-storage-defaults", () => {
  it("defaults confirm on and round-trips a key", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ confirm: false, apiKey: "sk-test" })).toMatchObject({
      confirm: false,
      apiKey: "sk-test",
      maxSteps: 20,
    });
    expect(normalizeSettings({ maxSteps: 0 }).maxSteps).toBe(20);
    expect(normalizeSettings({ maxSteps: 999 }).maxSteps).toBe(100);
    expect(DEFAULT_MODEL).toBe("claude-sonnet-5");
    expect(MODELS.some((item) => item.id === DEFAULT_MODEL)).toBe(true);
    expect(resolveModel("claude-sonnet-4-20250514")).toBe(DEFAULT_MODEL);
    expect(normalizeSettings({ model: "claude-sonnet-4-20250514" }).model).toBe(
      DEFAULT_MODEL,
    );
    expect(normalizeSettings({ model: "claude-opus-5" }).model).toBe("claude-opus-5");
  });
});

describe("AC7-goal-parse", () => {
  it("parses string, template, and empty", () => {
    expect(parseGoal("goal")).toBe("goal");
    expect(parseGoal({ raw: ["a", "c"] }, "b")).toBe("abc");
    expect(parseGoal("")).toBeNull();
    expect(parseGoal()).toBeNull();
    expect(parseGoal("   ")).toBeNull();
  });

  it("parseAsk accepts an Element and a goal", () => {
    const el = { tagName: "VIDEO", id: "p", className: "x", innerText: "hi", outerHTML: "<video>" };
    expect(parseAsk([el])).toEqual({ goal: DEFAULT_INSPECT_GOAL, selected: [el] });
    expect(parseAsk(["why overflow", el])).toEqual({ goal: "why overflow", selected: [el] });
    expect(parseAsk([el, "why overflow"])).toEqual({ goal: "why overflow", selected: [el] });
    expect(parseAsk([])).toBeNull();
    expect(parseAsk(["  "])).toBeNull();
  });
});

describe("observe summaries", () => {
  const har = {
    entries: [
      {
        request: { method: "GET", url: "https://a.test/ok.js" },
        response: { status: 200, content: { size: 10, mimeType: "text/javascript" } },
        time: 12,
      },
      {
        request: { method: "POST", url: "https://a.test/fail" },
        response: {
          status: 500,
          content: { size: 4, mimeType: "text/plain", text: "boom" },
        },
        time: 40,
      },
    ],
  };

  it("filters, caps, and attaches one body", () => {
    expect(normalizeHar(har).log?.entries).toHaveLength(2);
    expect(summarizeHar(har, { status: "error" })).toMatchObject([
      { method: "POST", url: "https://a.test/fail", status: 500 },
    ]);
    const withBody = summarizeHar(har, { url: "/fail", includeBody: true });
    expect(withBody).toHaveLength(1);
    expect(withBody[0].body).toBe("boom");
    const long = {
      log: {
        entries: Array.from({ length: 80 }, (_, i) => ({
          request: { method: "GET", url: `https://a.test/${i}` },
          response: { status: 200 },
        })),
      },
    };
    expect(summarizeHar(long)).toHaveLength(MAX_NETWORK);
  });

  it("classifies and filters resources", () => {
    expect(inferResourceType("https://a.test/app.js")).toBe("script");
    expect(inferResourceType("https://a.test/app.css")).toBe("stylesheet");
    expect(inferResourceType("https://a.test/app.js", "Script")).toBe("script");
    expect(inferResourceType("https://a.test/app.js", "image")).toBe("script");
    expect(inferResourceType("https://a.test/", "document")).toBe("document");
    const rows = summarizeResources(
      [
        { url: "https://a.test/app.js", type: "script" },
        { url: "https://a.test/app.css", type: "stylesheet" },
      ],
      { type: "script" },
    );
    expect(rows).toEqual([{ url: "https://a.test/app.js", type: "script" }]);
  });

  it("coerces network filters and attachBody", () => {
    expect(parseNetworkFilter({ status: "500", url: "/api" })).toEqual({
      url: "/api",
      status: 500,
      includeBody: false,
    });
    expect(parseNetworkFilter({ status: "error", includeBody: true })).toMatchObject({
      status: "error",
      includeBody: true,
    });
    expect(summarizeHar(har, parseNetworkFilter({ status: "500" }))).toMatchObject([
      { status: 500, url: "https://a.test/fail" },
    ]);
    const row = { method: "GET", url: "https://a.test/x", status: 200, mime: null, timeMs: 1, size: 1 };
    expect(attachBody({ ...row, reason: "not captured" }, "hello")).toEqual({
      ...row,
      body: "hello",
    });
    expect(attachBody(row, "hello", "base64").reason).toBe("encoded");
    expect(attachBody(row, null).reason).toBe("not captured");
  });
});

describe("agent confirm deny", () => {
  it("does not eval when the user denies", async () => {
    let ran = false;
    const result = await runAgent("go", {
      confirm: async () => false,
      runTool: async () => {
        ran = true;
        return { ok: true, result: 1 };
      },
      complete: async () => ({
        content: [{ type: "tool_use", name: "eval_js", id: "1", input: { code: "1" } }],
      }),
      maxSteps: 1,
    });
    expect(ran).toBe(false);
    expect(result.outcome).toBe("ok");
    expect(result.text).toMatch(/exceeded/);
  });

  it("rejects unknown tools without eval", async () => {
    let ran = false;
    let step = 0;
    const result = await runAgent("go", {
      runTool: async (name) => {
        if (name === "eval_js") ran = true;
        return { ok: false, error: `Unknown tool: ${name}` };
      },
      complete: async () => {
        step += 1;
        if (step === 1) {
          return {
            content: [{ type: "tool_use", name: "not_a_tool", id: "1", input: { code: "1" } }],
          };
        }
        return { content: [{ type: "text", text: "done" }] };
      },
    });
    expect(ran).toBe(false);
    expect(result.text).toBe("done");
  });

  it("runs network without confirm", async () => {
    let confirmed = false;
    let ran = "";
    let step = 0;
    const result = await runAgent("go", {
      confirm: async () => {
        confirmed = true;
        return false;
      },
      runTool: async (name) => {
        ran = name;
        return { ok: true, result: [] };
      },
      complete: async () => {
        step += 1;
        if (step === 1) {
          return {
            content: [{ type: "tool_use", name: "network", id: "1", input: { url: "/api" } }],
          };
        }
        return { content: [{ type: "text", text: "seen" }] };
      },
    });
    expect(confirmed).toBe(false);
    expect(ran).toBe("network");
    expect(result.text).toBe("seen");
  });

  it("runs resources without confirm", async () => {
    let confirmed = false;
    let step = 0;
    const result = await runAgent("go", {
      confirm: async () => {
        confirmed = true;
        return false;
      },
      runTool: async () => ({ ok: true, result: [] }),
      complete: async () => {
        step += 1;
        if (step === 1) {
          return {
            content: [{ type: "tool_use", name: "resources", id: "1", input: { type: "script" } }],
          };
        }
        return { content: [{ type: "text", text: "listed" }] };
      },
    });
    expect(confirmed).toBe(false);
    expect(result.text).toBe("listed");
  });
});

describe("helpers", () => {
  it("detects AbortError only", () => {
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("nope"))).toBe(false);
  });

  it("detects an already-installed page stub", () => {
    expect(isPageStubInstalled({})).toBe(false);
    expect(isPageStubInstalled({ __ccEval: () => undefined })).toBe(true);
  });
});
