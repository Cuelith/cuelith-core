import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  ErrorCode,
  RpcError,
  SHOW_FILE_EXTENSION,
  type LiveState,
  type Show,
  type StateDocument,
} from "@cuelith/protocol";
import type { Logger } from "../log.js";
import type { Locales } from "../modules/locales.js";
import type { ModuleRegistry } from "../modules/registry.js";
import type { StateStore } from "../state/store.js";
import { createLiveState, createShow } from "../state/defaults.js";
import { checkShowPath, readShowFile, writeShowFile } from "./files.js";

/** Ogni quanto si salva la copia automatica (cap. 28: ogni 2 minuti). */
export const AUTOSAVE_INTERVAL_MS = 120_000;

export interface ShowServiceOptions {
  readonly store: StateStore;
  readonly locales: Locales;
  readonly modules: ModuleRegistry;
  readonly logger: Logger;
  /** Cartella delle copie automatiche (dentro la cartella dati dell'app). */
  readonly autosaveDir: string;
  readonly autosaveIntervalMs?: number;
}

/** Stato live di uno show appena aperto o creato: niente in onda, uscite accese. */
function freshLive(current: LiveState, show: Show): LiveState {
  const live = createLiveState();
  return {
    ...live,
    rev: current.rev,
    libraryRev: current.libraryRev,
    clients: current.clients,
    plugins: current.plugins,
    ...(current.recovery === undefined ? {} : { recovery: current.recovery }),
    // Rete e lingua sono dell'installazione, non dello show: restano come sono.
    ...(current.network === undefined ? {} : { network: current.network }),
    ...(current.lang === undefined ? {} : { lang: current.lang }),
    outputs: Object.fromEntries(
      Object.keys(show.outputs).map((id) => [
        id,
        { blackout: false, freeze: false, status: "ok" as const },
      ]),
    ),
  };
}

/**
 * File dello show: nuovo, apri, salva, rinomina, e la copia automatica.
 * La copia automatica non tocca mai il file dell'utente: sta nella cartella
 * dati, esiste solo finche' ci sono modifiche non salvate e, dopo una
 * chiusura non corretta, viene proposta al riavvio (live.recovery).
 */
export class ShowService {
  readonly #o: ShowServiceOptions;
  #timer: ReturnType<typeof setInterval> | undefined;
  #autosavedRev = -1;
  #autosaving: Promise<void> = Promise.resolve();

  constructor(options: ShowServiceOptions) {
    this.#o = options;
  }

  async start(): Promise<void> {
    await mkdir(this.#o.autosaveDir, { recursive: true });
    await this.#findRecovery();
    this.#timer = setInterval(() => {
      void this.autosaveNow();
    }, this.#o.autosaveIntervalMs ?? AUTOSAVE_INTERVAL_MS);
  }

  /** Chiusura corretta: la copia automatica non serve piu'. */
  async stop(): Promise<void> {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#autosaving;
    await this.#removeAutosave(this.#showId());
  }

