import { describe, expect, it } from "vitest";
import {
  clampDrawerWidth,
  DRAWER_DEFAULT,
  DRAWER_KEY,
  DRAWER_MAX,
  DRAWER_MIN,
  loadDrawer,
  normalizeDrawer,
  saveDrawer,
} from "./drawer";

function memoryArea(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    },
    data,
  };
}

describe("clampDrawerWidth", () => {
  it("clamps to the allowed range", () => {
    expect(clampDrawerWidth(80)).toBe(DRAWER_MIN);
    expect(clampDrawerWidth(800)).toBe(DRAWER_MAX);
    expect(clampDrawerWidth(200)).toBe(200);
    expect(clampDrawerWidth(Number.NaN)).toBe(DRAWER_DEFAULT);
  });
});

describe("normalizeDrawer", () => {
  it("defaults to open at the default width", () => {
    expect(normalizeDrawer(undefined)).toEqual({ open: true, width: DRAWER_DEFAULT });
    expect(normalizeDrawer({ open: false, width: 280 })).toEqual({ open: false, width: 280 });
  });
});

describe("drawer storage", () => {
  it("round-trips open and width", async () => {
    const area = memoryArea();
    await saveDrawer({ open: false, width: 300 }, area);
    expect(area.data[DRAWER_KEY]).toEqual({ open: false, width: 300 });
    expect(await loadDrawer(area)).toEqual({ open: false, width: 300 });
  });
});
