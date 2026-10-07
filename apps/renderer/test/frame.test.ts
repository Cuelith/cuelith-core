import { createDefaultLooks, PRESENTATION_SOURCE_TYPE } from "@cuelith-core/core-looks";
import {
  emptyLayers,
  newId,
  StateDocumentSchema,
  type OutputConfig,
  type StateDocument,
} from "@cuelith/protocol";
import { describe, expect, it } from "vitest";
import { describeOutput } from "../src/frame.js";

function makeDoc() {
  const looks = createDefaultLooks({ room: "Sala", stage: "Palco" });
  const sourceId = newId();
  const itemId = newId();
  const entryId = newId();
  const output = (name: string, lookId: string): OutputConfig => ({
    id: newId(),
    name,
    kind: "display",
    provider: "core",
    target: { displayId: "1", mode: "window" },
    format: { width: 1920, height: 1080, fps: 60 },
    feed: { type: "source", sourceId, lookId },
  });
  const room = output("Proiettore", looks.room.id);
  const stage = output("Palco", looks.stage.id);
  const mirror: OutputConfig = {
    ...output("Registrazione", looks.room.id),
    feed: { type: "mirror", outputId: room.id },
  };
  const slide = (id: string, value: string) => ({
    id,
    fields: { text: { kind: "text" as const, value } },
  });
  const doc: StateDocument = {
    show: {
      schema: 1,
      id: newId(),
      name: "Show",
      playlist: [{ id: entryId, itemId }],
      items: {
        [itemId]: {
          id: itemId,
          type: "core.text",
          title: "Canto",
          slides: [slide(newId(), "Prima"), slide(newId(), "Seconda")],
          meta: {},
        },
      },
      sources: {
        [sourceId]: { id: sourceId, type: PRESENTATION_SOURCE_TYPE, provider: "core", params: {} },
      },
      looks: { [looks.room.id]: looks.room, [looks.stage.id]: looks.stage },
      scenes: {},
      outputs: { [room.id]: room, [stage.id]: stage, [mirror.id]: mirror },
      rules: [],
      plugins: {},
    },
    live: {
      rev: 1,
      cursor: { entryId, slideIndex: 0 },
      preview: { entryId, slideIndex: 1 },
      layers: { ...emptyLayers(), content: { visible: true, itemId, slideIndex: 0 } },
      outputs: {
        [room.id]: { blackout: false, freeze: false, status: "ok" },
        [stage.id]: { blackout: false, freeze: false, status: "ok" },
        [mirror.id]: { blackout: false, freeze: false, status: "ok" },
      },
      activeScene: {},
      clients: [],
      plugins: [],
      dirty: false,
      libraryRev: 0,
    },
  };
  expect(StateDocumentSchema.safeParse(doc).success).toBe(true);
  return { doc, room: room.id, stage: stage.id, mirror: mirror.id };
}

