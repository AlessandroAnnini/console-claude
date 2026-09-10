/**
 * Hidden DevTools page. Owns the agent loop, Anthropic fetch, and confirm
 * dialog (this window, not the inspected page — the page can override confirm).
 *
 * eval_js runs via chrome.scripting.executeScript in MAIN, calling __ccEval
 * so the in-page serializer always wraps the result. network / resources are
 * read-only chrome.devtools.* snapshots (no debugger permission).
 */
import { runAgent, type ToolResult } from "./agent";
import { completeMessages, completeTitle } from "./anthropic";
import { isAbortError } from "./errors";
import {
  attachBody,
  inferResourceType,
  parseNetworkFilter,
  summarizeHar,
  summarizeResources,
  type NetworkRow,
  type ResourceKind,
} from "./observe";
import { DEVTOOLS_PORT, type AskVia, type ConfirmReply } from "./protocol";
import {
  activeSession,
  compactValue,
  COMPACT_PREVIEW,
  ensureOrigin,
  loadBag,
  putBucket,
  renameSession,
  resetNewSession,
  saveBag,
  SESSIONS_KEY,
  shouldForkOnAsk,
  shouldNameSession,
  UNTITLED,
  type OriginBucket,
  type SessionsBag,
  type ToolCard,
  type TurnStatus,
} from "./sessions";
import { chromeArea, loadSettings } from "./storage";

const tabId = chrome.devtools.inspectedWindow.tabId;

let port: chrome.runtime.Port | null = null;
let abort: AbortController | null = null;
let turnSessionId: string | null = null;
let messages: unknown[] = [];
let origin = "";
let bucket: OriginBucket | null = null;
let confirmSeq = 0;
const confirmWait = new Map<string, (result: boolean | "fallback") => void>();
let turnTools: ToolCard[] = [];

function connect() {
  try {
    const next = chrome.runtime.connect({ name: DEVTOOLS_PORT });
    port = next;
    next.postMessage({ kind: "hello", tabId });
    next.onMessage.addListener(
      (msg: {
        id?: string;
        type?: string;
        goal?: string;
        selected?: unknown;
        kind?: string;
        via?: AskVia;
      }) => {
        if (msg.kind === "confirm-reply" && msg.id) {
          const wait = confirmWait.get(msg.id);
          const reply = msg as ConfirmReply;
          wait?.(reply.fallback ? "fallback" : Boolean(reply.allowed));
          return;
        }
        if (msg.id && msg.type) {
          void handle(
            msg as { id: string; type: string; goal?: string; selected?: unknown; via?: AskVia },
          );
        }
      },
    );
    next.onDisconnect.addListener(() => {
      if (port === next) port = null;
      window.setTimeout(connect, 250);
    });
  } catch {
    window.setTimeout(connect, 1000);
  }
}

connect();
window.setInterval(() => {
  try {
    port?.postMessage({ kind: "ping" });
  } catch {
    port = null;
    connect();
  }
}, 15_000);

const REQUEST_CACHE_MAX = 100;
const finishedRequests: chrome.devtools.network.Request[] = [];

chrome.devtools.network.onRequestFinished.addListener((request) => {
  finishedRequests.push(request);
  if (finishedRequests.length > REQUEST_CACHE_MAX) finishedRequests.shift();
});

void ensurePageHooks();
void syncOrigin();
chrome.devtools.panels.create("Console Claude", "", "panel.html");
chrome.devtools.network.onNavigated.addListener(() => {
  finishedRequests.length = 0;
  void ensurePageHooks();
  void onDocumentChanged();
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !origin) return;
  const change = changes[SESSIONS_KEY];
  if (!change) return;
  const next = (change.newValue as SessionsBag | undefined)?.[origin];
  if (!next) return;
  bucket = next;
  if (!abort) messages = activeSession(next)?.messages ?? [];
});

function reply(msg: { id: string }, extra: Record<string, unknown> = {}) {
  port?.postMessage({ kind: "reply", id: msg.id, ...extra });
}

