import { renderMarkdownFragment, type MermaidBlock } from "./markdown";
import { SESSION_DELETE_MARK } from "./panel-copy";
import { PANEL_PORT, type ConfirmRequest } from "./protocol";
import type { MermaidAsk, MermaidReply } from "./sandbox";
import {
  activeSession,
  deleteSession,
  ensureOrigin,
  loadBag,
  putBucket,
  renameSession,
  resetNewSession,
  saveBag,
  selectSession,
  SESSIONS_KEY,
  type OriginBucket,
  type Session,
  type Turn,
} from "./sessions";
import { chromeArea } from "./storage";

const tabId = chrome.devtools.inspectedWindow.tabId;
const originEl = document.getElementById("origin") as HTMLElement;
const newBtn = document.getElementById("new") as HTMLButtonElement;
const listEl = document.getElementById("sessions") as HTMLUListElement;
const bannerEl = document.getElementById("banner") as HTMLElement;
const turnsEl = document.getElementById("turns") as HTMLElement;
const form = document.getElementById("composer") as HTMLFormElement;
const goalEl = document.getElementById("goal") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const dlg = document.getElementById("confirmDlg") as HTMLDialogElement;
const codeEl = document.getElementById("confirmCode") as HTMLElement;

let port: chrome.runtime.Port | null = null;
let origin = "";
let bucket: OriginBucket | null = null;
let banner = false;
let confirmId = "";
let seq = 0;

function connect() {
  try {
    const next = chrome.runtime.connect({ name: PANEL_PORT });
    port = next;
    next.postMessage({ kind: "hello", tabId });
    next.onMessage.addListener((msg: ConfirmRequest | { kind?: string }) => {
      if (msg && msg.kind === "confirm-request") {
        const request = msg as ConfirmRequest;
        confirmId = request.id;
        codeEl.textContent = request.code;
        dlg.showModal();
      }
    });
    next.onDisconnect.addListener(() => {
      if (port === next) port = null;
      window.setTimeout(connect, 250);
    });
  } catch {
    window.setTimeout(connect, 1000);
  }
}

function inspectedOrigin(): Promise<string> {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval("location.origin", (result) => {
      resolve(typeof result === "string" ? result : "");
    });
  });
}

async function refresh() {
  origin = await inspectedOrigin();
  originEl.textContent = origin;
  if (!origin) return;
  bucket = (await loadBag(chromeArea()))[origin] ?? null;
  render();
}

async function write(next: OriginBucket) {
  bucket = next;
  if (!origin) return;
  await saveBag(putBucket(await loadBag(chromeArea()), origin, next), chromeArea());
  render();
}

function render() {
  const sessions = bucket?.sessions ?? [];
  const active = bucket ? activeSession(bucket) : undefined;
  const running = Boolean(bucket?.running);
  newBtn.hidden = sessions.length === 0;
  newBtn.disabled = running;
  listEl.replaceChildren(
    ...sessions.map((session) => {
      const row = document.createElement("li");
      if (session.id === bucket?.activeId) row.className = "active";
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = session.title;
      title.addEventListener("click", (event) => {
        event.stopPropagation();
        if (running || !bucket) return;
        if (session.id !== bucket.activeId) {
          void write(selectSession(bucket, session.id));
          return;
        }
        startRename(row, session);
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.textContent = SESSION_DELETE_MARK;
      del.setAttribute("aria-label", "Delete session");
      del.title = "Delete";
      del.addEventListener("click", (event) => {
        event.stopPropagation();
        if (running || !bucket) return;
        if (!window.confirm(`Delete “${session.title}”?`)) return;
        void write(deleteSession(bucket, session.id));
      });
      row.append(title, del);
      row.addEventListener("click", () => {
        if (!running && bucket && session.id !== bucket.activeId) void write(selectSession(bucket, session.id));
      });
      return row;
    }),
  );
  const n = active?.messages.length ?? 0;
  bannerEl.hidden = !banner;
  bannerEl.textContent = banner
    ? `Document is new. ${n} message${n === 1 ? "" : "s"} still loaded.`
    : "";
  const turns = active?.turns ?? [];
  if (!turns.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Ask Claude about this page. Console commands attach to the same session.";
    turnsEl.replaceChildren(empty);
  } else {
    turnsEl.replaceChildren(...groupExchanges(turns).map(exchangeNode));
    turnsEl.scrollTop = turnsEl.scrollHeight;
  }
  sendBtn.textContent = running ? "Stop" : "Send";
  sendBtn.classList.toggle("stop", running);
}

function groupExchanges(turns: Turn[]): Turn[][] {
  const groups: Turn[][] = [];
  let current: Turn[] = [];
  for (const turn of turns) {
    if (turn.role === "user" && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(turn);
  }
  if (current.length) groups.push(current);
  return groups;
}

function exchangeNode(turns: Turn[]): HTMLElement {
  const wrap = document.createElement("section");
  wrap.className = "exchange";
  wrap.append(...turns.map(turnNode));
  return wrap;
}

function turnNode(turn: Turn) {
  const wrap = document.createElement("article");
  wrap.className = turn.role === "user" ? "turn user" : "turn";
  const who = document.createElement("p");
  who.className = "who";
  who.textContent = turn.role === "user" ? "You" : "Claude";
  wrap.append(who);
  if (turn.role === "user") {
    const body = document.createElement("p");
    body.textContent = turn.text;
    wrap.append(body);
  } else {
    wrap.append(assistantBody(turn.text));
  }
  for (const tool of turn.tools ?? []) {
    const card = document.createElement("div");
    card.className = "tool";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = tool.name;
    const pre = document.createElement("pre");
    pre.textContent = tool.summary;
    card.append(name, pre);
    wrap.append(card);
  }
  if (turn.status && turn.status !== "ok") {
    const status = document.createElement("p");
    status.className = "status";
    status.textContent = turn.status === "stopped" ? "Stopped" : "Error";
    wrap.append(status);
  }
  return wrap;
}

function assistantBody(text: string): HTMLElement {
  const body = document.createElement("div");
  body.className = "md";
  try {
    const { fragment, blocks } = renderMarkdownFragment(text);
    for (const node of [...fragment.querySelectorAll("p")]) {
      const match = /^%%CC_MERMAID_(\d+)%%$/.exec(node.textContent?.trim() ?? "");
      if (!match) continue;
      const slot = document.createElement("div");
      slot.className = "mermaid";
      slot.dataset.index = match[1];
      node.replaceWith(slot);
    }
    for (const table of [...fragment.querySelectorAll("table")]) {
      const hold = document.createElement("div");
      hold.className = "table-wrap";
      table.replaceWith(hold);
      hold.append(table);
    }
    body.append(fragment);
    if (blocks.length) void fillMermaid(body, blocks);
  } catch {
    body.textContent = text;
  }
  return body;
}

let sandbox: HTMLIFrameElement | null = null;
let sandboxReady: Promise<HTMLIFrameElement> | null = null;
const mermaidWait = new Map<string, (svg: string | null) => void>();

function ensureSandbox(): Promise<HTMLIFrameElement> {
  if (sandboxReady) return sandboxReady;
  sandboxReady = new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "Mermaid";
    frame.src = "sandbox.html";
    frame.addEventListener("load", () => resolve(frame), { once: true });
    document.body.append(frame);
    sandbox = frame;
    window.addEventListener("message", (event) => {
      if (event.source !== sandbox?.contentWindow) return;
      const msg = event.data as MermaidReply;
      if (!msg || (msg.kind !== "svg" && msg.kind !== "error")) return;
      const wait = mermaidWait.get(msg.id);
      if (!wait) return;
      mermaidWait.delete(msg.id);
      wait(msg.kind === "svg" ? msg.svg : null);
    });
  });
  return sandboxReady;
}

function askMermaid(id: string, source: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      mermaidWait.delete(id);
      resolve(null);
    }, 8000);
    mermaidWait.set(id, (svg) => {
      window.clearTimeout(timer);
      resolve(svg);
    });
    void ensureSandbox().then((frame) => {
      const ask: MermaidAsk = { kind: "render", id, source };
      frame.contentWindow?.postMessage(ask, "*");
    });
  });
}

