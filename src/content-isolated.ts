import { EXT_SOURCE, PAGE_SOURCE, type ExtReply, type PageRequest } from "./protocol";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as PageRequest | undefined;
  if (!data || data.source !== PAGE_SOURCE) return;
  chrome.runtime.sendMessage(data, (reply: ExtReply) => {
    window.postMessage({ ...reply, source: EXT_SOURCE, type: "reply", id: data.id }, "*");
  });
});
