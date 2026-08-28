import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  webServer: {
    command: "npx --yes serve e2e/fixture -l 4177",
    port: 4177,
    reuseExistingServer: !process.env.CI,
  },
});
