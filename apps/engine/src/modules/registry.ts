import { randomBytes } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ErrorCode,
  RpcError,
  type InstalledPlugin,
  type PluginState,
  type PluginStatus,
} from "@cuelith/protocol";
import { z } from "zod";
import type { Logger } from "../log.js";
import { writeFileAtomic } from "../show/files.js";
import { loadModule, ModuleLoadError, type LoadedModule } from "./load.js";
import { extractPackage, stagingDir } from "./package.js";

const STATE_FILE = "installed.json";

const StateSchema = z.object({
  schema: z.literal(1),
  installed: z.record(
    z.string(),
    z.object({
      version: z.string(),
      enabled: z.boolean(),
      source: z.enum(["registry", "local"]),
      /** Versione precedente, tenuta per tornare indietro se quella nuova non si carica. */
      previous: z.string().optional(),
    }),
  ),
  /** Moduli preinstallati spenti dall'utente. */
  disabled: z.array(z.string()),
});
type State = z.infer<typeof StateSchema>;
type InstallRecord = State["installed"][string];

interface Installed {
  readonly record: InstallRecord;
  readonly module: LoadedModule | undefined;
  /** Perche' non si carica (chiave di traduzione). */
  readonly error: string | undefined;
}

export interface InstallExpectation {
  readonly id: string;
  readonly version: string;
}

const EMPTY_STATE: State = { schema: 1, installed: {}, disabled: [] };

/**
 * Moduli noti al motore (cap. 13 e 24). Il nucleo non conosce i moduli: li
 * trova nelle cartelle dei preinstallati e in quella dei moduli installati
 * (una sottocartella per versione, cap. 26). Attivare o disattivare un modulo
 * non richiede riavvii. I moduli con codice (runtime node/native) girano
 * nei loro processi, seguiti dal ModuleSupervisor (passo 9b): il loro stato
 * arriva da li' (setRuntimeStatus).
 */
