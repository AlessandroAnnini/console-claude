import { normalizeSettings, type Settings } from "./settings";

export const SETTINGS_KEY = "consoleClaude.settings";

export type SettingsArea = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export async function loadSettings(area: SettingsArea): Promise<Settings> {
  const bag = await area.get(SETTINGS_KEY);
  return normalizeSettings(bag[SETTINGS_KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(
  settings: Settings,
  area: SettingsArea,
): Promise<void> {
  await area.set({ [SETTINGS_KEY]: settings });
}

export function chromeArea(): SettingsArea {
  return {
    get: (key) => chrome.storage.local.get(key),
    set: (items) => chrome.storage.local.set(items),
  };
}
