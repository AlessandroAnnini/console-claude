/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { extractMermaid, renderMarkdown } from "./markdown";
import { SESSION_DELETE_MARK } from "./panel-copy";

describe("AC1-delete-mark", () => {
  it("is the multiplication sign, not the word Delete", () => {
    expect(SESSION_DELETE_MARK).toBe("\u00D7");
    expect(SESSION_DELETE_MARK).not.toBe("Delete");
  });
});

describe("AC2-md-sanitize", () => {
  it("strips script tags and javascript hrefs", () => {
    const { html } = renderMarkdown(
      `hello <script>alert(1)</script> [x](javascript:alert(1))`,
    );
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });
});

describe("AC3-md-table", () => {
  it("renders a GFM table", () => {
    const { html } = renderMarkdown(`| Col |\n| --- |\n| A |\n`);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
  });
});

describe("AC4-mermaid-extract", () => {
  it("pulls mermaid source and does not parse the fence as a table", () => {
    const src = `See this:\n\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n`;
    const extracted = extractMermaid(src);
    expect(extracted.blocks).toHaveLength(1);
    expect(extracted.blocks[0]?.source).toContain("flowchart LR");
    expect(extracted.text).not.toContain("```mermaid");
    const { html, blocks } = renderMarkdown(src);
    expect(blocks).toHaveLength(1);
    expect(html).not.toContain("<table");
  });
});
