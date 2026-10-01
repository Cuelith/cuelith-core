import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mediaUri,
  mediaUrl,
  type EngineMethodName,
  type EngineMethodParams,
} from "@cuelith/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { Engine } from "../src/index.js";
import { expectError, expectOk, startTestEngine, TestClient } from "./helpers.js";

// Sfondi immagine (passo 6c, decisione 0003): per slide, per elemento e
// predefinito del look, sempre immagini gia' nell'archivio media.

/** PNG 1x1 valido. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const running: { engine: Engine; client: TestClient }[] = [];
afterEach(async () => {
  for (const { engine, client } of running.splice(0)) {
    await client.close();
    await engine.stop();
  }
});

async function start() {
  const engine = await startTestEngine();
  const client = await TestClient.connect(engine);
  await client.login(engine.tokens.station);
  running.push({ engine, client });
  const ok = <N extends EngineMethodName>(method: N, params: EngineMethodParams<N>) =>
    expectOk(client, method, params);
  const dir = mkdtempSync(join(tmpdir(), "cuelith-sfondi-"));
  const importFile = async (name: string, data: Buffer) => {
    const file = join(dir, name);
    writeFileSync(file, data);
    return (await ok("media.import", { path: file })).media;
  };
  return { engine, client, ok, importFile };
}

describe("sfondi", () => {
  it("sfondo dell'elemento e della singola slide; si tolgono con null; il file si scarica", async () => {
    const { engine, client, ok, importFile } = await start();
    const image = await importFile("cielo.png", PNG);
    const background = { uri: mediaUri(image.id), kind: "image" as const };
    const { id } = await ok("item.create", {
      type: "core.text",
      title: "Canto",
      background,
      slides: [
        { fields: { text: { kind: "text", value: "Uno" } } },
        { fields: { text: { kind: "text", value: "Due" } }, background },
      ],
    });
    const item = () => engine.context.store.snapshot().show.items[id];
    expect(item()?.background).toEqual(background);
    expect(item()?.slides[1]?.background).toEqual(background);

    await ok("item.update", { id, background: null });
    expect(item()?.background).toBeUndefined();
    const slideId = item()?.slides[0]?.id ?? "";
    await ok("slide.update", { itemId: id, slideId, background });
    expect(item()?.slides[0]?.background).toEqual(background);
    await ok("slide.update", { itemId: id, slideId, background: null });
    expect(item()?.slides[0]?.background).toBeUndefined();

    // Le uscite e la postazione lo leggono dal motore.
    const response = await fetch(
      `http://127.0.0.1:${String(engine.port)}${mediaUrl(background.uri) ?? ""}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);

    // L'elenco delle immagini dell'archivio, per sceglierle di nuovo (protocollo 1.12).
    const second = await importFile("mare.png", Buffer.concat([PNG, Buffer.from([0])]));
    const listed = (await ok("media.list", { kind: "image" })).media;
    expect(listed.map((m) => m.name).sort()).toEqual(["cielo.png", "mare.png"]);
    expect(listed.find((m) => m.id === second.id)).toMatchObject({
      kind: "image",
      mime: "image/png",
    });
    expect((await ok("media.list", { kind: "audio" })).media).toEqual([]);

    // Solo immagini dell'archivio.
    const missing = { uri: mediaUri(`${"0".repeat(64)}.png`), kind: "image" as const };
    expect(await expectError(client, "item.update", { id, background: missing })).toEqual([
      4220,
      "core.error.backgroundInvalid",
    ]);
    expect(
      await expectError(client, "item.update", {
        id,
        background: { uri: "https://example.com/x.png", kind: "image" },
      }),
    ).toEqual([4220, "core.error.backgroundInvalid"]);
    expect(
      await expectError(client, "item.update", {
        id,
        background: { ...background, kind: "video" },
      }),
    ).toEqual([4220, "core.error.backgroundInvalid"]);
  });

  it("il look ha uno sfondo predefinito e un velo; uno stile sbagliato viene rifiutato", async () => {
    const { engine, client, ok, importFile } = await start();
    const image = await importFile("sala.png", PNG);
    const show = () => engine.context.store.snapshot().show;
    const room = Object.values(show().looks).find((l) => l.template === "core.fullscreen");
    if (room === undefined) throw new Error("look Sala mancante");
    const style = room.style as { background: { color: string } };

    await ok("look.update", {
      id: room.id,
      style: { ...style, background: { color: "#101010", image: mediaUri(image.id), dim: 0.4 } },
    });
    expect((show().looks[room.id]?.style as typeof style).background).toEqual({
      color: "#101010",
      image: mediaUri(image.id),
      dim: 0.4,
    });
    expect(engine.context.store.snapshot().live.dirty).toBe(true);

    for (const background of [
      { color: "rosso" },
      { color: "#000000", dim: 2 },
      { color: "#000000", image: mediaUri(`${"0".repeat(64)}.png`) },
    ]) {
      expect(
        (
          await expectError(client, "look.update", { id: room.id, style: { ...style, background } })
        )[0],
      ).toBe(4220);
    }
    // Rifiutato: il look resta quello di prima.
    expect((show().looks[room.id]?.style as typeof style).background.color).toBe("#101010");
    expect(
      (
        await expectError(client, "look.update", { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "x" })
      )[0],
    ).toBe(4040);
  });
});
