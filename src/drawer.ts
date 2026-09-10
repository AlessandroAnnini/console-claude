/** Panel session-drawer chrome. Not origin-scoped. */
import type { SettingsArea } from "./storage";

export const DRAWER_KEY = "consoleClaude.drawer";
export const DRAWER_MIN = 160;
export const DRAWER_MAX = 360;
export const DRAWER_DEFAULT = 216;

export type DrawerState = {
  open: boolean;
  width: number;
};

export function clampDrawerWidth(width: number): number {
  if (!Number.isFinite(width)) return DRAWER_DEFAULT;
  return Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, Math.round(width)));
}

export function normalizeDrawer(raw: unknown): DrawerState {
  const bag = raw && typeof raw === "object" ? (raw as Partial<DrawerState>) : {};
  return {
    open: bag.open !== false,
    width: clampDrawerWidth(typeof bag.width === "number" ? bag.width : DRAWER_DEFAULT),
  };
}

export async function loadDrawer(area: SettingsArea): Promise<DrawerState> {
  const got = await area.get(DRAWER_KEY);
  return normalizeDrawer(got[DRAWER_KEY]);
}

export async function saveDrawer(state: DrawerState, area: SettingsArea): Promise<void> {
  await area.set({ [DRAWER_KEY]: normalizeDrawer(state) });
}
