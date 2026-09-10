import { extensionAlive } from "./extension-alive";
import {
  EXT_SOURCE,
  PAGE_SOURCE,
  type ExtReply,
  type PageRequest,
} from "./protocol";
import { SETTINGS_KEY } from "./storage";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as PageRequest | undefined;
  if (!data || data.source !== PAGE_SOURCE) return;
  if (!extensionAlive()) return;
  try {
    chrome.runtime.sendMessage(data, (reply: ExtReply | undefined) => {
      if (!extensionAlive()) return;
      try {
        const error = chrome.runtime.lastError?.message;
        window.postMessage(
          {
            ...(reply ?? {}),
            source: EXT_SOURCE,
            type: "reply",
            id: data.id,
            ...(error ? { error } : {}),
          },
          "*",
        );
      } catch {
        // Extension reloaded; this isolated world is dead.
      }
    });
  } catch {
    // sendMessage throws once chrome.runtime is invalidated.
  }
});

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!extensionAlive()) return;
    if (area !== "local" || !changes[SETTINGS_KEY]) return;
    const next = changes[SETTINGS_KEY].newValue as { confirm?: boolean } | undefined;
    if (typeof next?.confirm !== "boolean") return;
    window.postMessage(
      {
        source: EXT_SOURCE,
        type: "config-push",
        id: "config-push",
        config: { confirm: next.confirm },
      },
      "*",
    );
  });
} catch {
  // Reloaded while this content script was still attached.
}

(globalThis as unknown as { __ccBridge?: boolean }).__ccBridge = true;
