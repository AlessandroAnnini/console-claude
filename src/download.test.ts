import { describe, expect, it } from "vitest";
import { mermaidFilename } from "./download";

describe("mermaidFilename", () => {
  it("slugs the first non-comment line", () => {
    expect(mermaidFilename("flowchart LR\n  A --> B", "mmd")).toBe("flowchart-lr.mmd");
  });

  it("skips mermaid comments", () => {
    expect(mermaidFilename("%% note\nsequenceDiagram", "png")).toBe("sequencediagram.png");
  });

  it("falls back when the source is empty", () => {
    expect(mermaidFilename("   \n%% only", "mmd")).toBe("diagram.mmd");
  });
});
