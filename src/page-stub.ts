import { HELP_TEXT, parseGoal } from "./console-api";
import { runEval } from "./eval-wrapper";
import { STYLE } from "./log-style";
import { EXT_SOURCE, PAGE_SOURCE, type ExtReply, type PageRequest } from "./protocol";
import { serialize } from "./serialize";

type ClaudeFn = {
  (...args: unknown[]): Promise<string | void>;
  stop: () => void;
  reset: () => void;
  help: () => void;
  history: () => Promise<unknown>;
  last: string | null;
  busy: boolean;
  config: { confirm: boolean };
};

let seq = 0;
let last: string | null = null;
let busy = false;
let confirmFlag = true;
const pending = new Map<string, (reply: ExtReply) => void>();

function send(type: PageRequest["type"], extra: Partial<PageRequest> = {}): Promise<ExtReply> {
  const id = `cc-${++seq}`;
  const request: PageRequest = { source: PAGE_SOURCE, id, type, ...extra };
  return new Promise((resolve) => {
    pending.set(id, resolve);
    window.postMessage(request, "*");
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as ExtReply | undefined;
  if (!data || data.source !== EXT_SOURCE || data.type !== "reply") return;
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

function __ccLog(kind: keyof typeof STYLE | "code" | "stopped", payload?: unknown) {
  if (kind === "eval") {
    console.groupCollapsed("%cClaude → eval_js", STYLE.eval);
    console.log(payload);
    console.groupEnd();
    return;
  }
  if (kind === "code") {
    console.log(payload);
    return;
  }
  if (kind === "stopped") {
    console.log("%cStopped.", STYLE.error);
    return;
  }
  const label =
    kind === "result" ? "Tool result:" : kind === "error" ? "Claude:" : "Claude:";
  const style = kind === "ready" ? STYLE.ready : STYLE[kind] ?? STYLE.claude;
  console.log(`%c${kind === "ready" ? "Console Claude ready" : label}`, style, payload ?? "");
}

function help() {
  console.log("%cConsole Claude", STYLE.claude, `\n${HELP_TEXT}`);
}

async function claudeImpl(...args: unknown[]): Promise<string | void> {
  const goal = parseGoal(args[0], ...args.slice(1));
  if (goal == null) {
    help();
    return;
  }
  busy = true;
  try {
    const reply = await send("ask", { goal });
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

const claude = claudeImpl as ClaudeFn;
claude.stop = () => {
  void send("stop");
};
claude.reset = () => {
  last = null;
  void send("reset");
  console.log("%cClaude conversation reset.", STYLE.claude);
};
claude.help = help;
claude.history = async () => {
  const reply = await send("history");
  if (reply.error) throw new Error(reply.error);
  return reply.history;
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

void send("config-get").then((reply) => {
  if (typeof reply.config?.confirm === "boolean") confirmFlag = reply.config.confirm;
});

__ccLog("ready");
console.log(
  'Use: claude("Inspect this page") · claude.stop() · claude.reset() · claude.help()',
);

export {};
