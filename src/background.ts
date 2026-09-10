import {
  DEVTOOLS_PORT,
  DEVTOOLS_REQUIRED,
  PAGE_SOURCE,
  PANEL_PORT,
  type ConfirmReply,
  type ConfirmRequest,
  type DevtoolsHello,
  type DevtoolsPing,
  type DevtoolsReply,
  type PageRequest,
} from "./protocol";
import { chromeArea, loadSettings, saveSettings } from "./storage";

type Pending = {
  tabId: number;
  resolve: (reply: DevtoolsReply) => void;
};

const ports = new Map<number, chrome.runtime.Port>();
const panelPorts = new Map<number, chrome.runtime.Port>();
const pending = new Map<string, Pending>();
const confirmWait = new Map<string, { tabId: number }>();

type EngineMsg = DevtoolsHello | DevtoolsPing | DevtoolsReply | ConfirmRequest;
type PanelMsg =
  | DevtoolsHello
  | ConfirmReply
  | (Partial<PageRequest> & { type?: PageRequest["type"]; id?: string; goal?: string });

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === DEVTOOLS_PORT) {
    attachDevtools(port);
    return;
  }
  if (port.name === PANEL_PORT) attachPanel(port);
});

function attachDevtools(port: chrome.runtime.Port) {
  let tabId = -1;
  port.onMessage.addListener((msg: EngineMsg) => {
    if (msg && "kind" in msg && msg.kind === "ping") return;
    if (msg && "kind" in msg && msg.kind === "hello") {
      tabId = msg.tabId;
      ports.set(tabId, port);
      return;
    }
    if (msg && "kind" in msg && msg.kind === "confirm-request") {
      const panel = tabId >= 0 ? panelPorts.get(tabId) : undefined;
      if (!panel) {
        port.postMessage({ kind: "confirm-reply", id: msg.id, fallback: true });
        return;
      }
      confirmWait.set(msg.id, { tabId });
      panel.postMessage(msg);
      return;
    }
    if (msg && "kind" in msg && msg.kind === "reply") {
      const wait = pending.get(msg.id);
      if (wait) {
        pending.delete(msg.id);
        wait.resolve(msg);
      }
    }
  });
  port.onDisconnect.addListener(() => {
    if (tabId >= 0) ports.delete(tabId);
    for (const [id, wait] of pending) {
      if (wait.tabId === tabId) {
        pending.delete(id);
        wait.resolve({ kind: "reply", id, error: DEVTOOLS_REQUIRED });
      }
    }
  });
}

function attachPanel(port: chrome.runtime.Port) {
  let tabId = -1;
  port.onMessage.addListener((msg: PanelMsg) => {
    if (msg && "kind" in msg && msg.kind === "hello") {
      tabId = msg.tabId;
      if (tabId >= 0) panelPorts.set(tabId, port);
      return;
    }
    if (msg && "kind" in msg && msg.kind === "confirm-reply") {
      confirmWait.delete(msg.id);
      ports.get(tabId)?.postMessage(msg);
      return;
    }
    const type = "type" in msg ? msg.type : undefined;
    if (!type || !["ask", "stop", "reset", "history"].includes(type)) return;
    const id = ("id" in msg && msg.id) || `panel-${Date.now()}`;
    const request: PageRequest = {
      source: PAGE_SOURCE,
      id,
      type,
      goal: "goal" in msg ? msg.goal : undefined,
      via: "via" in msg && msg.via === "console" ? "console" : "panel",
    };
    void forwardToDevtools(request, tabId).then((reply) => {
      try {
        port.postMessage({ kind: "reply", id: reply.id, text: reply.text, error: reply.error, history: reply.history });
      } catch {
        // Panel closed.
      }
    });
  });
  port.onDisconnect.addListener(() => {
    if (tabId >= 0) panelPorts.delete(tabId);
    for (const [id, wait] of confirmWait) {
      if (wait.tabId !== tabId) continue;
      confirmWait.delete(id);
      ports.get(tabId)?.postMessage({ kind: "confirm-reply", id, fallback: true });
    }
  });
}

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg: PageRequest & { tabId?: number }, sender, sendResponse) => {
  const fromExtension = sender.id === chrome.runtime.id && sender.tab == null;
  const tabId = sender.tab?.id ?? (fromExtension ? msg.tabId : undefined);
  void handlePage(msg, tabId)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        id: msg.id,
        type: "reply",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  return true;
});

async function handlePage(msg: PageRequest, tabId?: number) {
  if (msg.type === "config-get") {
    const settings = await loadSettings(chromeArea());
    return {
      id: msg.id,
      type: "reply",
      config: {
        confirm: settings.confirm,
        model: settings.model,
        maxSteps: settings.maxSteps,
      },
    };
  }
  if (msg.type === "config-set") {
    const settings = await loadSettings(chromeArea());
    settings.confirm = Boolean(msg.confirm);
    await saveSettings(settings, chromeArea());
    return { id: msg.id, type: "reply", config: { confirm: settings.confirm } };
  }
  if (tabId == null) {
    return { id: msg.id, type: "reply", error: "No tab." };
  }
  return await forwardToDevtools(msg, tabId);
}

function forwardToDevtools(msg: PageRequest, tabId: number): Promise<DevtoolsReply> {
  const port = ports.get(tabId);
  if (!port) {
    if (msg.type === "ask") {
      return Promise.resolve({ kind: "reply", id: msg.id, error: DEVTOOLS_REQUIRED });
    }
    return Promise.resolve({ kind: "reply", id: msg.id });
  }
  return new Promise((resolve) => {
    pending.set(msg.id, { tabId, resolve });
    port.postMessage({ ...msg, tabId });
  });
}
