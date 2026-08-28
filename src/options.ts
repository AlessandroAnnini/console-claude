import { normalizeSettings } from "./settings";
import { chromeArea, loadSettings, saveSettings } from "./storage";

const form = document.querySelector<HTMLFormElement>("#form")!;
const apiKey = document.querySelector<HTMLInputElement>("#apiKey")!;
const model = document.querySelector<HTMLInputElement>("#model")!;
const maxSteps = document.querySelector<HTMLInputElement>("#maxSteps")!;
const confirmBox = document.querySelector<HTMLInputElement>("#confirm")!;
const status = document.querySelector<HTMLElement>("#status")!;

async function refresh() {
  const settings = await loadSettings(chromeArea());
  apiKey.value = "";
  apiKey.placeholder = settings.apiKey ? "Key saved" : "Paste API key";
  model.value = settings.model;
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
  apiKey.value = "";
  status.textContent = "Saved.";
  await refresh();
});

void refresh();
