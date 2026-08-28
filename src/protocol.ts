export const PAGE_SOURCE = "cc-page";
export const EXT_SOURCE = "cc-ext";

export type PageRequest = {
  source: typeof PAGE_SOURCE;
  id: string;
  type: "ask" | "stop" | "reset" | "history" | "config-get" | "config-set";
  goal?: string;
  confirm?: boolean;
};

export type ExtReply = {
  source: typeof EXT_SOURCE;
  id: string;
  type: "reply";
  text?: string;
  error?: string;
  history?: unknown;
  config?: { confirm: boolean; model?: string; maxSteps?: number };
};
