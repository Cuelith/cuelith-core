import {
  slideSequence,
  type Item,
  type Show,
  type Slide,
  type StateDocument,
} from "@cuelith/protocol";

/**
 * Una slide precisa: di una voce della scaletta, oppure (protocollo 1.5) di un
 * elemento mandato direttamente, fuori scaletta, che sta in `live.direct`.
 * L'indice e' nella sequenza di proiezione.
 */
export type Position =
  | { readonly entryId: string; readonly itemId?: undefined; readonly slideIndex: number }
  | { readonly itemId: string; readonly entryId?: undefined; readonly slideIndex: number };

/** Sequenza di slide della voce di scaletta, o undefined se la voce non esiste. */
export function entrySlides(show: Show, entryId: string): Slide[] | undefined {
  const entry = show.playlist.find((e) => e.id === entryId);
  if (entry === undefined) return undefined;
  const item = show.items[entry.itemId];
  return item === undefined ? undefined : slideSequence(item);
}

/** L'elemento di una posizione: della scaletta o fuori scaletta. */
export function positionItem(doc: StateDocument, position: Position): Item | undefined {
  if (position.itemId !== undefined) return doc.live.direct?.[position.itemId];
  const entry = doc.show.playlist.find((e) => e.id === position.entryId);
  return entry === undefined ? undefined : doc.show.items[entry.itemId];
}

function positionSlides(doc: StateDocument, position: Position): Slide[] | undefined {
  const item = positionItem(doc, position);
  return item === undefined ? undefined : slideSequence(item);
}

/** Quante slide ha la voce (o l'elemento diretto) della posizione; undefined se non esiste. */
export function positionLength(doc: StateDocument, position: Position): number | undefined {
  return positionSlides(doc, position)?.length;
}

export function isValidPosition(doc: StateDocument, position: Position): boolean {
  const slides = positionSlides(doc, position);
  return slides !== undefined && position.slideIndex < slides.length;
}

/** Prima slide della prima voce, a partire da `fromIndex`, che ne abbia almeno una. */
function firstFrom(show: Show, fromIndex: number, step: 1 | -1): Position | undefined {
  for (let i = fromIndex; i >= 0 && i < show.playlist.length; i += step) {
    const entry = show.playlist[i];
    if (entry === undefined) continue;
    const count = entrySlides(show, entry.id)?.length ?? 0;
    if (count > 0) return { entryId: entry.id, slideIndex: step === 1 ? 0 : count - 1 };
  }
  return undefined;
}

export function firstPosition(show: Show): Position | undefined {
  return firstFrom(show, 0, 1);
}

/** Stessa voce (o stesso elemento diretto), altra slide. */
export function moved(position: Position, slideIndex: number): Position {
  return position.itemId !== undefined
    ? { itemId: position.itemId, slideIndex }
    : { entryId: position.entryId, slideIndex };
}

/**
 * Slide successiva: nella stessa voce, altrimenti la prima della voce seguente.
 * Un elemento fuori scaletta finisce con la sua ultima slide.
 */
export function nextPosition(doc: StateDocument, position: Position): Position | undefined {
  const slides = positionSlides(doc, position);
  if (slides === undefined) return undefined;
  if (position.slideIndex + 1 < slides.length) return moved(position, position.slideIndex + 1);
  if (position.entryId === undefined) return undefined;
  const index = doc.show.playlist.findIndex((e) => e.id === position.entryId);
  return firstFrom(doc.show, index + 1, 1);
}

/** Slide precedente: nella stessa voce, altrimenti l'ultima della voce prima. */
export function prevPosition(doc: StateDocument, position: Position): Position | undefined {
  const slides = positionSlides(doc, position);
  if (slides === undefined) return undefined;
  if (position.slideIndex > 0) return moved(position, position.slideIndex - 1);
  if (position.entryId === undefined) return undefined;
  const index = doc.show.playlist.findIndex((e) => e.id === position.entryId);
  return firstFrom(doc.show, index - 1, -1);
}
