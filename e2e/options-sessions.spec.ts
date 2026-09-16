import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { chromium } from "@playwright/test";

const extensionPath = join(import.meta.dirname, "..", "dist");

const historySession = (id: string, updatedAt: number) => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  messages: [],
  turns: [{ role: "user", text: "goal" }],
});

test("options lists history origins and wipes them", async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "cc-e2e-sessions-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const fixture = await context.newPage();
    await fixture.goto("http://127.0.0.1:4177/");
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
    const extensionId = new URL(worker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator("#apiKey").fill("sk-e2e-not-a-real-key");
    await options.getByRole("button", { name: "Save" }).click();
    await expect(options.locator("#status")).toHaveText("Key saved");

    options.on("dialog", (dialog) => dialog.accept());
    await options.evaluate((bag) => chrome.storage.local.set({ "consoleClaude.sessions": bag }), {
      "https://empty.example": {
        activeId: "shell",
        sessions: [
          {
            id: "shell",
            title: "Untitled",
            createdAt: 1,
            updatedAt: 1,
            messages: [],
            turns: [],
          },
        ],
      },
      "https://keep.example": {
        activeId: "keep",
        sessions: [historySession("keep", 20)],
      },
      "https://drop.example": {
        activeId: "drop",
        sessions: [historySession("drop", 30)],
      },
    });

    await expect(options.locator(".origin-row")).toHaveCount(2);
    await expect(options.locator("#origins")).toContainText("https://drop.example");
    await expect(options.locator("#origins")).toContainText("https://keep.example");
    await expect(options.locator("#origins")).not.toContainText("https://empty.example");
    await expect(options.getByRole("button", { name: "Delete all sessions" })).toBeVisible();

    await options.getByRole("button", { name: "Delete sessions for https://drop.example" }).click();
    await expect(options.locator("#origins")).not.toContainText("https://drop.example");
    await expect(options.locator("#origins")).toContainText("https://keep.example");
    await expect(options.locator("#status")).toHaveText("Deleted sessions for https://drop.example");
    await expect(options.locator("#removeKey")).toBeVisible();
    await expect(options.locator("#keyEntry")).toBeHidden();

    await options.getByRole("button", { name: "Delete all sessions" }).click();
    await expect(options.locator("#originsEmpty")).toHaveText("No stored sessions.");
    await expect(options.locator("#originsEmpty")).toBeVisible();
    await expect(options.getByRole("button", { name: "Delete all sessions" })).toBeHidden();
    await expect(options.locator("#status")).toHaveText("Deleted all sessions.");
    await expect(options.locator("#removeKey")).toBeVisible();
  } finally {
    await context.close();
  }
});
