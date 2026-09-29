import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// La postazione viene servita dal motore (stessa origine del WebSocket /rpc):
// si costruisce in dist/ e il motore la pubblica.
export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // Niente file incorporati come data: (font piccoli compresi): la CSP del
    // motore consente font e script solo dalla sua origine.
    assetsInlineLimit: 0,
  },
});