/** MAIN stub can survive an extension reload; the isolated bridge cannot. */
async function ensurePageHooks() {
  try {
    await injectIfMissing({
      world: "ISOLATED",
      file: "content.js",
      present: () => {
        try {
          const flag = Boolean((globalThis as { __ccBridge?: boolean }).__ccBridge);
          return flag && typeof chrome.runtime?.id === "string" && chrome.runtime.id.length > 0;
        } catch {
          return false;
        }
      },
    });
    await injectIfMissing({
      world: "MAIN",
      file: "stub.js",
      present: () =>
        typeof (window as unknown as { __ccEval?: unknown }).__ccEval === "function",
    });
  } catch {
    // chrome://, Web Store, and other restricted pages cannot be injected.
  }
}

async function injectIfMissing(opts: {
  world: `${chrome.scripting.ExecutionWorld}`;
  file: string;
  present: () => boolean;
}) {
  const [probe] = await chrome.scripting.executeScript({
    target: { tabId },
    world: opts.world,
    func: opts.present,
  });
  if (probe?.result) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    world: opts.world,
    files: [opts.file],
  });
}

function resourceType(value: unknown): ResourceKind | undefined {
  if (typeof value !== "string") return undefined;
  const kind = value.toLowerCase();
  if (kind === "script" || kind === "stylesheet" || kind === "document" || kind === "other") {
    return kind;
  }
  return undefined;
}

function readHar(): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.devtools.network.getHAR(resolve);
  });
}

function readResources(): Promise<Array<{ url: string; type: string }>> {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.getResources((items) => {
      resolve(
        (items ?? []).map((item) => ({
          url: item.url,
          type: inferResourceType(item.url, (item as { type?: string }).type),
        })),
      );
    });
  });
}

function requestContent(request: chrome.devtools.network.Request): Promise<{
  text: string;
  encoding: string;
}> {
  return new Promise((resolve) => {
    request.getContent((text, encoding) => {
      resolve({ text: text ?? "", encoding: encoding ?? "" });
    });
  });
}

function matchFinished(row: NetworkRow): chrome.devtools.network.Request | undefined {
  for (let i = finishedRequests.length - 1; i >= 0; i--) {
    const item = finishedRequests[i];
    const url = item.request?.url ?? "";
    const method = item.request?.method ?? "";
    const status = item.response?.status ?? 0;
    if (url === row.url && method === row.method && status === row.status) return item;
  }
  return undefined;
}

async function fillBody(rows: NetworkRow[]): Promise<void> {
  if (!rows[0] || rows[0].body) return;
  const request = matchFinished(rows[0]);
  if (!request) return;
  const { text, encoding } = await requestContent(request);
  Object.assign(rows[0], attachBody(rows[0], text, encoding));
}

async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    if (name === "eval_js") {
      const code = typeof input.code === "string" ? input.code : "";
      const [inj] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (source: string) => {
          const run = (
            window as unknown as {
              __ccEval?: (code: string) => Promise<{
                ok: boolean;
                result?: unknown;
                error?: string;
              }>;
            }
          ).__ccEval;
          if (typeof run !== "function") {
            return Promise.resolve({
              ok: false,
              error: "Console Claude is not injected on this page.",
            });
          }
          return run(source);
        },
        args: [code],
      });
      const value = inj?.result ?? { ok: false, error: "No eval result." };
      await pageLog("tool", { name: "eval_js", input: code, result: value });
      noteTool("eval_js", code, value);
      return value;
    }
    if (name === "network") {
      const filter = parseNetworkFilter(input);
      const rows = summarizeHar(await readHar(), filter);
      if (filter.includeBody) await fillBody(rows);
      await pageLog("tool", { name: "network", input: filter, result: rows });
      noteTool("network", filter, rows);
      return { ok: true, result: rows };
    }
    if (name === "resources") {
      const filter = {
        type: resourceType(input.type),
        url: typeof input.url === "string" ? input.url : undefined,
      };
      const rows = summarizeResources(await readResources(), filter);
      await pageLog("tool", { name: "resources", input: filter, result: rows });
      noteTool("resources", filter, rows);
      return { ok: true, result: rows };
    }
    return { ok: false, error: `Unknown tool: ${name}` };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { ok: false, error: text };
  }
}

