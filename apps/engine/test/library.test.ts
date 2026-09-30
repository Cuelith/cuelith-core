import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import {
  newId,
  type EngineMethodName,
  type EngineMethodParams,
  type Item,
  type StateDocument,
} from "@cuelith/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { parseRange } from "../src/http/media.js";
import type { Engine } from "../src/index.js";
import {
  expectError,
  expectOk,
  startTestEngine,
  TestClient,
  type TestEngineOptions,
} from "./helpers.js";

const running: { engine: Engine; client: TestClient }[] = [];

async function start(options: TestEngineOptions = {}) {
  const engine = await startTestEngine(options);
  const client = await TestClient.connect(engine);
  await client.login(engine.tokens.station);
  running.push({ engine, client });
  const ok = <N extends EngineMethodName>(method: N, params: EngineMethodParams<N>) =>
    expectOk(client, method, params);
  const fails = (method: EngineMethodName, params: unknown) => expectError(client, method, params);
  const state = (): StateDocument => engine.context.store.snapshot();
  return { engine, client, ok, fails, state };
}

afterEach(async () => {
  for (const { engine, client } of running.splice(0)) {
    await client.close();
    await engine.stop();
  }
});

const folder = () => mkdtempSync(join(tmpdir(), "cuelith-library-"));

function song(title: string, lines: string[], extra: Partial<Item> = {}): Item {
  return {
    id: newId(),
    type: "core.text",
    title,
    slides: lines.map((value) => ({ id: newId(), fields: { text: { kind: "text", value } } })),
    meta: {},
    ...extra,
  };
}

const artist = (name: string) => ({
  authors: [{ name, role: "artist" as const }],
  show: "last" as const,
});

