import { chromeArea, loadSettings, saveSettings } from "./storage";

type DevtoolsHello = { kind: "hello"; tabId: number };
type DevtoolsReply = { kind: "reply"; id: string } & Record<string, unknown>;
type PageMsg = {
  id: string;
  type: string;
  goal?: string;
  confirm?: boolean;
};

const ports = new Map<number, chrome.runtime.Port>();
const pending = new Map<string, (reply: DevtoolsReply) => void>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "devtools") return;
  let tabId = -1;
  port.onMessage.addListener((msg: DevtoolsHello | DevtoolsReply) => {
    if (msg && "kind" in msg && msg.kind === "hello") {
      tabId = msg.tabId;
      ports.set(tabId, port);
      return;
    }
    if (msg && "kind" in msg && msg.kind === "reply" && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    }
  });
  port.onDisconnect.addListener(() => {
    if (tabId >= 0) ports.delete(tabId);
  });
});

chrome.runtime.onMessage.addListener((msg: PageMsg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  void handlePage(msg, tabId).then(sendResponse);
  return true;
});

async function handlePage(msg: PageMsg, tabId?: number) {
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
      return { id: msg.id, type: "reply", error: "Open DevTools to run Claude." };
    }
    return { id: msg.id, type: "reply" };
  }
  return await new Promise<DevtoolsReply>((resolve) => {
    pending.set(msg.id, resolve);
    port.postMessage({ ...msg, tabId });
  });
}
