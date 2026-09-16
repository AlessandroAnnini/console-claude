/** Panel chrome copy. Keep delete as a mark so the session list does not wrap. */
export const SESSION_DELETE_MARK = "\u00D7";

export function bindCopyButton(
  copy: HTMLButtonElement,
  live: HTMLElement,
  getText: () => string,
): void {
  copy.addEventListener("click", () => {
    const text = getText();
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => {
        copy.textContent = "Copied";
        live.textContent = "Copied";
        window.setTimeout(() => {
          copy.textContent = "Copy";
          live.textContent = "";
        }, 1600);
      },
      () => {
        live.textContent = "Copy failed";
      },
    );
  });
}
