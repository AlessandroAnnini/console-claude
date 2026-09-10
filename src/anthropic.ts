/** Messages API from the DevTools page. The key stays in extension storage. */
import { SYSTEM_PROMPT, TOOLS } from "./prompt";
import { sanitizeTitle } from "./sessions";

export type AnthropicMessage = { role: string; content: unknown };

const CACHE = { type: "ephemeral" as const };

export const TITLE_MODEL = "claude-haiku-4-5";

export const TITLE_SYSTEM = `Name this conversation for a sidebar list.
Return JSON only: {"title":"..."}.
Rules: sentence case; 3 to 7 words; no quotes; no trailing period; no emoji.`;

export async function completeMessages(opts: {
  apiKey: string;
  model: string;
  maxTokens?: number;
  messages: AnthropicMessage[];
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}): Promise<{ content: Array<Record<string, unknown>> }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const response = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: opts.signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: CACHE }],
      tools: TOOLS.map((tool, index) =>
        index === TOOLS.length - 1 ? { ...tool, cache_control: CACHE } : tool,
      ),
      messages: opts.messages,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${text}`);
  }
  return response.json() as Promise<{ content: Array<Record<string, unknown>> }>;
}

export function parseTitleResponse(raw: string): string {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(trimmed) as { title?: unknown };
    if (typeof parsed.title === "string") return sanitizeTitle(parsed.title);
  } catch {
    // Model sometimes returns a bare title.
  }
  return sanitizeTitle(trimmed);
}

function textFromContent(content: Array<Record<string, unknown>>): string {
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n");
}

export async function completeTitle(opts: {
  apiKey: string;
  user: string;
  assistant: string;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}): Promise<string | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const user = opts.user.trim().slice(0, 500);
  const assistant = opts.assistant.trim().slice(0, 800);
  const response = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: opts.signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: TITLE_MODEL,
      max_tokens: 64,
      system: TITLE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `User:\n${user}\n\nAssistant:\n${assistant}`,
        },
      ],
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { content?: Array<Record<string, unknown>> };
  const title = parseTitleResponse(textFromContent(body.content ?? []));
  return title || null;
}
