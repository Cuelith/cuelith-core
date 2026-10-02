import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LoadedModule } from "./load.js";

/** Oltre questa misura un file non si legge in anticipo (un video, un archivio). */
const MAX_FILE = 8 * 1024 * 1024;
const MAX_FILES = 400;

/**
 * Legge una volta, uno dopo l'altro, i file dell'interfaccia dei moduli appena
 * comparsi. Su alcuni computer la prima lettura di un file nuovo viene
 * trattenuta per secondi dai controlli del sistema: se avviene qui, subito
 * dopo l'installazione e in background, il pannello non resta vuoto la prima
 * volta che lo si apre. Non cambia cio' che viene servito: e' solo una lettura.
 */
export class PanelWarmer {
  readonly #done = new Set<string>();
  #queue: Promise<void> = Promise.resolve();

  /** I moduli attivi di adesso: quelli gia' letti si saltano. */
  warm(modules: readonly LoadedModule[]): Promise<void> {
    for (const module of modules) {
      const entry = module.manifest.ui?.entry;
      const key = `${module.manifest.id}@${module.manifest.version}@${module.dir}`;
      if (entry === undefined || this.#done.has(key)) continue;
      this.#done.add(key);
      const folder = join(module.dir, dirname(entry));
      this.#queue = this.#queue.then(() => readAll(folder)).catch(() => undefined);
    }
    return this.#queue;
  }
}

async function readAll(folder: string): Promise<void> {
  let left = MAX_FILES;
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (left <= 0) return;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") await visit(file);
        continue;
      }
      if (!entry.isFile()) continue;
      left--;
      const info = await stat(file).catch(() => undefined);
      if (info === undefined || info.size > MAX_FILE) continue;
      await readFile(file).catch(() => undefined);
    }
  };
  await visit(folder);
}
