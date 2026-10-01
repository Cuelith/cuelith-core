import {
  creditsFor,
  FullscreenStyleSchema,
  PRESENTATION_SOURCE_TYPE,
  StageStyleSchema,
  type FullscreenStyle,
} from "@cuelith-core/core-looks";
import {
  cursorItem,
  itemById,
  mediaUrl,
  slideBackground,
  slideSequence,
  type Feed,
  type Look,
  type OutputConfig,
  type Slide,
  type StateDocument,
  type Timer,
} from "@cuelith/protocol";

export type TextStyle = FullscreenStyle["text"];
export type Transition = FullscreenStyle["transition"];

/** Cosa deve mostrare un'uscita in questo momento, indipendente da come si disegna. */
export type Frame =
  | { readonly kind: "black" }
  | {
      readonly kind: "fullscreen";
      readonly background: string;
      /** Immagine di sfondo (indirizzo sul motore): della slide, dell'elemento o del look. */
      readonly image: string | undefined;
      /** Velo scuro sopra l'immagine, 0..0.9, perche' il testo resti leggibile. */
      readonly dim: number;
      readonly text: string | undefined;
      readonly style: TextStyle;
      readonly message: string | undefined;
      /** Riga dei crediti (prima o ultima slide, se l'elemento li prevede). */
      readonly credits: string | undefined;
    }
  | {
      readonly kind: "stage";
      readonly background: string;
      readonly text: string | undefined;
      readonly style: TextStyle;
      readonly next: string | undefined;
      readonly clock: boolean;
      readonly message: string | undefined;
      /** Timer della regia (protocollo 1.7), per il relatore. */
      readonly timer: Timer | undefined;
    };

export interface OutputView {
  readonly name: string;
  readonly blackout: boolean;
  readonly freeze: boolean;
  readonly frame: Frame;
  /** Cambia quando cambia il contenuto: e' il momento di una transizione. */
  readonly key: string;
  readonly transition: Transition;
  /** Immagini che serviranno subito dopo (la prossima slide): da caricare in anticipo. */
  readonly preload: readonly string[];
}

const CUT: Transition = { type: "cut", durationMs: 0 };
const BLACK: Frame = { kind: "black" };

/** Segue le uscite "specchio" fino a quella che ha un feed proprio. */
function resolve(doc: StateDocument, output: OutputConfig): { feed: Feed; blackout: boolean } {
  let current = output;
  let blackout = doc.live.outputs[output.id]?.blackout ?? false;
  const seen = new Set([output.id]);
  while (current.feed.type === "mirror") {
    const next = doc.show.outputs[current.feed.outputId];
    if (next === undefined || seen.has(next.id)) break;
    seen.add(next.id);
    blackout ||= doc.live.outputs[next.id]?.blackout ?? false;
    current = next;
  }
  return { feed: current.feed, blackout };
}

const textOf = (slide: Slide | undefined): string | undefined => {
  const value = slide?.fields["text"]?.value;
  return value === undefined || value === "" ? undefined : value;
};

/** Slide in onda e prossima, dal layer del contenuto e dall'anteprima. */
function presentation(doc: StateDocument) {
  const content = doc.live.layers.content;
  // Anche un elemento fuori scaletta (mandato direttamente in onda).
  const item = itemById(doc, content.itemId);
  const sequence = item === undefined ? [] : slideSequence(item);
  const onAir =
    content.visible && item !== undefined && content.slideIndex !== undefined
      ? sequence[content.slideIndex]
      : undefined;
  const credits =
    onAir === undefined || item === undefined || content.slideIndex === undefined
      ? undefined
      : creditsFor(item, content.slideIndex, sequence.length);
  const { preview } = doc.live;
  const previewItem = cursorItem(doc, preview);
  const next =
    previewItem === undefined ? undefined : slideSequence(previewItem)[preview.slideIndex];
  const key =
    onAir === undefined ? "none" : `${item?.id ?? ""}/${String(content.slideIndex)}/${onAir.id}`;
  return {
    onAir,
    next,
    key,
    credits,
    // Sfondo della slide, altrimenti dell'elemento (decisione 0003).
    background: onAir === undefined ? undefined : slideBackground(item, onAir),
    nextBackground: next === undefined ? undefined : slideBackground(previewItem, next),
  };
}

