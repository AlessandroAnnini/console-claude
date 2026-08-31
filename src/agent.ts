/** Model loop: complete → optional eval_js → tool_result, until text-only or abort. */
export type ToolResult = { ok: boolean; result?: unknown; error?: string };

export type ContentBlock = {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: { code?: string };
};

export type AgentDeps = {
  complete: (messages: unknown[]) => Promise<{ content: ContentBlock[] }>;
  evalJs: (code: string) => Promise<ToolResult>;
  confirm?: (code: string) => Promise<boolean>;
  signal?: AbortSignal;
  maxSteps?: number;
  history?: unknown[];
};

export type AgentOutcome = {
  outcome: "ok" | "stopped";
  text: string;
  messages?: unknown[];
};

function aborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

export async function runAgent(
  goal: string,
  deps: AgentDeps,
): Promise<AgentOutcome> {
  const maxSteps = deps.maxSteps ?? 20;
  const messages: unknown[] = [...(deps.history ?? []), { role: "user", content: goal }];

  for (let step = 1; step <= maxSteps; step++) {
    if (aborted(deps.signal)) return { outcome: "stopped", text: "Stopped." };

    const response = await deps.complete(messages);
    if (aborted(deps.signal)) return { outcome: "stopped", text: "Stopped." };

    messages.push({ role: "assistant", content: response.content });
    const textBlocks = response.content.filter((block) => block.type === "text");
    const toolCalls = response.content.filter((block) => block.type === "tool_use");

    if (!toolCalls.length) {
      return {
        outcome: "ok",
        text: textBlocks.map((block) => block.text ?? "").join("\n"),
        messages,
      };
    }

    const toolResults: unknown[] = [];
    for (const call of toolCalls) {
      if (aborted(deps.signal)) return { outcome: "stopped", text: "Stopped." };
      if (call.name !== "eval_js") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify({ ok: false, error: `Unknown tool: ${call.name}` }),
        });
        continue;
      }
      const code = call.input?.code ?? "";
      if (deps.confirm && !(await deps.confirm(code))) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify({
            ok: false,
            error: "Execution denied by user.",
          }),
        });
        continue;
      }
      const result = await deps.evalJs(code);
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    outcome: "ok",
    text: `Claude exceeded ${maxSteps} tool iterations.`,
    messages,
  };
}
