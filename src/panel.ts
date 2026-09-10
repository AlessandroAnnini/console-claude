import { enhanceCodeBlock, languageFromClass } from "./code-block";
import { downloadBlob, downloadText, mermaidFilename, svgElementToPngBlob } from "./download";
import {
  clampDrawerWidth,
  DRAWER_DEFAULT,
  loadDrawer,
  saveDrawer,
  type DrawerState,
} from "./drawer";
import { renderMarkdownFragment, sanitizeMermaidSvg, type MermaidBlock } from "./markdown";
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
  sessionMatchesTitle,
  SESSIONS_KEY,
  type OriginBucket,
  type Session,
  type Turn,
} from "./sessions";
import { chromeArea } from "./storage";
import { canPatchLastExchange, groupExchanges, turnSig } from "./transcript-paint";

const tabId = chrome.devtools.inspectedWindow.tabId;
const originEl = document.getElementById("origin") as HTMLElement;
const layoutEl = document.querySelector(".layout") as HTMLElement;
const drawerToggle = document.getElementById("drawerToggle") as HTMLButtonElement;
const drawerResize = document.getElementById("drawerResize") as HTMLButtonElement;
const newBtn = document.getElementById("new") as HTMLButtonElement;
const searchWrap = document.getElementById("sessionSearchWrap") as HTMLElement;
const searchEl = document.getElementById("sessionSearch") as HTMLInputElement;
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
let engineError = "";
let sending = false;
let drawerDirty = false;
let confirmId = "";
let seq = 0;
let paint = 0;
let painted = { sessionId: "", sig: "", running: false, turns: [] as Turn[] };
let renamingId: string | null = null;
let finishRename: ((save: boolean) => void) | null = null;
let drawer: DrawerState = { open: true, width: DRAWER_DEFAULT };

function applyDrawer() {
  layoutEl.style.setProperty("--drawer-width", `${drawer.width}px`);
  layoutEl.classList.toggle("drawer-closed", !drawer.open);
  drawerToggle.setAttribute("aria-expanded", drawer.open ? "true" : "false");
  drawerToggle.setAttribute("aria-label", drawer.open ? "Hide sessions" : "Show sessions");
}

function isBusy() {
  return Boolean(bucket?.running) || sending;
}

function persistDrawer() {
  drawerDirty = true;
  void saveDrawer(drawer, chromeArea());
}

applyDrawer();

