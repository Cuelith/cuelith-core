import type { Tokens } from "./auth.js";
import type { DisplayProvider } from "./displays.js";
import type { Logger } from "./log.js";
import type { LibraryService } from "./library/service.js";
import type { Locales } from "./modules/locales.js";
import type { Marketplace } from "./modules/marketplace.js";
import type { ModuleRegistry } from "./modules/registry.js";
import type { ModuleSupervisor } from "./modules/supervisor.js";
import type { ResourceMonitor } from "./resources.js";
import type { ShowService } from "./show/service.js";
import type { StateStore } from "./state/store.js";

/** Tutto cio' che i gestori dei comandi possono usare. */
export interface EngineContext {
  readonly version: string;
  readonly store: StateStore;
  readonly locales: Locales;
  readonly modules: ModuleRegistry;
  /** Processi dei moduli con codice (passo 9b). */
  readonly supervisor: ModuleSupervisor;
  /** Contatore delle risorse (protocollo 1.9). */
  readonly resources: ResourceMonitor;
  /** Indice dei moduli (GitHub Pages) e download dei pacchetti. */
  readonly marketplace: Marketplace;
  /** Librerie, archivio e media. */
  readonly library: LibraryService;
  /** File dello show e copia automatica. */
  readonly shows: ShowService;
  readonly displays: DisplayProvider;
  readonly tokens: Tokens;
  readonly logger: Logger;
}
