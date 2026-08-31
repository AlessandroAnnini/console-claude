/** Expression first, then statement body. Used by MAIN-world `__ccEval`. */
export type EvalResult = { ok: boolean; result?: unknown; error?: string };

type EvalFn = (source: string) => unknown;

export async function runEval(
  code: string,
  evalFn: EvalFn = eval,
): Promise<EvalResult> {
  try {
    let result: unknown;
    try {
      result = await evalFn(`(async () => (${code}))()`);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      result = await evalFn(`(async () => {\n${code}\n})()`);
    }
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function executeJs(
  code: string,
  opts: { allowed?: boolean; evalFn?: EvalFn } = {},
): Promise<EvalResult> {
  if (opts.allowed === false) {
    return { ok: false, error: "Execution denied by user." };
  }
  return runEval(code, opts.evalFn ?? eval);
}