function connect() {
  try {
    const next = chrome.runtime.connect({ name: PANEL_PORT });
    port = next;
    next.postMessage({ kind: "hello", tabId });
    next.onMessage.addListener((msg: ConfirmRequest | { kind?: string; error?: string }) => {
      if (msg && msg.kind === "confirm-request") {
        const request = msg as ConfirmRequest;
        confirmId = request.id;
        codeEl.textContent = request.code;
        dlg.showModal();
        return;
      }
      if (msg && msg.kind === "reply") {
        sending = false;
        if (msg.error) {
          engineError = msg.error;
          render();
        }
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

function renderSessionList() {
  const sessions = bucket?.sessions ?? [];
  const running = isBusy();
  newBtn.hidden = sessions.length === 0;
  newBtn.disabled = running;
  searchWrap.hidden = sessions.length === 0;
  const query = searchEl.value;
  if (renamingId) return;
  const visible = sessions.filter((session) => sessionMatchesTitle(session.title, query));
  if (query.trim() && !visible.length) {
    const none = document.createElement("li");
    none.className = "none";
    none.textContent = "No matching sessions";
    listEl.replaceChildren(none);
    return;
  }
  listEl.replaceChildren(
    ...visible.map((session) => {
      const row = document.createElement("li");
      if (session.id === bucket?.activeId) row.className = "active";
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = session.title;
      title.title = "Double-click to rename";
      title.addEventListener("click", (event) => {
        event.stopPropagation();
        if (running || !bucket) return;
        if (session.id !== bucket.activeId) void write(selectSession(bucket, session.id));
      });
      title.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (running || !bucket) return;
        if (session.id !== bucket.activeId) void write(selectSession(bucket, session.id));
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
}

function nearBottom(): boolean {
  return turnsEl.scrollHeight - turnsEl.scrollTop - turnsEl.clientHeight < 48;
}

function emptyTranscript() {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent =
    "Ask Claude about this page. Console commands start a new session when this one already has history.";
  turnsEl.replaceChildren(empty);
}

function syncThinking(running: boolean, groups: Turn[][]) {
  for (const node of Array.from(turnsEl.querySelectorAll("[data-thinking]"))) node.remove();
  for (const node of Array.from(turnsEl.querySelectorAll(".thinking"))) node.remove();
  if (!running) return;
  const lastGroup = groups.at(-1);
  const lastExchange = Array.from(turnsEl.querySelectorAll(":scope > .exchange")).at(-1);
  if (lastExchange && lastGroup && !lastGroup.some((turn) => turn.role === "assistant")) {
    lastExchange.append(thinkingNode());
    return;
  }
  const wait = document.createElement("section");
  wait.className = "exchange";
  wait.dataset.thinking = "";
  wait.append(thinkingNode());
  turnsEl.append(wait);
}

function paintTranscript(turns: Turn[], running: boolean, mode: "full" | "last") {
  const groups = groupExchanges(turns);
  paint += 1;
  const gen = paint;
  if (mode === "full") {
    const nodes = groups.map((group) => exchangeNode(group, gen));
    turnsEl.replaceChildren(...nodes);
  } else {
    const last = groups.at(-1);
    if (!last) return;
    const next = exchangeNode(last, gen);
    const rows = Array.from(turnsEl.querySelectorAll(":scope > .exchange:not([data-thinking])"));
    if (rows.length === groups.length) {
      rows.at(-1)?.replaceWith(next);
    } else if (rows.length + 1 === groups.length) {
      const tail = rows.at(-1);
      if (tail) tail.after(next);
      else turnsEl.append(next);
    } else {
      turnsEl.replaceChildren(...groups.map((group) => exchangeNode(group, gen)));
    }
  }
  syncThinking(running, groups);
}

function render() {
  const active = bucket ? activeSession(bucket) : undefined;
  const running = isBusy();
  renderSessionList();
  const n = active?.messages.length ?? 0;
  if (engineError) {
    bannerEl.hidden = false;
    bannerEl.textContent = engineError;
  } else if (banner) {
    bannerEl.hidden = false;
    bannerEl.textContent = `Document is new. ${n} message${n === 1 ? "" : "s"} still loaded.`;
  } else {
    bannerEl.hidden = true;
    bannerEl.textContent = "";
  }
  const turns = active?.turns ?? [];
  const sessionId = active?.id ?? "";
  const sig = turnSig(turns);
  const empty = !turns.length && !running;
  sendBtn.textContent = running ? "Stop" : "Send";
  sendBtn.classList.toggle("stop", running);
  if (empty) {
    if (painted.sig !== "" || painted.sessionId !== sessionId || turnsEl.querySelector(".exchange")) {
      emptyTranscript();
    }
    painted = { sessionId, sig, running, turns };
    return;
  }
  const sessionChanged = sessionId !== painted.sessionId;
  const sameTurns = !sessionChanged && sig === painted.sig;
  if (sameTurns) {
    if (running !== painted.running) syncThinking(running, groupExchanges(turns));
    painted = { sessionId, sig, running, turns };
    return;
  }
  const stick = nearBottom();
  if (sessionChanged || !canPatchLastExchange(painted.turns, turns) || !turnsEl.querySelector(".exchange")) {
    paintTranscript(turns, running, "full");
  } else {
    paintTranscript(turns, running, "last");
  }
  if (stick) turnsEl.scrollTop = turnsEl.scrollHeight;
  painted = { sessionId, sig, running, turns };
}

function exchangeNode(turns: Turn[], gen: number): HTMLElement {
  const wrap = document.createElement("section");
  wrap.className = "exchange";
  wrap.append(...turns.map((turn) => turnNode(turn, gen)));
  return wrap;
}

function turnNode(turn: Turn, gen: number) {
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
    wrap.append(assistantBody(turn.text, gen));
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

function assistantBody(text: string, gen: number): HTMLElement {
  const body = document.createElement("div");
  body.className = "md";
  try {
    const { fragment, blocks } = renderMarkdownFragment(text);
    for (const node of Array.from(fragment.querySelectorAll("*"))) {
      if (node.children.length) continue;
      const match = /^%%CC_MERMAID_(\d+)%%$/.exec(node.textContent?.trim() ?? "");
      if (!match) continue;
      const slot = document.createElement("div");
      slot.className = "mermaid";
      slot.dataset.index = match[1];
      node.replaceWith(slot);
    }
    for (const table of Array.from(fragment.querySelectorAll("table"))) {
      const hold = document.createElement("div");
      hold.className = "table-wrap";
      table.replaceWith(hold);
      hold.append(table);
    }
    for (const pre of Array.from(fragment.querySelectorAll("pre"))) {
      const code = pre.querySelector("code");
      const source = code?.textContent ?? pre.textContent ?? "";
      const language = languageFromClass(code?.className ?? "");
      enhanceCodeBlock(pre, source, language);
    }
    body.append(fragment);
    if (blocks.length) void fillMermaid(body, blocks, gen);
  } catch {
    body.textContent = text;
  }
  return body;
}

let sandboxReady: Promise<HTMLIFrameElement> | null = null;
const mermaidWait = new Map<string, (svg: string | null) => void>();

window.addEventListener("message", (event) => {
  const msg = event.data as MermaidReply;
  if (!msg || typeof msg !== "object") return;
  if (msg.kind !== "svg" && msg.kind !== "error") return;
  if (typeof msg.id !== "string") return;
  const wait = mermaidWait.get(msg.id);
  if (!wait) return;
  mermaidWait.delete(msg.id);
  wait(msg.kind === "svg" ? msg.svg : null);
});

function ensureSandbox(): Promise<HTMLIFrameElement> {
  if (sandboxReady) return sandboxReady;
  sandboxReady = new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "Mermaid";
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
    frame.src = "sandbox.html";
    const timer = window.setTimeout(() => {
      sandboxReady = null;
      frame.remove();
      reject(new Error("sandbox"));
    }, 20000);
    frame.addEventListener(
      "load",
      () => {
        window.clearTimeout(timer);
        resolve(frame);
      },
      { once: true },
    );
    document.body.append(frame);
  });
  return sandboxReady;
}

function askMermaid(source: string): Promise<string | null> {
  const id = `m-${++seq}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      mermaidWait.delete(id);
      resolve(null);
    }, 20000);
    mermaidWait.set(id, (svg) => {
      window.clearTimeout(timer);
      resolve(svg);
    });
    void ensureSandbox()
      .then((frame) => {
        const ask: MermaidAsk = { kind: "render", id, source };
        frame.contentWindow?.postMessage(ask, "*");
      })
      .catch(() => {
        window.clearTimeout(timer);
        mermaidWait.delete(id);
        resolve(null);
      });
  });
}

function thinkingNode(): HTMLElement {
  const row = document.createElement("p");
  row.className = "thinking";
  row.setAttribute("aria-live", "polite");
  const mark = document.createElement("span");
  mark.className = "mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "○";
  const label = document.createElement("span");
  label.textContent = "Thinking";
  row.append(mark, label);
  return row;
}

function mermaidFallback(source: string): HTMLElement {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = source;
  pre.append(code);
  return enhanceCodeBlock(pre, source);
}

function chip(label: string, aria: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip";
  btn.setAttribute("aria-label", aria);
  btn.textContent = label;
  return btn;
}

function attachMermaidChrome(slot: HTMLElement, source: string) {
  if (slot.parentElement?.classList.contains("diagram")) return;
  const wrap = document.createElement("div");
  wrap.className = "diagram";
  const tools = document.createElement("div");
  tools.className = "diagram-tools";
  const live = document.createElement("span");
  live.className = "copy-live";
  live.setAttribute("aria-live", "polite");
  const flash = (text: string) => {
    live.textContent = text;
    window.setTimeout(() => {
      if (live.textContent === text) live.textContent = "";
    }, 1600);
  };
  const png = chip("PNG", "Download PNG");
  const code = chip("Code", "Download Mermaid source");
  png.addEventListener("click", () => {
    const svg = slot.querySelector("svg");
    if (!svg) {
      flash("PNG failed");
      return;
    }
    void svgElementToPngBlob(svg).then(
      (blob) => {
        downloadBlob(blob, mermaidFilename(source, "png"));
        flash("Downloaded PNG");
      },
      () => {
        flash("PNG failed");
      },
    );
  });
  code.addEventListener("click", () => {
    downloadText(source, mermaidFilename(source, "mmd"));
    flash("Downloaded source");
  });
  if (slot.querySelector("svg")) tools.append(png);
  tools.append(code);
  slot.replaceWith(wrap);
  wrap.append(tools, live, slot);
}

async function fillMermaid(root: HTMLElement, blocks: MermaidBlock[], gen: number) {
  const drawn = await Promise.all(
    blocks.map(async (block) => ({ block, svg: await askMermaid(block.source) })),
  );
  if (gen !== paint) return;
  for (const { block, svg } of drawn) {
    const index = block.id.replace("mermaid-", "");
    const slot = root.querySelector(`[data-index="${index}"]`);
    if (!(slot instanceof HTMLElement)) continue;
    const el = svg ? sanitizeMermaidSvg(svg) : null;
    slot.replaceChildren(el ?? mermaidFallback(block.source));
    attachMermaidChrome(slot, block.source);
  }
}

function startRename(row: HTMLElement, session: Session) {
  if (renamingId) finishRename?.(false);
  renamingId = session.id;
  const field = document.createElement("input");
  field.type = "text";
  field.value = session.title;
  field.setAttribute("aria-label", "Session name");
  row.replaceChildren(field);
  const finish = (save: boolean) => {
    if (renamingId !== session.id) return;
    renamingId = null;
    finishRename = null;
    if (!bucket) return;
    void write(save ? renameSession(bucket, session.id, field.value) : bucket);
  };
  finishRename = finish;
  field.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish(event.key === "Enter");
    },
    true,
  );
  field.addEventListener("blur", () => finish(true));
  window.requestAnimationFrame(() => {
    field.focus();
    field.select();
  });
}

function askOrStop() {
  if (bucket?.running || sending) {
    port?.postMessage({ type: "stop", id: `p-${++seq}` });
    sending = false;
    return;
  }
  const goal = goalEl.value.trim();
  if (!goal || !origin) return;
  void (async () => {
    if (!bucket?.sessions.length) {
      await write(ensureOrigin({}, origin).bucket);
    }
    banner = false;
    engineError = "";
    sending = true;
    goalEl.value = "";
    render();
    port?.postMessage({ type: "ask", id: `p-${++seq}`, goal, via: "panel" });
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
document.addEventListener(
  "keydown",
  (event) => {
    if (finishRename && (event.key === "Enter" || event.key === "Escape")) {
      event.preventDefault();
      event.stopPropagation();
      finishRename(event.key === "Enter");
      return;
    }
    if (event.key === "Escape" && bucket?.running) {
      event.preventDefault();
      port?.postMessage({ type: "stop", id: `p-${++seq}` });
    }
  },
  true,
);
searchEl.addEventListener("input", () => {
  renderSessionList();
});
drawerToggle.addEventListener("click", () => {
  drawer = { ...drawer, open: !drawer.open };
  applyDrawer();
  persistDrawer();
});
drawerResize.addEventListener("pointerdown", (event) => {
  if (!drawer.open) return;
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = drawer.width;
  layoutEl.classList.add("drawer-dragging");
  drawerResize.setPointerCapture(event.pointerId);
  const onMove = (move: PointerEvent) => {
    drawer = { ...drawer, width: clampDrawerWidth(startWidth + (move.clientX - startX)) };
    applyDrawer();
  };
  const onUp = () => {
    layoutEl.classList.remove("drawer-dragging");
    drawerResize.removeEventListener("pointermove", onMove);
    drawerResize.removeEventListener("pointerup", onUp);
    persistDrawer();
  };
  drawerResize.addEventListener("pointermove", onMove);
  drawerResize.addEventListener("pointerup", onUp);
});
drawerResize.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const step = event.key === "ArrowRight" ? 16 : -16;
  drawer = { ...drawer, width: clampDrawerWidth(drawer.width + step) };
  applyDrawer();
  persistDrawer();
});
void loadDrawer(chromeArea()).then((next) => {
  if (drawerDirty) return;
  drawer = next;
  applyDrawer();
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
  if (!next.running) sending = false;
  bucket = next;
  render();
});