async function handle(msg: {
  id: string;
  type: string;
  goal?: string;
  selected?: unknown;
  via?: AskVia;
}) {
  if (msg.type === "stop") {
    abort?.abort();
    reply(msg);
    return;
  }
  if (msg.type === "reset") {
    abort?.abort();
    await ensureActiveBucket();
    if (origin && bucket) await writeBucket(resetNewSession(bucket));
    messages = [];
    reply(msg);
    return;
  }
  if (msg.type === "history") {
    reply(msg, { history: messages });
    return;
  }
  if (msg.type !== "ask" || !msg.goal) {
    reply(msg, { error: "Unknown request." });
    return;
  }
  if (abort) {
    reply(msg, { error: "Claude is already running. Use claude.stop() first." });
    return;
  }

  const settings = await loadSettings(chromeArea());
  if (!settings.apiKey) {
    reply(msg, {
      error: "No API key. Save one on the Console Claude options page.",
    });
    return;
  }

  await ensureActiveBucket();
  if (bucket && shouldForkOnAsk(msg.via, activeSession(bucket)?.turns.length ?? 0)) {
    await writeBucket(resetNewSession(bucket));
    messages = [];
  }
  abort = new AbortController();
  const goal =
    msg.selected == null
      ? msg.goal
      : `Selected node:\n${JSON.stringify(msg.selected)}\n\n${msg.goal}`;
  turnTools = [];
  await beginTurn(goal);
  let runHistory = messages;
  try {
    const result = await runAgent(goal, {
      signal: abort.signal,
      maxSteps: settings.maxSteps,
      history: runHistory,
      confirm: settings.confirm ? (code) => requestConfirm(code) : undefined,
      complete: async (history) => {
        const response = await completeMessages({
          apiKey: settings.apiKey,
          model: settings.model,
          messages: history as { role: string; content: unknown }[],
          signal: abort?.signal,
        });
        const content = response.content as Array<{
          type: string;
          text?: string;
          name?: string;
          id?: string;
          input?: Record<string, unknown>;
        }>;
        const hasTools = content.some((block) => block.type === "tool_use");
        if (hasTools) {
          for (const block of content) {
            if (block.type === "text" && block.text) await pageLog("claude", block.text);
          }
        }
        return { content };
      },
      runTool: (name, input) => dispatchTool(name, input),
    });
    if (result.messages) {
      runHistory = result.messages;
      messages = result.messages;
    }
    if (result.outcome === "stopped") {
      await endTurn("Stopped.", "stopped", runHistory);
      reply(msg, { text: "Stopped." });
      return;
    }
    await endTurn(result.text, "ok", runHistory);
    reply(msg, { text: result.text });
  } catch (error) {
    if (isAbortError(error)) {
      await endTurn("Stopped.", "stopped", runHistory);
      reply(msg, { text: "Stopped." });
      return;
    }
    const text = error instanceof Error ? error.message : String(error);
    await pageLog("error", text);
    await endTurn(text, "error", runHistory);
    reply(msg, { error: text });
  } finally {
    abort = null;
    turnSessionId = null;
    if (bucket) await writeBucket({ ...bucket, running: false });
  }
}

function noteTool(name: string, input: unknown, result: unknown) {
  const compact = compactValue({ input, result });
  const summary =
    typeof compact === "object" && compact && "preview" in compact
      ? String((compact as { preview: string }).preview)
      : (JSON.stringify(compact) ?? "");
  turnTools.push({ name, summary: summary.slice(0, COMPACT_PREVIEW) });
}

function inspectedOrigin(): Promise<string> {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval("location.origin", (result) => {
      resolve(typeof result === "string" ? result : "");
    });
  });
}

async function syncOrigin(): Promise<void> {
  const next = await inspectedOrigin();
  if (!next) return;
  origin = next;
  const existing = (await loadBag(chromeArea()))[origin];
  if (existing?.sessions.length) {
    bucket = existing;
    if (!abort) messages = activeSession(bucket)?.messages ?? [];
    return;
  }
  bucket = null;
  if (!abort) messages = [];
}

