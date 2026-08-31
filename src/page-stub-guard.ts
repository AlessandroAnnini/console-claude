/** MAIN-world helpers already present (content script plus optional DevTools inject). */
export function isPageStubInstalled(target: { __ccEval?: unknown }): boolean {
  return typeof target.__ccEval === "function";
}
