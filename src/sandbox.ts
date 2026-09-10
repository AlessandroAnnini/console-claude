/** Sandboxed Mermaid renderer. No chrome.* APIs. Inlined into sandbox.html. */
import mermaid from "mermaid";

export type MermaidAsk = { kind: "render"; id: string; source: string };
export type MermaidReply =
  | { kind: "ready" }
  | { kind: "svg"; id: string; svg: string }
  | { kind: "error"; id: string; error: string };

try {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
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
} catch {
  // Listener still registers so the panel gets an error instead of silence.
}

let renderSeq = 0;

window.addEventListener("message", (event) => {
  const data = event.data as MermaidAsk | undefined;
  if (!data || data.kind !== "render" || !data.id || typeof data.source !== "string") return;
  const dest = event.source as Window | null;
  if (!dest?.postMessage) return;
  const renderId = `cc-${++renderSeq}`;
  void mermaid
    .render(renderId, data.source)
    .then(({ svg }) => {
      dest.postMessage({ kind: "svg", id: data.id, svg } satisfies MermaidReply, "*");
    })
    .catch((error: unknown) => {
      dest.postMessage(
        {
          kind: "error",
          id: data.id,
          error: error instanceof Error ? error.message : String(error),
        } satisfies MermaidReply,
        "*",
      );
    });
});
