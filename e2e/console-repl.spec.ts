import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { chromium } from "@playwright/test";

const extensionPath = join(import.meta.dirname, "..", "dist");

test("saves a key and injects the console API", async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "cc-e2e-"));
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
    await fixture.waitForFunction(() => typeof (window as unknown as { claude?: unknown }).claude === "function", null, { timeout: 15_000 });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
    const extensionId = new URL(worker.url()).host;

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator("#apiKey").fill("sk-e2e-not-a-real-key");
    await options.locator("#confirm").uncheck();
    await options.getByRole("button", { name: "Save" }).click();
    await expect(options.locator("#status")).toHaveText("Key saved");
    await expect(options.locator("#keyEntry")).toBeHidden();
    await expect(options.locator("#removeKey")).toBeVisible();
    await expect(options.locator("#model")).toHaveValue("claude-sonnet-5");
    await options.reload();
    await expect(options.locator("#status")).toHaveText("Key saved");
    await expect(options.locator("#keyEntry")).toBeHidden();
    await expect(options.locator("#confirm")).not.toBeChecked();
    await options.getByRole("button", { name: "Remove key" }).click();
    await expect(options.locator("#status")).toHaveText("No key saved");
    await expect(options.locator("#apiKey")).toBeVisible();
    await expect(options.getByRole("link", { name: "Source" })).toHaveAttribute(
      "href",
      "https://github.com/AlessandroAnnini/console-claude",
    );
    await expect(options.getByRole("link", { name: "alessandroannini.com" })).toHaveAttribute(
      "href",
      "https://alessandroannini.com",
    );

    const api = await fixture.evaluate(() => {
      const claude = (window as unknown as { claude?: Record<string, unknown> }).claude;
      return {
        hasClaude: typeof claude === "function",
        hasStop: typeof claude?.stop === "function",
        hasReset: typeof claude?.reset === "function",
        hasHelp: typeof claude?.help === "function",
        hasInspect: typeof claude?.inspect === "function",
      };
    });
    expect(api).toEqual({
      hasClaude: true,
      hasStop: true,
      hasReset: true,
      hasHelp: true,
      hasInspect: true,
    });
  } finally {
    await context.close();
  }
});