async function fillMermaid(root: HTMLElement, blocks: MermaidBlock[]) {
  for (const block of blocks) {
    const index = block.id.replace("mermaid-", "");
    const slot = root.querySelector(`[data-index="${index}"]`);
    if (!(slot instanceof HTMLElement)) continue;
    const svg = await askMermaid(block.id, block.source);
    if (!svg) {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.source;
      pre.append(code);
      slot.replaceChildren(pre);
      continue;
    }
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const el = parsed.documentElement;
    if (el.tagName.toLowerCase() === "svg") {
      slot.replaceChildren(document.importNode(el, true));
    } else {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.source;
      pre.append(code);
      slot.replaceChildren(pre);
    }
  }
}

function startRename(row: HTMLElement, session: Session) {
  const field = document.createElement("input");
  field.value = session.title;
  row.replaceChildren(field);
  field.focus();
  field.select();
  const finish = (save: boolean) => {
    if (!bucket) return;
    void write(save ? renameSession(bucket, session.id, field.value) : bucket);
  };
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  });
  field.addEventListener("blur", () => finish(true));
}

function askOrStop() {
  if (bucket?.running) {
    port?.postMessage({ type: "stop", id: `p-${++seq}` });
    return;
  }
  const goal = goalEl.value.trim();
  if (!goal || !origin) return;
  void (async () => {
    if (!bucket?.sessions.length) {
      await write(ensureOrigin({}, origin).bucket);
    }
    banner = false;
    goalEl.value = "";
    port?.postMessage({ type: "ask", id: `p-${++seq}`, goal });
  })();
}

function replyConfirm(allowed: boolean) {
  if (!confirmId) return;
  port?.postMessage({ kind: "confirm-reply", id: confirmId, allowed });
  confirmId = "";
  dlg.close();
}

connect();
void refresh();
document.getElementById("options")?.addEventListener("click", (event) => {
  event.preventDefault();
  void chrome.runtime.openOptionsPage();
});
newBtn.addEventListener("click", () => {
  if (bucket && !bucket.running) void write(resetNewSession(bucket));
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  askOrStop();
});
goalEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    askOrStop();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && bucket?.running) {
    event.preventDefault();
    port?.postMessage({ type: "stop", id: `p-${++seq}` });
  }
});
document.getElementById("allow")?.addEventListener("click", () => replyConfirm(true));
document.getElementById("deny")?.addEventListener("click", () => replyConfirm(false));
chrome.devtools.network.onNavigated.addListener(() => {
  banner = true;
  void refresh();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SESSIONS_KEY] || !origin) return;
  const bag = changes[SESSIONS_KEY].newValue as Record<string, OriginBucket> | undefined;
  const next = bag?.[origin];
  if (!next) return;
  bucket = next;
  render();
});
