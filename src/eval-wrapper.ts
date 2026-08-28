export type EvalResult = { ok: boolean; result?: unknown; error?: string };

export async function runEval(
  _code: string,
  _evalFn: (source: string) => unknown = eval,
): Promise<EvalResult> {
  throw new Error("not implemented");
}

export async function executeJs(
  _code: string,
  _opts: {
    allowed?: boolean;
    evalFn?: (source: string) => unknown;
  } = {},
): Promise<EvalResult> {
  throw new Error("not implemented");
}
