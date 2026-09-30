import {
  mergeCatalogs,
  translate,
  type Catalog,
  type Lang,
  type MessageParams,
} from "@cuelith/protocol";
import type { LoadedModule } from "./load.js";

export interface LangInfo {
  readonly lang: Lang;
  readonly name: string;
}

/**
 * Le lingue arrivano dai moduli: i moduli della famiglia "locale" traducono
 * il nucleo, ogni altro modulo porta le traduzioni delle sue chiavi.
 */
export class Locales {
  readonly #modules: () => readonly LoadedModule[];
  #active: Lang;

  constructor(modules: () => readonly LoadedModule[], preferred: Lang) {
    this.#modules = modules;
    const available = this.available().map((l) => l.lang);
    this.#active = available.includes(preferred) ? preferred : (available[0] ?? preferred);
  }

  get active(): Lang {
    return this.#active;
  }

  available(): LangInfo[] {
    const langs = new Map<Lang, string>();
    for (const module of this.#modules()) {
      if (module.manifest.family !== "locale") continue;
      for (const locale of module.manifest.contributes.locales ?? []) {
        if (!langs.has(locale.lang)) langs.set(locale.lang, locale.name ?? locale.lang);
      }
    }
    return [...langs].map(([lang, name]) => ({ lang, name }));
  }

  catalog(lang: Lang): Catalog {
    const modules = this.#modules();
    const core = modules.filter((m) => m.manifest.family === "locale");
    const others = modules.filter((m) => m.manifest.family !== "locale");
    return mergeCatalogs([...core, ...others].map((m) => m.catalogs.get(lang) ?? {}));
  }

  /**
   * Dopo che i moduli cambiano: se la lingua in uso non c'e' piu' si passa
   * alla prima disponibile. Restituisce true se la lingua e' cambiata.
   */
  refresh(preferred: Lang): boolean {
    const available = this.available().map((l) => l.lang);
    const next = available.includes(preferred) ? preferred : (available[0] ?? this.#active);
    const changed = next !== this.#active;
    this.#active = next;
    return changed;
  }

  t(key: string, params?: MessageParams): string {
    return translate(this.catalog(this.#active), this.#active, key, params);
  }
}
