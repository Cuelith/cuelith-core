import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ShowSchema,
  type EngineMethodName,
  type EngineMethodParams,
  type StateDocument,
} from "@cuelith/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { Engine } from "../src/index.js";
import {
  expectError,
  expectOk,
  startTestEngine,
  TestClient,
  waitFor,
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

const folder = () => mkdtempSync(join(tmpdir(), "cuelith-files-"));
const text = (value: string) => ({ fields: { text: { kind: "text" as const, value } } });

describe("file .cuelith", () => {
  it("salva e riapre lo stesso show; il file e' JSON leggibile e valido", async () => {
    const { ok, state } = await start();
    const { id } = await ok("item.create", {
      type: "core.text",
      title: "Canto",
      slides: [text("A")],
    });
    await ok("playlist.add", { itemId: id });
    const path = join(folder(), "Domenica.cuelith");

    const saved = await ok("show.save", { path });
    expect(saved.path).toBe(path);
    expect(state().live).toMatchObject({ showPath: path, dirty: false });
    const onDisk: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(ShowSchema.safeParse(onDisk).success).toBe(true);
    expect(onDisk).toEqual(state().show);

    const before = state().show;
    await ok("show.new", { name: "Vuoto" });
    expect(state().show.playlist).toEqual([]);
    expect(state().live.showPath).toBeUndefined();
    await ok("show.open", { path });
    expect(state().show).toEqual(before);
    expect(state().live).toMatchObject({ showPath: path, dirty: false });
  });

  it("salva di nuovo sullo stesso file senza chiedere il percorso, senza lasciare temporanei", async () => {
    const { ok, fails, state } = await start();
    expect(await fails("show.save", {})).toEqual([4220, "core.error.showPathRequired"]);
    const dir = folder();
    const path = join(dir, "Prova.cuelith");
    await ok("show.save", { path });
    await ok("show.rename", { name: "Culto di domenica" });
    expect(state().live.dirty).toBe(true);
    await ok("show.save", {});
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ name: "Culto di domenica" });
    expect(readdirSync(dir)).toEqual(["Prova.cuelith"]);
  });

  it("se il salvataggio fallisce il file precedente resta intatto", async () => {
    const { ok, fails } = await start();
    const dir = folder();
    const path = join(dir, "Buono.cuelith");
    await ok("show.save", { path });
    const good = readFileSync(path, "utf8");
    await ok("show.rename", { name: "Cambiato" });
    const missing = join(dir, "non-esiste", "Altro.cuelith");
    expect(await fails("show.save", { path: missing })).toEqual([
      -32603,
      "core.error.showSaveFailed",
    ]);
    expect(readFileSync(path, "utf8")).toBe(good);
    expect(readdirSync(dir)).toEqual(["Buono.cuelith"]);
  });

  it("accetta solo percorsi assoluti .cuelith", async () => {
    const { fails } = await start();
    expect(await fails("show.save", { path: "relativo.cuelith" })).toEqual([
      4220,
      "core.error.showPathInvalid",
    ]);
    expect(await fails("show.save", { path: join(folder(), "x.txt") })).toEqual([
      4220,
      "core.error.showPathInvalid",
    ]);
    expect(await fails("show.open", { path: join(folder(), "x.json") })).toEqual([
      4220,
      "core.error.showPathInvalid",
    ]);
  });

  it("spiega perche' un file non si apre, senza cambiare lo show aperto", async () => {
    const { fails, state } = await start();
    const dir = folder();
    const before = state().show;
    const broken = join(dir, "Rotto.cuelith");
    writeFileSync(broken, "{ non e' json");
    const invalid = join(dir, "Invalido.cuelith");
    writeFileSync(invalid, JSON.stringify({ schema: 1, name: "x" }));
    const future = join(dir, "Futuro.cuelith");
    writeFileSync(future, JSON.stringify({ schema: 2 }));
    expect(await fails("show.open", { path: join(dir, "Manca.cuelith") })).toEqual([
      4040,
      "core.error.showNotFound",
    ]);
    expect(await fails("show.open", { path: broken })).toEqual([4220, "core.error.showUnreadable"]);
    expect(await fails("show.open", { path: invalid })).toEqual([4220, "core.error.showInvalid"]);
    expect(await fails("show.open", { path: future })).toEqual([4220, "core.error.showTooNew"]);
    expect(state().show).toEqual(before);
  });

  it("aprendo uno show le uscite ripartono accese e niente e' in onda", async () => {
    const { ok, state } = await start();
    const doc = state();
    const source = Object.values(doc.show.sources)[0];
    const look = Object.values(doc.show.looks)[0];
    if (source === undefined || look === undefined) throw new Error("show incompleto");
    const { id: output } = await ok("output.create", {
      name: "Proiettore",
      kind: "display",
      provider: "core",
      target: { displayId: "1", mode: "window" },
      format: { width: 1920, height: 1080, fps: 60 },
      feed: { type: "source", sourceId: source.id, lookId: look.id },
    });
    const { id: item } = await ok("item.create", {
      type: "core.text",
      title: "T",
      slides: [text("A")],
    });
    const { id: entry } = await ok("playlist.add", { itemId: item });
    await ok("cue.goto", { entryId: entry, slideIndex: 0 });
    await ok("output.blackout", { outputId: output, on: true });
    const path = join(folder(), "Con uscite.cuelith");
    await ok("show.save", { path });
    await ok("show.open", { path });
    const live = state().live;
    expect(live.outputs[output]).toEqual({ blackout: false, freeze: false, status: "ok" });
    expect(live.layers.content.visible).toBe(false);
    expect(live.cursor).toEqual({ slideIndex: 0 });
  });
});

