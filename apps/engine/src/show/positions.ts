import { slideSequence, type Show, type Slide } from "@cuelith/protocol";

/** Una slide precisa della scaletta: voce + indice nella sequenza di proiezione. */
export interface Position {
  readonly entryId: string;
  readonly slideIndex: number;
}

/** Sequenza di slide della voce di scaletta, o undefined se la voce non esiste. */
export function entrySlides(show: Show, entryId: string): Slide[] | undefined {
  const entry = show.playlist.find((e) => e.id === entryId);
  if (entry === undefined) return undefined;
  const item = show.items[entry.itemId];
  return item === undefined ? undefined : slideSequence(item);
}

export function isValidPosition(show: Show, position: Position): boolean {
  const slides = entrySlides(show, position.entryId);
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

/** Slide successiva: nella stessa voce, altrimenti la prima della voce seguente. */
export function nextPosition(show: Show, position: Position): Position | undefined {
  const slides = entrySlides(show, position.entryId);
  if (slides === undefined) return undefined;
  if (position.slideIndex + 1 < slides.length) {
    return { entryId: position.entryId, slideIndex: position.slideIndex + 1 };
  }
  const index = show.playlist.findIndex((e) => e.id === position.entryId);
  return firstFrom(show, index + 1, 1);
}

/** Slide precedente: nella stessa voce, altrimenti l'ultima della voce prima. */
export function prevPosition(show: Show, position: Position): Position | undefined {
  const slides = entrySlides(show, position.entryId);
  if (slides === undefined) return undefined;
  if (position.slideIndex > 0) {
    return { entryId: position.entryId, slideIndex: position.slideIndex - 1 };
  }
  const index = show.playlist.findIndex((e) => e.id === position.entryId);
  return firstFrom(show, index - 1, -1);
}
