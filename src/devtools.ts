/**
 * Hidden DevTools page. Owns the agent loop, Anthropic fetch, and confirm
 * dialog (this window, not the inspected page — the page can override confirm).
 *
 * eval_js runs via chrome.scripting.executeScript in MAIN, calling __ccEval
 * so the in-page serializer always wraps the result. network / resources are
 * read-only chrome.devtools.* snapshots (no debugger permission).
 */
import { runAgent, type ToolResult } from "./agent";
import { completeMessages } from "./anthropic";
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
import { chromeArea, loadSettings } from "./storage";

const tabId = chrome.devtools.inspectedWindow.tabId;

let port: chrome.runtime.Port | null = null;
let abort: AbortController | null = null;
let messages: unknown[] = [];

function connect() {
  try {
    const next = chrome.runtime.connect({ name: "devtools" });
    port = next;
    next.postMessage({ kind: "hello", tabId });
    next.onMessage.addListener(
      (msg: { id: string; type: string; goal?: string; selected?: unknown }) => {
        void handle(msg);
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

void ensureStub();
chrome.devtools.network.onNavigated.addListener(() => {
  finishedRequests.length = 0;
  void ensureStub();
});

function reply(msg: { id: string }, extra: Record<string, unknown> = {}) {
  port?.postMessage({ kind: "reply", id: msg.id, ...extra });
}

async function ensureStub() {
  try {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () =>
        typeof (window as unknown as { __ccEval?: unknown }).__ccEval === "function",
    });
    if (probe?.result) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["stub.js"],
    });
  } catch {
    // chrome://, Web Store, and other restricted pages cannot be injected.
  }
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
      return value;
    }
    if (name === "network") {
      const filter = parseNetworkFilter(input);
      const rows = summarizeHar(await readHar(), filter);
      if (filter.includeBody) await fillBody(rows);
      await pageLog("tool", { name: "network", input: filter, result: rows });
      return { ok: true, result: rows };
    }
    if (name === "resources") {
      const filter = {
        type: resourceType(input.type),
        url: typeof input.url === "string" ? input.url : undefined,
      };
      const rows = summarizeResources(await readResources(), filter);
      await pageLog("tool", { name: "resources", input: filter, result: rows });
      return { ok: true, result: rows };
    }
    return { ok: false, error: `Unknown tool: ${name}` };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { ok: false, error: text };
  }
}

async function handle(msg: { id: string; type: string; goal?: string; selected?: unknown }) {
  if (msg.type === "stop") {
    abort?.abort();
    reply(msg);
    return;
  }
  if (msg.type === "reset") {
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

  const settings = await loadSettings(chromeArea());
  if (!settings.apiKey) {
    reply(msg, {
      error: "No API key. Save one on the Console Claude options page.",
    });
    return;
  }

  abort = new AbortController();
  const goal =
    msg.selected == null
      ? msg.goal
      : `Selected node:\n${JSON.stringify(msg.selected)}\n\n${msg.goal}`;
  try {
    const result = await runAgent(goal, {
      signal: abort.signal,
      maxSteps: settings.maxSteps,
      history: messages,
      confirm: settings.confirm
        ? async (code) => window.confirm(`Claude wants to execute:\n\n${code}\n\nAllow?`)
        : undefined,
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
    if (result.messages) messages = result.messages;
    if (result.outcome === "stopped") {
      reply(msg, { text: "Stopped." });
      return;
    }
    reply(msg, { text: result.text });
  } catch (error) {
    if (isAbortError(error)) {
      reply(msg, { text: "Stopped." });
      return;
    }
    const text = error instanceof Error ? error.message : String(error);
    await pageLog("error", text);
    reply(msg, { error: text });
  } finally {
    abort = null;
  }
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