describe("copia automatica", () => {
  it("si scrive solo con modifiche non salvate, fuori dal file dell'utente", async () => {
    const data = folder();
    const { ok, engine, state } = await start({ data, autosaveIntervalMs: 60_000 });
    const autosave = join(data, "autosave");
    await engine.context.shows.autosaveNow();
    expect(readdirSync(autosave)).toEqual([]);

    await ok("item.create", { type: "core.text", title: "Canto", slides: [text("A")] });
    await engine.context.shows.autosaveNow();
    const file = join(autosave, `${state().show.id}.cuelith`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(state().show);

    // Salvato dall'utente: la copia non serve piu'.
    await ok("show.save", { path: join(folder(), "Salvato.cuelith") });
    expect(readdirSync(autosave)).toEqual([]);
  });

  it("parte da sola a intervalli", async () => {
    const data = folder();
    const { ok } = await start({ data, autosaveIntervalMs: 50 });
    await ok("show.rename", { name: "Modificato" });
    await waitFor(() => readdirSync(join(data, "autosave")).length === 1, 3000);
  });

  /** Primo avvio con modifiche non salvate, poi "arresto": la copia resta in una cartella dati nuova. */
  async function crashWithChanges() {
    const data = folder();
    const first = await start({ data, autosaveIntervalMs: 60_000 });
    const { id } = await first.ok("item.create", {
      type: "core.text",
      title: "Canto",
      slides: [text("A")],
    });
    await first.ok("playlist.add", { itemId: id });
    await first.ok("show.rename", { name: "Culto" });
    await first.engine.context.shows.autosaveNow();
    const lost = first.state().show;
    const nextData = folder();
    mkdirSync(join(nextData, "autosave"));
    copyFileSync(
      join(data, "autosave", `${lost.id}.cuelith`),
      join(nextData, "autosave", `${lost.id}.cuelith`),
    );
    return { lost, nextData };
  }

  it("dopo una chiusura non corretta propone la copia; riaprendola lo show torna com'era", async () => {
    const { lost, nextData } = await crashWithChanges();
    const second = await start({ data: nextData, autosaveIntervalMs: 60_000 });
    const recovery = second.state().live.recovery;
    expect(recovery).toMatchObject({ showName: "Culto" });
    if (recovery === undefined) throw new Error("copia non proposta");

    await second.ok("show.open", { path: recovery.path });
    const doc = second.state();
    expect(doc.show).toEqual(lost);
    // E' una copia: va salvata con un nome, quindi risulta da salvare.
    expect(doc.live).toMatchObject({ dirty: true });
    expect(doc.live.showPath).toBeUndefined();
    expect(doc.live.recovery).toBeUndefined();
  });

  it("si puo' rinunciare alla copia: il file sparisce", async () => {
    const { nextData } = await crashWithChanges();
    const second = await start({ data: nextData, autosaveIntervalMs: 60_000 });
    expect(second.state().live.recovery).toBeDefined();
    await second.ok("show.discardRecovery", {});
    expect(second.state().live.recovery).toBeUndefined();
    expect(readdirSync(join(nextData, "autosave"))).toEqual([]);
  });

  it("una chiusura corretta non lascia copie", async () => {
    const data = folder();
    const { ok, engine } = await start({ data, autosaveIntervalMs: 60_000 });
    await ok("show.rename", { name: "Modificato" });
    await engine.context.shows.autosaveNow();
    expect(readdirSync(join(data, "autosave"))).toHaveLength(1);
    const entry = running.pop();
    await entry?.client.close();
    await engine.stop();
    expect(readdirSync(join(data, "autosave"))).toEqual([]);
  });
});
