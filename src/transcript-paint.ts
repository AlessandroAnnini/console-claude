/** Pure helpers so the panel can skip a full transcript rebuild. */
import type { Turn } from "./sessions";

export function turnSig(turns: readonly Turn[]): string {
  return turns
    .map((turn) => {
      const tools = (turn.tools ?? []).map((card) => `${card.name}\t${card.summary}`).join("\n");
      return `${turn.role}\0${turn.text}\0${turn.status ?? ""}\0${tools}`;
    })
    .join("\n\n");
}

export function groupExchanges(turns: readonly Turn[]): Turn[][] {
  const groups: Turn[][] = [];
  let current: Turn[] = [];
  for (const turn of turns) {
    if (turn.role === "user" && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(turn);
  }
  if (current.length) groups.push(current);
  return groups;
}

/** True when only the last exchange grew or changed. */
export function canPatchLastExchange(prev: readonly Turn[], next: readonly Turn[]): boolean {
  const before = groupExchanges(prev);
  const after = groupExchanges(next);
  if (!after.length) return false;
  if (before.length === after.length) {
    return turnSig(before.slice(0, -1).flat()) === turnSig(after.slice(0, -1).flat());
  }
  if (before.length + 1 === after.length) {
    return turnSig(before.flat()) === turnSig(after.slice(0, -1).flat());
  }
  return false;
}
