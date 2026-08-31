import { HELP_TEXT, parseAsk } from "./console-api";
import { runEval } from "./eval-wrapper";
import { STYLE } from "./log-style";
import { isPageStubInstalled } from "./page-stub-guard";
import {
  EXT_SOURCE,
  PAGE_SOURCE,
  type ExtMessage,
  type ExtReply,
  type PageRequest,
} from "./protocol";
import { serialize } from "./serialize";

type ClaudeFn = {
  (...args: unknown[]): Promise<string | void>;
  inspect: (...args: unknown[]) => Promise<string | void>;
  stop: () => void;
  reset: () => void;
  help: () => void;
  history: () => Promise<unknown>;
  last: string | null;
  busy: boolean;
  config: { confirm: boolean };
};

const ASK_TIMEOUT_MS = 15 * 60 * 1000;
const CONTROL_TIMEOUT_MS = 20_000;

function install(): void {
  let seq = 0;
  let last: string | null = null;
  let busy = false;
  let confirmFlag = true;
  const pending = new Map<string, (reply: ExtReply) => void>();

  function send(
    type: PageRequest["type"],
    extra: Partial<PageRequest> = {},
  ): Promise<ExtReply> {
    const id = `cc-${++seq}`;
    const request: PageRequest = { source: PAGE_SOURCE, id, type, ...extra };
    const timeoutMs = type === "ask" ? ASK_TIMEOUT_MS : CONTROL_TIMEOUT_MS;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        if (!pending.delete(id)) return;
        resolve({
          source: EXT_SOURCE,
          id,
          type: "reply",
          error:
            type === "ask"
              ? "Timed out waiting for Claude. Is DevTools still open?"
              : "Timed out waiting for the extension.",
        });
      }, timeoutMs);
      pending.set(id, (reply) => {
        window.clearTimeout(timer);
        resolve(reply);
      });
      window.postMessage(request, "*");
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data as ExtMessage | undefined;
    if (!data || data.source !== EXT_SOURCE) return;
    if (data.type === "config-push") {
      if (typeof data.config?.confirm === "boolean") {
        confirmFlag = data.config.confirm;
      }
      return;
    }
    if (data.type !== "reply") return;
    const wait = pending.get(data.id);
    if (wait) {
      pending.delete(data.id);
      wait(data);
    }
  });

  async function __ccEval(code: string) {
    const raw = await runEval(code);
    if (!raw.ok) return raw;
    return { ok: true, result: serialize(raw.result) };
  }

  function __ccLog(kind: keyof typeof STYLE | "stopped" | "tool", payload?: unknown) {
    if (kind === "tool") {
      const entry = payload as { name?: string; input?: unknown; result?: unknown };
      console.groupCollapsed(`%cClaude → ${entry.name ?? "tool"}`, STYLE.eval);
      if (entry.input !== undefined) console.log(entry.input);
      console.log("%c→", STYLE.result, entry.result);
      console.groupEnd();
      return;
    }
    if (kind === "stopped") {
      console.log("%cStopped.", STYLE.error);
      return;
    }
    const label = kind === "ready" ? "Console Claude ready" : "Claude:";
    const style = kind === "ready" ? STYLE.ready : STYLE[kind] ?? STYLE.claude;
    console.log(`%c${label}`, style, payload ?? "");
  }

  function help() {
    console.log("%cConsole Claude", STYLE.claude, `\n${HELP_TEXT}`);
  }

  async function claudeImpl(...args: unknown[]): Promise<string | void> {
    const ask = parseAsk(args);
    if (ask == null) {
      help();
      return;
    }
    if (busy) {
      const error = "Claude is already running. Use claude.stop() first.";
      console.log("%cClaude:", STYLE.error, error);
      throw new Error(error);
    }
    busy = true;
    try {
      const extra: Partial<PageRequest> = { goal: ask.goal };
      if (ask.selected.length === 1) extra.selected = serialize(ask.selected[0]);
      else if (ask.selected.length > 1) extra.selected = ask.selected.map((node) => serialize(node));
      const reply = await send("ask", extra);
      if (reply.error) {
        console.log("%cClaude:", STYLE.error, reply.error);
        throw new Error(reply.error);
      }
      last = reply.text ?? null;
      if (reply.text) console.log("%cClaude:", STYLE.claude, reply.text);
      return reply.text;
    } finally {
      busy = false;
    }
  }

  const claude = ((...args: unknown[]) => {
    const run = claudeImpl(...args);
    void run.catch(() => undefined);
    return run;
  }) as ClaudeFn;
  claude.inspect = (...args: unknown[]) => claude(...args);
  claude.stop = () => {
    void send("stop");
  };
  claude.reset = () => {
    last = null;
    void send("reset");
    console.log("%cClaude conversation reset.", STYLE.claude);
  };
  claude.help = help;
  claude.history = () => {
    const run = send("history").then((reply) => {
      if (reply.error) throw new Error(reply.error);
      return reply.history;
    });
    void run.catch(() => undefined);
    return run;
  };
  Object.defineProperty(claude, "last", {
    get: () => last,
    enumerable: true,
  });
  Object.defineProperty(claude, "busy", {
    get: () => busy,
    enumerable: true,
  });
  claude.config = {
    get confirm() {
      return confirmFlag;
    },
    set confirm(value: boolean) {
      confirmFlag = Boolean(value);
      void send("config-set", { confirm: confirmFlag });
    },
  };

  Object.assign(window, { claude, __ccEval, __ccLog });

  void send("config-get")
    .then((reply) => {
      if (typeof reply.config?.confirm === "boolean") confirmFlag = reply.config.confirm;
    })
    .catch(() => undefined);

  __ccLog("ready");
  console.log(
    'Use: claude("Inspect this page") · claude($0) · claude.stop() · claude.help()',
  );
}

if (!isPageStubInstalled(window as unknown as { __ccEval?: unknown })) {
  install();
}

export {};
