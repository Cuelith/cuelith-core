import { FullscreenStyleSchema, type FullscreenStyle } from "@cuelith-core/core-looks";
import { slideSequence, type Item, type Slide, type StateDocument } from "@cuelith/protocol";

/** Slide pronta da disegnare, con l'identita' che serve alle dissolvenze. */
export interface ShownSlide {
  readonly key: string;
  readonly item: Item;
  readonly index: number;
  readonly count: number;
  readonly slide: Slide;
}

export function itemOfEntry(doc: StateDocument, entryId: string | undefined): Item | undefined {
  if (entryId === undefined) return undefined;
  const entry = doc.show.playlist.find((e) => e.id === entryId);
  return entry === undefined ? undefined : doc.show.items[entry.itemId];
}

function shown(item: Item | undefined, index: number | undefined): ShownSlide | undefined {
  if (item === undefined || index === undefined) return undefined;
  const slides = slideSequence(item);
  const slide = slides[index];
  return slide === undefined
    ? undefined
    : { key: `${item.id}/${String(index)}/${slide.id}`, item, index, count: slides.length, slide };
}

/** Cio' che e' in onda: il layer del contenuto, non il cursore (dopo "pulisci" e' vuoto). */
export function programSlide(doc: StateDocument): ShownSlide | undefined {
  const content = doc.live.layers.content;
  if (!content.visible || content.itemId === undefined) return undefined;
  return shown(doc.show.items[content.itemId], content.slideIndex);
}

export function previewSlide(doc: StateDocument): ShownSlide | undefined {
  const { preview } = doc.live;
  return shown(itemOfEntry(doc, preview.entryId), preview.slideIndex);
}

/** Stile del look Sala (template a tutto schermo) con cui la postazione disegna i testi. */
export function roomStyle(doc: StateDocument): FullscreenStyle | undefined {
  for (const look of Object.values(doc.show.looks)) {
    if (look.template !== "core.fullscreen") continue;
    const style = FullscreenStyleSchema.safeParse(look.style);
    if (style.success) return style.data;
  }
  return undefined;
}

/** Testo della slide: il campo "text", l'unico che il look Sala mostra. */
export const slideText = (slide: Slide): string => slide.fields["text"]?.value ?? "";

/** Testo scritto nell'editor -> slide: una riga vuota separa due slide. */
export function splitSlides(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export const joinSlides = (slides: readonly Slide[]): string => slides.map(slideText).join("\n\n");
