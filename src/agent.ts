export type ToolResult = { ok: boolean; result?: unknown; error?: string };

export type AgentDeps = {
  complete: (messages: unknown[]) => Promise<{
    content: Array<{ type: string; name?: string; id?: string; input?: { code?: string } }>;
  }>;
  evalJs: (code: string) => Promise<ToolResult>;
  confirm?: (code: string) => Promise<boolean>;
  signal?: AbortSignal;
};

export async function runAgent(
  _goal: string,
  _deps: AgentDeps,
): Promise<{ outcome: "ok" | "stopped" | "denied"; text: string }> {
  throw new Error("not implemented");
}
