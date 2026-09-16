/** Origin-scoped conversation store. Key never holds the API key. */
import type { SettingsArea } from "./storage";

export const SESSIONS_KEY = "consoleClaude.sessions";
export const SESSION_CAP = 20;
export const COMPACT_MAX = 2000;
export const COMPACT_PREVIEW = 400;
export const TITLE_MAX = 48;
export const TOOL_LINE_MAX = 80;
export const UNTITLED = "Untitled";

export type TurnStatus = "ok" | "stopped" | "error";

export type ToolCard = {
  name: string;
  line?: string;
  summary: string;
};

export type Turn = {
  role: "user" | "assistant";
  text: string;
  tools?: ToolCard[];
  status?: TurnStatus;
};

export type Session = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: unknown[];
  turns: Turn[];
};

export type OriginBucket = {
  activeId: string;
  sessions: Session[];
  running?: boolean;
  navigatedAt?: number;
};

export type SessionsBag = Record<string, OriginBucket>;

export type OriginSummary = {
  origin: string;
  sessionCount: number;
  updatedAt: number;
};

export function originFromUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function titleFromGoal(goal: string): string {
  const line = goal.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!line) return UNTITLED;
  if (line.length <= TITLE_MAX) return line;
  return `${line.slice(0, TITLE_MAX - 1)}…`;
}

/** Console forks when the selected session already has turns. Panel never forks. */
export function shouldForkOnAsk(via: string | undefined, turnCount: number): boolean {
  return via === "console" && turnCount > 0;
}

export function sanitizeTitle(raw: string): string {
  let text = raw
    .trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim();
  if (!text || text.toLowerCase() === UNTITLED.toLowerCase()) return "";
  if (text.length > TITLE_MAX) text = `${text.slice(0, TITLE_MAX - 1)}…`;
  return text;
}

export function shouldNameSession(session: Session, status: TurnStatus): boolean {
  return status === "ok" && session.title === UNTITLED;
}

export function sessionMatchesTitle(title: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return title.toLowerCase().includes(needle);
}

export function createSession(opts?: { now?: number; id?: string; title?: string }): Session {
  const now = opts?.now ?? Date.now();
  return {
    id: opts?.id ?? newId(),
    title: opts?.title ?? UNTITLED,
    createdAt: now,
    updatedAt: now,
    messages: [],
    turns: [],
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function emptyBucket(session?: Session, now?: number): OriginBucket {
  const next = session ?? createSession({ now });
  return { activeId: next.id, sessions: [next] };
}

export function activeSession(bucket: OriginBucket): Session | undefined {
  return bucket.sessions.find((item) => item.id === bucket.activeId);
}

export function addSession(
  bucket: OriginBucket,
  session: Session,
  cap = SESSION_CAP,
): OriginBucket {
  return evictUnused(
    { ...bucket, activeId: session.id, sessions: [...bucket.sessions, session] },
    cap,
  );
}

function evictUnused(bucket: OriginBucket, cap: number): OriginBucket {
  if (bucket.sessions.length <= cap) return bucket;
  const unused = bucket.sessions
    .filter((item) => item.id !== bucket.activeId)
    .sort((a, b) => a.updatedAt - b.updatedAt || a.createdAt - b.createdAt);
  const drop = new Set<string>();
  let extra = bucket.sessions.length - cap;
  for (const item of unused) {
    if (extra <= 0) break;
    drop.add(item.id);
    extra -= 1;
  }
  return { ...bucket, sessions: bucket.sessions.filter((item) => !drop.has(item.id)) };
}

export function renameSession(
  bucket: OriginBucket,
  id: string,
  title: string,
  now?: number,
): OriginBucket {
  const trimmed = title.trim();
  if (!trimmed) return bucket;
  return {
    ...bucket,
    sessions: bucket.sessions.map((item) =>
      item.id === id ? { ...item, title: trimmed, updatedAt: now ?? Date.now() } : item,
    ),
  };
}

export function selectSession(bucket: OriginBucket, id: string): OriginBucket {
  if (!bucket.sessions.some((item) => item.id === id)) return bucket;
  return { ...bucket, activeId: id };
}

export function deleteSession(bucket: OriginBucket, id: string, now?: number): OriginBucket {
  const remaining = bucket.sessions.filter((item) => item.id !== id);
  if (!remaining.length) {
    const created = createSession({ now });
    return { activeId: created.id, sessions: [created] };
  }
  if (bucket.activeId !== id) return { ...bucket, sessions: remaining };
  const next = [...remaining].sort(
    (a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt,
  )[0];
  return { ...bucket, activeId: next.id, sessions: remaining };
}

export function resetNewSession(bucket: OriginBucket, now?: number): OriginBucket {
  return addSession(bucket, createSession({ now }));
}

function capLine(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (trimmed.length <= TOOL_LINE_MAX) return trimmed;
  return `${trimmed.slice(0, TOOL_LINE_MAX - 1)}…`;
}

function resultError(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" ? error.trim() : "";
}

function resultRows(result: unknown): unknown[] | null {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "result" in result) {
    const inner = (result as { result?: unknown }).result;
    if (Array.isArray(inner)) return inner;
  }
  return null;
}

function filterHint(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const rec = input as Record<string, unknown>;
  if (typeof rec.url === "string" && rec.url.trim()) return rec.url.trim();
  if (typeof rec.type === "string" && rec.type.trim()) return rec.type.trim();
  return "";
}

export function toolLine(name: string, input: unknown, result: unknown): string {
  const error = resultError(result);
  if (name === "eval_js") {
    if (error) return capLine(error);
    const code =
      typeof input === "string"
        ? input
        : input && typeof input === "object" && typeof (input as { code?: unknown }).code === "string"
          ? (input as { code: string }).code
          : "";
    const first = code.trim().split(/\r?\n/, 1)[0] ?? "";
    return first ? capLine(first) : name;
  }
  if (name === "network" || name === "resources") {
    const count = resultRows(result)?.length ?? 0;
    const noun =
      name === "network"
        ? count === 1
          ? "request"
          : "requests"
        : count === 1
          ? "resource"
          : "resources";
    const hint = filterHint(input);
    return hint ? capLine(`${count} ${noun} · ${hint}`) : `${count} ${noun}`;
  }
  if (error) return capLine(error);
  return name;
}

export function toolCardLine(card: ToolCard): string {
  const line = card.line?.trim();
  if (line) return line;
  return lineFromSummary(card.name, card.summary ?? "");
}

function lineFromSummary(name: string, summary: string): string {
  const raw = summary.trim();
  if (!raw) return "";
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed !== null && "input" in parsed) {
      const rec = parsed as { input: unknown; result?: unknown };
      return toolLine(name, rec.input, rec.result);
    }
  } catch {
    return "";
  }
  return "";
}

