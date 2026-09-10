/** Origin-scoped conversation store. Key never holds the API key. */
import type { SettingsArea } from "./storage";

export const SESSIONS_KEY = "consoleClaude.sessions";
export const SESSION_CAP = 20;
export const COMPACT_MAX = 2000;
export const COMPACT_PREVIEW = 400;
export const TITLE_MAX = 48;

export type TurnStatus = "ok" | "stopped" | "error";

export type ToolCard = {
  name: string;
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

export function originFromUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function titleFromGoal(goal: string): string {
  const line = goal.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!line) return "Untitled";
  if (line.length <= TITLE_MAX) return line;
  return `${line.slice(0, TITLE_MAX - 1)}…`;
}

export function createSession(opts?: { now?: number; id?: string; title?: string }): Session {
  const now = opts?.now ?? Date.now();
  return {
    id: opts?.id ?? newId(),
    title: opts?.title ?? "Untitled",
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

export async function loadBag(area: SettingsArea): Promise<SessionsBag> {
  const got = await area.get(SESSIONS_KEY);
  const raw = got[SESSIONS_KEY];
  if (!raw || typeof raw !== "object") return {};
  return raw as SessionsBag;
}

export async function saveBag(bag: SessionsBag, area: SettingsArea): Promise<void> {
  await area.set({ [SESSIONS_KEY]: bag });
}
