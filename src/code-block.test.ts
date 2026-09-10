/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  highlightSource,
  highlightedLinesHtml,
  languageFromClass,
  resolveLanguage,
  wrapHighlightedLines,
} from "./code-block";

describe("languageFromClass", () => {
  it("reads a GFM language class", () => {
    expect(languageFromClass("language-javascript")).toBe("javascript");
    expect(languageFromClass("")).toBe("");
  });

  it("maps common aliases", () => {
    expect(languageFromClass("language-js")).toBe("javascript");
    expect(languageFromClass("language-ts")).toBe("typescript");
    expect(languageFromClass("language-yml")).toBe("yaml");
  });
});

describe("resolveLanguage", () => {
  it("keeps a known fence tag", () => {
    expect(resolveLanguage("const x = 1;", "javascript")).toBe("javascript");
  });

  it("guesses JavaScript when the fence has no language", () => {
    expect(resolveLanguage("function sum(a, b) {\n  return a + b;\n}", "")).toBe("javascript");
  });

  it("guesses JSON when the fence is a parseable object", () => {
    expect(resolveLanguage('{"ok": true}', "")).toBe("json");
  });
});

describe("highlightSource", () => {
  it("marks JavaScript keywords", () => {
    const html = highlightSource("const x = 1;", "javascript");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("const");
  });

  it("marks keywords when Claude omits the fence language", () => {
    const html = highlightSource("function sum(a, b) {\n  return a + b;\n}", "");
    expect(html).toContain("hljs-keyword");
  });

  it("escapes unknown languages instead of injecting tags", () => {
    const html = highlightSource("<script>alert(1)</script>", "not-a-lang");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("wrapHighlightedLines", () => {
  it("wraps each line so numbers stay out of the text", () => {
    const html = wrapHighlightedLines("a\nb");
    expect(html).toContain('class="line"');
    expect(html.match(/class="line"/g)?.length).toBe(2);
  });
});

describe("highlightedLinesHtml", () => {
  it("keeps span tokens and drops scripts", () => {
    const html = highlightedLinesHtml("const x = 1;", "javascript");
    expect(html).toContain("hljs-keyword");
    expect(html).not.toContain("<script");
  });
});
