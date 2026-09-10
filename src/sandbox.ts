/** Sandboxed Mermaid renderer. No chrome.* APIs (MV3 sandbox). */
import mermaid from "mermaid";

export type MermaidAsk = { kind: "render"; id: string; source: string };
export type MermaidReply =
  | { kind: "svg"; id: string; svg: string }
  | { kind: "error"; id: string; error: string };

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  themeVariables: {
    background: "#FAF9F5",
    primaryColor: "#ECE9E0",
    primaryTextColor: "#171717",
    primaryBorderColor: "#AAA69D",
    lineColor: "#55534D",
    secondaryColor: "#F7F5EE",
    tertiaryColor: "#FAF9F5",
    fontFamily: "IBM Plex Sans, Geist, Inter, sans-serif",
  },
});

function reply(target: Window, msg: MermaidReply) {
  target.postMessage(msg, "*");
}

window.addEventListener("message", (event) => {
  const data = event.data as MermaidAsk | undefined;
  if (!data || data.kind !== "render" || !data.id || typeof data.source !== "string") return;
  const source = event.source;
  if (!source || !("postMessage" in source)) return;
  const dest = source as Window;
  void mermaid
    .render(`cc-${data.id.replace(/[^a-zA-Z0-9_-]/g, "")}`, data.source)
    .then(({ svg }) => reply(dest, { kind: "svg", id: data.id, svg }))
    .catch((error: unknown) => {
      reply(dest, {
        kind: "error",
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
});
