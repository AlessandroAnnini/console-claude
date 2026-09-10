import { describe, expect, it } from "vitest";
import { completeMessages, completeTitle, parseTitleResponse, TITLE_MODEL } from "./anthropic";
import { TOOLS } from "./prompt";

describe("parseTitleResponse", () => {
  it("reads a JSON title and strips quotes", () => {
    expect(parseTitleResponse('{"title":"Earth orbit diagram."}')).toBe("Earth orbit diagram");
  });

  it("accepts a fenced JSON object", () => {
    expect(parseTitleResponse('```json\n{"title":"Sum helper"}\n```')).toBe("Sum helper");
  });

  it("accepts a bare title", () => {
    expect(parseTitleResponse("Wikipedia earth article")).toBe("Wikipedia earth article");
  });

  it("rejects empty or Untitled", () => {
    expect(parseTitleResponse('{"title":"Untitled"}')).toBe("");
    expect(parseTitleResponse("   ")).toBe("");
  });
});

describe("completeMessages", () => {
  it("marks system and the last tool for prompt cache", async () => {
    await completeMessages({
      apiKey: "sk-test",
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "hi" }],
      fetchFn: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          system: Array<{ cache_control?: { type: string } }>;
          tools: Array<{ name: string; cache_control?: { type: string } }>;
        };
        expect(body.system.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
        expect(body.tools.at(-1)?.name).toBe(TOOLS.at(-1)?.name);
        expect(body.tools.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
        expect(body.tools.slice(0, -1).every((tool) => !tool.cache_control)).toBe(true);
        return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
  });
});

describe("completeTitle", () => {
  it("returns a sanitized title from a mocked Messages call", async () => {
    const title = await completeTitle({
      apiKey: "sk-test",
      user: "hello",
      assistant: "Hi there.",
      fetchFn: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { model: string; tools?: unknown };
        expect(body.model).toBe(TITLE_MODEL);
        expect(body.tools).toBeUndefined();
        return new Response(JSON.stringify({ content: [{ type: "text", text: '{"title":"Greeting"}' }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(title).toBe("Greeting");
  });

  it("returns null when the API fails", async () => {
    const title = await completeTitle({
      apiKey: "sk-test",
      user: "hello",
      assistant: "Hi.",
      fetchFn: async () => new Response("nope", { status: 500 }),
    });
    expect(title).toBeNull();
  });
});
