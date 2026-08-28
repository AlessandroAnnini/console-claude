import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        options: resolve(__dirname, "options.html"),
        devtools: resolve(__dirname, "devtools.html"),
        background: resolve(__dirname, "src/background.ts"),
        content: resolve(__dirname, "src/content-isolated.ts"),
        stub: resolve(__dirname, "src/page-stub.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
