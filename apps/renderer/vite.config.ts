import { defineConfig } from "vite";

// Le uscite sono servite dal motore sotto /renderer/ (stessa origine del WebSocket).
export default defineConfig({
  base: "/renderer/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // Niente data: incorporati: la CSP del motore consente font e script solo dalla sua origine.
    assetsInlineLimit: 0,
  },
});
