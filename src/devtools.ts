import { runAgent } from "./agent";
import { completeMessages } from "./anthropic";
import { chromeArea, loadSettings } from "./storage";

const tabId = chrome.devtools.inspectedWindow.tabId;
const port = chrome.runtime.connect({ name: "devtools" });
port.postMessage({ kind: "hello", tabId });

let abort: AbortController | null = null;
let messages: unknown[] = [];

void chrome.scripting.executeScript({
  target: { tabId },
  world: "MAIN",
  files: ["stub.js"],
});

port.onMessage.addListener((msg: { id: string; type: string; goal?: string }) => {
  void handle(msg);
});

async function handle(msg: { id: string; type: string; goal?: string }) {
  if (msg.type === "stop") {
    abort?.abort();
    await pageLog("stopped");
    port.postMessage({ kind: "reply", id: msg.id });
    return;
  }
  if (msg.type === "reset") {
    messages = [];
    port.postMessage({ kind: "reply", id: msg.id });
    return;
  }
  if (msg.type === "history") {
    port.postMessage({ kind: "reply", id: msg.id, history: messages });
    return;
  }
  if (msg.type !== "ask" || !msg.goal) {
    port.postMessage({ kind: "reply", id: msg.id, error: "Unknown request." });
    return;
  }

  const settings = await loadSettings(chromeArea());
  if (!settings.apiKey) {
    port.postMessage({
      kind: "reply",
      id: msg.id,
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
        for (const block of content) {
          if (block.type === "text" && block.text) await pageLog("claude", block.text);
        }
        return { content };
      },
      evalJs: async (code) => {
        await pageLog("eval", code);
        const [inj] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: (source: string) =>
            (
              window as unknown as {
                __ccEval: (code: string) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
              }
            ).__ccEval(source),
          args: [code],
        });
        const value = inj?.result ?? { ok: false, error: "No eval result." };
        await pageLog(value.ok ? "result" : "error", value);
        return value;
      },
    });
    if (result.messages) messages = result.messages;
    if (result.outcome === "stopped") {
      port.postMessage({ kind: "reply", id: msg.id, text: "Stopped." });
      return;
    }
    port.postMessage({ kind: "reply", id: msg.id, text: result.text });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await pageLog("error", text);
    port.postMessage({ kind: "reply", id: msg.id, error: text });
  } finally {
    abort = null;
  }
}

async function pageLog(kind: string, payload?: unknown) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (k: string, p: unknown) =>
      (window as unknown as { __ccLog: (kind: string, payload?: unknown) => void }).__ccLog(k, p),
    args: [kind, payload ?? null],
  });
}
