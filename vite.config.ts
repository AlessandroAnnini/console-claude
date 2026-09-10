/** Options and DevTools pages. Empties dist/. IIFE configs run after. */
import { resolve } from "node:path";
import { defineConfig } from "vite";

function extensionHtml() {
  return {
    name: "extension-html",
    transformIndexHtml(html: string) {
      return html
        .replace(/\s+crossorigin(?:="[^"]*")?/g, "")
        .replace(/\s*<link rel="modulepreload"[^>]*>/g, "");
    },
  };
}

export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: [extensionHtml()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        options: resolve(__dirname, "options.html"),
        devtools: resolve(__dirname, "devtools.html"),
        panel: resolve(__dirname, "panel.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
