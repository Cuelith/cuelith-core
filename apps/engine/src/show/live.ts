import type { Cursor, StateDocument } from "@cuelith/protocol";
import { entrySlides, isValidPosition, nextPosition, type Position } from "./positions.js";

const EMPTY: Cursor = { slideIndex: 0 };

function positionOf(cursor: Cursor): Position | undefined {
  return cursor.entryId === undefined
    ? undefined
    : { entryId: cursor.entryId, slideIndex: cursor.slideIndex };
}

export const programPosition = (doc: StateDocument): Position | undefined =>
  positionOf(doc.live.cursor);
export const previewPosition = (doc: StateDocument): Position | undefined =>
  positionOf(doc.live.preview);

/**
 * Manda in programma una slide (o nulla). Il layer del contenuto la mostra e
 * l'anteprima passa da sola alla slide successiva, cosi' "Invio" o "avanti"
 * proseguono senza che l'operatore debba prepararla.
 */
export function goLive(draft: StateDocument, position: Position | undefined): void {
  const { show, live } = draft;
  if (position === undefined) {
    live.cursor = { ...EMPTY };
    live.layers.content = { visible: false };
    return;
  }
  const entry = show.playlist.find((e) => e.id === position.entryId);
  if (entry === undefined) throw new Error(`voce inesistente ${position.entryId}`);
  live.cursor = { entryId: position.entryId, slideIndex: position.slideIndex };
  live.layers.content = { visible: true, itemId: entry.itemId, slideIndex: position.slideIndex };
  const next = nextPosition(show, position);
  live.preview = next === undefined ? { ...EMPTY } : { ...next };
}

/** Riporta una posizione dentro lo show dopo una modifica, o la toglie. */
function repair(draft: StateDocument, cursor: Cursor): Cursor {
  const position = positionOf(cursor);
  if (position === undefined || isValidPosition(draft.show, position)) return cursor;
  const count = entrySlides(draft.show, position.entryId)?.length ?? 0;
  return count === 0 ? { ...EMPTY } : { entryId: position.entryId, slideIndex: count - 1 };
}

/**
 * Dopo ogni modifica allo show: cursore e anteprima non possono puntare a
 * voci o slide che non esistono piu', e il layer del contenuto resta
 * allineato al programma (se era visibile).
 */
export function normalizeLive(draft: StateDocument): void {
  const { live, show } = draft;
  live.cursor = repair(draft, live.cursor);
  live.preview = repair(draft, live.preview);
  const program = positionOf(live.cursor);
  if (program === undefined) {
    live.layers.content = { visible: false };
    return;
  }
  const entry = show.playlist.find((e) => e.id === program.entryId);
  if (live.layers.content.visible && entry !== undefined) {
    live.layers.content = { visible: true, itemId: entry.itemId, slideIndex: program.slideIndex };
  }
}
