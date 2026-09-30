/**
 * Ricerca libera -> espressione FTS5 sicura: ogni parola diventa un prefisso
 * tra virgolette ("lu"* trova "luce"), unite in AND. Caratteri speciali e
 * operatori scritti dall'utente non arrivano mai a SQLite.
 */
export function ftsQuery(text: string): string | undefined {
  const words = text
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .slice(0, 12);
  if (words.length === 0) return undefined;
  return words.map((word) => `"${word.replaceAll('"', '""')}"*`).join(" ");
}

/** Testo indicizzato di un elemento: tutte le slide, per trovare un canto da una sua riga. */
export function searchableBody(
  slides: readonly { fields: Record<string, { value: string }> }[],
): string {
  return slides
    .map((slide) =>
      Object.values(slide.fields)
        .map((field) => field.value)
        .join("\n"),
    )
    .join("\n");
}
