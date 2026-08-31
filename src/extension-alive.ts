/** Isolated-world chrome.runtime.id throws after the extension is reloaded. */
export function extensionAlive(
  api: { runtime?: { id?: string } } = chrome,
): boolean {
  try {
    return typeof api.runtime?.id === "string" && api.runtime.id.length > 0;
  } catch {
    return false;
  }
}
