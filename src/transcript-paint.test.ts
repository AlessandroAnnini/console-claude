import { describe, expect, it } from "vitest";
import { canPatchLastExchange, groupExchanges, turnSig } from "./transcript-paint";
import type { Turn } from "./sessions";

const user = (text: string): Turn => ({ role: "user", text });
const assistant = (text: string, extra: Partial<Turn> = {}): Turn => ({
  role: "assistant",
  text,
  ...extra,
});

describe("turnSig", () => {
  it("changes when assistant text or tools change", () => {
    const a = [user("hi"), assistant("yo")];
    const b = [user("hi"), assistant("yo", { tools: [{ name: "eval_js", summary: "1" }] })];
    expect(turnSig(a)).not.toBe(turnSig(b));
    expect(turnSig(a)).toBe(turnSig([user("hi"), assistant("yo")]));
  });
});

describe("groupExchanges", () => {
  it("starts a group on each user turn", () => {
    expect(groupExchanges([user("a"), assistant("b"), user("c")])).toHaveLength(2);
  });
});

describe("canPatchLastExchange", () => {
  it("allows appending a new user turn", () => {
    expect(canPatchLastExchange([user("a"), assistant("b")], [user("a"), assistant("b"), user("c")])).toBe(
      true,
    );
  });

  it("allows completing the last exchange", () => {
    expect(canPatchLastExchange([user("a")], [user("a"), assistant("b")])).toBe(true);
  });

  it("rejects edits to an earlier exchange", () => {
    expect(
      canPatchLastExchange(
        [user("a"), assistant("b"), user("c")],
        [user("a"), assistant("CHANGED"), user("c")],
      ),
    ).toBe(false);
  });
});
