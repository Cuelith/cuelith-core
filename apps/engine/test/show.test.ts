import type { EngineMethodName, EngineMethodParams, StateDocument } from "@cuelith/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Engine } from "../src/index.js";
import { expectError, expectOk, startTestEngine, TestClient } from "./helpers.js";

let engine: Engine;
let client: TestClient;

beforeEach(async () => {
  engine = await startTestEngine();
  client = await TestClient.connect(engine);
  await client.login(engine.tokens.station);
});

afterEach(async () => {
  await client.close();
  await engine.stop();
});

const ok = <N extends EngineMethodName>(method: N, params: EngineMethodParams<N>) =>
  expectOk(client, method, params);
const fails = (method: EngineMethodName, params: unknown) => expectError(client, method, params);

const state = (): StateDocument => engine.context.store.snapshot();
const text = (value: string) => ({ fields: { text: { kind: "text" as const, value } } });

/** Crea un testo con le slide date e lo mette in scaletta. */
async function addText(
  title: string,
  slides: string[],
): Promise<{ itemId: string; entryId: string }> {
  const { id: itemId } = await ok("item.create", {
    type: "core.text",
    title,
    slides: slides.map(text),
  });
  const { id: entryId } = await ok("playlist.add", { itemId });
  return { itemId, entryId };
}

