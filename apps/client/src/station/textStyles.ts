import {
  canvasMeasure,
  checkStyle,
  creditsReserve,
  cssFont,
  renderScale,
  FullscreenStyleSchema,
  type FullscreenStyle,
  TextStyleSchema,
  type MeasureText,
  type OutputBox,
  type StyleCheck,
  type TextFace,
  type TextStyle,
} from "@cuelith-core/core-looks";
import {
  cursorItem,
  itemById,
  slideSequence,
  type RichText,
  type Item,
  type StateDocument,
  type TextStyleRecord,
} from "@cuelith/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useConnection, useEngine } from "../engine/react.js";
import { slideRich } from "./show.js";

// Stili globali del testo (decisione 0015): l'elenco salvato nel computer, le uscite su cui
// devono entrare e il controllo dello spazio che decide se uno stile si puo' scegliere.

/** Uno stile salvato con la forma gia' controllata. */
export interface SavedStyle {
  readonly id: string;
  readonly name: string;
  readonly style: TextStyle;
}

/** Gli stili salvati, riletti a ogni cambio delle librerie (live.libraryRev). */
export function useTextStyles(): readonly SavedStyle[] {
  const connection = useConnection();
  const rev = useEngine().state?.live.libraryRev;
  const [styles, setStyles] = useState<readonly SavedStyle[]>([]);
  useEffect(() => {
    let alive = true;
    connection.call("textstyle.list", {}).then(
      ({ styles: records }) => {
        if (alive) setStyles(checked(records));
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [connection, rev]);
  return styles;
}

/** Tiene solo gli stili con la forma giusta: un record rovinato non deve rompere il pannello. */
export function checked(records: readonly TextStyleRecord[]): SavedStyle[] {
  return records.flatMap((record) => {
    const parsed = TextStyleSchema.safeParse(record.style);
    return parsed.success ? [{ id: record.id, name: record.name, style: parsed.data }] : [];
  });
}

/** Misura del testo con i caratteri veri: un canvas che non si vede, creato alla prima richiesta. */
let measureCache: MeasureText | undefined;
export function measure(): MeasureText {
  if (measureCache === undefined) {
    const context = document.createElement("canvas").getContext("2d");
    const inner = canvasMeasure(
      context ?? { font: "", measureText: (text: string) => ({ width: text.length * 20 }) },
    );
    // Un carattere mai usato si carica adesso (la misura di questa volta e' di ripiego);
    // quando arriva, chi usa useFontsVersion() si ridisegna e misura giusto.
    measureCache = (text, size, face) => {
      requestFont(face);
      return inner(text, size, face);
    };
  }
  return measureCache;
}

const requested = new Set<string>();
const fontListeners = new Set<() => void>();
let fontsVersion = 0;

/** Chiede il caricamento di un carattere, una volta sola. */
export function requestFont(face: TextFace): void {
  const key = cssFont(face, 48);
  if (requested.has(key)) return;
  requested.add(key);
  if (typeof document === "undefined" || !("fonts" in document)) return;
  void document.fonts
    .load(key)
    .catch(() => [])
    .then(() => {
      fontsVersion += 1;
      for (const listener of fontListeners) listener();
    });
}

/** Cambia ogni volta che finisce di caricarsi un carattere: serve a rifare le misure. */
export function useFontsVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      fontListeners.add(listener);
      return () => fontListeners.delete(listener);
    },
    () => fontsVersion,
  );
}

/**
 * I caratteri vanno caricati prima di misurare, altrimenti la misura e' quella di un carattere di
 * ripiego. Si caricano solo quelli che servono (gli altri restano su disco finche' non si scelgono).
 */
export function loadFonts(...faces: readonly TextFace[]): Promise<unknown> {
  const wanted: readonly TextFace[] =
    faces.length > 0 ? faces : [{ font: "display" }, { font: "body" }];
  for (const face of wanted) requestFont(face);
  return Promise.all(wanted.map((face) => document.fonts.load(cssFont(face, 48)).catch(() => [])));
}

/** Testi delle slide di un elemento, nell'ordine di proiezione, senza quelle vuote. */
export function itemTexts(item: Item): RichText[] {
  return slideSequence(item)
    .map(slideRich)
    .filter((rich) => rich.text !== "");
}

