/** Highlight + line-wrap assistant fences. Copy uses the raw source, not the DOM. */
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import createDOMPurify from "dompurify";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("yaml", yaml);

const PURIFY = {
  ALLOWED_TAGS: ["span"],
  ALLOWED_ATTR: ["class"],
  ALLOW_DATA_ATTR: false,
};

let purifyOnce: ReturnType<typeof createDOMPurify> | null = null;

function purify() {
  if (!purifyOnce) purifyOnce = createDOMPurify(window);
  return purifyOnce;
}

const HINTS: { test: RegExp; language: string }[] = [
  { test: /\b(interface\s+\w+|type\s+\w+\s*=|as const)\b/, language: "typescript" },
  { test: /\b(function|const|let|=>|export\s|import\s)\b/, language: "javascript" },
  { test: /\b(def\s+\w+|elif\b|None\b|True\b|False\b)/, language: "python" },
  { test: /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i, language: "sql" },
  { test: /^\s*(#!\/|echo\s)/, language: "bash" },
];

export function languageFromClass(className: string): string {
  const match = /\blanguage-([\w+-]+)/i.exec(className);
  const raw = match?.[1]?.toLowerCase() ?? "";
  if (raw === "js") return "javascript";
  if (raw === "ts") return "typescript";
  if (raw === "py") return "python";
  if (raw === "sh" || raw === "shell" || raw === "zsh") return "bash";
  if (raw === "yml") return "yaml";
  if (raw === "md") return "markdown";
  return raw;
}

function looksLikeJson(source: string): boolean {
  const trimmed = source.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Use the fence tag when known; otherwise guess from a few source hints. */
export function resolveLanguage(source: string, language: string): string {
  if (language && hljs.getLanguage(language)) return language;
  if (looksLikeJson(source)) return "json";
  return HINTS.find((hint) => hint.test.test(source))?.language ?? "";
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightSource(source: string, language: string): string {
  const lang = resolveLanguage(source, language);
  if (!lang) return escapeHtml(source);
  try {
    return hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(source);
  }
}

export function wrapHighlightedLines(html: string): string {
  return html
    .split("\n")
    .map((line) => `<span class="line">${line || " "}</span>`)
    .join("");
}

export function highlightedLinesHtml(source: string, language: string): string {
  const raw = wrapHighlightedLines(highlightSource(source, language));
  return purify().sanitize(raw, PURIFY);
}

export function enhanceCodeBlock(pre: HTMLElement, source: string, language = ""): HTMLElement {
  const code = pre.querySelector("code") ?? pre;
  code.innerHTML = highlightedLinesHtml(source, language);
  const wrap = document.createElement("div");
  wrap.className = "code-block";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "chip copy";
  copy.setAttribute("aria-label", "Copy code");
  copy.textContent = "Copy";
  const live = document.createElement("span");
  live.className = "copy-live";
  live.setAttribute("aria-live", "polite");
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(source).then(
      () => {
        copy.textContent = "Copied";
        live.textContent = "Copied";
        window.setTimeout(() => {
          copy.textContent = "Copy";
          live.textContent = "";
        }, 1600);
      },
      () => {
        live.textContent = "Copy failed";
      },
    );
  });
  pre.setAttribute("tabindex", "0");
  pre.replaceWith(wrap);
  wrap.append(copy, live, pre);
  return wrap;
}
