import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ENGINE_PORT,
  isOnAir,
  LangSchema,
  REGISTRY_INDEX_URL,
  REGISTRY_INDEX_V2_URL,
  type Lang,
} from "@cuelith/protocol";
import { Tokens } from "./auth.js";
import type { EngineContext } from "./context.js";
import type { DisplayProvider } from "./displays.js";
import { createHttpServer, type StaticPaths } from "./http/server.js";
import { consoleLogger, type Logger } from "./log.js";
import { LicenseService, type LicenseTimings } from "./licenses/service.js";
import type { SecretStore } from "./licenses/secrets.js";
import { Locales } from "./modules/locales.js";
import { Marketplace, type Fetch } from "./modules/marketplace.js";
import { ModuleRegistry } from "./modules/registry.js";
import type { NodeRuntime } from "./modules/sandbox.js";
import { ModuleSupervisor, type SupervisorTimings } from "./modules/supervisor.js";
import { PanelWarmer } from "./modules/warm.js";
import { pluginSelfHandlers } from "./rpc/handlers/pluginSelf.js";
import { NetworkService } from "./network.js";
import { processMetrics, ResourceMonitor, type MetricsProvider } from "./resources.js";
import { licenseHandlers } from "./rpc/handlers/licenses.js";
import { pluginHandlers } from "./rpc/handlers/plugins.js";
import { dispatch, type HandlerMap } from "./rpc/dispatch.js";
import { cueHandlers } from "./rpc/handlers/cue.js";
import { editHandlers } from "./rpc/handlers/edit.js";
import { outputHandlers } from "./rpc/handlers/outputs.js";
import { readHandlers } from "./rpc/handlers/read.js";
import { sessionHandlers } from "./rpc/handlers/session.js";
import { showHandlers } from "./rpc/handlers/show.js";
import { attachRpcServer } from "./rpc/server.js";
import { writeFileAtomic } from "./show/files.js";
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
  /** Indice del marketplace (predefinito: l'indice 2 su GitHub Pages di Cuelith, con ripiego sull'indice 1). */
  readonly registryUrl?: string;
  /**
   * Custodia dei segreti del sistema (nel desktop `safeStorage`): senza, i plugin a
   * pagamento non si possono attivare (decisione 0013).
   */
  readonly secrets?: SecretStore;
  /** Solo per le prove: indirizzo e chiavi del Notaio, orologio e tempi dei controlli. */
  readonly licenseUrl?: string;
  readonly notaryKeys?: Readonly<Record<string, string>>;
  readonly now?: () => number;
  readonly licenseTimings?: Partial<LicenseTimings>;
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
  ...licenseHandlers,
  ...pluginSelfHandlers,
};

/** Scelte dell'utente che valgono per tutta l'installazione (settings.json). */
interface Settings {
  lang?: Lang;
}

async function readSettings(file: string): Promise<Settings> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as { lang?: unknown };
    const lang = LangSchema.safeParse(raw.lang);
    return lang.success ? { lang: lang.data } : {};
  } catch {
    return {};
  }
}

export async function startEngine(options: EngineOptions): Promise<Engine> {
  const logger = options.logger ?? consoleLogger;
  const host = options.host ?? "127.0.0.1";

  const modules = new ModuleRegistry(logger);
  await modules.loadBundled(options.paths.bundledPlugins, options.version);
  await modules.loadInstalled(join(options.paths.data, "plugins"));
  const marketplace = new Marketplace({
    url: options.registryUrl ?? REGISTRY_INDEX_V2_URL,
    ...(options.registryUrl === undefined ? { fallbackUrl: REGISTRY_INDEX_URL } : {}),
    cacheFile: join(options.paths.data, "registry-cache.json"),
    engineVersion: options.version,
    logger,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  // Licenze dei plugin a pagamento: i plugin installati dal marketplace come «a pagamento»
  // partono solo se la licenza vale; in onda non si toglie nulla (vedi LicenseService).
  const refs: { store: StateStore | undefined } = { store: undefined };
  const licenses = new LicenseService({
    dir: join(options.paths.data, "licenses"),
    secrets: options.secrets,
    notaryUrl: options.licenseUrl,
    notaryKeys: options.notaryKeys,
    fetch: options.fetch ?? fetch,
    logger,
    isOnAir: () => refs.store?.read(isOnAir) ?? false,
    onChange: () => {
      modules.refresh();
    },
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.licenseTimings === undefined ? {} : { timings: options.licenseTimings }),
  });
  modules.setLicenseGate(licenses);
  await licenses.load();
  // La lingua scelta dall'utente vale piu' di quella proposta all'avvio
  // (options.lang: quella del sistema, se il desktop la passa).
  const settingsFile = join(options.paths.data, "settings.json");
  const settings = await readSettings(settingsFile);
  const locales = new Locales(() => modules.active(), settings.lang ?? options.lang ?? "it");
  if (locales.available().length === 0)
    logger.error("nessuna lingua installata: l'interfaccia mostrerà le chiavi");

  const store = new StateStore(
    {
      show: createShow({
        show: locales.t("core.show.newName"),
        roomLook: locales.t("core.look.room"),
        stageLook: locales.t("core.look.stage"),
      }),
      live: { ...createLiveState(), plugins: modules.statuses(), lang: locales.active },
    },
    logger,
  );
  refs.store = store;

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

  const warmer = new PanelWarmer();
  void warmer.warm(modules.active());
  const publishLang = () => {
    store.update((draft) => {
      draft.live.lang = locales.active;
    });
  };
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
    setLanguage: async (lang) => {
      if (!locales.choose(lang)) return false;
      await writeFileAtomic(settingsFile, `${JSON.stringify({ ...settings, lang }, null, 2)}\n`);
      settings.lang = lang;
      publishLang();
      return true;
    },
    modules,
    supervisor,
    resources,
    marketplace,
    licenses,
    library,
    shows,
    displays: options.displays,
    tokens,
    sessions: new Set(),
    network,
    logger,
  };

  modules.setStopWaiter((id) => supervisor.whenStopped(id));
  modules.onChange(() => {
    if (locales.refresh()) publishLang();
    refreshPlugins();
    void warmer.warm(modules.active());
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
  licenses.start();
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
      licenses.stop();
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
