/** Public console contract. No Chrome APIs, no secrets. */

export const HELP_TEXT = `claude(goal)          start a run (await optional)
claude\`goal\`          same, tagged template
claude.stop()         abort the current run
claude.reset()        clear conversation
claude.help()         this text
claude.last           last answer
claude.busy           true while a run is in flight
claude.config.confirm ask before each eval (also on the options page)

DevTools must be open on this tab. After you reload the extension, close
DevTools and open it again — the console staying open is not enough.
`;

export type TemplateLike = { raw: readonly string[] };

export function parseGoal(
  first?: unknown,
  ...values: unknown[]
): string | null {
  if (first == null || first === "") {
    return null;
  }
  if (typeof first === "string") {
    const text = first.trim();
    return text.length ? text : null;
  }
  if (isTemplate(first)) {
    const raw = first.raw;
    let out = "";
    for (let i = 0; i < raw.length; i++) {
      out += raw[i];
      if (i < values.length) {
        out += String(values[i]);
      }
    }
    const text = out.trim();
    return text.length ? text : null;
  }
  return null;
}

function isTemplate(value: unknown): value is TemplateLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "raw" in value &&
    Array.isArray((value as TemplateLike).raw)
  );
}
