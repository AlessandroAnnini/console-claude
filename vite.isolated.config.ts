/** Isolated bridge → dist/content.js. */
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/content-isolated.ts"),
      name: "consoleClaudeIsolated",
      formats: ["iife"],
      fileName: () => "content.js",
    },
  },
});
