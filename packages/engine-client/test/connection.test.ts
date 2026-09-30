import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { silentLogger, startEngine, type Engine } from "@cuelith-core/engine";
import { afterEach, describe, expect, it } from "vitest";
import { EngineConnection, type EngineSnapshot } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const LOCALE_IT_DIR = resolve(here, "../../../../plugin-locale-it");

async function engineOn(port = 0): Promise<Engine> {
  const root = mkdtempSync(join(tmpdir(), "cuelith-client-"));
  const client = join(root, "client");
  mkdirSync(client);
  writeFileSync(join(client, "index.html"), "<!doctype html>");
  return startEngine({
    version: "0.1.0",
    port,
    paths: { client, ui: root, bundledPlugins: [LOCALE_IT_DIR] },
    displays: { list: () => [] },
    logger: silentLogger,
  });
}

async function until(
  connection: EngineConnection,
  check: (snapshot: EngineSnapshot) => boolean,
  timeoutMs = 5000,
): Promise<EngineSnapshot> {
  const start = Date.now();
  while (!check(connection.getSnapshot())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `condizione non raggiunta: ${JSON.stringify(connection.getSnapshot().status)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  return connection.getSnapshot();
}

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function connect(engine: Engine, token: string | undefined): EngineConnection {
  const connection = new EngineConnection(`ws://127.0.0.1:${engine.port}/rpc`, () =>
    Promise.resolve({ name: "Prova", token }),
  );
  connection.start();
  cleanup.push(() => {
    connection.stop();
  });
  return connection;
}

describe("EngineConnection", () => {
  it("si presenta, accede, riceve lingua e stato", async () => {
    const engine = await engineOn();
    cleanup.push(() => engine.stop());
    const connection = connect(engine, engine.tokens.station);
    const snapshot = await until(connection, (s) => s.status.kind === "connected");
    expect(snapshot.role).toBe("director");
    expect(snapshot.lang).toBe("it");
    expect(snapshot.catalog["core.mode.present"]).toBe("Presenta");
    expect(snapshot.state?.show.name).toBe("Nuovo show");
  });

  it("applica le patch del motore e resta allineato", async () => {
    const engine = await engineOn();
    cleanup.push(() => engine.stop());
    const connection = connect(engine, engine.tokens.station);
    await until(connection, (s) => s.status.kind === "connected");
    const { id } = await connection.call("item.create", { type: "core.text", title: "Canto" });
    const snapshot = await until(connection, (s) => s.state?.show.items[id] !== undefined);
    expect(snapshot.state).toEqual(engine.context.store.snapshot());
  });

  it("senza credenziali resta da abbinare", async () => {
    const engine = await engineOn();
    cleanup.push(() => engine.stop());
    const connection = connect(engine, undefined);
    await until(connection, (s) => s.status.kind === "unpaired");
  });

  it("se il motore si ferma segnala il collegamento perso, poi si ricollega da solo", async () => {
    const first = await engineOn();
    const port = first.port;
    const connection = connect(first, first.tokens.station);
    await until(connection, (s) => s.status.kind === "connected");
    await first.stop();
    const lost = await until(connection, (s) => s.status.kind === "lost");
    // Lo stato mostrato resta l'ultimo valido mentre si riprova.
    expect(lost.state?.show.name).toBe("Nuovo show");

    // Un motore nuovo sulla stessa porta: token diversi, quindi la postazione
    // (con le credenziali vecchie) risulta da abbinare, senza errori.
    const second = await engineOn(port);
    cleanup.push(() => second.stop());
    await until(connection, (s) => s.status.kind === "unpaired", 10_000);
  });
});