describe("describeOutput", () => {
  it("Sala: sfondo e testo grande, con la dissolvenza del look", () => {
    const { doc, room } = makeDoc();
    const view = describeOutput(doc, room);
    expect(view?.frame).toMatchObject({ kind: "fullscreen", text: "Prima", background: "#000000" });
    expect(view?.transition).toEqual({ type: "fade", durationMs: 300 });
  });

  it("Palco: testo, prossima slide e orologio, a taglio", () => {
    const { doc, stage } = makeDoc();
    const view = describeOutput(doc, stage);
    expect(view?.frame).toMatchObject({
      kind: "stage",
      text: "Prima",
      next: "Seconda",
      clock: true,
    });
    expect(view?.transition.type).toBe("cut");
  });

  it("stesso contenuto = stessa chiave; slide diversa = chiave diversa (transizione)", () => {
    const { doc, room, stage } = makeDoc();
    expect(describeOutput(doc, room)?.key).toBe(describeOutput(doc, stage)?.key);
    const before = describeOutput(doc, room)?.key;
    doc.live.layers.content.slideIndex = 1;
    expect(describeOutput(doc, room)?.key).not.toBe(before);
    expect(describeOutput(doc, room)?.frame).toMatchObject({ text: "Seconda" });
  });

  it("pulito il programma, resta lo sfondo senza testo", () => {
    const { doc, room } = makeDoc();
    doc.live.layers.content = { visible: false };
    expect(describeOutput(doc, room)?.frame).toMatchObject({ kind: "fullscreen", text: undefined });
  });

  it("blackout e freeze sono per uscita", () => {
    const { doc, room, stage } = makeDoc();
    const roomLive = doc.live.outputs[room];
    if (roomLive === undefined) throw new Error("stato mancante");
    roomLive.blackout = true;
    roomLive.freeze = true;
    expect(describeOutput(doc, room)).toMatchObject({ blackout: true, freeze: true });
    expect(describeOutput(doc, stage)).toMatchObject({ blackout: false, freeze: false });
  });

  it("uno specchio mostra la sua uscita, blackout compreso", () => {
    const { doc, room, mirror } = makeDoc();
    expect(describeOutput(doc, mirror)?.frame).toMatchObject({ kind: "fullscreen", text: "Prima" });
    const roomLive = doc.live.outputs[room];
    if (roomLive === undefined) throw new Error("stato mancante");
    roomLive.blackout = true;
    expect(describeOutput(doc, mirror)?.blackout).toBe(true);
  });

  it("stile del testo: l'editor si somma al look, lo stile globale lo sostituisce, e tornano se lo si toglie", () => {
    const { doc, room, stage } = makeDoc();
    const itemId = Object.keys(doc.show.items)[0] ?? "";
    const item = doc.show.items[itemId];
    const look = Object.values(doc.show.looks).find((l) => l.template === "core.fullscreen");
    if (item === undefined || look === undefined) throw new Error("stato mancante");
    const textOf = (id: string) =>
      (
        describeOutput(doc, id)?.frame as {
          style: { size: number; color: string; weight?: string };
        }
      ).style;
    const baseSize = textOf(room).size;

    item.textStyle = { scale: 1.5, color: "#FFCC00", weight: "bold" };
    expect(textOf(room)).toMatchObject({ size: baseSize * 1.5, color: "#FFCC00", weight: "bold" });
    // Il look Palco ha il suo stile di base: la scala dell'editor vale anche li', in proporzione.
    expect(textOf(stage).size).toBeGreaterThan(0);

    const style = look.style as { text: Record<string, unknown> };
    look.style = {
      ...style,
      globalText: {
        id: "g1",
        name: "Grande",
        text: { ...style.text, size: 200, color: "#00FF00" },
      },
    };
    expect(textOf(room)).toMatchObject({ size: 200, color: "#00FF00" });
    expect(textOf(room).weight).toBeUndefined();

    look.style = style;
    expect(textOf(room)).toMatchObject({ size: baseSize * 1.5, color: "#FFCC00", weight: "bold" });
  });

  it("porta i testi di tutte le slide dell'elemento per l'adattamento, senza quelle vuote", () => {
    const { doc, room } = makeDoc();
    expect(describeOutput(doc, room)?.frame).toMatchObject({ fitTexts: ["Prima", "Seconda"] });
    const item = Object.values(doc.show.items)[0];
    if (item === undefined) throw new Error("stato mancante");
    item.slides.push({ id: newId(), fields: { text: { kind: "text", value: "" } } });
    expect(describeOutput(doc, room)?.frame).toMatchObject({ fitTexts: ["Prima", "Seconda"] });
  });

  it("il messaggio compare solo sui look che hanno il layer dei messaggi", () => {
    const { doc, room, stage } = makeDoc();
    doc.live.layers.message = { visible: true, text: "Cinque minuti" };
    expect(describeOutput(doc, room)?.frame).toMatchObject({ message: "Cinque minuti" });
    expect(describeOutput(doc, stage)?.frame).toMatchObject({ message: "Cinque minuti" });
  });

  it("un messaggio per un'uscita sola (es. al relatore) non compare sulle altre", () => {
    const { doc, room, stage } = makeDoc();
    const stageLive = doc.live.outputs[stage];
    if (stageLive === undefined) throw new Error("stato mancante");
    stageLive.message = "5 minuti";
    expect(describeOutput(doc, stage)?.frame).toMatchObject({ message: "5 minuti" });
    expect(describeOutput(doc, room)?.frame).toMatchObject({ message: undefined });
  });

  it("Palco: il timer della regia arriva al relatore", () => {
    const { doc, room, stage } = makeDoc();
    doc.live.timer = { durationMs: 600_000, remainingMs: 600_000 };
    expect(describeOutput(doc, stage)?.frame).toMatchObject({
      kind: "stage",
      timer: { durationMs: 600_000, remainingMs: 600_000 },
    });
    expect(describeOutput(doc, room)?.frame).not.toHaveProperty("timer");
  });

  it("Sala: i crediti compaiono sull'ultima slide se l'elemento lo prevede", () => {
    const { doc, room, stage } = makeDoc();
    const item = Object.values(doc.show.items)[0];
    if (item === undefined) throw new Error("elemento mancante");
    item.credits = { authors: [{ name: "Anna Rossi", role: "artist" }], ccli: "123", show: "last" };
    expect(describeOutput(doc, room)?.frame).toMatchObject({ credits: undefined });
    doc.live.layers.content.slideIndex = 1;
    expect(describeOutput(doc, room)?.frame).toMatchObject({
      credits: "Canto — Anna Rossi · CCLI 123",
    });
    // Il palco non mostra i crediti.
    expect(describeOutput(doc, stage)?.frame).not.toHaveProperty("credits");
  });

  it("uscita inesistente: nulla da disegnare", () => {
    const { doc } = makeDoc();
    expect(describeOutput(doc, newId())).toBeUndefined();
  });

  describe("sfondi (decisione 0003)", () => {
    const uri = (letter: string) => `media:${letter.repeat(64)}.jpg`;
    const url = (letter: string) => `/media/${letter.repeat(64)}.jpg`;
    const image = (letter: string) => ({ uri: uri(letter), kind: "image" as const });
    const fullscreen = (doc: StateDocument, output: string) => {
      const view = describeOutput(doc, output);
      if (view?.frame.kind !== "fullscreen") throw new Error("non e' il look Sala");
      return { view, frame: view.frame };
    };
    const setLook = (doc: StateDocument, output: string, background: object) => {
      const feed = doc.show.outputs[output]?.feed;
      const look = feed?.type === "source" ? doc.show.looks[feed.lookId ?? ""] : undefined;
      if (look === undefined) throw new Error("look mancante");
      look.style = { ...look.style, background };
      return look;
    };

    it("ordine: slide, poi elemento, poi look; col velo del look", () => {
      const { doc, room } = makeDoc();
      const item = Object.values(doc.show.items)[0];
      if (item === undefined) throw new Error("elemento mancante");
      expect(fullscreen(doc, room).frame).toMatchObject({ image: undefined, dim: 0 });

      setLook(doc, room, { color: "#000000", image: uri("c"), dim: 0.35 });
      expect(fullscreen(doc, room).frame).toMatchObject({ image: url("c"), dim: 0.35 });
      item.background = image("b");
      expect(fullscreen(doc, room).frame.image).toBe(url("b"));
      const first = item.slides[0];
      if (first !== undefined) first.background = image("a");
      expect(fullscreen(doc, room).frame.image).toBe(url("a"));
    });

    it("cambiare sfondo cambia la chiave (dissolvenza); la prossima immagine si carica prima", () => {
      const { doc, room } = makeDoc();
      const item = Object.values(doc.show.items)[0];
      const [first, second] = item?.slides ?? [];
      if (first === undefined || second === undefined) throw new Error("slide mancanti");
      first.background = image("a");
      second.background = image("b");
      const now = fullscreen(doc, room).view;
      // In anteprima c'e' la seconda slide: il suo sfondo e' gia' in arrivo.
      expect(now.preload).toEqual([url("b")]);
      const plain = makeDoc();
      expect(describeOutput(plain.doc, plain.room)?.preload).toEqual([]);
      expect(now.key).toContain(url("a"));
    });

    it("il Palco non mostra sfondi, e nemmeno un look senza il layer dello sfondo", () => {
      const { doc, room, stage } = makeDoc();
      const item = Object.values(doc.show.items)[0];
      if (item === undefined) throw new Error("elemento mancante");
      item.background = image("a");
      expect(describeOutput(doc, stage)?.frame).not.toHaveProperty("image");
      expect(describeOutput(doc, stage)?.preload).toEqual([]);
      const look = setLook(doc, room, { color: "#000000", image: uri("c") });
      look.layers = look.layers.filter((layer) => layer !== "background");
      expect(fullscreen(doc, room).frame.image).toBeUndefined();
    });

    it("niente in onda: resta lo sfondo predefinito del look", () => {
      const { doc, room } = makeDoc();
      setLook(doc, room, { color: "#101010", image: uri("c") });
      doc.live.layers.content = { visible: false };
      expect(fullscreen(doc, room).frame).toMatchObject({ image: url("c"), text: undefined });
    });
  });
});
