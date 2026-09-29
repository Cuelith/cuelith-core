import type { InstalledPlugin, PluginStatus } from "@cuelith/protocol";
import type { Logger } from "../log.js";
import { loadModule, ModuleLoadError, type LoadedModule } from "./load.js";

/**
 * Moduli noti al motore. Il nucleo non conosce i moduli (cap. 13): li
 * scopre dalle cartelle. In questa fase solo i moduli preinstallati di soli
 * dati (lingue); processi, installazione e attivazione a caldo arrivano con
 * il gestore moduli.
 */
export class ModuleRegistry {
  readonly #modules = new Map<string, LoadedModule>();
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  async loadBundled(dirs: readonly string[], engineVersion: string): Promise<void> {
    for (const dir of dirs) {
      try {
        const module = await loadModule(dir, engineVersion, true);
        if (this.#modules.has(module.manifest.id)) {
          this.#logger.warn(`modulo preinstallato duplicato ignorato: ${module.manifest.id}`, dir);
          continue;
        }
        this.#modules.set(module.manifest.id, module);
        this.#logger.info(
          `modulo preinstallato caricato: ${module.manifest.id} ${module.manifest.version}`,
        );
      } catch (error) {
        const detail =
          error instanceof ModuleLoadError ? { key: error.key, params: error.params } : error;
        this.#logger.error(`modulo preinstallato non caricabile: ${dir}`, detail);
      }
    }
  }

  /** Moduli attivi, in ordine di caricamento. */
  active(): LoadedModule[] {
    return [...this.#modules.values()];
  }

  statuses(): PluginStatus[] {
    return this.active().map((m) => ({
      id: m.manifest.id,
      version: m.manifest.version,
      state: "active",
    }));
  }

  /** Un modulo e' obbligatorio se toglierlo lascerebbe il nucleo senza lingua. */
  isRequired(id: string): boolean {
    const module = this.#modules.get(id);
    if (module?.manifest.family !== "locale") return false;
    return this.active().filter((m) => m.manifest.family === "locale").length === 1;
  }

  installed(): InstalledPlugin[] {
    return this.active().map((m) => ({
      manifest: m.manifest,
      status: { id: m.manifest.id, version: m.manifest.version, state: "active" },
      bundled: m.bundled,
      required: this.isRequired(m.manifest.id),
    }));
  }
}