describe("librerie", () => {
  it("se ne creano quante si vuole, si rinominano, si riordinano; eliminarle non tocca l'archivio", async () => {
    const { ok } = await start();
    const { id: natale } = await ok("library.create", {
      name: "Canti di Natale",
      color: "#37D1BF",
    });
    const { id: innario } = await ok("library.create", { name: "Innario" });
    await ok("library.update", { id: innario, name: "Innario 2026", description: "Numerato" });
    await ok("library.move", { id: innario, toIndex: 0 });
    const { libraries } = await ok("library.list", {});
    expect(libraries.map((l) => l.name)).toEqual(["Innario 2026", "Canti di Natale"]);
    expect(libraries[1]).toMatchObject({ color: "#37D1BF", count: 0 });

    const item = song("Astro del ciel", ["Astro del ciel"]);
    await ok("library.saveItem", { item, libraryId: natale });
    await ok("library.delete", { id: natale });
    expect((await ok("library.list", {})).libraries).toHaveLength(1);
    expect((await ok("library.items", {})).items.map((i) => i.title)).toEqual(["Astro del ciel"]);
  });

  it("lo stesso brano sta in piu' librerie; le voci hanno ordine e numero", async () => {
    const { ok } = await start();
    const { id: a } = await ok("library.create", { name: "A" });
    const { id: b } = await ok("library.create", { name: "B" });
    const first = song("Primo", ["uno"]);
    const second = song("Secondo", ["due"]);
    await ok("library.saveItem", { item: first, libraryId: a });
    await ok("library.saveItem", { item: second, libraryId: a });
    await ok("library.addEntry", { libraryId: b, itemId: first.id, number: "123" });
    const inA = await ok("library.items", { libraryId: a });
    expect(inA.items.map((i) => i.title)).toEqual(["Primo", "Secondo"]);
    const secondEntry = inA.items[1]?.entryId;
    if (secondEntry === undefined) throw new Error("voce mancante");
    await ok("library.moveEntry", { entryId: secondEntry, toIndex: 0 });
    expect((await ok("library.items", { libraryId: a })).items.map((i) => i.title)).toEqual([
      "Secondo",
      "Primo",
    ]);
    expect((await ok("library.items", { libraryId: b })).items[0]).toMatchObject({
      title: "Primo",
      number: "123",
    });
    // Cercando il numero in una libreria si trova il brano (innario).
    expect((await ok("library.items", { libraryId: b, query: "123" })).items).toHaveLength(1);
  });

  it("cerca in titolo, testo, autori e tag, senza badare agli accenti", async () => {
    const { ok } = await start();
    await ok("library.saveItem", {
      item: song("Città di Dio", ["Perché tu sei santo"], { credits: artist("Anna Rossi") }),
    });
    await ok("library.saveItem", {
      item: song("Luce del mattino", ["Vieni su di noi"], { tags: ["Mattino", "Lode"] }),
    });
    const titles = async (query: string) =>
      (await ok("library.items", { query })).items.map((i) => i.title);
    expect(await titles("citta")).toEqual(["Città di Dio"]);
    expect(await titles("perche santo")).toEqual(["Città di Dio"]);
    expect(await titles("ross")).toEqual(["Città di Dio"]);
    expect(await titles("vien")).toEqual(["Luce del mattino"]);
    expect(await titles('"; DROP TABLE items; --')).toEqual([]);
    expect((await ok("library.items", { tag: "lode" })).items.map((i) => i.title)).toEqual([
      "Luce del mattino",
    ]);
    expect((await ok("library.tags", {})).tags).toEqual([
      { tag: "Lode", count: 1 },
      { tag: "Mattino", count: 1 },
    ]);
  });

  it("duplicare crea una versione indipendente che ricorda l'originale", async () => {
    const { ok } = await start();
    const original = song("Luce del mattino", ["Vieni su di noi"], { credits: artist("Coro") });
    await ok("library.saveItem", { item: original });
    const { id } = await ok("library.duplicateItem", { id: original.id });
    const { item: copy } = await ok("library.getItem", { id });
    expect(copy).toMatchObject({ title: "Luce del mattino", derivedFrom: original.id });
    expect(copy.slides[0]?.id).not.toBe(original.slides[0]?.id);
    await ok("library.saveItem", {
      item: { ...copy, title: "Luce del mattino (acustica)", credits: artist("Marco") },
    });
    expect((await ok("library.getItem", { id: original.id })).item.title).toBe("Luce del mattino");
    const all = (await ok("library.items", {})).items;
    expect(all.find((i) => i.id === id)).toMatchObject({
      authors: ["Marco"],
      derivedFrom: original.id,
    });
  });

  it("eliminare un elemento lo toglie da tutte le librerie", async () => {
    const { ok } = await start();
    const { id: a } = await ok("library.create", { name: "A" });
    const item = song("Via", ["x"]);
    await ok("library.saveItem", { item, libraryId: a });
    await ok("library.deleteItem", { id: item.id });
    expect((await ok("library.list", {})).libraries[0]?.count).toBe(0);
    expect((await ok("library.items", {})).total).toBe(0);
  });

  it("rifiuta elementi senza titolo, di tipo sconosciuto o con allegati fuori archivio", async () => {
    const { ok, fails } = await start();
    expect(await fails("library.saveItem", { item: song("  ", ["x"]) })).toEqual([
      4220,
      "core.error.titleRequired",
    ]);
    expect(
      await fails("library.saveItem", { item: { ...song("T", []), type: "core.nope" } }),
    ).toEqual([4220, "core.error.itemTypeUnknown"]);
    const attachments = [
      {
        mediaId: `${"a".repeat(64)}.mp3`,
        name: "Base",
        kind: "audio" as const,
        role: "backing" as const,
      },
    ];
    expect(await fails("library.saveItem", { item: song("T", ["x"], { attachments }) })).toEqual([
      4220,
      "core.error.mediaMissing",
    ]);
    expect((await ok("library.items", {})).total).toBe(0);
  });

  it("ogni modifica fa crescere libraryRev (le postazioni rileggono)", async () => {
    const { ok, state } = await start();
    const before = state().live.libraryRev;
    await ok("library.create", { name: "A" });
    expect(state().live.libraryRev).toBe(before + 1);
    expect(state().live.dirty).toBe(false);
  });

  it("restano dopo un riavvio", async () => {
    const data = folder();
    const first = await start({ data });
    await first.ok("library.create", { name: "Innario" });
    await first.ok("library.saveItem", { item: song("Resta", ["x"]) });
    const entry = running.pop();
    await entry?.client.close();
    await first.engine.stop();

    const second = await start({ data });
    expect((await second.ok("library.list", {})).libraries.map((l) => l.name)).toEqual(["Innario"]);
    expect((await second.ok("library.items", {})).items.map((i) => i.title)).toEqual(["Resta"]);
  });
});

