import { fontInfo, weightFor } from "./fonts.js";
import type { TextOverride, TextStyle } from "./styles.js";

// Stile effettivo del testo e controllo dello spazio (decisione 0015). Codice puro,
// senza DOM: la misura di una riga di testo la fornisce chi lo usa (il disegno delle uscite,
// l'anteprima, le prove), cosi' ogni parte del programma calcola esattamente la stessa cosa.

export const DEFAULT_LINE_HEIGHT = 1.25;
/** L'uscita di riferimento per le dimensioni di stile: altezza 1080 pixel. */
export const REFERENCE_HEIGHT = 1080;
/** Margine di sicurezza sulla larghezza: tra due motori di disegno la misura differisce di poco. */
const WIDTH_SAFETY = 0.97;

/**
 * Stile con cui si disegna un testo.
 * - Con uno stile globale selezionato vale solo quello (sostituisce l'editor).
 * - Senza, valgono lo stile dell'aspetto e le modifiche dell'editor sopra, se ci sono.
 * Le modifiche dell'editor restano salvate: tolto lo stile globale, tornano.
 */
export function effectiveTextStyle(
  base: TextStyle,
  global?: TextStyle,
  editor?: TextOverride,
): TextStyle {
  if (global !== undefined) return { ...global };
  if (editor === undefined) return { ...base };
  const { scale, ...rest } = editor;
  const changed = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  );
  return {
    ...base,
    ...changed,
    size: scale === undefined ? base.size : base.size * scale,
  };
}

/** Quanto e' larga una riga: la fornisce chi disegna (canvas, DOM...). */
export type TextFace = Pick<TextStyle, "font" | "weight" | "italic" | "letterSpacing">;
export type MeasureText = (text: string, fontSizePx: number, face: TextFace) => number;

export interface OutputBox {
  readonly width: number;
  readonly height: number;
  /** Nome dell'uscita, per dire quale non va. */
  readonly name?: string;
}

/** Spazio utile per il testo: l'uscita meno i margini, e meno quanto riservato in basso (crediti, ecc.). */
function usableArea(
  style: TextStyle,
  box: OutputBox,
  reserveBottomPx: number,
): { width: number; height: number } {
  const margin = style.margin * Math.min(box.width, box.height);
  return {
    width: Math.max(1, box.width - 2 * margin),
    height: Math.max(1, box.height - 2 * margin - reserveBottomPx),
  };
}

/** Il testo come lo vede l'uscita (maiuscolo compreso). */
const shown = (text: string, style: TextStyle): string =>
  style.uppercase === true ? text.toUpperCase() : text;

