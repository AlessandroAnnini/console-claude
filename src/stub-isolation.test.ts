import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const forbidden = /apiKey|x-api-key|sk-ant|anthropic/i;
const fetchCall = /\bfetch\s*\(/;

describe("MAIN stub isolation", () => {
  it("source has no key or fetch identifiers", () => {
    const source = readFileSync(resolve(__dirname, "page-stub.ts"), "utf8");
    expect(source).not.toMatch(forbidden);
    expect(source).not.toMatch(fetchCall);
  });

  it("built stub.js has no key or fetch identifiers", () => {
    const bundlePath = resolve(__dirname, "../dist/stub.js");
    if (!existsSync(bundlePath)) return;
    const bundle = readFileSync(bundlePath, "utf8");
    expect(bundle).not.toMatch(forbidden);
    expect(bundle).not.toMatch(fetchCall);
  });
});
