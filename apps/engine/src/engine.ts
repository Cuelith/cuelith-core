import type { AddressInfo } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";
import { DEFAULT_ENGINE_PORT, REGISTRY_INDEX_URL, type Lang } from "@cuelith/protocol";
import { Tokens } from "./auth.js";
import type { EngineContext } from "./context.js";
import type { DisplayProvider } from "./displays.js";
import { createHttpServer, type StaticPaths } from "./http/server.js";
import { consoleLogger, type Logger } from "./log.js";
import { Locales } from "./modules/locales.js";
import { Marketplace, type Fetch } from "./modules/marketplace.js";
import { ModuleRegistry } from "./modules/registry.js";
import type { NodeRuntime } from "./modules/sandbox.js";
import { ModuleSupervisor, type SupervisorTimings } from "./modules/supervisor.js";
import { pluginSelfHandlers } from "./rpc/handlers/pluginSelf.js";
import { NetworkService } from "./network.js";
import { processMetrics, ResourceMonitor, type MetricsProvider } from "./resources.js";
import { pluginHandlers } from "./rpc/handlers/plugins.js";
import { dispatch, type HandlerMap } from "./rpc/dispatch.js";
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
  /** Indice del marketplace (predefinito: GitHub Pages di Cuelith). */
  readonly registryUrl?: string;
  /** Solo per le prove: rete finta per indice e pacchetti. */
  readonly fetch?: Fetch;
  /** Eseguibile Node per i moduli (predefinito: quello del motore, vedi sandbox.ts). */
  readonly nodeRuntime?: NodeRuntime;
  /** Porta dell'ascolto in rete per le altre postazioni (predefinita 7420; 0 nelle prove). */
  readonly lanPort?: number;
  /** Annuncio in rete `_cuelith._tcp` (predefinito acceso; spento nelle prove). */
  readonly announce?: boolean;
  /** Misure dei processi (il desktop usa quelle di Electron); predefinito: solo il motore. */
  readonly metrics?: MetricsProvider;
  /** Solo per le prove: tempi dei processi dei moduli. */
  readonly moduleTimings?: Partial<SupervisorTimings>;
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
  ...pluginHandlers,
  ...pluginSelfHandlers,
};

export async function startEngine(options: EngineOptions): Promise<Engine> {
  const logger = options.logger ?? consoleLogger;
  const host = options.host ?? "127.0.0.1";

  const modules = new ModuleRegistry(logger);
  await modules.loadBundled(options.paths.bundledPlugins, options.version);
  await modules.loadInstalled(join(options.paths.data, "plugins"));
  const marketplace = new Marketplace({
    url: options.registryUrl ?? REGISTRY_INDEX_URL,
    cacheFile: join(options.paths.data, "registry-cache.json"),
    engineVersion: options.version,
    logger,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
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

  const preferredLang = options.lang ?? "it";
  const refreshPlugins = () => {
    store.update((draft) => {
      draft.live.plugins = modules.statuses();
    });
  };
  const supervisor = new ModuleSupervisor({
    registry: modules,
    store,
    logger,
    dataDir: options.paths.data,
    lang: () => locales.active,
    // Le richieste dei moduli passano dagli stessi controlli delle postazioni.
    dispatch: (request, session) => dispatch(request, session, context, handlers),
    ...(options.nodeRuntime === undefined ? {} : { nodeRuntime: options.nodeRuntime }),
    ...(options.moduleTimings === undefined ? {} : { timings: options.moduleTimings }),
    onStatus: refreshPlugins,
  });
  modules.setRuntimeStatus((id) => supervisor.status(id));

  const resources = new ResourceMonitor({
    provider: options.metrics ?? processMetrics(),
    registry: modules,
    supervisor,
    store,
    peaksFile: join(options.paths.data, "resources.json"),
    logger,
  });

  const tokens = new Tokens();
  await tokens.load(join(options.paths.data, "stations.json"));

  const http = createHttpServer(
    {
      ...options.paths,
      media: library.media.dir,
      pluginDir: (id, version) => modules.dirOf(id, version),
    },
    logger,
  );
  const network = new NetworkService({
    local: http,
    store,
    logger,
    file: join(options.paths.data, "network.json"),
    port: options.lanPort ?? DEFAULT_ENGINE_PORT,
    name: `Cuelith (${hostname()})`,
    announce: options.announce ?? true,
  });

  const context: EngineContext = {
    version: options.version,
    store,
    locales,
    modules,
    supervisor,
    resources,
    marketplace,
    library,
    shows,
    displays: options.displays,
    tokens,
    sessions: new Set(),
    network,
    logger,
  };

  modules.onChange(() => {
    locales.refresh(preferredLang);
    refreshPlugins();
    supervisor.sync();
  });

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
  await supervisor.start();
  await resources.start();
  await network.start();
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
      await network.stop();
      await resources.stop();
      await supervisor.stop();
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
