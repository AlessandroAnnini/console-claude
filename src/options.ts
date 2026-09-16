import {
  clearBag,
  listOrigins,
  loadBag,
  removeOrigin,
  saveBag,
  SESSIONS_KEY,
  type OriginSummary,
} from "./sessions";
import { MODELS, normalizeSettings } from "./settings";
import { chromeArea, loadSettings, saveSettings } from "./storage";

const form = document.querySelector<HTMLFormElement>("#form")!;
const keyEntry = document.querySelector<HTMLElement>("#keyEntry")!;
const keySaved = document.querySelector<HTMLElement>("#keySaved")!;
const apiKey = document.querySelector<HTMLInputElement>("#apiKey")!;
const model = document.querySelector<HTMLSelectElement>("#model")!;
const maxSteps = document.querySelector<HTMLInputElement>("#maxSteps")!;
const confirmBox = document.querySelector<HTMLInputElement>("#confirm")!;
const removeKey = document.querySelector<HTMLButtonElement>("#removeKey")!;
const status = document.querySelector<HTMLElement>("#status")!;
const originsEl = document.querySelector<HTMLElement>("#origins")!;
const originsEmpty = document.querySelector<HTMLElement>("#originsEmpty")!;
const clearAll = document.querySelector<HTMLButtonElement>("#clearAll")!;

function fillModelSelect(selected: string) {
  model.replaceChildren();
  const ids = new Set<string>(MODELS.map((item) => item.id));
  for (const item of MODELS) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    model.append(option);
  }
  if (selected && !ids.has(selected)) {
    const option = document.createElement("option");
    option.value = selected;
    option.textContent = selected;
    model.append(option);
  }
  model.value = selected;
}

function showKey(hasKey: boolean) {
  keyEntry.hidden = hasKey;
  keySaved.hidden = !hasKey;
  if (!hasKey) apiKey.value = "";
}

async function refresh() {
  const settings = await loadSettings(chromeArea());
  showKey(Boolean(settings.apiKey));
  fillModelSelect(settings.model);
  maxSteps.value = String(settings.maxSteps);
  confirmBox.checked = settings.confirm;
  status.textContent = settings.apiKey ? "Key saved" : "No key saved";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const current = await loadSettings(chromeArea());
  const next = normalizeSettings({
    apiKey: apiKey.value.trim() || current.apiKey,
    model: model.value,
    maxSteps: Number(maxSteps.value),
    confirm: confirmBox.checked,
  });
  if (!next.apiKey) {
    status.textContent = "API key is required.";
    return;
  }
  await saveSettings(next, chromeArea());
  await refresh();
});

removeKey.addEventListener("click", async () => {
  const current = await loadSettings(chromeArea());
  await saveSettings({ ...current, apiKey: "" }, chromeArea());
  await refresh();
});

function sessionLabel(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
}

function renderOrigins(rows: OriginSummary[]) {
  originsEl.replaceChildren();
  originsEmpty.hidden = rows.length > 0;
  clearAll.hidden = rows.length === 0;
  for (const row of rows) {
    const item = document.createElement("li");
    item.className = "origin-row";
    const meta = document.createElement("div");
    meta.className = "origin-meta";
    const host = document.createElement("code");
    host.textContent = row.origin;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = sessionLabel(row.sessionCount);
    meta.append(host, count);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "secondary";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete sessions for ${row.origin}`);
    del.addEventListener("click", () => void deleteOrigin(row));
    item.append(meta, del);
    originsEl.append(item);
  }
}

async function refreshOrigins() {
  renderOrigins(listOrigins(await loadBag(chromeArea())));
}

async function deleteOrigin(row: OriginSummary) {
  const ok = window.confirm(
    `Delete ${sessionLabel(row.sessionCount)} for ${row.origin}? This cannot be undone. Your API key is not removed.`,
  );
  if (!ok) return;
  await saveBag(removeOrigin(await loadBag(chromeArea()), row.origin), chromeArea());
  status.textContent = `Deleted sessions for ${row.origin}`;
  await refreshOrigins();
}

clearAll.addEventListener("click", async () => {
  const rows = listOrigins(await loadBag(chromeArea()));
  if (!rows.length) return;
  const sessions = rows.reduce((sum, row) => sum + row.sessionCount, 0);
  const sites = rows.length === 1 ? "1 site" : `${rows.length} sites`;
  if (
    !window.confirm(
      `Delete ${sessionLabel(sessions)} across ${sites}? This cannot be undone. Your API key and model settings stay.`,
    )
  ) {
    return;
  }
  await saveBag(clearBag(), chromeArea());
  status.textContent = "Deleted all sessions.";
  await refreshOrigins();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SESSIONS_KEY]) return;
  void refreshOrigins();
});

void refresh();
void refreshOrigins();
