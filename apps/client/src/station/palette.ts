// «Cerca e vai» (decisione 0017): voci cercabili e ordine dei risultati. Codice puro, senza
// interfaccia, cosi' si prova a parte.

export type PaletteKind = "plugin" | "command" | "mode" | "app" | "item";

/** Ordine dei gruppi nell'elenco. */
export const PALETTE_KINDS: readonly PaletteKind[] = ["plugin", "command", "mode", "app", "item"];

export interface PaletteEntry {
  /** Unico tra tutte le voci (serve anche come chiave). */
  readonly id: string;
  readonly kind: PaletteKind;
  readonly title: string;
  /** Riga sotto il titolo: il plugin di uno strumento, la scorciatoia di un comando... */
  readonly subtitle?: string | undefined;
  /** Altre parole che trovano la voce (non si mostrano). */
  readonly keywords?: string | undefined;
}

/** Minuscolo e senza accenti: «Uscite» e «uscite», «città» e «citta» sono la stessa cosa. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

/**
 * Punteggio di una voce per una ricerca (piu' basso = piu' in alto), o `undefined` se non
 * corrisponde. Ogni parola scritta deve trovarsi da qualche parte nella voce, in qualsiasi ordine.
 * Conta dove: l'inizio del titolo vince sull'inizio di una sua parola, che vince su un pezzo nel
 * mezzo, che vince su sottotitolo e parole chiave.
 */
export function score(entry: PaletteEntry, query: string): number | undefined {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const title = normalize(entry.title);
  const other = normalize(`${entry.subtitle ?? ""} ${entry.keywords ?? ""}`);
  let total = 0;
  for (const word of words) {
    if (title.startsWith(word)) total += 0;
    else if (title.split(/[\s\-_.]+/).some((part) => part.startsWith(word))) total += 1;
    else if (title.includes(word)) total += 2;
    else if (other.includes(word)) total += 3;
    else return undefined;
  }
  return total;
}

/**
 * Le voci che corrispondono, dalla migliore. A parita' di punteggio restano nell'ordine
 * dato (e i gruppi nell'ordine di `PALETTE_KINDS`). Senza ricerca: tutte, tranne gli elementi
 * della scaletta (sarebbero troppi e non servono a chi non ha scritto nulla).
 */
export function search(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  const empty = query.trim() === "";
  const kindOrder = (entry: PaletteEntry) => PALETTE_KINDS.indexOf(entry.kind);
  return entries
    .map((entry, index) => ({ entry, index, points: score(entry, query) }))
    .filter(
      (found): found is { entry: PaletteEntry; index: number; points: number } =>
        found.points !== undefined && !(empty && found.entry.kind === "item"),
    )
    .sort(
      (a, b) => a.points - b.points || kindOrder(a.entry) - kindOrder(b.entry) || a.index - b.index,
    )
    .map((found) => found.entry);
}
