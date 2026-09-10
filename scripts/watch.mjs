import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const vite = join(app, "node_modules/vite/bin/vite.js");
const configs = [
  "vite.config.ts",
  "vite.stub.config.ts",
  "vite.isolated.config.ts",
  "vite.background.config.ts",
  "vite.sandbox.config.ts",
];

for (const config of configs) {
  const child = spawn(process.execPath, [vite, "build", "--watch", "--config", config], {
    cwd: app,
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    if (code) process.exit(code);
  });
}
