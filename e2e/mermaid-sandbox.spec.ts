import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { chromium } from "@playwright/test";

const extensionPath = join(import.meta.dirname, "..", "dist");

test("sandbox mermaid iframe returns an svg", async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "cc-e2e-mermaid-"));
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
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const svg = await page.evaluate(() => {
      return new Promise<string>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("sandbox timeout")), 30_000);
        window.addEventListener("message", (event) => {
          const msg = event.data as { kind?: string; svg?: string; error?: string };
          if (msg?.kind === "svg" && msg.svg) {
            window.clearTimeout(timer);
            resolve(msg.svg);
          }
          if (msg?.kind === "error") {
            window.clearTimeout(timer);
            reject(new Error(msg.error ?? "render error"));
          }
        });
        const frame = document.createElement("iframe");
        frame.src = "sandbox.html";
        frame.addEventListener(
          "load",
          () => {
            frame.contentWindow?.postMessage(
              { kind: "render", id: "t1", source: "flowchart LR\n  A --> B" },
              "*",
            );
          },
          { once: true },
        );
        document.body.append(frame);
      });
    });
    expect(svg.toLowerCase()).toContain("<svg");
  } finally {
    await context.close();
  }
});