export class ModuleRegistry {
  readonly #bundled = new Map<string, LoadedModule>();
  readonly #installed = new Map<string, Installed>();
  readonly #logger: Logger;
  #state: State = EMPTY_STATE;
  #dir: string | undefined;
  #engineVersion = "0.0.0";
  #queue: Promise<unknown> = Promise.resolve();
  readonly #listeners = new Set<() => void>();
  #runtimeStatus: (id: string) => { state: PluginState; error?: string } | undefined = () =>
    undefined;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  /** Chiamato dopo ogni cambiamento (installa, attiva, disattiva, disinstalla). */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }

  /** Le operazioni sui file dei moduli avvengono una alla volta. */
  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async loadBundled(dirs: readonly string[], engineVersion: string): Promise<void> {
    this.#engineVersion = engineVersion;
    for (const dir of dirs) {
      try {
        const module = await loadModule(dir, engineVersion, true);
        if (this.#bundled.has(module.manifest.id)) {
          this.#logger.warn(`modulo preinstallato duplicato ignorato: ${module.manifest.id}`, dir);
          continue;
        }
        this.#bundled.set(module.manifest.id, module);
        this.#logger.info(`modulo preinstallato: ${module.manifest.id} ${module.manifest.version}`);
      } catch (error) {
        const detail =
          error instanceof ModuleLoadError ? { key: error.key, params: error.params } : error;
        this.#logger.error(`modulo preinstallato non caricabile: ${dir}`, detail);
      }
    }
  }

  /** Legge i moduli installati dalla cartella dati. */
  async loadInstalled(dir: string): Promise<void> {
    this.#dir = dir;
    await mkdir(dir, { recursive: true });
    await rm(join(dir, ".staging"), { recursive: true, force: true });
    try {
      const parsed = StateSchema.safeParse(
        JSON.parse(await readFile(join(dir, STATE_FILE), "utf8")),
      );
      this.#state = parsed.success ? parsed.data : EMPTY_STATE;
      if (!parsed.success)
        this.#logger.error("elenco dei moduli installati illeggibile: si riparte vuoti");
    } catch {
      this.#state = EMPTY_STATE;
    }
    for (const [id, record] of Object.entries(this.#state.installed)) {
      this.#installed.set(id, await this.#loadRecord(id, record));
    }
  }

  /** Carica la versione installata; se non va, la precedente (cap. 26). */
  async #loadRecord(id: string, record: InstallRecord): Promise<Installed> {
    const dir = this.#requireDir();
    for (const version of [record.version, record.previous]) {
      if (version === undefined) continue;
      try {
        const module = await loadModule(join(dir, id, version), this.#engineVersion, false);
        if (module.manifest.id !== id)
          throw new ModuleLoadError("core.module.manifestInvalid", { dir });
        if (version !== record.version) {
          this.#logger.warn(
            `modulo ${id}: la versione ${record.version} non si carica, uso la ${version}`,
          );
          return { record: { ...record, version, previous: undefined }, module, error: undefined };
        }
        return { record, module, error: undefined };
      } catch (error) {
        this.#logger.error(`modulo ${id} ${version} non caricabile`, error);
      }
    }
    return { record, module: undefined, error: "core.module.loadFailed" };
  }

  #requireDir(): string {
    if (this.#dir === undefined) throw new Error("cartella dei moduli non impostata");
    return this.#dir;
  }

  async #saveState(): Promise<void> {
    await writeFileAtomic(
      join(this.#requireDir(), STATE_FILE),
      `${JSON.stringify(this.#state, null, 2)}\n`,
    );
  }

  /** Il modulo in uso per un id: quello installato vince su quello preinstallato. */
  #current(id: string): {
    module: LoadedModule | undefined;
    enabled: boolean;
    error: string | undefined;
  } {
    const installed = this.#installed.get(id);
    if (installed !== undefined) {
      return {
        module: installed.module,
        enabled: installed.record.enabled,
        error: installed.error,
      };
    }
    const bundled = this.#bundled.get(id);
    return { module: bundled, enabled: !this.#state.disabled.includes(id), error: undefined };
  }

  #ids(): string[] {
    return [...new Set([...this.#bundled.keys(), ...this.#installed.keys()])];
  }

  /** Stato dei processi dei moduli con codice (dal ModuleSupervisor). */
  setRuntimeStatus(
    provider: (id: string) => { state: PluginState; error?: string } | undefined,
  ): void {
    this.#runtimeStatus = provider;
  }

  /** Il modulo attivo con quell'id, se c'e'. */
  find(id: string): LoadedModule | undefined {
    return this.active().find((m) => m.manifest.id === id);
  }

  /** Cartella del modulo in uso con quell'id e quella versione (per servirne i file). */
  dirOf(id: string, version: string): string | undefined {
    const { module } = this.#current(id);
    return module !== undefined && module.manifest.version === version ? module.dir : undefined;
  }

  /** Moduli attivi, in ordine: preinstallati poi installati. */
  active(): LoadedModule[] {
    return this.#ids().flatMap((id) => {
      const { module, enabled, error } = this.#current(id);
      return module !== undefined && enabled && error === undefined ? [module] : [];
    });
  }

  statuses(): PluginStatus[] {
    return this.#ids().flatMap((id): PluginStatus[] => {
      const { module, enabled, error } = this.#current(id);
      const version =
        module?.manifest.version ?? this.#installed.get(id)?.record.version ?? "0.0.0";
      if (error !== undefined || module === undefined) {
        return [
          { id, version, state: "crashed" as const, error: error ?? "core.module.loadFailed" },
        ];
      }
      if (!enabled) return [{ id, version, state: "disabled" as const }];
      if (module.manifest.runtime.type === "none")
        return [{ id, version, state: "active" as const }];
      // Modulo con codice: lo stato del suo processo (in avvio finche' non risponde).
      const runtime = this.#runtimeStatus(id) ?? { state: "enabled" as const };
      return [{ id, version, ...runtime }];
    });
  }

  /** Un modulo e' obbligatorio se toglierlo lascerebbe il nucleo senza lingua. */
  isRequired(id: string): boolean {
    const { module } = this.#current(id);
    if (module?.manifest.family !== "locale") return false;
    return (
      this.active().filter((m) => m.manifest.family === "locale").length === 1 &&
      this.active().some((m) => m.manifest.id === id)
    );
  }

  installed(): InstalledPlugin[] {
    const statuses = new Map(this.statuses().map((s) => [s.id, s]));
    return this.#ids().flatMap((id) => {
      const { module, enabled } = this.#current(id);
      const status = statuses.get(id);
      if (module === undefined || status === undefined) return [];
      const record = this.#installed.get(id)?.record;
      return [
        {
          manifest: module.manifest,
          status,
          bundled: this.#bundled.has(id),
          required: this.isRequired(id),
          enabled,
          source: record?.source ?? "bundled",
        },
      ];
    });
  }

  /**
   * Installa (o aggiorna) da un pacchetto .cpkg o da una cartella. Si estrae
   * in una cartella di lavoro, si valida il manifest e solo allora si mette
   * al suo posto: un pacchetto sbagliato non tocca il modulo gia' installato.
   */
  install(
    input: { readonly data: Uint8Array } | { readonly dir: string },
    source: "registry" | "local",
    expected?: InstallExpectation,
  ): Promise<{ id: string; version: string }> {
    return this.#serial(async () => {
      const root = this.#requireDir();
      const staging = stagingDir(root, randomBytes(6).toString("hex"));
      await mkdir(staging, { recursive: true });
      try {
        if ("data" in input) await extractPackage(input.data, staging);
        else
          await cp(input.dir, staging, {
            recursive: true,
            // Una cartella di sviluppo: niente dipendenze e niente storia di git.
            filter: (src) => !/[\\/](?:node_modules|\.git)(?:[\\/]|$)/.test(src),
          });

        let module: LoadedModule;
        try {
          module = await loadModule(staging, this.#engineVersion, false);
        } catch (error) {
          if (error instanceof ModuleLoadError) {
            throw new RpcError(ErrorCode.InvalidParameters, error.key, { params: error.params });
          }
          throw error;
        }
        const { id, version } = module.manifest;
        if (expected !== undefined && (expected.id !== id || expected.version !== version)) {
          throw new RpcError(ErrorCode.InvalidParameters, "core.error.packageMismatch");
        }

        const target = join(root, id, version);
        await mkdir(join(root, id), { recursive: true });
        await rm(target, { recursive: true, force: true });
        await rename(staging, target);

        const old = this.#state.installed[id];
        const record: InstallRecord = {
          version,
          enabled: old?.enabled ?? true,
          source,
          ...(old !== undefined && old.version !== version ? { previous: old.version } : {}),
        };
        this.#state = { ...this.#state, installed: { ...this.#state.installed, [id]: record } };
        await this.#saveState();
        this.#installed.set(id, await this.#loadRecord(id, record));
        await this.#prune(id, [record.version, record.previous]);
        this.#changed();
        return { id, version };
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    });
  }

  /** Tiene solo la versione in uso e la precedente. */
  async #prune(id: string, keep: readonly (string | undefined)[]): Promise<void> {
    const dir = join(this.#requireDir(), id);
    const versions = await readdir(dir).catch(() => [] as string[]);
    for (const version of versions) {
      if (keep.includes(version)) continue;
      const path = join(dir, version);
      if ((await stat(path)).isDirectory()) await rm(path, { recursive: true, force: true });
    }
  }

  setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.#serial(async () => {
      const { module } = this.#current(id);
      if (module === undefined) throw new RpcError(ErrorCode.NotFound, "core.error.moduleNotFound");
      if (!enabled && this.isRequired(id)) {
        throw new RpcError(ErrorCode.InvalidParameters, "core.error.moduleRequired");
      }
      const installed = this.#installed.get(id);
      if (installed !== undefined) {
        const record = { ...installed.record, enabled };
        this.#state = { ...this.#state, installed: { ...this.#state.installed, [id]: record } };
        this.#installed.set(id, { ...installed, record });
      } else {
        const disabled = new Set(this.#state.disabled);
        if (enabled) disabled.delete(id);
        else disabled.add(id);
        this.#state = { ...this.#state, disabled: [...disabled] };
      }
      await this.#saveState();
      this.#changed();
    });
  }

  /** Disinstalla; se il modulo c'era anche preinstallato si torna a quello. */
  uninstall(id: string): Promise<void> {
    return this.#serial(async () => {
      if (!this.#installed.has(id)) {
        throw new RpcError(
          ErrorCode.InvalidParameters,
          this.#bundled.has(id) ? "core.error.moduleBundled" : "core.error.moduleNotFound",
        );
      }
      if (this.isRequired(id) && !this.#bundled.has(id)) {
        throw new RpcError(ErrorCode.InvalidParameters, "core.error.moduleRequired");
      }
      const { [id]: _removed, ...rest } = this.#state.installed;
      this.#state = { ...this.#state, installed: rest };
      await this.#saveState();
      this.#installed.delete(id);
      await rm(join(this.#requireDir(), id), { recursive: true, force: true });
      this.#changed();
    });
  }
}