/** Messaggio dell'uscita (protocollo 1.7), altrimenti quello generale, se il look lo mostra. */
function messageOf(doc: StateDocument, look: Look, outputId: string): string | undefined {
  if (!look.layers.includes("message")) return undefined;
  const own = doc.live.outputs[outputId]?.message;
  if (own !== undefined && own !== "") return own;
  const layer = doc.live.layers.message;
  return layer.visible && layer.text !== undefined && layer.text !== "" ? layer.text : undefined;
}

/**
 * Descrive l'uscita: feed risolto, look applicato, blackout e freeze. Le
 * uscite eseguono solo lo stato ricevuto (cap. 21): questa funzione e' tutta
 * la loro "logica", pura e provata a parte.
 */
export function describeOutput(doc: StateDocument, outputId: string): OutputView | undefined {
  const output = doc.show.outputs[outputId];
  const live = doc.live.outputs[outputId];
  if (output === undefined || live === undefined) return undefined;
  const base = { name: output.name, freeze: live.freeze };
  const { feed, blackout } = resolve(doc, output);
  const black = { ...base, blackout, frame: BLACK, key: "black", transition: CUT, preload: [] };

  // Scene (camere, composizioni) arrivano con i moduli: finche' non ci sono, nero.
  if (feed.type !== "source") return black;
  const source = doc.show.sources[feed.sourceId];
  const look = feed.lookId === undefined ? undefined : doc.show.looks[feed.lookId];
  if (source?.type !== PRESENTATION_SOURCE_TYPE || look === undefined) return black;

  const { onAir, next, key, credits, background, nextBackground } = presentation(doc);
  const showContent = look.layers.includes("content");
  const text = showContent && look.fields.includes("text") ? textOf(onAir) : undefined;
  const message = messageOf(doc, look, outputId);

  if (look.template === "core.fullscreen") {
    const style = FullscreenStyleSchema.safeParse(look.style);
    if (!style.success) return black;
    // Ordine: slide, elemento, look. Un look senza il layer "background" non ne mostra.
    const withBackground = look.layers.includes("background");
    const fallback = style.data.background.image;
    const urlOf = (uri: string | undefined) =>
      !withBackground || uri === undefined ? undefined : mediaUrl(uri);
    const image = urlOf(background?.uri ?? fallback);
    const upcoming = urlOf(nextBackground?.uri ?? fallback);
    return {
      ...base,
      blackout,
      // Cambiare sfondo e' un cambio di contenuto: vale la dissolvenza.
      key: image === undefined ? key : `${key}|${image}`,
      transition: style.data.transition,
      preload: upcoming === undefined || upcoming === image ? [] : [upcoming],
      frame: {
        kind: "fullscreen",
        background: style.data.background.color,
        image,
        dim: style.data.background.dim ?? 0,
        text,
        style: style.data.text,
        message,
        credits: showContent ? credits : undefined,
      },
    };
  }
  if (look.template === "core.stage") {
    const style = StageStyleSchema.safeParse(look.style);
    if (!style.success) return black;
    return {
      ...base,
      blackout,
      key,
      transition: style.data.transition,
      // Il look Palco per definizione non mostra sfondi.
      preload: [],
      frame: {
        kind: "stage",
        background: style.data.background.color,
        text,
        style: style.data.text,
        next: style.data.showNext ? textOf(next) : undefined,
        clock: style.data.showClock,
        message,
        timer: doc.live.timer,
      },
    };
  }
  // Template di un modulo: lo disegnera' il modulo stesso.
  return black;
}
