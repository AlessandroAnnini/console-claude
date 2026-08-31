/** Current Claude API IDs. See https://platform.claude.com/docs/en/about-claude/models/overview */
export const MODELS = [
  { id: "claude-sonnet-5", label: "Sonnet 5 — default, fast tool use" },
  { id: "claude-opus-5", label: "Opus 5 — strongest coding" },
  { id: "claude-fable-5", label: "Fable 5 — long-horizon, slower" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5 — fastest" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
] as const;

export const DEFAULT_MODEL = "claude-sonnet-5";

/** Retired IDs that 404 on the current API. Remap to the default. */
export const RETIRED_MODELS = new Set([
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
  "claude-opus-4-1-20250805",
  "claude-3-7-sonnet-20250219",
  "claude-3-5-haiku-20241022",
  "claude-3-haiku-20240307",
]);

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

export function resolveModel(raw?: string): string {
  const model = typeof raw === "string" ? raw.trim() : "";
  if (!model || RETIRED_MODELS.has(model)) return DEFAULT_MODEL;
  return model;
}

export function normalizeSettings(
  raw: Partial<Settings> | null | undefined,
): Settings {
  const maxSteps = Number(raw?.maxSteps);
  return {
    apiKey: typeof raw?.apiKey === "string" ? raw.apiKey : "",
    model: resolveModel(raw?.model),
    maxSteps:
      Number.isFinite(maxSteps) && maxSteps >= 1
        ? Math.min(Math.floor(maxSteps), 100)
        : DEFAULT_SETTINGS.maxSteps,
    confirm: raw?.confirm !== false,
  };
}