describe("libreria e scaletta", () => {
  it("in scaletta va una copia che ricorda l'originale; la stessa copia si riusa", async () => {
    const { ok, state } = await start();
    const item = song("Luce", ["uno", "due"], { credits: artist("Coro"), tags: ["Lode"] });
    await ok("library.saveItem", { item });
    const { id: entry } = await ok("playlist.addFromLibrary", { itemId: item.id });
    await ok("playlist.addFromLibrary", { itemId: item.id });
    const doc = state();
    const copies = Object.values(doc.show.items);
    expect(copies).toHaveLength(1);
    const copy = copies[0];
    expect(copy?.id).not.toBe(item.id);
    expect(copy).toMatchObject({ title: "Luce", credits: artist("Coro"), tags: ["Lode"] });
    expect(copy?.libraryRef?.itemId).toBe(item.id);
    expect(doc.show.playlist.map((e) => e.itemId)).toEqual([copy?.id, copy?.id]);
    expect(doc.show.playlist[0]?.id).toBe(entry);
    expect(doc.live.dirty).toBe(true);
  });

  it("se l'originale cambia, la copia si aggiorna a richiesta (anche se e' in onda)", async () => {
    const { ok, state } = await start();
    const item = song("Luce", ["uno", "due", "tre"]);
    await ok("library.saveItem", { item });
    const { id: entry } = await ok("playlist.addFromLibrary", { itemId: item.id });
    await ok("cue.goto", { entryId: entry, slideIndex: 2 });
    await ok("library.saveItem", { item: { ...item, slides: item.slides.slice(0, 2) } });
    const copyId = state().show.playlist[0]?.itemId ?? "";
    await ok("item.refreshFromLibrary", { id: copyId });
    const doc = state();
    expect(doc.show.items[copyId]?.slides).toHaveLength(2);
    expect(doc.live.cursor).toEqual({ entryId: entry, slideIndex: 1 });
  });

  it("un testo creato nello show si salva in libreria, poi le modifiche tornano all'originale", async () => {
    const { ok, state } = await start();
    const { id: libraryId } = await ok("library.create", { name: "Avvisi" });
    const { id: showItem } = await ok("item.create", {
      type: "core.text",
      title: "Avviso",
      slides: [{ fields: { text: { kind: "text", value: "Cena domenica" } } }],
    });
    const { id: saved } = await ok("library.saveFromShow", { itemId: showItem, libraryId });
    expect(state().show.items[showItem]?.libraryRef?.itemId).toBe(saved);
    expect((await ok("library.items", { libraryId })).items.map((i) => i.id)).toEqual([saved]);

    await ok("item.update", { id: showItem, title: "Avviso aggiornato" });
    const { id: again } = await ok("library.saveFromShow", { itemId: showItem });
    expect(again).toBe(saved);
    expect((await ok("library.getItem", { id: saved })).item.title).toBe("Avviso aggiornato");
    expect((await ok("library.items", {})).total).toBe(1);
  });
});

