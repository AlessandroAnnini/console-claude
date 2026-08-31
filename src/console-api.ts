/** Public console contract. No Chrome APIs, no secrets. */

export const HELP_TEXT = `claude(goal)          start a run (await optional)
claude\`goal\`          same, tagged template
claude($0)            inspect the selected Elements node
claude.inspect($0)    same
claude('why', $0)     goal plus the selected node
claude.stop()         abort the current run
claude.reset()        clear conversation
claude.help()         this text
claude.last           last answer
claude.busy           true while a run is in flight
claude.config.confirm ask before each eval (also on the options page)

DevTools must be open on this tab. After you reload the extension, close
DevTools and open it again — the console staying open is not enough.
`;

export const DEFAULT_INSPECT_GOAL = "Inspect the selected node.";

export type TemplateLike = { raw: readonly string[] };

export type AskParse = {
  goal: string;
  selected: unknown[];
};

export function isElementLike(value: unknown): value is object {
  return (
    typeof value === "object" &&
    value !== null &&
    "tagName" in value &&
    ("outerHTML" in value || "innerText" in value)
  );
}

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

export function parseAsk(args: unknown[]): AskParse | null {
  if (!args.length) return null;
  const selected: unknown[] = [];
  const texts: string[] = [];

  if (isTemplate(args[0])) {
    const goal = parseGoal(args[0], ...args.slice(1));
    for (const arg of args.slice(1)) {
      if (isElementLike(arg)) selected.push(arg);
    }
    if (goal) return { goal, selected };
    if (selected.length) return { goal: DEFAULT_INSPECT_GOAL, selected };
    return null;
  }

  for (const arg of args) {
    if (isElementLike(arg)) selected.push(arg);
    else if (typeof arg === "string" && arg.trim()) texts.push(arg.trim());
  }
  if (!texts.length && !selected.length) return null;
  return {
    goal: texts.join(" ") || DEFAULT_INSPECT_GOAL,
    selected,
  };
}

function isTemplate(value: unknown): value is TemplateLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "raw" in value &&
    Array.isArray((value as TemplateLike).raw)
  );
}