async function ensureActiveBucket(): Promise<void> {
  await syncOrigin();
  if (bucket || !origin) return;
  await writeBucket(ensureOrigin({}, origin).bucket);
}

async function writeBucket(next: OriginBucket): Promise<void> {
  bucket = next;
  if (!origin) return;
  await saveBag(putBucket(await loadBag(chromeArea()), origin, next), chromeArea());
}

async function onDocumentChanged(): Promise<void> {
  const next = await inspectedOrigin();
  if (next && next !== origin) {
    await syncOrigin();
    return;
  }
  if (!bucket) return;
  await writeBucket({ ...bucket, navigatedAt: Date.now() });
}

function turnSession() {
  if (!bucket) return undefined;
  if (turnSessionId) {
    const pinned = bucket.sessions.find((item) => item.id === turnSessionId);
    if (pinned) return pinned;
  }
  return activeSession(bucket);
}

async function beginTurn(goal: string): Promise<void> {
  if (!bucket) return;
  const active = activeSession(bucket);
  if (!active) return;
  turnSessionId = active.id;
  await writeBucket({
    ...bucket,
    running: true,
    sessions: bucket.sessions.map((item) =>
      item.id === active.id
        ? {
            ...item,
            turns: [...item.turns, { role: "user", text: goal }],
            updatedAt: Date.now(),
          }
        : item,
    ),
  });
}

async function endTurn(text: string, status: TurnStatus, history: unknown[] = messages): Promise<void> {
  if (!bucket) return;
  const target = turnSession();
  if (!target) return;
  await writeBucket({
    ...bucket,
    running: false,
    sessions: bucket.sessions.map((item) =>
      item.id === target.id
        ? {
            ...item,
            messages: history,
            turns: [
              ...item.turns,
              { role: "assistant", text, status, tools: turnTools.length ? turnTools : undefined },
            ],
            updatedAt: Date.now(),
          }
        : item,
    ),
  });
  await maybeNameSession(text, status, target.id);
}

async function maybeNameSession(answer: string, status: TurnStatus, sessionId: string): Promise<void> {
  if (!bucket) return;
  const target = bucket.sessions.find((item) => item.id === sessionId);
  if (!target || !shouldNameSession(target, status)) return;
  const settings = await loadSettings(chromeArea());
  if (!settings.apiKey) return;
  const user = target.turns.find((turn) => turn.role === "user")?.text ?? "";
  try {
    const title = await completeTitle({
      apiKey: settings.apiKey,
      user,
      assistant: answer,
    });
    if (!title || !bucket) return;
    const current = bucket.sessions.find((item) => item.id === sessionId);
    if (!current || current.title !== UNTITLED) return;
    await writeBucket(renameSession(bucket, current.id, title));
  } catch {
    // Leave Untitled; the user can rename.
  }
}

function requestConfirm(code: string): Promise<boolean> {
  const id = `cf-${++confirmSeq}`;
  return new Promise((resolve) => {
    confirmWait.set(id, (result) => {
      confirmWait.delete(id);
      if (result === "fallback") {
        resolve(window.confirm(`Claude wants to execute:\n\n${code}\n\nAllow?`));
        return;
      }
      resolve(result);
    });
    try {
      if (!port) {
        confirmWait.delete(id);
        resolve(window.confirm(`Claude wants to execute:\n\n${code}\n\nAllow?`));
        return;
      }
      port.postMessage({ kind: "confirm-request", id, code });
    } catch {
      confirmWait.delete(id);
      resolve(window.confirm(`Claude wants to execute:\n\n${code}\n\nAllow?`));
    }
  });
}

async function pageLog(kind: string, payload?: unknown) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (k: string, p: unknown) =>
        (window as unknown as { __ccLog?: (kind: string, payload?: unknown) => void }).__ccLog?.(
          k,
          p,
        ),
      args: [kind, payload ?? null],
    });
  } catch {
    // Tab navigated away or is restricted.
  }
}