/**
 * Le uscite su cui il testo deve entrare: quelle con il look Sala (a tutto schermo). Gli specchi
 * non contano (mostrano un'altra uscita). Senza uscite si prova su uno schermo 16:9.
 */
export function roomOutputs(doc: StateDocument): OutputBox[] {
  const boxes: OutputBox[] = [];
  for (const output of Object.values(doc.show.outputs)) {
    if (output.feed.type !== "source" || output.feed.lookId === undefined) continue;
    const look = doc.show.looks[output.feed.lookId];
    if (look?.template !== "core.fullscreen") continue;
    if (!FullscreenStyleSchema.safeParse(look.style).success) continue;
    boxes.push({ width: output.format.width, height: output.format.height, name: output.name });
  }
  return boxes.length > 0 ? boxes : [{ width: 1920, height: 1080, name: "16:9" }];
}

/** Gli elementi per cui un cambio di stile non puo' mai creare un problema: in onda, in anteprima, selezionato. */
export function criticalItems(doc: StateDocument, selected: Item | undefined): Item[] {
  const items = new Map<string, Item>();
  const content = doc.live.layers.content;
  const onAir = content.visible ? itemById(doc, content.itemId) : undefined;
  for (const item of [onAir, cursorItem(doc, doc.live.preview), selected]) {
    if (item !== undefined) items.set(item.id, item);
  }
  return [...items.values()];
}

/**
 * Di quanto rimpicciolire il testo di tutto l'elemento perche' entri nell'uscita principale
 * (1 = per niente). E' la stessa regola delle uscite, uguale per tutte le slide.
 */
export function itemFit(
  doc: StateDocument,
  style: FullscreenStyle | undefined,
  item: Item | undefined,
): number {
  if (style?.text.fit === undefined || item === undefined) return 1;
  const box = roomOutputs(doc)[0] ?? { width: 1920, height: 1080 };
  const credits = item.credits !== undefined && item.credits.show !== "none";
  return renderScale(
    itemTexts(item),
    style.text,
    box,
    measure(),
    creditsReserve(box.height, credits),
  );
}

export interface StyleVerdict {
  /** Si puo' scegliere: entra su tutte le uscite per gli elementi che contano ora. */
  readonly allowed: boolean;
  /** Elementi della scaletta (non critici) in cui alcune slide non entrerebbero. */
  readonly warnings: readonly string[];
  /** Perche' non si puo': l'elemento e l'uscita che non vanno. */
  readonly blocked?: { readonly item: string; readonly output: string; readonly slide: number };
  /** Scala di adattamento che servirebbe (1 = nessuna). */
  readonly scale: number;
}

function checkItem(item: Item, style: TextStyle, boxes: OutputBox[]): StyleCheck {
  // Se le slide hanno i crediti si lascia la fascia libera, come fanno le uscite.
  const credits = item.credits !== undefined && item.credits.show !== "none";
  const reserve = Math.max(...boxes.map((box) => creditsReserve(box.height, credits)));
  return checkStyle(itemTexts(item), style, boxes, measure(), reserve);
}

/**
 * Lo stile si puo' scegliere adesso? Vale il blocco per gli elementi in onda, in anteprima e
 * selezionato; per il resto della scaletta solo un avviso con i loro titoli.
 */
export function judgeStyle(
  doc: StateDocument,
  style: TextStyle,
  selected: Item | undefined,
): StyleVerdict {
  const boxes = roomOutputs(doc);
  const critical = criticalItems(doc, selected);
  let scale = 1;
  for (const item of critical) {
    const result = checkItem(item, style, boxes);
    if (!result.ok) {
      const first = result.failures[0];
      return {
        allowed: false,
        warnings: [],
        blocked: { item: item.title, output: first?.output ?? "", slide: (first?.slide ?? 0) + 1 },
        scale,
      };
    }
    scale = Math.min(scale, result.scale);
  }
  const criticalIds = new Set(critical.map((item) => item.id));
  const warnings: string[] = [];
  for (const entry of doc.show.playlist) {
    const item = doc.show.items[entry.itemId];
    if (item === undefined || criticalIds.has(item.id) || warnings.includes(item.title)) continue;
    if (!checkItem(item, style, boxes).ok) warnings.push(item.title);
  }
  return { allowed: true, warnings, scale };
}