describe("archivio media", () => {
  it("importa una copia col nome dell'impronta, una sola volta per contenuto, e la serve", async () => {
    const { ok, fails, engine } = await start();
    const dir = folder();
    const file = join(dir, "Base Luce.mp3");
    writeFileSync(file, Buffer.from("ID3 finta base musicale"));
    const { media } = await ok("media.import", { path: file });
    expect(media).toMatchObject({
      name: "Base Luce.mp3",
      kind: "audio",
      mime: "audio/mpeg",
      size: 23,
    });
    expect(media.id).toMatch(/^[a-f0-9]{64}\.mp3$/);

    const again = join(dir, "copia.mp3");
    writeFileSync(again, readFileSync(file));
    expect((await ok("media.import", { path: again })).media.id).toBe(media.id);
    expect(readdirSync(engine.context.library.media.dir).filter((n) => !n.startsWith("."))).toEqual(
      [media.id],
    );

    const url = `http://127.0.0.1:${String(engine.port)}/media/${media.id}`;
    const whole = await fetch(url);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("audio/mpeg");
    expect(whole.headers.get("content-security-policy")).toContain("sandbox");
    expect(await whole.text()).toBe("ID3 finta base musicale");
    const part = await fetch(url, { headers: { Range: "bytes=4-8" } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("finta");
    expect(
      (await fetch(`http://127.0.0.1:${String(engine.port)}/media/..%2F..%2Fsegreto.txt`)).status,
    ).toBe(404);

    expect(await fails("media.import", { path: join(dir, "testo.txt") })).toEqual([
      4220,
      "core.error.mediaUnsupported",
    ]);
    expect(await fails("media.import", { path: join(dir, "manca.mp3") })).toEqual([
      4040,
      "core.error.mediaNotFound",
    ]);

    // Ora un canto puo' avere la sua base musicale.
    const item = song("Luce", ["x"], {
      attachments: [{ mediaId: media.id, name: media.name, kind: "audio", role: "backing" }],
    });
    await ok("library.saveItem", { item });
    expect((await ok("library.items", {})).items[0]?.hasAttachments).toBe(true);
  });

  it("interpreta gli intervalli di byte", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBeNull();
    expect(parseRange("bytes=5-2", 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
  });
});

describe("librerie organizzate (decisione 0004)", () => {
  it("categoria, sigla e preferita; la sigla e' unica", async () => {
    const { ok, fails } = await start();
    const { id } = await ok("library.create", { name: "Innario", category: "Innari", code: "INN" });
    await ok("library.update", { id, favorite: true });
    expect((await ok("library.list", {})).libraries[0]).toMatchObject({
      name: "Innario",
      category: "Innari",
      code: "INN",
      favorite: true,
    });
    expect(await fails("library.create", { name: "Altro", code: "INN" })).toEqual([
      4220,
      "core.error.libraryCodeInUse",
    ]);
    await ok("library.update", { id, code: null, category: null });
    expect((await ok("library.list", {})).libraries[0]).not.toHaveProperty("code");
    await ok("library.create", { name: "Altro", code: "INN" });
  });

  it("'INN 245' va al brano 245 dell'innario; 'inn luce' cerca solo li'", async () => {
    const { ok } = await start();
    const { id: innario } = await ok("library.create", { name: "Innario", code: "INN" });
    const luce = song("Luce del mattino", ["Vieni su di noi"]);
    const altra = song("Luce eterna", ["Gloria"]);
    await ok("library.saveItem", { item: luce });
    await ok("library.saveItem", { item: altra });
    await ok("library.addEntry", { libraryId: innario, itemId: luce.id, number: "245" });
    const titles = async (query: string) =>
      (await ok("library.items", { query })).items.map((i) => i.title);
    expect(await titles("INN 245")).toEqual(["Luce del mattino"]);
    expect(await titles("inn luce")).toEqual(["Luce del mattino"]);
    expect(await titles("luce")).toEqual(["Luce del mattino", "Luce eterna"]);
    // Una parola qualsiasi seguita da altro non e' una sigla: ricerca normale.
    expect(await titles("luce eterna")).toEqual(["Luce eterna"]);
  });

  it("nella ricerca in tutto l'archivio ogni brano dice in quali librerie sta", async () => {
    const { ok } = await start();
    const { id: a } = await ok("library.create", { name: "Innario", code: "INN" });
    const { id: b } = await ok("library.create", { name: "Natale" });
    const item = song("Astro del ciel", ["Astro del ciel"]);
    await ok("library.saveItem", { item });
    await ok("library.addEntry", { libraryId: a, itemId: item.id, number: "12" });
    await ok("library.addEntry", { libraryId: b, itemId: item.id });
    const [found] = (await ok("library.items", {})).items;
    expect(found?.libraries).toEqual([
      { libraryId: a, name: "Innario", code: "INN", number: "12" },
      { libraryId: b, name: "Natale" },
    ]);
  });

  it("un archivio creato con la versione precedente si aggiorna senza perdere nulla", async () => {
    const data = folder();
    const db = new DatabaseSync(join(data, "library.sqlite"));
    db.exec(ARCHIVE_V1);
    const item = song("Vecchio canto", ["Ancora qui"]);
    db.prepare("INSERT INTO items (id, title, data, updated_at) VALUES (?, ?, ?, ?)").run(
      item.id,
      item.title,
      JSON.stringify(item),
      new Date().toISOString(),
    );
    db.prepare(
      "INSERT INTO libraries (id, name, description, color, position) VALUES (?, ?, NULL, NULL, 0)",
    ).run(newId(), "Vecchia libreria");
    db.exec("PRAGMA user_version = 1");
    db.close();

    const { ok } = await start({ data });
    expect((await ok("library.list", {})).libraries).toEqual([
      expect.objectContaining({ name: "Vecchia libreria", favorite: false, count: 0 }),
    ]);
    expect((await ok("library.getItem", { id: item.id })).item.title).toBe("Vecchio canto");
    const { id } = (await ok("library.list", {})).libraries[0] ?? { id: "" };
    await ok("library.update", { id, code: "OLD", category: "Archivio storico" });
  });
});

/** Schema dell'archivio alla versione 1 (congelato: serve a provare la migrazione). */
const ARCHIVE_V1 = `
  CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE VIRTUAL TABLE items_fts USING fts5(id UNINDEXED, title, body, authors, tags, tokenize = 'unicode61 remove_diacritics 2');
  CREATE TABLE libraries (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, color TEXT, position INTEGER NOT NULL);
  CREATE TABLE entries (id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, position INTEGER NOT NULL, number TEXT);
  CREATE INDEX entries_library ON entries(library_id, position);
  CREATE INDEX entries_item ON entries(item_id);
  CREATE TABLE media (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
`;
