import {
  cursorItem,
  slideSequence,
  type Item,
  type Position,
  type StateDocument,
} from "@cuelith/protocol";
import { sectionStarts } from "./shortcuts.js";

/** Una sezione nell'ordine di proiezione (una ripetizione e' una nuova occorrenza). */
export interface SectionOccurrence {
  /** "V1", "C1"...; per un elemento senza sezioni, il numero della slide. */
  readonly label: string;
  /** Posizione della prima slide, da mandare in onda. */
  readonly position: Position;
  readonly start: number;
  readonly end: number;
  /** Prima riga del testo, per riconoscerla al volo. */
  readonly firstLine: string;
  readonly state: "live" | "next" | undefined;
}

/**
 * Sezioni dell'elemento in onda (o, se non c'e' nulla in onda, di quello in
 * anteprima), con quella in onda e la successiva: servono ai pannelli
 * Sezioni e Ordine della disposizione Band.
 */
export function liveSections(
  doc: StateDocument,
): { item: Item; occurrences: SectionOccurrence[] } | undefined {
  const { cursor, preview, layers } = doc.live;
  const hasProgram = cursor.entryId !== undefined || cursor.itemId !== undefined;
  const base = hasProgram ? cursor : preview;
  const item = cursorItem(doc, base);
  if (item === undefined) return undefined;
  const where = (slideIndex: number): Position | undefined =>
    base.itemId !== undefined
      ? { itemId: base.itemId, slideIndex }
      : base.entryId !== undefined
        ? { entryId: base.entryId, slideIndex }
        : undefined;
  const sequence = slideSequence(item);
  const grouped = sectionStarts(item);
  const ranges =
    grouped.length > 0
      ? grouped.map(({ group, start }, i) => ({
          label: group.toUpperCase(),
          start,
          end: (grouped[i + 1]?.start ?? sequence.length) - 1,
        }))
      : sequence.map((_, i) => ({ label: String(i + 1), start: i, end: i }));
  const onAir = hasProgram && layers.content.visible ? cursor.slideIndex : undefined;
  const samePreview =
    preview.itemId === base.itemId && preview.entryId === base.entryId
      ? preview.slideIndex
      : undefined;
  const occurrences = ranges.flatMap(({ label, start, end }) => {
    const position = where(start);
    if (position === undefined) return [];
    const within = (index: number | undefined) =>
      index !== undefined && index >= start && index <= end;
    const text = sequence[start]?.fields["text"]?.value ?? "";
    return [
      {
        label,
        position,
        start,
        end,
        firstLine: text.split("\n")[0] ?? "",
        state: within(onAir)
          ? ("live" as const)
          : within(samePreview)
            ? ("next" as const)
            : undefined,
      },
    ];
  });
  return { item, occurrences };
}
