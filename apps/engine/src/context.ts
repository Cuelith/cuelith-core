import type { Tokens } from "./auth.js";
import type { DisplayProvider } from "./displays.js";
import type { Logger } from "./log.js";
import type { Locales } from "./modules/locales.js";
import type { ModuleRegistry } from "./modules/registry.js";
import type { StateStore } from "./state/store.js";

/** Tutto cio' che i gestori dei comandi possono usare. */
export interface EngineContext {
  readonly version: string;
  readonly store: StateStore;
  readonly locales: Locales;
  readonly modules: ModuleRegistry;
  readonly displays: DisplayProvider;
  readonly tokens: Tokens;
  readonly logger: Logger;
}
