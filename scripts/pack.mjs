import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const zip = resolve(root, "console-claude.zip");

if (!existsSync(resolve(dist, "manifest.json"))) {
  console.error("dist/manifest.json missing. Run npm run build first.");
  process.exit(1);
}

rmSync(zip, { force: true });
const result = spawnSync("zip", ["-r", "-q", zip, "."], { cwd: dist, stdio: "inherit" });
if (result.status !== 0) {
  console.error("zip failed. Install zip or pack dist/ yourself.");
  process.exit(result.status ?? 1);
}
console.log(`Wrote ${zip} (manifest.json at zip root). Upload this file to the Chrome Web Store.`);
