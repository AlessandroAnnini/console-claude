import {
  DEVTOOLS_REQUIRED,
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
const pending = new Map<string, Pending>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "devtools") return;
  let tabId = -1;
  port.onMessage.addListener((msg: DevtoolsHello | DevtoolsPing | DevtoolsReply) => {
    if (msg && "kind" in msg && msg.kind === "ping") return;
    if (msg && "kind" in msg && msg.kind === "hello") {
      tabId = msg.tabId;
      ports.set(tabId, port);
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
        wait.resolve({
          kind: "reply",
          id,
          error: DEVTOOLS_REQUIRED,
        });
      }
    }
  });
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg: PageRequest, sender, sendResponse) => {
  const tabId = sender.tab?.id;
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
  const port = ports.get(tabId);
  if (!port) {
    if (msg.type === "ask") {
      return { id: msg.id, type: "reply", error: DEVTOOLS_REQUIRED };
    }
    return { id: msg.id, type: "reply" };
  }
  return await new Promise<DevtoolsReply>((resolve) => {
    pending.set(msg.id, { tabId, resolve });
    port.postMessage({ ...msg, tabId });
  });
}
