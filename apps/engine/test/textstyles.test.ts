import { DEFAULT_ROOM_STYLE } from "@cuelith-core/core-looks";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorCode, type EngineMethodName, type EngineMethodParams } from "@cuelith/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { Engine } from "../src/index.js";
import { expectError, expectOk, startTestEngine, TestClient } from "./helpers.js";

// Stili del testo (decisione 0015): gli stili globali salvati dall'utente nell'archivio del
// computer, lo stile del testo di un singolo elemento e lo stile globale scelto per un look.

const running: { engine: Engine; client: TestClient }[] = [];
afterEach(async () => {
  for (const { engine, client } of running.splice(0)) {
    await client.close();
    await engine.stop();
  }
});

async function start(options: Parameters<typeof startTestEngine>[0] = {}) {
  const engine = await startTestEngine(options);
  const client = await TestClient.connect(engine);
  await client.login(engine.tokens.station);
  running.push({ engine, client });
  const ok = <N extends EngineMethodName>(method: N, params: EngineMethodParams<N>) =>
    expectOk(client, method, params);
  const fails = (method: EngineMethodName, params: unknown) => expectError(client, method, params);
  return { engine, client, ok, fails };
}

const style = { ...DEFAULT_ROOM_STYLE.text, size: 96, fit: { min: 0.6 } };

describe("stili globali del testo", () => {
  it("si creano, si leggono nell'ordine, si modificano e si eliminano", async () => {
    const { ok, engine } = await start();
    expect((await ok("textstyle.list", {})).styles).toEqual([]);
    const revBefore = engine.context.store.snapshot().live.libraryRev;
    const a = await ok("textstyle.create", { name: "Sala grande", style });
    const b = await ok("textstyle.create", { name: "Karaoke", style: { ...style, size: 140 } });
    // Le postazioni lo vengono a sapere: le librerie sono cambiate.
    expect(engine.context.store.snapshot().live.libraryRev).toBeGreaterThan(revBefore);
    const listed = (await ok("textstyle.list", {})).styles;
    expect(listed.map((s) => s.name)).toEqual(["Sala grande", "Karaoke"]);
    expect(listed[0]?.style).toMatchObject({ size: 96, fit: { min: 0.6 } });

    await ok("textstyle.update", { id: a.id, name: "Sala", style: { ...style, size: 100 } });
    expect((await ok("textstyle.list", {})).styles[0]).toMatchObject({
      name: "Sala",
      style: { size: 100 },
    });
    await ok("textstyle.update", { id: b.id, name: "Karaoke 2" });
    expect((await ok("textstyle.list", {})).styles[1]?.style).toMatchObject({ size: 140 });

    await ok("textstyle.delete", { id: a.id });
    expect((await ok("textstyle.list", {})).styles.map((s) => s.id)).toEqual([b.id]);
  });

  it("uno stile che non ha la forma di uno stile di testo e' rifiutato, e nulla viene salvato", async () => {
    const { ok, fails } = await start();
    for (const bad of [
      {},
      { ...style, size: 5 },
      { ...style, fit: { min: 0.1 } },
      { ...style, colour: "#fff" },
    ]) {
      expect((await fails("textstyle.create", { name: "x", style: bad }))[1]).toBe(
        "core.error.textStyleInvalid",
      );
    }
    const { id } = await ok("textstyle.create", { name: "Buono", style });
    expect((await fails("textstyle.update", { id, style: { size: 1 } }))[1]).toBe(
      "core.error.textStyleInvalid",
    );
    expect((await ok("textstyle.list", {})).styles).toHaveLength(1);
    expect((await ok("textstyle.list", {})).styles[0]?.style).toMatchObject({ size: 96 });
  });

  it("nome vuoto o troppo lungo, id sconosciuto e limite sul numero", async () => {
    const { ok, fails } = await start();
    expect((await fails("textstyle.create", { name: "   ", style }))[0]).toBe(
      ErrorCode.InvalidParameters,
    );
    expect((await fails("textstyle.create", { name: "x".repeat(61), style }))[0]).toBe(
      ErrorCode.InvalidParameters,
    );
    expect((await fails("textstyle.delete", { id: "01HZZZZZZZZZZZZZZZZZZZZZZZ" }))[1]).toBe(
      "core.error.textStyleNotFound",
    );
    for (let i = 0; i < 60; i += 1) await ok("textstyle.create", { name: `S${String(i)}`, style });
    expect((await fails("textstyle.create", { name: "uno di troppo", style }))[1]).toBe(
      "core.error.textStyleLimit",
    );
  });

  it("restano dopo un riavvio del motore", async () => {
    const data = mkdtempSync(join(tmpdir(), "cuelith-stili-"));
    const first = await start({ data });
    await first.ok("textstyle.create", { name: "Resta", style });
    const index = running.findIndex((r) => r.engine === first.engine);
    const [{ client, engine }] = running.splice(index, 1) as [
      { engine: Engine; client: TestClient },
    ];
    await client.close();
    await engine.stop();
    const second = await start({ data });
    expect((await second.ok("textstyle.list", {})).styles.map((s) => s.name)).toEqual(["Resta"]);
  });
});

describe("stile del testo dell'elemento e stile globale del look", () => {
  it("lo stile dell'editor si salva nell'elemento e si toglie con null", async () => {
    const { ok, fails, engine } = await start();
    const { id } = await ok("item.create", {
      type: "core.text",
      title: "Salmo",
      slides: [{ fields: { text: { kind: "text", value: "Il Signore e' il mio pastore" } } }],
    });
    await ok("item.update", { id, textStyle: { scale: 0.8, weight: "bold", color: "#FFCC00" } });
    expect(engine.context.store.snapshot().show.items[id]?.textStyle).toEqual({
      scale: 0.8,
      weight: "bold",
      color: "#FFCC00",
    });
    // Valori fuori misura o campi sconosciuti sono rifiutati.
    expect((await fails("item.update", { id, textStyle: { scale: 3 } }))[0]).toBe(
      ErrorCode.InvalidParameters,
    );
    expect((await fails("item.update", { id, textStyle: { size: 50 } }))[0]).toBe(
      ErrorCode.InvalidParameters,
    );
    await ok("item.update", { id, textStyle: null });
    expect(engine.context.store.snapshot().show.items[id]?.textStyle).toBeUndefined();
  });

  it("lo stile globale scelto sta nel look come copia, e si toglie senza lasciare tracce", async () => {
    const { ok, fails, engine } = await start();
    const room = Object.values(engine.context.store.snapshot().show.looks).find(
      (look) => look.template === "core.fullscreen",
    );
    expect(room).toBeDefined();
    const base = room?.style as typeof DEFAULT_ROOM_STYLE;
    const globalText = { id: "abc", name: "Sala grande", text: { ...style } };
    await ok("look.update", { id: room?.id ?? "", style: { ...base, globalText } });
    expect(
      (
        engine.context.store.snapshot().show.looks[room?.id ?? ""]?.style as {
          globalText?: unknown;
        }
      ).globalText,
    ).toMatchObject({ id: "abc", name: "Sala grande" });
    // Uno stile globale con campi sbagliati non entra nel look.
    expect(
      (
        await fails("look.update", {
          id: room?.id ?? "",
          style: { ...base, globalText: { id: "abc", name: "x", text: { size: 1 } } },
        })
      )[0],
    ).toBe(ErrorCode.InvalidParameters);
    await ok("look.update", { id: room?.id ?? "", style: base });
    expect(engine.context.store.snapshot().show.looks[room?.id ?? ""]?.style).toEqual(base);
  });
});
