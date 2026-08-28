import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runAgent } from "./agent";
import { parseGoal } from "./console-api";
import { executeJs, runEval } from "./eval-wrapper";
import { serialize } from "./serialize";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";

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
  });
});

describe("AC3-stop", () => {
  it("does not eval after abort", async () => {
    const evals: string[] = [];
    const ctrl = new AbortController();
    let completes = 0;
    const run = runAgent("go", {
      signal: ctrl.signal,
      evalJs: async (code) => {
        evals.push(code);
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
  });
});

describe("AC7-goal-parse", () => {
  it("parses string, template, and empty", () => {
    expect(parseGoal("goal")).toBe("goal");
    expect(parseGoal({ raw: ["a", "c"] }, "b")).toBe("abc");
    expect(parseGoal("")).toBeNull();
    expect(parseGoal()).toBeNull();
  });
});