  #showId(): string {
    return this.#o.store.read((doc) => doc.show.id);
  }

  #autosavePath(showId: string): string {
    return join(this.#o.autosaveDir, `${showId}${SHOW_FILE_EXTENSION}`);
  }

  async #removeAutosave(showId: string): Promise<void> {
    await rm(this.#autosavePath(showId), { force: true }).catch((error: unknown) => {
      this.#o.logger.warn("copia automatica non eliminata", error);
    });
    if (this.#o.store.read((doc) => doc.show.id) === showId) this.#autosavedRev = -1;
  }

  /** Scrive la copia automatica se lo show ha modifiche non salvate nuove. */
  autosaveNow(): Promise<void> {
    const run = async () => {
      const { show, rev, dirty } = this.#o.store.read((doc) => ({
        show: structuredClone(doc.show),
        rev: doc.live.rev,
        dirty: doc.live.dirty,
      }));
      if (!dirty || rev === this.#autosavedRev) return;
      try {
        await writeShowFile(this.#autosavePath(show.id), show);
        this.#autosavedRev = rev;
      } catch (error) {
        this.#o.logger.error("copia automatica non riuscita", error);
      }
    };
    this.#autosaving = this.#autosaving.then(run);
    return this.#autosaving;
  }

  /** La copia automatica piu' recente rimasta nella cartella, le altre si eliminano. */
  async #findRecovery(): Promise<void> {
    const names = (await readdir(this.#o.autosaveDir)).filter((n) =>
      n.endsWith(SHOW_FILE_EXTENSION),
    );
    const files = await Promise.all(
      names.map(async (name) => {
        const path = join(this.#o.autosaveDir, name);
        return { path, mtime: (await stat(path)).mtime };
      }),
    );
    files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const [newest, ...stale] = files;
    await Promise.all(stale.map((f) => rm(f.path, { force: true })));
    if (newest === undefined) return;
    try {
      const show = await readShowFile(newest.path);
      this.#o.store.update((draft) => {
        draft.live.recovery = {
          path: newest.path,
          showName: show.name,
          savedAt: newest.mtime.toISOString(),
        };
      });
    } catch {
      await rm(newest.path, { force: true });
    }
  }

  newShow(name: string): number {
    const oldId = this.#showId();
    const { locales } = this.#o;
    const show = createShow({
      show: name,
      roomLook: locales.t("core.look.room"),
      stageLook: locales.t("core.look.stage"),
    });
    const rev = this.#o.store.update((draft) => {
      draft.show = show;
      draft.live = freshLive(draft.live, show);
    });
    void this.#removeAutosave(oldId);
    return rev;
  }

  async open(path: string): Promise<number> {
    const recoveryPath = this.#o.store.read((doc) => doc.live.recovery?.path);
    const isRecovery = recoveryPath !== undefined && path === recoveryPath;
    if (!isRecovery) checkShowPath(path);
    const show = await readShowFile(path);
    const installed = new Set(this.#o.modules.installed().map((p) => p.manifest.id));
    const missing = Object.keys(show.plugins).filter((id) => !installed.has(id));
    if (missing.length > 0) {
      throw new RpcError(ErrorCode.PluginNotActive, "core.error.showNeedsPlugins", {
        params: { plugins: missing.join(", ") },
      });
    }
    const oldId = this.#showId();
    const rev = this.#o.store.update((draft) => {
      draft.show = show;
      draft.live = freshLive(draft.live, show);
      if (isRecovery) {
        // Una copia automatica non e' un file dell'utente: va salvata con un nome.
        delete draft.live.recovery;
        draft.live.dirty = true;
      } else {
        draft.live.showPath = path;
      }
    });
    if (oldId !== show.id) void this.#removeAutosave(oldId);
    return rev;
  }

  async save(path?: string): Promise<{ path: string; rev: number }> {
    const target = path ?? this.#o.store.read((doc) => doc.live.showPath);
    if (target === undefined) {
      throw new RpcError(ErrorCode.InvalidParameters, "core.error.showPathRequired");
    }
    checkShowPath(target);
    const written = this.#o.store.read((doc) => structuredClone(doc.show));
    await writeShowFile(target, written);
    const rev = this.#o.store.update((draft: StateDocument) => {
      draft.live.showPath = target;
      // Modifiche arrivate durante la scrittura restano da salvare.
      draft.live.dirty = !isDeepStrictEqual(draft.show, written);
    });
    if (!this.#o.store.read((doc) => doc.live.dirty)) await this.#removeAutosave(written.id);
    return { path: target, rev };
  }

  rename(name: string): number {
    return this.#o.store.update((draft) => {
      if (draft.show.name === name) return;
      draft.show.name = name;
      draft.live.dirty = true;
    });
  }

  async discardRecovery(): Promise<number> {
    const path = this.#o.store.read((doc) => doc.live.recovery?.path);
    if (path !== undefined) await rm(path, { force: true });
    return this.#o.store.update((draft) => {
      delete draft.live.recovery;
    });
  }
}
