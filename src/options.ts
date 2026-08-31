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

void refresh();
