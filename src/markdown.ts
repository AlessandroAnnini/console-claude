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

const PURIFY_MD = {
  ALLOWED_TAGS,
  ALLOWED_ATTR: ["href", "title", "align", "target", "rel", "class"],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ["img", "script", "style", "iframe"],
};

marked.use({
  gfm: true,
  breaks: true,
  tokenizer: {
    // marked 18 has no `html: false`; skip block + inline HTML tokenizers.
    html() {
      return undefined;
    },
    tag() {
      return undefined;
    },
  },
});

export function extractMermaid(text: string): { text: string; blocks: MermaidBlock[] } {
  const blocks: MermaidBlock[] = [];
  const next = text.replace(/(```|~~~)[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\1/gi, (_all, _fence: string, src: string) => {
    const id = `mermaid-${blocks.length}`;
    blocks.push({ id, source: src.trim() });
    return `\n\n${PLACE(blocks.length - 1)}\n\n`;
  });
  return { text: next, blocks };
}

let purifyOnce: ReturnType<typeof createDOMPurify> | null = null;

function purify() {
  if (purifyOnce) return purifyOnce;
  const instance = createDOMPurify(window);
  instance.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element) || node.tagName !== "A") return;
    const href = node.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) {
      node.removeAttribute("href");
      node.removeAttribute("target");
      node.removeAttribute("rel");
      return;
    }
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  });
  purifyOnce = instance;
  return instance;
}

function parseMarkdown(source: string): { raw: string; blocks: MermaidBlock[] } {
  const { text, blocks } = extractMermaid(source);
  const raw = marked.parse(text, { async: false }) as string;
  return { raw, blocks };
}

export function renderMarkdown(source: string): { html: string; blocks: MermaidBlock[] } {
  const { raw, blocks } = parseMarkdown(source);
  const html = purify().sanitize(raw, PURIFY_MD);
  return { html, blocks };
}

export function renderMarkdownFragment(source: string): {
  fragment: DocumentFragment;
  blocks: MermaidBlock[];
} {
  const { raw, blocks } = parseMarkdown(source);
  const fragment = purify().sanitize(raw, {
    ...PURIFY_MD,
    RETURN_DOM_FRAGMENT: true,
  });
  return { fragment, blocks };
}

/** Drop script/handlers from mermaid SVG. Keep foreignObject labels. */
export function sanitizeMermaidSvg(svg: string): Element | null {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const el = parsed.documentElement;
  if (el.tagName.toLowerCase() !== "svg") return null;
  for (const bad of Array.from(el.querySelectorAll("script, iframe"))) bad.remove();
  for (const node of Array.from(el.querySelectorAll("*"))) {
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name) || /javascript:/i.test(attr.value)) {
        node.removeAttribute(attr.name);
      }
    }
  }
  return document.importNode(el, true);
}
