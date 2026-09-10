/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { extractMermaid, renderMarkdown, sanitizeMermaidSvg } from "./markdown";
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

  it("does not honor raw HTML tags", () => {
    const { html } = renderMarkdown(`hello <em>raw</em> <img src=x onerror=alert(1)>`);
    expect(html.toLowerCase()).not.toContain("<em>");
    expect(html.toLowerCase()).not.toContain("<img");
    expect(html).toContain("raw");
  });

  it("still renders markdown emphasis", () => {
    const { html } = renderMarkdown(`hello *raw*`);
    expect(html).toContain("<em>raw</em>");
  });

  it("opens http(s) links in a new tab", () => {
    const { html } = renderMarkdown(`[docs](https://example.com/a)`);
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe("code fence language class", () => {
  it("keeps a language class for the highlighter", () => {
    const { html } = renderMarkdown("```javascript\nconst x = 1;\n```\n");
    expect(html).toMatch(/language-javascript/i);
  });
});

describe("hard line breaks", () => {
  it("keeps single newlines in a verse", () => {
    const { html } = renderMarkdown("Verse 1\nSpinning through the dark\nA tiny marble\n");
    expect(html).toMatch(/<br\s*\/?>/i);
    expect(html).toContain("Verse 1");
    expect(html).toContain("Spinning through the dark");
  });
});

describe("AC3-md-table", () => {
  it("renders a GFM table", () => {
    const { html } = renderMarkdown(`| Col |\n| --- |\n| A |\n`);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
  });
});

describe("sanitizeMermaidSvg", () => {
  it("keeps an svg and drops script", () => {
    const el = sanitizeMermaidSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>ok</text></svg>`,
    );
    expect(el?.tagName.toLowerCase()).toBe("svg");
    expect(el?.querySelector("script")).toBeNull();
    expect(el?.textContent).toContain("ok");
  });

  it("keeps mermaid foreignObject labels", () => {
    const el = sanitizeMermaidSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Node</div></foreignObject></svg>`,
    );
    expect(el?.querySelector("foreignObject")).not.toBeNull();
    expect(el?.textContent).toContain("Node");
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

  it("accepts a space before the mermaid language tag", () => {
    const extracted = extractMermaid("``` mermaid\nflowchart LR\n  A --> B\n```\n");
    expect(extracted.blocks).toHaveLength(1);
    expect(extracted.blocks[0]?.source).toContain("flowchart LR");
  });
});
