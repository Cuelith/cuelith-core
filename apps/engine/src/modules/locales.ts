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

  #preferred: Lang;

  constructor(modules: () => readonly LoadedModule[], preferred: Lang) {
    this.#modules = modules;
    this.#preferred = preferred;
    const available = this.available().map((l) => l.lang);
    this.#active = available.includes(preferred) ? preferred : (available[0] ?? preferred);
  }

  get active(): Lang {
    return this.#active;
  }

  /**
   * La lingua scelta dall'utente (protocollo 1.13): diventa quella in uso e
   * quella preferita ai prossimi cambi dei moduli. False se non e' installata.
   */
  choose(lang: Lang): boolean {
    if (!this.available().some((l) => l.lang === lang)) return false;
    this.#preferred = lang;
    this.#active = lang;
    return true;
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
    // Un modulo non ancora tradotto in questa lingua mostra i suoi testi nella
    // lingua che ha, invece delle chiavi.
    return mergeCatalogs(
      [...core, ...others].map(
        (m) =>
          m.catalogs.get(lang) ??
          (m.manifest.family === "locale" ? {} : (m.catalogs.values().next().value ?? {})),
      ),
    );
  }

  /**
   * Dopo che i moduli cambiano: se la lingua in uso non c'e' piu' si passa
   * alla prima disponibile; se quella preferita e' tornata, la si riprende.
   * Restituisce true se la lingua e' cambiata.
   */
  refresh(): boolean {
    const available = this.available().map((l) => l.lang);
    const next = available.includes(this.#preferred)
      ? this.#preferred
      : (available[0] ?? this.#active);
    const changed = next !== this.#active;
    this.#active = next;
    return changed;
  }

  t(key: string, params?: MessageParams): string {
    return translate(this.catalog(this.#active), this.#active, key, params);
  }
}
