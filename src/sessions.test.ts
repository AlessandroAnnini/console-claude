import { describe, expect, it } from "vitest";
import {
  addSession,
  compactValue,
  COMPACT_MAX,
  createSession,
  deleteSession,
  emptyBucket,
  originFromUrl,
  renameSession,
  resetNewSession,
  sanitizeTitle,
  selectSession,
  SESSION_CAP,
  sessionMatchesTitle,
  shouldForkOnAsk,
  shouldNameSession,
  titleFromGoal,
} from "./sessions";

describe("AC1-origin-key", () => {
  it("returns scheme+host+port and rejects invalid input", () => {
    expect(originFromUrl("https://en.wikipedia.org/wiki/Earth")).toBe("https://en.wikipedia.org");
    expect(originFromUrl("https://localhost:5173/app")).toBe("https://localhost:5173");
    expect(originFromUrl("not a url")).toBe("");
  });
});

describe("AC2-session-crud", () => {
  it("creates, renames, and selects", () => {
    const first = createSession({ id: "a", now: 1 });
    let bucket = emptyBucket(first, 1);
    expect(bucket.activeId).toBe("a");
    bucket = renameSession(bucket, "a", "  playback 2.5x  ", 2);
    expect(bucket.sessions[0]?.title).toBe("playback 2.5x");
    const second = createSession({ id: "b", now: 3 });
    bucket = addSession(bucket, second);
    bucket = selectSession(bucket, "a");
    expect(bucket.activeId).toBe("a");
  });
});

describe("AC3-session-cap", () => {
  it("drops the oldest unused session when adding past the cap", () => {
    let bucket = emptyBucket(createSession({ id: "oldest", now: 1 }), 1);
    for (let i = 0; i < SESSION_CAP - 1; i++) {
      bucket = addSession(bucket, createSession({ id: `s-${i}`, now: 10 + i }));
    }
    expect(bucket.sessions).toHaveLength(SESSION_CAP);
    const previousActive = bucket.activeId;
    bucket = addSession(bucket, createSession({ id: "new", now: 1000 }));
    expect(bucket.sessions).toHaveLength(SESSION_CAP);
    expect(bucket.activeId).toBe("new");
    expect(bucket.sessions.some((item) => item.id === "new")).toBe(true);
    expect(bucket.sessions.some((item) => item.id === previousActive)).toBe(true);
    expect(bucket.sessions.some((item) => item.id === "oldest")).toBe(false);
  });
});

describe("AC4-reset-new-session", () => {
  it("creates a new empty session and keeps the old ones", () => {
    let bucket = emptyBucket(createSession({ id: "one", now: 1 }), 1);
    bucket = addSession(bucket, createSession({ id: "two", now: 2 }));
    bucket = resetNewSession(bucket, 3);
    expect(bucket.sessions).toHaveLength(3);
    expect(bucket.sessions.filter((item) => item.id === "one" || item.id === "two")).toHaveLength(2);
    const active = bucket.sessions.find((item) => item.id === bucket.activeId);
    expect(active?.messages).toEqual([]);
    expect(active?.id).not.toBe("one");
    expect(active?.id).not.toBe("two");
  });
});

describe("shouldForkOnAsk", () => {
  it("forks a console ask only when the selected session has turns", () => {
    expect(shouldForkOnAsk("console", 1)).toBe(true);
    expect(shouldForkOnAsk("console", 0)).toBe(false);
    expect(shouldForkOnAsk("panel", 4)).toBe(false);
    expect(shouldForkOnAsk(undefined, 2)).toBe(false);
  });
});

describe("shouldNameSession", () => {
  it("names only an Untitled session after an ok answer", () => {
    const untitled = createSession({ id: "a", now: 1 });
    expect(shouldNameSession(untitled, "ok")).toBe(true);
    expect(shouldNameSession(untitled, "error")).toBe(false);
    expect(shouldNameSession(untitled, "stopped")).toBe(false);
    expect(shouldNameSession({ ...untitled, title: "Earth orbit" }, "ok")).toBe(false);
  });
});

describe("sanitizeTitle", () => {
  it("strips quotes, periods, and overflow", () => {
    expect(sanitizeTitle('  "Earth orbit diagram."  ')).toBe("Earth orbit diagram");
    expect(sanitizeTitle("x".repeat(60)).length).toBe(48);
    expect(sanitizeTitle("Untitled")).toBe("");
    expect(sanitizeTitle("   ")).toBe("");
  });
});

describe("sessionMatchesTitle", () => {
  it("filters by case-insensitive substring", () => {
    expect(sessionMatchesTitle("Earth orbit", "")).toBe(true);
    expect(sessionMatchesTitle("Earth orbit", "  ")).toBe(true);
    expect(sessionMatchesTitle("Earth orbit", "ORBIT")).toBe(true);
    expect(sessionMatchesTitle("Earth orbit", "mars")).toBe(false);
  });
});

describe("AC5-title-from-goal", () => {
  it("uses a trimmed first-line preview", () => {
    expect(titleFromGoal("playback 2.5x\nmore notes")).toBe("playback 2.5x");
    expect(titleFromGoal("   why seek resets   ")).toBe("why seek resets");
  });
});

describe("AC6-delete-selects-next", () => {
  it("selects the next recent session, or creates empty when none remain", () => {
    let bucket = emptyBucket(createSession({ id: "b", now: 1, title: "older" }), 1);
    bucket = addSession(bucket, createSession({ id: "a", now: 2, title: "newer" }));
    bucket = selectSession(bucket, "a");
    bucket = deleteSession(bucket, "a", 3);
    expect(bucket.activeId).toBe("b");
    expect(bucket.sessions).toHaveLength(1);
    bucket = deleteSession(bucket, "b", 4);
    expect(bucket.sessions).toHaveLength(1);
    expect(bucket.activeId).not.toBe("b");
    expect(bucket.sessions[0]?.messages).toEqual([]);
  });
});

describe("AC7-compact-turns", () => {
  it("truncates oversized tool results and keeps small ones", () => {
    expect(compactValue({ ok: true, rows: 2 })).toEqual({ ok: true, rows: 2 });
    const huge = { body: "x".repeat(COMPACT_MAX + 50) };
    const compact = compactValue(huge) as { truncated: boolean; preview: string };
    expect(compact.truncated).toBe(true);
    expect(compact.preview.length).toBeLessThan(huge.body.length);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(huge).length);
  });
});
