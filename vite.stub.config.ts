import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/page-stub.ts"),
      name: "consoleClaudeStub",
      formats: ["iife"],
      fileName: () => "stub.js",
    },
  },
});
