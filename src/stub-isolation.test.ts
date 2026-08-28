import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("MAIN stub isolation", () => {
  it("source and bundle have no key or fetch identifiers", () => {
    const source = readFileSync(resolve(__dirname, "page-stub.ts"), "utf8");
    const bundle = readFileSync(resolve(__dirname, "../dist/stub.js"), "utf8");
    for (const text of [source, bundle]) {
      expect(text).not.toMatch(/apiKey|x-api-key|sk-ant|anthropic/i);
      expect(text).not.toMatch(/\bfetch\s*\(/);
    }
  });
});
