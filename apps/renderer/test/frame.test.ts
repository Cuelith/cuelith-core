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

  it("il messaggio compare solo sui look che hanno il layer dei messaggi", () => {
    const { doc, room, stage } = makeDoc();
    doc.live.layers.message = { visible: true, text: "Cinque minuti" };
    expect(describeOutput(doc, room)?.frame).toMatchObject({ message: "Cinque minuti" });
    expect(describeOutput(doc, stage)?.frame).toMatchObject({ message: "Cinque minuti" });
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
});