export function stepsSummary(tools: readonly ToolCard[]): string {
  const count = tools.length;
  const steps = count === 1 ? "1 step" : `${count} steps`;
  const unique = [...new Set(tools.map((item) => item.name))];
  if (unique.length === 1) return `${steps} · ${unique[0]}`;
  if (unique.length > 0 && unique.length <= 3) return `${steps} · ${unique.join(", ")}`;
  return steps;
}

function unescapeToolText(text: string): string {
  return text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function truncatedPreview(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    (value as { truncated?: unknown }).truncated === true &&
    typeof (value as { preview?: unknown }).preview === "string"
  ) {
    return (value as { preview: string }).preview;
  }
  return "";
}

export function prettyToolSummary(summary: string, line: string): string {
  const raw = summary.trim();
  if (!raw) return "";
  try {
    const parsed: unknown = JSON.parse(raw);
    const preview = truncatedPreview(parsed);
    const readable = preview
      ? unescapeToolText(preview)
      : unescapeToolText(JSON.stringify(parsed, null, 2));
    return readable && readable !== line ? readable : "";
  } catch {
    const readable = unescapeToolText(raw);
    return readable && readable !== line ? readable : "";
  }
}

export function toolSummary(input: unknown, result: unknown): string {
  return JSON.stringify(compactValue({ input, result })) ?? "";
}

export function compactValue(value: unknown): unknown {
  let text: string;
  try {
    text = JSON.stringify(value) ?? "";
  } catch {
    return { truncated: true, preview: String(value).slice(0, COMPACT_PREVIEW) };
  }
  if (text.length <= COMPACT_MAX) return value;
  return { truncated: true, preview: text.slice(0, COMPACT_PREVIEW) };
}

export function ensureOrigin(
  bag: SessionsBag,
  origin: string,
  now?: number,
): { bag: SessionsBag; bucket: OriginBucket } {
  const existing = bag[origin];
  if (existing?.sessions.length) return { bag, bucket: existing };
  const bucket = emptyBucket(undefined, now);
  return { bag: { ...bag, [origin]: bucket }, bucket };
}

export function putBucket(bag: SessionsBag, origin: string, bucket: OriginBucket): SessionsBag {
  return { ...bag, [origin]: bucket };
}

export function sessionHasHistory(session: Session): boolean {
  return Array.isArray(session?.turns) && session.turns.length > 0;
}

export function originHasHistory(bucket: OriginBucket): boolean {
  return Boolean(bucket?.sessions?.some((item) => item && sessionHasHistory(item)));
}

export function listOrigins(bag: SessionsBag): OriginSummary[] {
  return Object.entries(bag)
    .filter(([, bucket]) => originHasHistory(bucket))
    .map(([origin, bucket]) => {
      const history = bucket.sessions.filter((item) => item && sessionHasHistory(item));
      return {
        origin,
        sessionCount: history.length,
        updatedAt: Math.max(...history.map((item) => item.updatedAt)),
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeOrigin(bag: SessionsBag, origin: string): SessionsBag {
  if (!Object.hasOwn(bag, origin)) return bag;
  const next = { ...bag };
  delete next[origin];
  return next;
}

export function clearBag(): SessionsBag {
  return {};
}

export function persistOrigin(
  bag: SessionsBag,
  origin: string,
  next: OriginBucket,
  create = false,
): { bag: SessionsBag; persisted: boolean } {
  if (!create && !Object.hasOwn(bag, origin)) return { bag, persisted: false };
  return { bag: putBucket(bag, origin, next), persisted: true };
}

export async function loadBag(area: SettingsArea): Promise<SessionsBag> {
  const got = await area.get(SESSIONS_KEY);
  const raw = got[SESSIONS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as SessionsBag;
}

export async function saveBag(bag: SessionsBag, area: SettingsArea): Promise<void> {
  await area.set({ [SESSIONS_KEY]: bag });
}
