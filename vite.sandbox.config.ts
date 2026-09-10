/** Mermaid sandbox: IIFE inlined into sandbox.html. Unique origin cannot fetch extra scripts. */
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

function inlineSandboxHtml(): Plugin {
  return {
    name: "inline-sandbox-html",
    generateBundle(_opts, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk" || !item.isEntry) continue;
        const code = item.code.replace(/<\/script/gi, "<\\/script");
        this.emitFile({
          type: "asset",
          fileName: "sandbox.html",
          source:
            "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\"/>\n<title>Mermaid sandbox</title>\n</head>\n<body>\n<script>\n" +
            code +
            "\n</script>\n</body>\n</html>\n",
        });
        delete bundle[item.fileName];
      }
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [inlineSandboxHtml()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    chunkSizeWarningLimit: 3000,
    lib: {
      entry: resolve(__dirname, "src/sandbox.ts"),
      name: "consoleClaudeSandbox",
      formats: ["iife"],
      fileName: () => "sandbox.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
