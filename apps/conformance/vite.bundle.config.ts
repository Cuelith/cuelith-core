import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const core = (JSON.parse(readFileSync("../desktop/package.json", "utf8")) as { version: string })
  .version;

// Il programma di verifica in un solo file (cuelith-conformance.mjs): motore e
// dipendenze dentro, nessun node_modules. E' quello che si scarica dalla release
// del nucleo e si lancia con `node cuelith-conformance.mjs mio.cpkg`.
export default defineConfig({
  define: { __CORE__: JSON.stringify(core) },
  ssr: { noExternal: true },
  build: {
    ssr: "src/cli.ts",
    outDir: "bundle",
    emptyOutDir: true,
    target: "node24",
    sourcemap: false,
    minify: false,
    rollupOptions: {
      external: ["bufferutil", "utf-8-validate"],
      output: { entryFileNames: "cuelith-conformance.mjs", format: "es" },
    },
  },
});
