import {
  creditsFor,
  effectiveTextStyle,
  FullscreenStyleSchema,
  type FullscreenStyle,
} from "@cuelith-core/core-looks";
import {
  cursorItem,
  itemById,
  joinRich,
  slideSequence,
  sliceRich,
  type Item,
  type RichText,
  type Slide,
  type Span,
  type StateDocument,
} from "@cuelith/protocol";

/** Slide pronta da disegnare, con l'identita' che serve alle dissolvenze. */
export interface ShownSlide {
  readonly key: string;
  readonly item: Item;
  readonly index: number;
  readonly count: number;
  readonly slide: Slide;
  /** Riga dei crediti se va mostrata su questa slide (come sulle uscite Sala). */
  readonly credits: string | undefined;
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
    : {
        key: `${item.id}/${String(index)}/${slide.id}`,
        item,
        index,
        count: slides.length,
        slide,
        credits: creditsFor(item, index, slides.length),
      };
}

/** Cio' che e' in onda: il layer del contenuto, non il cursore (dopo "pulisci" e' vuoto). */
export function programSlide(doc: StateDocument): ShownSlide | undefined {
  const content = doc.live.layers.content;
  if (!content.visible || content.itemId === undefined) return undefined;
  return shown(itemById(doc, content.itemId), content.slideIndex);
}

export function previewSlide(doc: StateDocument): ShownSlide | undefined {
  const { preview } = doc.live;
  return shown(cursorItem(doc, preview), preview.slideIndex);
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

/**
 * Stile del look Sala con cui si disegna il testo di un elemento: lo stile globale scelto,
 * altrimenti le modifiche dell'editor sopra lo stile del look (decisione 0015). E' lo stesso
 * calcolo delle uscite.
 */
export function roomStyleFor(
  doc: StateDocument,
  item: Pick<Item, "textStyle"> | undefined,
): FullscreenStyle | undefined {
  const base = roomStyle(doc);
  if (base === undefined) return undefined;
  return {
    ...base,
    text: effectiveTextStyle(base.text, base.globalText?.text, item?.textStyle),
  };
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

/** Le parole formattate di una slide (protocollo 1.21); niente se non ne ha. */
export function slideSpans(slide: Slide): readonly Span[] | undefined {
  const field = slide.fields["text"];
  return field?.kind === "text" && field.spans !== undefined && field.spans.length > 0
    ? field.spans
    : undefined;
}

/** Il testo di una slide con le sue parole formattate. */
export function slideRich(slide: Slide): RichText {
  const spans = slideSpans(slide);
  return spans === undefined ? { text: slideText(slide) } : { text: slideText(slide), spans };
}

/**
 * Come `splitSlides`, ma ogni slide porta le sue parole formattate (ritagliate e spostate).
 * Le slide che escono sono esattamente le stesse di `splitSlides`.
 */
export function splitSlidesRich(text: string, spans: readonly Span[] | undefined): RichText[] {
  const parts: RichText[] = [];
  const push = (from: number, to: number): void => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(text.charAt(start))) start += 1;
    while (end > start && /\s/.test(text.charAt(end - 1))) end -= 1;
    if (end > start) parts.push(sliceRich(text, spans, start, end));
  };
  let from = 0;
  for (const match of text.matchAll(/\n[ \t]*\n/g)) {
    push(from, match.index);
    from = match.index + match[0].length;
  }
  push(from, text.length);
  return parts;
}

/** Le slide di un elemento come un solo testo (una riga vuota tra l'una e l'altra), con le parole formattate. */
export const joinSlidesRich = (slides: readonly Slide[]): RichText =>
  joinRich(slides.map(slideRich), "\n\n");