describe("modifica dello show", () => {
  it("crea un testo con piu' slide e lo mette in scaletta; lo show risulta da salvare", async () => {
    expect(state().live.dirty).toBe(false);
    const { itemId, entryId } = await addText("Luce del mattino", ["Uno", "Due", "Tre"]);
    const doc = state();
    expect(doc.show.items[itemId]?.slides.map((s) => s.fields["text"]?.value)).toEqual([
      "Uno",
      "Due",
      "Tre",
    ]);
    expect(doc.show.playlist).toEqual([{ id: entryId, itemId }]);
    expect(doc.live.dirty).toBe(true);
  });

  it("rifiuta tipi di elemento sconosciuti e riferimenti inesistenti senza toccare lo stato", async () => {
    const rev = state().live.rev;
    expect(await fails("item.create", { type: "core.nope", title: "x" })).toEqual([
      4220,
      "core.error.itemTypeUnknown",
    ]);
    expect(await fails("item.create", { type: "cuelith.bible.passage", title: "x" })).toEqual([
      4220,
      "core.error.itemTypeUnknown",
    ]);
    expect(await fails("playlist.add", { itemId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toEqual([
      4040,
      "core.error.itemNotFound",
    ]);
    expect(state().live.rev).toBe(rev);
  });

  it("aggiorna, inserisce, sposta ed elimina slide", async () => {
    const { itemId } = await addText("Canto", ["A", "B"]);
    const [a, b] = state().show.items[itemId]?.slides ?? [];
    if (a === undefined || b === undefined) throw new Error("slide mancanti");
    await ok("slide.update", { itemId, slideId: a.id, ...text("A2") });
    const { id: c } = await ok("slide.insert", { itemId, index: 0, slide: text("C") });
    await ok("slide.move", { itemId, slideId: c, toIndex: 2 });
    await ok("slide.delete", { itemId, slideId: b.id });
    expect(state().show.items[itemId]?.slides.map((s) => s.fields["text"]?.value)).toEqual([
      "A2",
      "C",
    ]);
    expect(await fails("slide.insert", { itemId, index: 9, slide: text("x") })).toEqual([
      4220,
      "core.error.indexOutOfRange",
    ]);
  });

  it("l'arrangiamento puo' usare solo gruppi esistenti", async () => {
    const { itemId } = await addText("Canto", ["A"]);
    expect(await fails("item.update", { id: itemId, arrangement: ["RIT"] })).toEqual([
      4220,
      "core.error.groupMissing",
    ]);
  });

  it("sposta le voci della scaletta e ne cambia il pubblico", async () => {
    const first = await addText("Primo", ["1"]);
    const second = await addText("Secondo", ["2"]);
    await ok("playlist.move", { entryId: second.entryId, toIndex: 0 });
    await ok("playlist.setAudience", { entryId: first.entryId, audience: "stream" });
    expect(state().show.playlist).toEqual([
      { id: second.entryId, itemId: second.itemId },
      { id: first.entryId, itemId: first.itemId, audience: "stream" },
    ]);
    await ok("playlist.setAudience", { entryId: first.entryId, audience: null });
    expect(state().show.playlist[1]).toEqual({ id: first.entryId, itemId: first.itemId });
  });
});

describe("anteprima e programma", () => {
  it("anteprima, Invio, avanti e indietro seguono la scaletta tra un elemento e l'altro", async () => {
    const song = await addText("Canto", ["S1", "S2"]);
    const reading = await addText("Lettura", ["L1"]);

    await ok("preview.set", { entryId: song.entryId, slideIndex: 0 });
    expect(state().live.preview).toEqual({ entryId: song.entryId, slideIndex: 0 });
    expect(state().live.layers.content.visible).toBe(false);

    await ok("cue.take", {});
    let live = state().live;
    expect(live.cursor).toEqual({ entryId: song.entryId, slideIndex: 0 });
    expect(live.layers.content).toEqual({ visible: true, itemId: song.itemId, slideIndex: 0 });
    expect(live.preview).toEqual({ entryId: song.entryId, slideIndex: 1 });

    await ok("cue.next", {});
    await ok("cue.next", {});
    live = state().live;
    expect(live.cursor).toEqual({ entryId: reading.entryId, slideIndex: 0 });
    expect(live.layers.content.itemId).toBe(reading.itemId);
    expect(live.preview).toEqual({ slideIndex: 0 });

    // In fondo alla scaletta "avanti" non fa nulla.
    const rev = state().live.rev;
    await ok("cue.next", {});
    expect(state().live.rev).toBe(rev);

    await ok("cue.prev", {});
    expect(state().live.cursor).toEqual({ entryId: song.entryId, slideIndex: 1 });
  });

  it("col programma vuoto, avanti parte dall'inizio della scaletta saltando gli elementi vuoti", async () => {
    await addText("Vuoto", []);
    const song = await addText("Canto", ["S1"]);
    await ok("cue.next", {});
    expect(state().live.cursor).toEqual({ entryId: song.entryId, slideIndex: 0 });
  });

  it("pulisci toglie il testo ma non la posizione: avanti riprende da li'", async () => {
    const song = await addText("Canto", ["S1", "S2"]);
    await ok("cue.goto", { entryId: song.entryId, slideIndex: 0 });
    await ok("layer.clear", { layer: "content" });
    expect(state().live.layers.content).toEqual({ visible: false });
    expect(state().live.cursor.entryId).toBe(song.entryId);
    await ok("cue.next", {});
    expect(state().live.layers.content).toEqual({
      visible: true,
      itemId: song.itemId,
      slideIndex: 1,
    });
  });

  it("rifiuta slide inesistenti", async () => {
    const song = await addText("Canto", ["S1"]);
    expect(await fails("cue.goto", { entryId: song.entryId, slideIndex: 3 })).toEqual([
      4220,
      "core.error.slideOutOfRange",
    ]);
    expect(
      await fails("preview.set", { entryId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", slideIndex: 0 }),
    ).toEqual([4040, "core.error.entryNotFound"]);
  });

  it("modificare o togliere cio' che e' in onda riporta programma e anteprima su slide esistenti", async () => {
    const song = await addText("Canto", ["S1", "S2", "S3"]);
    await ok("cue.goto", { entryId: song.entryId, slideIndex: 2 });
    const last = state().show.items[song.itemId]?.slides[2];
    if (last === undefined) throw new Error("slide mancante");
    await ok("slide.delete", { itemId: song.itemId, slideId: last.id });
    expect(state().live.cursor).toEqual({ entryId: song.entryId, slideIndex: 1 });
    expect(state().live.layers.content.slideIndex).toBe(1);

    await ok("playlist.remove", { entryId: song.entryId });
    const live = state().live;
    expect(live.cursor).toEqual({ slideIndex: 0 });
    expect(live.preview).toEqual({ slideIndex: 0 });
    expect(live.layers.content).toEqual({ visible: false });
  });

  it("eliminare un elemento toglie anche le sue voci dalla scaletta", async () => {
    const song = await addText("Canto", ["S1"]);
    await ok("playlist.add", { itemId: song.itemId });
    await ok("item.delete", { id: song.itemId });
    expect(state().show.playlist).toEqual([]);
    expect(state().show.items).toEqual({});
  });
});
