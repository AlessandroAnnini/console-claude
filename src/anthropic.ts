/** Messages API from the DevTools page. The key stays in extension storage. */
import { SYSTEM_PROMPT, TOOLS } from "./prompt";

export type AnthropicMessage = { role: string; content: unknown };

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
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: opts.messages,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${text}`);
  }
  return response.json() as Promise<{ content: Array<Record<string, unknown>> }>;
}
