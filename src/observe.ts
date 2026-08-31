/** Pure HAR / resource summaries. No Chrome APIs. */

export const MAX_NETWORK = 40;
export const MAX_RESOURCES = 80;
export const MAX_BODY = 3000;

export type HarEntryLike = {
  request?: { method?: string; url?: string };
  response?: {
    status?: number;
    content?: { size?: number; mimeType?: string; text?: string };
  };
  time?: number;
};

export type HarLike = { log?: { entries?: HarEntryLike[] } };

export function normalizeHar(raw: unknown): HarLike {
  if (!raw || typeof raw !== "object") return { log: { entries: [] } };
  const obj = raw as { log?: { entries?: HarEntryLike[] }; entries?: HarEntryLike[] };
  if (Array.isArray(obj.log?.entries)) return { log: { entries: obj.log.entries } };
  if (Array.isArray(obj.entries)) return { log: { entries: obj.entries } };
  return { log: { entries: [] } };
}

export type NetworkFilter = {
  url?: string;
  status?: number | "error";
  includeBody?: boolean;
};

export type NetworkRow = {
  method: string;
  url: string;
  status: number;
  mime: string | null;
  timeMs: number;
  size: number | null;
  body?: string | null;
  reason?: string;
};

export type ResourceKind = "script" | "stylesheet" | "document" | "other";

export type ResourceLike = { url: string; type: string };

export type ResourceFilter = {
  type?: ResourceKind;
  url?: string;
};

export type ResourceRow = { url: string; type: ResourceKind };

export function resourceKind(type: string): ResourceKind {
  if (type === "script" || type === "stylesheet" || type === "document") return type;
  return "other";
}

export function inferResourceType(url: string, type?: string): ResourceKind {
  const fromType = type ? resourceKind(type.toLowerCase()) : "other";
  if (fromType !== "other") return fromType;
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/\.(m?js|cjs)$/.test(path)) return "script";
    if (path.endsWith(".css")) return "stylesheet";
    if (path.endsWith(".html") || path.endsWith(".htm") || path.endsWith("/")) return "document";
  } catch {
    // Invalid URL.
  }
  return "other";
}

export function parseNetworkFilter(input: Record<string, unknown>): NetworkFilter {
  const raw = input.status;
  let status: number | "error" | undefined;
  if (raw === "error") status = "error";
  else if (typeof raw === "number" && Number.isFinite(raw)) status = raw;
  else if (typeof raw === "string" && /^\d{1,3}$/.test(raw)) status = Number(raw);
  return {
    url: typeof input.url === "string" ? input.url : undefined,
    status,
    includeBody: Boolean(input.includeBody),
  };
}

export function attachBody(row: NetworkRow, text: string | null, encoding?: string): NetworkRow {
  if (encoding) return { ...row, body: null, reason: "encoded" };
  if (typeof text !== "string" || !text) return { ...row, body: null, reason: "not captured" };
  return { method: row.method, url: row.url, status: row.status, mime: row.mime, timeMs: row.timeMs, size: row.size, body: text.slice(0, MAX_BODY) };
}

function matchesNetwork(entry: HarEntryLike, filter: NetworkFilter): boolean {
  const url = entry.request?.url ?? "";
  const status = entry.response?.status ?? 0;
  if (filter.url && !url.includes(filter.url)) return false;
  if (filter.status === "error") return status === 0 || status >= 400;
  if (typeof filter.status === "number") return status === filter.status;
  return true;
}

export function summarizeHar(har: HarLike | unknown, filter: NetworkFilter = {}): NetworkRow[] {
  const matched = (normalizeHar(har).log?.entries ?? []).filter((entry) =>
    matchesNetwork(entry, filter),
  );
  const rows: NetworkRow[] = matched.slice(0, MAX_NETWORK).map((entry) => {
    const content = entry.response?.content;
    return {
      method: entry.request?.method ?? "",
      url: entry.request?.url ?? "",
      status: entry.response?.status ?? 0,
      mime: content?.mimeType ?? null,
      timeMs: typeof entry.time === "number" ? entry.time : 0,
      size: typeof content?.size === "number" ? content.size : null,
    };
  });
  if (filter.includeBody && rows.length) {
    const source = matched[0]?.response?.content?.text;
    if (typeof source === "string") rows[0].body = source.slice(0, MAX_BODY);
    else {
      rows[0].body = null;
      rows[0].reason = "not captured";
    }
  }
  return rows;
}

export function summarizeResources(
  resources: ResourceLike[],
  filter: ResourceFilter = {},
): ResourceRow[] {
  return resources
    .map((item) => ({ url: item.url, type: resourceKind(item.type) }))
    .filter((item) => {
      if (filter.type && item.type !== filter.type) return false;
      if (filter.url && !item.url.includes(filter.url)) return false;
      return true;
    })
    .slice(0, MAX_RESOURCES);
}
