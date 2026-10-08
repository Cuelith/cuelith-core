import { useCallback, useEffect, useSyncExternalStore } from "react";

// Preferiti della colonna delle icone e strumenti usati di recente (decisione 0017). Sono
// preferenze di questa postazione: stanno nel browser, non nello show.
//
// Finche' l'utente non sceglie, tutti gli strumenti sono nella colonna (come prima). Alla prima
// scelta l'elenco diventa esplicito; da quel momento un plugin appena installato si fissa da solo
// (si vede subito: poi lo si toglie con la stella se non serve).

const PINNED_KEY = "cuelith.pinned";
const SEEN_KEY = "cuelith.pinned.seen";
const RECENT_KEY = "cuelith.recent";
const CHANGED = "cuelith:prefs-changed";
const RECENT_MAX = 8;

function read(key: string): string[] | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // La scelta vale comunque finche' la pagina resta aperta (si rilegge dallo stato in memoria).
    memory.set(key, [...value]);
  }
  window.dispatchEvent(new Event(CHANGED));
}

const memory = new Map<string, string[]>();
const get = (key: string): string[] | undefined => read(key) ?? memory.get(key);

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Un valore stabile tra una lettura e l'altra, cosi' React non ridisegna per niente. */
const snapshot = (key: string): string => JSON.stringify(get(key) ?? null);

export interface Pins {
  /** Gli id fissati; `undefined` = nessuna scelta ancora, vale «tutti». */
  readonly pinned: readonly string[] | undefined;
  readonly isPinned: (id: string) => boolean;
  /** Fissa o toglie uno strumento; `all` e' l'elenco degli strumenti attivi adesso. */
  readonly toggle: (id: string, all: readonly string[]) => void;
  /** Ultimi strumenti aperti, il piu' recente per primo. */
  readonly recent: readonly string[];
  readonly markUsed: (id: string) => void;
}

/**
 * Preferiti e recenti. Passando l'elenco degli strumenti attivi (`all`) i nuovi vengono fissati
 * da soli quando l'elenco e' gia' esplicito.
 */
export function usePins(all: readonly string[]): Pins {
  const pinnedRaw = useSyncExternalStore(subscribe, () => snapshot(PINNED_KEY));
  const recentRaw = useSyncExternalStore(subscribe, () => snapshot(RECENT_KEY));
  const pinned = (JSON.parse(pinnedRaw) as string[] | null) ?? undefined;
  const recent = (JSON.parse(recentRaw) as string[] | null) ?? [];

  const allKey = all.join("\n");
  useEffect(() => {
    const current = get(PINNED_KEY);
    if (current === undefined) return;
    const seen = new Set(get(SEEN_KEY) ?? current);
    const fresh = allKey === "" ? [] : allKey.split("\n").filter((id) => !seen.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) seen.add(id);
    write(SEEN_KEY, [...seen]);
    write(PINNED_KEY, [...current, ...fresh]);
  }, [allKey]);

  const toggle = useCallback((id: string, every: readonly string[]) => {
    const current = get(PINNED_KEY);
    if (current === undefined) {
      // Prima scelta: tutti fissati tranne questo, e quelli che ci sono ora non sono «nuovi».
      write(SEEN_KEY, [...every]);
      write(
        PINNED_KEY,
        every.filter((other) => other !== id),
      );
      return;
    }
    write(
      PINNED_KEY,
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  }, []);

  const markUsed = useCallback((id: string) => {
    const list = get(RECENT_KEY) ?? [];
    write(RECENT_KEY, [id, ...list.filter((other) => other !== id)].slice(0, RECENT_MAX));
  }, []);

  return {
    pinned,
    isPinned: (id) => pinned === undefined || pinned.includes(id),
    toggle,
    recent,
    markUsed,
  };
}
