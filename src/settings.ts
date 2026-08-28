export const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export type Settings = {
  apiKey: string;
  model: string;
  maxSteps: number;
  confirm: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: DEFAULT_MODEL,
  maxSteps: 20,
  confirm: true,
};

export function normalizeSettings(
  raw: Partial<Settings> | null | undefined,
): Settings {
  const maxSteps = Number(raw?.maxSteps);
  return {
    apiKey: typeof raw?.apiKey === "string" ? raw.apiKey : "",
    model:
      typeof raw?.model === "string" && raw.model.trim()
        ? raw.model.trim()
        : DEFAULT_MODEL,
    maxSteps:
      Number.isFinite(maxSteps) && maxSteps >= 1
        ? Math.min(Math.floor(maxSteps), 100)
        : DEFAULT_SETTINGS.maxSteps,
    confirm: raw?.confirm !== false,
  };
}
