/** GFM → sanitized HTML for assistant turns. No Chrome APIs. */
import { marked } from "marked";
import createDOMPurify from "dompurify";

export type MermaidBlock = { id: string; source: string };

const PLACE = (index: number) => `%%CC_MERMAID_${index}%%`;

const ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "code",
  "pre",
  "blockquote",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
  "br",
];

marked.setOptions({ gfm: true, breaks: false });

export function extractMermaid(text: string): { text: string; blocks: MermaidBlock[] } {
  const blocks: MermaidBlock[] = [];
  const next = text.replace(/```mermaid[ \t]*\r?\n([\s\S]*?)```/gi, (_all, src: string) => {
    const id = `mermaid-${blocks.length}`;
    blocks.push({ id, source: src.trim() });
    return `\n\n${PLACE(blocks.length - 1)}\n\n`;
  });
  return { text: next, blocks };
}

function purify() {
  const instance = createDOMPurify(window);
  instance.addHook("afterSanitizeAttributes", (node) => {
    if (!("tagName" in node) || (node as Element).tagName !== "A") return;
    const href = (node as Element).getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) (node as Element).removeAttribute("href");
  });
  return instance;
}

export function renderMarkdown(source: string): { html: string; blocks: MermaidBlock[] } {
  const { text, blocks } = extractMermaid(source);
  const raw = marked.parse(text, { async: false }) as string;
  const html = purify().sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "title", "align"],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["img", "script", "style", "iframe"],
  });
  return { html, blocks };
}

export function renderMarkdownFragment(source: string): {
  fragment: DocumentFragment;
  blocks: MermaidBlock[];
} {
  const { text, blocks } = extractMermaid(source);
  const raw = marked.parse(text, { async: false }) as string;
  const fragment = purify().sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "title", "align"],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["img", "script", "style", "iframe"],
    RETURN_DOM_FRAGMENT: true,
  });
  return { fragment, blocks };
}
