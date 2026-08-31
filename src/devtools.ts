/**
 * Hidden DevTools page. Owns the agent loop, Anthropic fetch, and confirm
 * dialog (this window, not the inspected page — the page can override confirm).
 *
 * eval_js runs via chrome.scripting.executeScript in MAIN, calling __ccEval
 * so the in-page serializer always wraps the result.
 */
import { runAgent } from "./agent";
import { completeMessages } from "./anthropic";
import { isAbortError } from "./errors";
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
    next.onMessage.addListener((msg: { id: string; type: string; goal?: string }) => {
      void handle(msg);
    });
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

void ensureStub();

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

async function handle(msg: { id: string; type: string; goal?: string }) {
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
  try {
    const result = await runAgent(msg.goal, {
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
          input?: { code?: string };
        }>;
        const hasTools = content.some((block) => block.type === "tool_use");
        if (hasTools) {
          for (const block of content) {
            if (block.type === "text" && block.text) await pageLog("claude", block.text);
          }
        }
        return { content };
      },
      evalJs: async (code) => {
        await pageLog("eval", code);
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
        await pageLog(value.ok ? "result" : "error", value);
        return value;
      },
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
