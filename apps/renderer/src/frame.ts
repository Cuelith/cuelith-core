import {
  FullscreenStyleSchema,
  PRESENTATION_SOURCE_TYPE,
  StageStyleSchema,
  type FullscreenStyle,
} from "@cuelith-core/core-looks";
import {
  slideSequence,
  type Feed,
  type Look,
  type OutputConfig,
  type Slide,
  type StateDocument,
} from "@cuelith/protocol";

export type TextStyle = FullscreenStyle["text"];
export type Transition = FullscreenStyle["transition"];

/** Cosa deve mostrare un'uscita in questo momento, indipendente da come si disegna. */
export type Frame =
  | { readonly kind: "black" }
  | {
      readonly kind: "fullscreen";
      readonly background: string;
      readonly text: string | undefined;
      readonly style: TextStyle;
      readonly message: string | undefined;
    }
  | {
      readonly kind: "stage";
      readonly background: string;
      readonly text: string | undefined;
      readonly style: TextStyle;
      readonly next: string | undefined;
      readonly clock: boolean;
      readonly message: string | undefined;
    };

export interface OutputView {
  readonly name: string;
  readonly blackout: boolean;
  readonly freeze: boolean;
  readonly frame: Frame;
  /** Cambia quando cambia il contenuto: e' il momento di una transizione. */
  readonly key: string;
  readonly transition: Transition;
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
  const item = content.itemId === undefined ? undefined : doc.show.items[content.itemId];
  const onAir =
    content.visible && item !== undefined && content.slideIndex !== undefined
      ? slideSequence(item)[content.slideIndex]
      : undefined;
  const { preview } = doc.live;
  const previewEntry = doc.show.playlist.find((e) => e.id === preview.entryId);
  const previewItem = previewEntry === undefined ? undefined : doc.show.items[previewEntry.itemId];
  const next =
    previewItem === undefined ? undefined : slideSequence(previewItem)[preview.slideIndex];
  const key =
    onAir === undefined ? "none" : `${item?.id ?? ""}/${String(content.slideIndex)}/${onAir.id}`;
  return { onAir, next, key };
}

function messageOf(doc: StateDocument, look: Look): string | undefined {
  const layer = doc.live.layers.message;
  return look.layers.includes("message") &&
    layer.visible &&
    layer.text !== undefined &&
    layer.text !== ""
    ? layer.text
    : undefined;
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
  const black = { ...base, blackout, frame: BLACK, key: "black", transition: CUT };

  // Scene (camere, composizioni) arrivano con i moduli: finche' non ci sono, nero.
  if (feed.type !== "source") return black;
  const source = doc.show.sources[feed.sourceId];
  const look = feed.lookId === undefined ? undefined : doc.show.looks[feed.lookId];
  if (source?.type !== PRESENTATION_SOURCE_TYPE || look === undefined) return black;

  const { onAir, next, key } = presentation(doc);
  const showContent = look.layers.includes("content");
  const text = showContent && look.fields.includes("text") ? textOf(onAir) : undefined;
  const message = messageOf(doc, look);

  if (look.template === "core.fullscreen") {
    const style = FullscreenStyleSchema.safeParse(look.style);
    if (!style.success) return black;
    return {
      ...base,
      blackout,
      key,
      transition: style.data.transition,
      frame: {
        kind: "fullscreen",
        background: style.data.background.color,
        text,
        style: style.data.text,
        message,
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
      frame: {
        kind: "stage",
        background: style.data.background.color,
        text,
        style: style.data.text,
        next: style.data.showNext ? textOf(next) : undefined,
        clock: style.data.showClock,
        message,
      },
    };
  }
  // Template di un modulo: lo disegnera' il modulo stesso.
  return black;
}
