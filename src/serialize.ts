const MAX_KEYS = 100;
const MAX_DEPTH = 4;
const MAX_TEXT = 3000;
const MAX_HTML = 10000;

function ctorName(value: object): string {
  try {
    return value.constructor?.name ?? "";
  } catch {
    return "";
  }
}

function isElementLike(value: object): boolean {
  return "tagName" in value && ("outerHTML" in value || "innerText" in value);
}

export function serialize(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === undefined) return "[undefined]";
  if (value === null) return null;

  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return value;
  if (type === "bigint") return `${value}n`;
  if (type === "symbol") return String(value);
  if (type === "function") {
    const fn = value as (...args: never[]) => unknown;
    return `[Function ${fn.name || "anonymous"}] ${String(fn).slice(0, 1000)}`;
  }
  if (type !== "object") return String(value);

  const obj = value as object;
  const name = ctorName(obj);

  if (value instanceof Error) {
    return { type: value.name, message: value.message, stack: value.stack };
  }
  if (name === "Window") {
    const w = value as { location?: { href?: string }; document?: { title?: string } };
    return {
      type: "Window",
      url: w.location?.href ?? "",
      title: w.document?.title ?? "",
    };
  }
  if (name === "Document") {
    const d = value as { URL?: string; title?: string };
    return { type: "Document", url: d.URL ?? "", title: d.title ?? "" };
  }
  if (name === "Element" || isElementLike(obj)) {
    const el = value as {
      tagName?: string;
      id?: string;
      className?: unknown;
      innerText?: string;
      outerHTML?: string;
    };
    return {
      type: "Element",
      tag: el.tagName ?? "UNKNOWN",
      id: el.id || null,
      className: typeof el.className === "string" ? el.className : null,
      text: el.innerText?.slice(0, MAX_TEXT) ?? null,
      html: el.outerHTML?.slice(0, MAX_HTML) ?? null,
    };
  }
  if (typeof NodeList !== "undefined" && value instanceof NodeList) {
    return Array.from(value)
      .slice(0, MAX_KEYS)
      .map((v) => serialize(v, depth + 1, seen));
  }
  if (typeof HTMLCollection !== "undefined" && value instanceof HTMLCollection) {
    return Array.from(value)
      .slice(0, MAX_KEYS)
      .map((v) => serialize(v, depth + 1, seen));
  }
  if (seen.has(obj)) return "[Circular]";
  seen.add(obj);
  if (depth >= MAX_DEPTH) return Object.prototype.toString.call(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map((v) => serialize(v, depth + 1, seen));
  }

  const result: Record<string, unknown> = {};
  let keys: string[];
  try {
    keys = Object.keys(value).slice(0, MAX_KEYS);
  } catch {
    return String(value);
  }
  for (const key of keys) {
    try {
      result[key] = serialize((value as Record<string, unknown>)[key], depth + 1, seen);
    } catch (error) {
      result[key] = `[unreadable: ${error instanceof Error ? error.message : String(error)}]`;
    }
  }
  return result;
}
