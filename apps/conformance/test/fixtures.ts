import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { zipSync } from "fflate";

/**
 * Plugin di prova scritti a mano, senza SDK: parlano il protocollo come potrebbe
 * fare chiunque. `mode` decide come si comporta il processo.
 */
export const PROCESS = String.raw`
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
const mode = readFileSync(new URL("./mode.txt", import.meta.url), "utf8").trim();
const out = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
if (mode === "crash-start") process.exit(1);
if (mode === "crash-later") setTimeout(() => process.exit(2), 1200);
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === undefined || m.id === undefined) return;
  if (m.method === "plugin.activate") { if (mode !== "hang-activate") out({ id: m.id, result: {} }); return; }
  if (m.method === "plugin.ping") { out({ id: m.id, result: {} }); return; }
  if (m.method === "plugin.deactivate") { out({ id: m.id, result: {} }); if (mode !== "ignore-stop") setImmediate(() => process.exit(0)); return; }
  out({ id: m.id, result: null });
});
`;

export interface Fixture {
  /** Cartella con i file del plugin. */
  dir: string;
  /** File da aggiungere o sostituire: nome -> contenuto (null = togliere). */
  manifest: Record<string, unknown>;
}

export const baseManifest = (id = "acme.fixture"): Record<string, unknown> => ({
  id,
  name: "Fixture",
  version: "1.0.0",
  publisher: "Acme",
  license: "Apache-2.0",
  repository: "https://github.com/acme/plugin-fixture",
  family: "integration",
  engines: { cuelith: ">=0.3.0 <1.0.0", protocol: "^1.8.0" },
  runtime: { type: "node", entry: "main.mjs" },
  permissions: [],
  dependencies: {},
  extends: [],
  provides: [],
  contributes: {},
});

/** Cartella del plugin: manifest + main.mjs, piu' i file extra (null = non crearli). */
export function makeFolder(
  options: {
    manifest?: Record<string, unknown>;
    files?: Record<string, string | null>;
    mode?: string;
  } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), "cuelith-fx-"));
  const files: Record<string, string | null> = {
    "cuelith-plugin.json": JSON.stringify({ ...baseManifest(), ...options.manifest }),
    "main.mjs": PROCESS,
    "mode.txt": options.mode ?? "good",
    ...options.files,
  };
  for (const [name, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

/** Pacchetto .cpkg (zip) con i file indicati, ai percorsi esatti. */
export function makePackage(
  files: Record<string, string>,
  name = "acme.fixture-1.0.0.cpkg",
): string {
  const dir = mkdtempSync(join(tmpdir(), "cuelith-fx-pkg-"));
  const zipped: Record<string, Uint8Array> = {};
  for (const [file, content] of Object.entries(files))
    zipped[file] = new TextEncoder().encode(content);
  const path = join(dir, name);
  writeFileSync(path, zipSync(zipped));
  return path;
}
