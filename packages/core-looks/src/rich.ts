import { cleanSpans, segmentsOf, type RichText, type Segment } from "@cuelith/protocol";
import type { TextStyle } from "./styles.js";
import type { MeasureText, TextFace } from "./text.js";

// Disposizione del testo con parole formattate (decisione 0021): codice puro, senza DOM, usato
// dal controllo dello spazio e dal disegno delle uscite, cosi' calcolano esattamente le stesse righe.
// L'anteprima in CSS ottiene lo stesso risultato lasciando fare al browser, con le stesse regole:
// a capo agli spazi, altezza di riga data dal pezzo piu' grande, parola troppo lunga spezzata.

/** Un testo da disporre: semplice, o con le sue parole formattate. */
export type TextInput = string | RichText;

export const richOf = (input: TextInput): RichText =>
  typeof input === "string" ? { text: input } : input;

/** Il testo ha parole formattate davvero? Se no, si usa la strada di sempre. */
export const isRich = (input: TextInput): boolean =>
  typeof input !== "string" && cleanSpans(input.text, input.spans).length > 0;

/** Un pezzo di riga con un solo stile. */
export interface Run {
  readonly text: string;
  /** Dimensione in pixel. */
  readonly px: number;
  readonly face: TextFace;
  /** Colore del pezzo; `undefined` = quello dello stile. */
  readonly color: string | undefined;
  readonly width: number;
}

export interface RichLine {
  readonly runs: readonly Run[];
  /** Larghezza della riga, senza gli spazi finali. */
  readonly width: number;
  /** Altezza della riga: interlinea per il pezzo piu' grande (e mai meno della dimensione base). */
  readonly height: number;
  /** Dimensione del pezzo piu' grande, in pixel. */
  readonly px: number;
}

/** Margine di sicurezza sulla larghezza, lo stesso del testo senza formattazione. */
const WIDTH_SAFETY = 0.97;

interface Piece {
  readonly text: string;
  readonly px: number;
  readonly face: TextFace;
  readonly color: string | undefined;
}

const upper = (text: string, style: TextStyle): string =>
  style.uppercase === true ? text.toUpperCase() : text;

function pieceOf(segment: Segment, text: string, style: TextStyle, basePx: number): Piece {
  const face: TextFace = {
    font: style.font,
    weight: segment.bold === true ? "bold" : style.weight,
    italic: segment.italic ?? style.italic,
    letterSpacing: style.letterSpacing,
  };
  return { text, px: basePx * (segment.size ?? 1), face, color: segment.color };
}

const sameLook = (a: Piece, b: Piece): boolean =>
  a.px === b.px &&
  a.color === b.color &&
  a.face.weight === b.face.weight &&
  a.face.italic === b.face.italic;

/**
 * Le righe del testo, una per una, con i pezzi e le misure. `maxWidth` e' la larghezza utile; senza,
 * le righe sono solo quelle scritte (adattamento: le righe non si spezzano mai).
 */
export function layoutRich(
  input: TextInput,
  style: TextStyle,
  basePx: number,
  maxWidth: number | undefined,
  measure: MeasureText,
): RichLine[] {
  const rich = richOf(input);
  const limit = maxWidth === undefined ? Infinity : maxWidth * WIDTH_SAFETY;
  const lineHeight = style.lineHeight ?? 1.25;
  const widthOf = (piece: Piece): number => measure(piece.text, piece.px, piece.face);

  // Parole: pezzi di segmenti diversi senza spazio in mezzo restano una parola sola.
  type Unit =
    | { readonly kind: "word"; readonly pieces: readonly Piece[] }
    | { readonly kind: "space"; readonly piece: Piece }
    | { readonly kind: "newline" };
  const units: Unit[] = [];
  let word: Piece[] = [];
  const flush = (): void => {
    if (word.length > 0) units.push({ kind: "word", pieces: word });
    word = [];
  };
  for (const segment of segmentsOf(rich.text, rich.spans)) {
    for (const part of upper(segment.text, style).split(/(\n| +)/)) {
      if (part === "") continue;
      if (part === "\n") {
        flush();
        units.push({ kind: "newline" });
      } else if (part.startsWith(" ")) {
        flush();
        units.push({ kind: "space", piece: pieceOf(segment, part, style, basePx) });
      } else {
        word.push(pieceOf(segment, part, style, basePx));
      }
    }
  }
  flush();

  const lines: RichLine[] = [];
  let runs: Piece[] = [];
  let width = 0;
  const push = (piece: Piece, pieceWidth: number): void => {
    const last = runs[runs.length - 1];
    if (last !== undefined && sameLook(last, piece)) {
      runs[runs.length - 1] = { ...last, text: last.text + piece.text };
    } else {
      runs.push(piece);
    }
    width += pieceWidth;
  };
  const endLine = (): void => {
    // Gli spazi alla fine della riga non si disegnano ne' contano.
    while (runs.length > 0) {
      const last = runs[runs.length - 1];
      if (last === undefined || last.text.trim() !== "") break;
      runs.pop();
    }
    const tail = runs[runs.length - 1];
    if (tail !== undefined && tail.text.endsWith(" ")) {
      runs[runs.length - 1] = { ...tail, text: tail.text.replace(/ +$/, "") };
    }
    const measured: Run[] = runs.map((piece) => ({ ...piece, width: widthOf(piece) }));
    const lineWidth = measured.reduce((sum, run) => sum + run.width, 0);
    const biggest = Math.max(basePx, ...measured.map((run) => run.px));
    lines.push({ runs: measured, width: lineWidth, height: biggest * lineHeight, px: biggest });
    runs = [];
    width = 0;
  };

  let pendingSpace: Piece | undefined;
  for (const unit of units) {
    if (unit.kind === "newline") {
      endLine();
      pendingSpace = undefined;
      continue;
    }
    if (unit.kind === "space") {
      pendingSpace = runs.length === 0 ? undefined : unit.piece;
      continue;
    }
    const wordWidth = unit.pieces.reduce((sum, piece) => sum + widthOf(piece), 0);
    const spaceWidth = pendingSpace === undefined ? 0 : widthOf(pendingSpace);
    if (width + spaceWidth + wordWidth <= limit || runs.length === 0) {
      if (runs.length > 0 && pendingSpace !== undefined) push(pendingSpace, spaceWidth);
      if (wordWidth <= limit || runs.length > 0) {
        for (const piece of unit.pieces) push(piece, widthOf(piece));
        pendingSpace = undefined;
        continue;
      }
    } else {
      endLine();
    }
    pendingSpace = undefined;
    if (wordWidth <= limit) {
      for (const piece of unit.pieces) push(piece, widthOf(piece));
      continue;
    }
    // Parola da sola piu' larga della riga: si spezza a caratteri.
    for (const piece of unit.pieces) {
      for (const char of piece.text) {
        const single = { ...piece, text: char };
        const charWidth = widthOf(single);
        if (width + charWidth > limit && runs.length > 0) endLine();
        push(single, charWidth);
      }
    }
  }
  // Ultima riga (anche vuota: un testo che finisce con "a capo" lascia una riga).
  endLine();
  return lines;
}

/** Altezza totale delle righe. */
export const linesHeight = (lines: readonly RichLine[]): number =>
  lines.reduce((sum, line) => sum + line.height, 0);
