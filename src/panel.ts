import { PANEL_PORT, type ConfirmRequest } from "./protocol";
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
      del.textContent = "Delete";
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
    turnsEl.innerHTML = `<p class="empty">Ask Claude about this page. Console commands attach to the same session.</p>`;
  } else {
    turnsEl.replaceChildren(...turns.map(turnNode));
    turnsEl.scrollTop = turnsEl.scrollHeight;
  }
  sendBtn.textContent = running ? "Stop" : "Send";
  sendBtn.classList.toggle("stop", running);
}

function turnNode(turn: { role: string; text: string; tools?: { name: string; summary: string }[]; status?: string }) {
  const wrap = document.createElement("article");
  wrap.className = "turn";
  const who = document.createElement("p");
  who.className = "who";
  who.textContent = turn.role === "user" ? "You" : "Claude";
  const body = document.createElement("p");
  body.textContent = turn.text;
  wrap.append(who, body);
  for (const tool of turn.tools ?? []) {
    const card = document.createElement("div");
    card.className = "tool";
    card.innerHTML = `<div class="name">${escapeHtml(tool.name)}</div><pre></pre>`;
    (card.querySelector("pre") as HTMLElement).textContent = tool.summary;
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
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
