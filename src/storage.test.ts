import { describe, expect, it } from "vitest";
import { loadSettings, saveSettings, SETTINGS_KEY } from "./storage";
import { DEFAULT_SETTINGS } from "./settings";

function memoryArea(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    },
    data,
  };
}

describe("settings storage", () => {
  it("round-trips a key without exposing it on defaults", async () => {
    const area = memoryArea();
    await saveSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test" }, area);
    expect(area.data[SETTINGS_KEY]).toMatchObject({ apiKey: "sk-test" });
    const loaded = await loadSettings(area);
    expect(loaded.apiKey).toBe("sk-test");
    expect(loaded.confirm).toBe(true);
  });
});
