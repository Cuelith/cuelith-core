import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { DEFAULT_ENGINE_PORT, type Lang } from "@cuelith/protocol";
import { Tokens } from "./auth.js";
import type { EngineContext } from "./context.js";
import type { DisplayProvider } from "./displays.js";
import { createHttpServer, type StaticPaths } from "./http/server.js";
import { consoleLogger, type Logger } from "./log.js";
import { Locales } from "./modules/locales.js";
import { ModuleRegistry } from "./modules/registry.js";
import type { HandlerMap } from "./rpc/dispatch.js";
import { cueHandlers } from "./rpc/handlers/cue.js";
import { editHandlers } from "./rpc/handlers/edit.js";
import { outputHandlers } from "./rpc/handlers/outputs.js";
import { readHandlers } from "./rpc/handlers/read.js";
import { sessionHandlers } from "./rpc/handlers/session.js";
import { showHandlers } from "./rpc/handlers/show.js";
import { attachRpcServer } from "./rpc/server.js";
import { ShowService } from "./show/service.js";
import { LibraryService } from "./library/service.js";
import { libraryHandlers } from "./rpc/handlers/library.js";
import { createLiveState, createShow } from "./state/defaults.js";
import { StateStore } from "./state/store.js";

export interface EngineOptions {
  /** Versione del nucleo (package.json), confrontata con engines.cuelith dei moduli. */
  readonly version: string;
  /** Solo 127.0.0.1 finche' l'utente non sceglie una rete (cap. 27). */
  readonly host?: string;
  /** 0 = porta libera qualsiasi (test). */
  readonly port?: number;
  readonly paths: StaticPaths & {
    /** Cartelle dei moduli preinstallati, es. la lingua italiana. */
    readonly bundledPlugins: readonly string[];
    /** Cartella dati dell'app (copie automatiche, e dal passo 6b librerie e media). */
    readonly data: string;
  };
  /** Solo per le prove: intervallo della copia automatica (predefinito 2 minuti). */
  readonly autosaveIntervalMs?: number;
  readonly displays: DisplayProvider;
  readonly lang?: Lang;
  readonly logger?: Logger;
}

export interface Engine {
  readonly host: string;
  readonly port: number;
  /** Credenziali delle finestre locali; da passare solo a Electron, mai in rete. */
  readonly tokens: { readonly station: string; readonly renderer: string };
  readonly context: EngineContext;
  /**
   * Stato di un'uscita riportato da chi la esegue (le finestre Electron):
   * "error" con la chiave del problema, es. monitor scollegato.
   */
  setOutputStatus(outputId: string, status: "ok" | "error", error?: string): void;
  stop(): Promise<void>;
}

const handlers: HandlerMap = {
  ...sessionHandlers,
  ...readHandlers,
  ...cueHandlers,
  ...editHandlers,
  ...outputHandlers,
  ...showHandlers,
  ...libraryHandlers,
};

export async function startEngine(options: EngineOptions): Promise<Engine> {
  const logger = options.logger ?? consoleLogger;
  const host = options.host ?? "127.0.0.1";

  const modules = new ModuleRegistry(logger);
  await modules.loadBundled(options.paths.bundledPlugins, options.version);
  const locales = new Locales(() => modules.active(), options.lang ?? "it");
  if (locales.available().length === 0)
    logger.error("nessuna lingua installata: l'interfaccia mostrerà le chiavi");

  const store = new StateStore(
    {
      show: createShow({
        show: locales.t("core.show.newName"),
        roomLook: locales.t("core.look.room"),
        stageLook: locales.t("core.look.stage"),
      }),
      live: { ...createLiveState(), plugins: modules.statuses() },
    },
    logger,
  );

  const shows = new ShowService({
    store,
    locales,
    modules,
    logger,
    autosaveDir: join(options.paths.data, "autosave"),
    ...(options.autosaveIntervalMs === undefined
      ? {}
      : { autosaveIntervalMs: options.autosaveIntervalMs }),
  });

  const library = new LibraryService({ store, modules, dataDir: options.paths.data });
  await library.start();

  const context: EngineContext = {
    version: options.version,
    store,
    locales,
    modules,
    library,
    shows,
    displays: options.displays,
    tokens: new Tokens(),
    logger,
  };

  const http = createHttpServer({ ...options.paths, media: library.media.dir }, logger);
  const rpc = attachRpcServer(http, context, handlers);

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port ?? DEFAULT_ENGINE_PORT, host, () => {
      http.off("error", reject);
      resolve();
    });
  });
  const port = (http.address() as AddressInfo).port;
  await shows.start();
  logger.info(`motore in ascolto su http://${host}:${port}`);

  return {
    host,
    port,
    tokens: { station: context.tokens.station, renderer: context.tokens.renderer },
    context,
    setOutputStatus: (outputId, status, error) => {
      store.update((draft) => {
        const live = draft.live.outputs[outputId];
        if (live === undefined) return;
        live.status = status;
        if (status === "error" && error !== undefined) live.error = error;
        else delete live.error;
      });
    },
    stop: async () => {
      await shows.stop();
      await rpc.close();
      library.stop();
      await new Promise<void>((resolve) => {
        http.close(() => {
          resolve();
        });
        http.closeAllConnections();
      });
    },
  };
}
