/** Service worker → dist/background.js as IIFE. Edge/Chrome SW should not import Vite chunks. */
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/background.ts"),
      name: "consoleClaudeBackground",
      formats: ["iife"],
      fileName: () => "background.js",
    },
  },
});