/** Righe dopo l'a capo automatico: si va a capo agli spazi, e una parola piu' lunga della riga si spezza. */
export function wrapLines(
  text: string,
  maxWidth: number,
  fontSizePx: number,
  style: TextStyle,
  measure: MeasureText,
): string[] {
  const width = (value: string): number => measure(value, fontSizePx, style);
  const limit = maxWidth * WIDTH_SAFETY;
  const lines: string[] = [];
  for (const paragraph of shown(text, style).split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (width(candidate) <= limit) {
        line = candidate;
        continue;
      }
      if (line !== "") lines.push(line);
      // Parola da sola piu' larga della riga: si spezza a caratteri.
      let rest = word;
      while (rest !== "" && width(rest) > limit) {
        let cut = rest.length - 1;
        while (cut > 1 && width(rest.slice(0, cut)) > limit) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export interface FitResult {
  readonly fits: boolean;
  readonly lines: number;
  readonly height: number;
}

/** Il testo entra nello spazio dell'uscita, con la dimensione dello stile moltiplicata per `scale`? */
export function textFits(
  text: string,
  style: TextStyle,
  box: OutputBox,
  measure: MeasureText,
  options: { scale?: number; reserveBottomPx?: number } = {},
): FitResult {
  const scale = options.scale ?? 1;
  const reserve = options.reserveBottomPx ?? 0;
  const px = style.size * scale * (box.height / REFERENCE_HEIGHT);
  const area = usableArea(style, box, reserve);
  const lines =
    style.fit === undefined
      ? wrapLines(text, area.width, px, style, measure)
      : shown(text, style).split("\n");
  const height = lines.length * px * (style.lineHeight ?? DEFAULT_LINE_HEIGHT);
  // Con l'adattamento le righe del testo restano intere: se una non entra in larghezza, non entra.
  const wide =
    style.fit !== undefined &&
    lines.some((line) => measure(line, px, style) > area.width * WIDTH_SAFETY);
  return { fits: !wide && height <= area.height, lines: lines.length, height };
}

/**
 * Scala uniforme per tutte le slide di un elemento su una uscita: 1 se entrano tutte
 * alla dimensione dello stile; altrimenti, se lo stile ha l'adattamento, la piu' grande
 * (non sotto il minimo) con cui entrano tutte; altrimenti nessuna (undefined).
 */
export function fitScale(
  texts: readonly string[],
  style: TextStyle,
  box: OutputBox,
  measure: MeasureText,
  reserveBottomPx = 0,
): number | undefined {
  const allFit = (scale: number): boolean =>
    texts.every((text) => textFits(text, style, box, measure, { scale, reserveBottomPx }).fits);
  if (allFit(1)) return 1;
  const min = style.fit?.min;
  if (min === undefined || !allFit(min)) return undefined;
  // Ricerca della scala piu' grande che entra (la funzione e' monotona: piu' piccolo, piu' entra).
  let low = min;
  let high = 1;
  for (let step = 0; step < 14; step += 1) {
    const middle = (low + high) / 2;
    if (allFit(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/** Sotto questa scala non si scende mai, nemmeno per non spezzare una riga. */
const HARD_FLOOR = 0.1;

/**
 * Scala con cui disegnare davvero. Come `fitScale`, ma se neppure al minimo dello stile entra
 * tutto si scende ancora: in diretta e' meglio un testo piccolo che una riga spezzata.
 * Senza adattamento vale sempre 1.
 */
export function renderScale(
  texts: readonly string[],
  style: TextStyle,
  box: OutputBox,
  measure: MeasureText,
  reserveBottomPx = 0,
): number {
  if (style.fit === undefined) return 1;
  const found = fitScale(texts, style, box, measure, reserveBottomPx);
  if (found !== undefined) return found;
  const allFit = (scale: number): boolean =>
    texts.every((text) => textFits(text, style, box, measure, { scale, reserveBottomPx }).fits);
  if (!allFit(HARD_FLOOR)) return HARD_FLOOR;
  let low = HARD_FLOOR;
  let high = style.fit.min;
  for (let step = 0; step < 14; step += 1) {
    const middle = (low + high) / 2;
    if (allFit(middle)) low = middle;
    else high = middle;
  }
  return low;
}

export interface StyleCheck {
  readonly ok: boolean;
  /** Scala da applicare (la piu' piccola tra le uscite); 1 se non serve adattare. */
  readonly scale: number;
  /** Chi non entra, per dire il motivo: uscita e numero della slide (da 0). */
  readonly failures: readonly { output: string; slide: number }[];
}

/**
 * Lo stile va bene per questo elemento su tutte le uscite attive? Vale il caso peggiore:
 * basta una uscita su cui una slide non entra (neppure al minimo) perche' non vada bene.
 */
export function checkStyle(
  texts: readonly string[],
  style: TextStyle,
  boxes: readonly OutputBox[],
  measure: MeasureText,
  reserveBottomPx = 0,
): StyleCheck {
  let scale = 1;
  const failures: { output: string; slide: number }[] = [];
  boxes.forEach((box, index) => {
    const found = fitScale(texts, style, box, measure, reserveBottomPx);
    if (found !== undefined) {
      scale = Math.min(scale, found);
      return;
    }
    const min = style.fit?.min ?? 1;
    texts.forEach((text, slide) => {
      if (!textFits(text, style, box, measure, { scale: min, reserveBottomPx }).fits) {
        failures.push({ output: box.name ?? String(index + 1), slide });
      }
    });
  });
  return { ok: failures.length === 0, scale, failures };
}

/** Il carattere come lo scrive CSS e il canvas: corsivo, spessore vero, dimensione, famiglia. */
export function cssFont(face: TextFace, fontSizePx: number): string {
  const info = fontInfo(face.font);
  const italic = face.italic === true && info.italic ? "italic " : "";
  return `${italic}${String(weightFor(info, face.weight))} ${String(fontSizePx)}px "${info.family}"`;
}

/** Quel che serve a misurare del contesto 2D di un canvas (cosi' il pacchetto non dipende dal DOM). */
export interface MeasuringContext {
  font: string;
  /** Spaziatura tra le lettere come testo CSS (es. "2px"), se il contesto la conosce. */
  letterSpacing?: string;
  measureText(text: string): { width: number };
}

/** Misura reale delle righe con i caratteri veri, su un canvas fornito da chi disegna. */
export function canvasMeasure(context: MeasuringContext): MeasureText {
  return (text, fontSizePx, face) => {
    context.font = cssFont(face, fontSizePx);
    // Senza il supporto del contesto, si aggiunge a mano la spaziatura (una per lettera).
    const spacing = (face.letterSpacing ?? 0) * fontSizePx;
    if ("letterSpacing" in context) {
      context.letterSpacing = `${String(spacing)}px`;
      return context.measureText(text).width;
    }
    return context.measureText(text).width + spacing * text.length;
  };
}

/**
 * Spazio da lasciare libero in basso quando la slide ha i crediti: il testo e' centrato, quindi
 * la fascia dei crediti va tolta da entrambi i lati.
 */
export function creditsReserve(boxHeight: number, hasCredits: boolean): number {
  return hasCredits ? 2 * (0.03 * boxHeight + 30 * (boxHeight / REFERENCE_HEIGHT)) : 0;
}
