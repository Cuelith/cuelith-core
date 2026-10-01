import { defineConfig } from "vite";

// Processo principale per i pacchetti installabili: app desktop, motore e
// dipendenze in un solo file (nessun node_modules nell'app installata).
// Electron resta esterno; i moduli opzionali nativi di ws non servono.
export default defineConfig({
  ssr: { noExternal: true },
  build: {
    ssr: "src/main.ts",
    outDir: "pack/app",
    emptyOutDir: true,
    target: "node24",
    sourcemap: false,
    minify: false,
    rollupOptions: {
      external: ["electron", "bufferutil", "utf-8-validate"],
      output: { entryFileNames: "main.mjs", format: "es" },
    },
  },
});
