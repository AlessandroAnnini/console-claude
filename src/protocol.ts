/**
 * postMessage contract between the inspected page (MAIN stub) and the
 * isolated content script. The page never sees the API key.
 *
 * Page → isolated → service worker → DevTools page (agent loop).
 * Replies travel the same path in reverse.
 */
export const PAGE_SOURCE = "cc-page";
export const EXT_SOURCE = "cc-ext";

export type PageRequestType =
  | "ask"
  | "stop"
  | "reset"
  | "history"
  | "config-get"
  | "config-set";

export type PageRequest = {
  source: typeof PAGE_SOURCE;
  id: string;
  type: PageRequestType;
  goal?: string;
  confirm?: boolean;
};

export type ConfigSnapshot = {
  confirm: boolean;
  model?: string;
  maxSteps?: number;
};

export type ExtReply = {
  source: typeof EXT_SOURCE;
  id: string;
  type: "reply";
  text?: string;
  error?: string;
  history?: unknown;
  config?: ConfigSnapshot;
};

/** Isolated script pushes storage changes so `claude.config.confirm` stays current. */
export type ExtConfigPush = {
  source: typeof EXT_SOURCE;
  id: string;
  type: "config-push";
  config: ConfigSnapshot;
};

export type ExtMessage = ExtReply | ExtConfigPush;

export type DevtoolsHello = { kind: "hello"; tabId: number };
export type DevtoolsPing = { kind: "ping" };
export type DevtoolsReply = { kind: "reply"; id: string } & Omit<
  ExtReply,
  "source" | "type"
>;

/** Shown when the SW has no live DevTools-page port for this tab. */
export const DEVTOOLS_REQUIRED =
  "Close DevTools and open it again on this tab. Reloading the extension kills the hidden Console Claude page even if the console stays open.";
