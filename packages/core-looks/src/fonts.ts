import type { TextFont, TextWeight } from "@cuelith/protocol";

// I caratteri del testo proiettato (decisione 0020). Sono tutti inclusi nel programma
// (pacchetto show-fonts, tranne i primi tre che arrivano da @cuelith/ui): funzionano senza internet.
// Questo elenco serve a tre cose: scegliere (nome e gruppo), disegnare (nome CSS, spessore e
// corsivo che esistono davvero) e misurare (le stesse cose, cosi' uscite e anteprima concordano).

export type FontGroup = "serif" | "sans" | "display" | "script" | "mono";

export interface FontInfo {
  readonly id: TextFont;
  /** Nome mostrato (nome proprio del carattere: non si traduce). */
  readonly name: string;
  readonly group: FontGroup;
  /** Nome della famiglia in CSS e sul canvas. */
  readonly family: string;
  /** Pesi disponibili: [minimo, massimo] se il carattere e' variabile, altrimenti l'elenco. */
  readonly weights: readonly number[];
  readonly variable: boolean;
  /** Esiste un corsivo vero (altrimenti il browser inclinerebbe le lettere, e non lo si offre). */
  readonly italic: boolean;
  /** Pacchetto da cui arriva, per la costruzione (`ui` = gia' in @cuelith/ui). */
  readonly source: "ui" | "variable" | "static";
}

const v = (
  id: TextFont,
  name: string,
  group: FontGroup,
  min: number,
  max: number,
  italic: boolean,
  family = `${name} Variable`,
): FontInfo => ({
  id,
  name,
  group,
  family,
  weights: [min, max],
  variable: true,
  italic,
  source: id === "display" || id === "body" || id === "mono" ? "ui" : "variable",
});

const s = (
  id: TextFont,
  name: string,
  group: FontGroup,
  weights: readonly number[],
  italic: boolean,
): FontInfo => ({
  id,
  name,
  group,
  family: name,
  weights,
  variable: false,
  italic,
  source: "static",
});

export const FONTS: readonly FontInfo[] = [
  // Con grazie
  v("display", "Fraunces", "serif", 100, 900, true),
  v("lora", "Lora", "serif", 400, 700, true),
  v("merriweather", "Merriweather", "serif", 300, 900, true),
  v("playfair-display", "Playfair Display", "serif", 400, 900, true),
  v("eb-garamond", "EB Garamond", "serif", 400, 800, true),
  v("crimson-pro", "Crimson Pro", "serif", 200, 900, true),
  v("bitter", "Bitter", "serif", 100, 900, true),
  // Senza grazie
  v("body", "Schibsted Grotesk", "sans", 400, 900, false),
  v("inter", "Inter", "sans", 100, 900, true),
  v("montserrat", "Montserrat", "sans", 100, 900, true),
  v("open-sans", "Open Sans", "sans", 300, 800, true),
  v("nunito", "Nunito", "sans", 200, 900, true),
  v("raleway", "Raleway", "sans", 100, 900, true),
  v("work-sans", "Work Sans", "sans", 100, 900, true),
  v("source-sans-3", "Source Sans 3", "sans", 200, 900, true),
  v("dm-sans", "DM Sans", "sans", 100, 900, true),
  v("libre-franklin", "Libre Franklin", "sans", 100, 900, true),
  // Titoli
  v("oswald", "Oswald", "display", 200, 700, false),
  v("cinzel", "Cinzel", "display", 400, 900, false),
  s("bebas-neue", "Bebas Neue", "display", [400], false),
  s("anton", "Anton", "display", [400], false),
  s("abril-fatface", "Abril Fatface", "display", [400], false),
  // A mano
  v("caveat", "Caveat", "script", 400, 700, false),
  v("dancing-script", "Dancing Script", "script", 400, 700, false),
  s("pacifico", "Pacifico", "script", [400], false),
  // Spaziatura fissa
  v("mono", "JetBrains Mono", "mono", 100, 800, false),
  s("ibm-plex-mono", "IBM Plex Mono", "mono", [400, 700], true),
];

export const FONT_GROUPS: readonly FontGroup[] = ["serif", "sans", "display", "script", "mono"];

const BY_ID = new Map<string, FontInfo>(FONTS.map((font) => [font.id, font]));

/** Il carattere con questo id; uno sconosciuto (show di una versione piu' nuova) ricade sul primo. */
export function fontInfo(id: string): FontInfo {
  return BY_ID.get(id) ?? (FONTS[0] as FontInfo);
}

/** Valore numerico degli spessori dello stile. */
export const WEIGHT_VALUES: Readonly<Record<TextWeight, number>> = {
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  black: 900,
};

/**
 * Spessore da usare davvero con questo carattere: quello chiesto, portato dentro l'intervallo
 * (carattere variabile) o al piu' vicino che esiste (carattere con pochi spessori).
 */
export function weightFor(font: FontInfo, weight: TextWeight | undefined): number {
  const wanted = WEIGHT_VALUES[weight ?? "normal"];
  if (font.variable) {
    const [min, max] = [font.weights[0] ?? 400, font.weights[1] ?? 400];
    return Math.min(max, Math.max(min, wanted));
  }
  return font.weights.reduce(
    (best, candidate) =>
      Math.abs(candidate - wanted) < Math.abs(best - wanted) ? candidate : best,
    font.weights[0] ?? 400,
  );
}

/** Gli spessori dello stile che questo carattere ha davvero (quelli finti, che il browser inventerebbe, non si offrono). */
export function weightsOffered(font: FontInfo): TextWeight[] {
  const has = (value: number): boolean =>
    font.variable
      ? value >= (font.weights[0] ?? 400) && value <= (font.weights[1] ?? 400)
      : font.weights.includes(value);
  return (Object.entries(WEIGHT_VALUES) as [TextWeight, number][])
    .filter(([, value]) => has(value))
    .map(([name]) => name);
}
