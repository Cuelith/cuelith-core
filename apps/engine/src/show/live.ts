import type { Cursor, StateDocument } from "@cuelith/protocol";
import {
  isValidPosition,
  moved,
  nextPosition,
  positionItem,
  positionLength,
  type Position,
} from "./positions.js";

const EMPTY: Cursor = { slideIndex: 0 };

function positionOf(cursor: Cursor): Position | undefined {
  if (cursor.itemId !== undefined) return { itemId: cursor.itemId, slideIndex: cursor.slideIndex };
  return cursor.entryId === undefined
    ? undefined
    : { entryId: cursor.entryId, slideIndex: cursor.slideIndex };
}

const cursorOf = (position: Position): Cursor =>
  position.itemId !== undefined
    ? { itemId: position.itemId, slideIndex: position.slideIndex }
    : { entryId: position.entryId, slideIndex: position.slideIndex };

export const programPosition = (doc: StateDocument): Position | undefined =>
  positionOf(doc.live.cursor);
export const previewPosition = (doc: StateDocument): Position | undefined =>
  positionOf(doc.live.preview);

/**
 * Gli elementi fuori scaletta vivono finche' sono in programma o in anteprima
 * (o ancora sul layer del contenuto): poi si tolgono.
 */
export function pruneDirect(draft: StateDocument): void {
  const { live } = draft;
  if (live.direct === undefined) return;
  const used = new Set(
    [live.cursor.itemId, live.preview.itemId, live.layers.content.itemId].filter(
      (id): id is string => id !== undefined,
    ),
  );
  const all = Object.entries(live.direct);
  const kept = all.filter(([id]) => used.has(id));
  if (kept.length === 0) delete live.direct;
  else if (kept.length < all.length) live.direct = Object.fromEntries(kept);
}

/**
 * Manda in programma una slide (o nulla). Il layer del contenuto la mostra e
 * l'anteprima passa da sola alla slide successiva, cosi' "Invio" o "avanti"
 * proseguono senza che l'operatore debba prepararla.
 */
export function goLive(draft: StateDocument, position: Position | undefined): void {
  const { live } = draft;
  if (position === undefined) {
    live.cursor = { ...EMPTY };
    live.layers.content = { visible: false };
    pruneDirect(draft);
    return;
  }
  const item = positionItem(draft, position);
  if (item === undefined) throw new Error("posizione inesistente");
  live.cursor = cursorOf(position);
  live.layers.content = { visible: true, itemId: item.id, slideIndex: position.slideIndex };
  const next = nextPosition(draft, position);
  live.preview = next === undefined ? { ...EMPTY } : cursorOf(next);
  pruneDirect(draft);
}

/** Mette in anteprima una slide senza toccare il programma. */
export function setPreview(draft: StateDocument, position: Position): void {
  draft.live.preview = cursorOf(position);
  pruneDirect(draft);
}

/** Riporta una posizione dentro lo show dopo una modifica, o la toglie. */
function repair(draft: StateDocument, cursor: Cursor): Cursor {
  const position = positionOf(cursor);
  if (position === undefined || isValidPosition(draft, position)) return cursor;
  const count = positionLength(draft, position) ?? 0;
  return count === 0 ? { ...EMPTY } : cursorOf(moved(position, count - 1));
}

/**
 * Dopo ogni modifica allo show: cursore e anteprima non possono puntare a
 * voci o slide che non esistono piu', e il layer del contenuto resta
 * allineato al programma (se era visibile).
 */
export function normalizeLive(draft: StateDocument): void {
  const { live } = draft;
  live.cursor = repair(draft, live.cursor);
  live.preview = repair(draft, live.preview);
  const program = positionOf(live.cursor);
  if (program === undefined) {
    live.layers.content = { visible: false };
    pruneDirect(draft);
    return;
  }
  const item = positionItem(draft, program);
  if (live.layers.content.visible && item !== undefined) {
    live.layers.content = { visible: true, itemId: item.id, slideIndex: program.slideIndex };
  }
  pruneDirect(draft);
}
