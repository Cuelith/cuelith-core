import type { EngineMethodName, EngineMethodParams, Look, StateDocument } from "@cuelith/protocol";
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

function presentation(): { sourceId: string; room: Look; stage: Look } {
  const doc = state();
  const source = Object.values(doc.show.sources)[0];
  const looks = Object.values(doc.show.looks);
  const room = looks.find((l) => l.template === "core.fullscreen");
  const stage = looks.find((l) => l.template === "core.stage");
  if (source === undefined || room === undefined || stage === undefined) {
    throw new Error("show iniziale incompleto");
  }
  return { sourceId: source.id, room, stage };
}

function displayOutput(name: string, displayId: string, lookId: string, mode = "fullscreen") {
  return {
    name,
    kind: "display" as const,
    provider: "core",
    target: { displayId, mode },
    format: { width: 1920, height: 1080, fps: 60 },
    feed: { type: "source" as const, sourceId: presentation().sourceId, lookId },
  };
}

describe("uscite", () => {
  it("crea due uscite con look diversi, ognuna col suo stato live", async () => {
    const { room, stage } = presentation();
    const { id: projector } = await ok("output.create", displayOutput("Proiettore", "2", room.id));
    const { id: monitor } = await ok("output.create", displayOutput("Palco", "3", stage.id));
    const doc = state();
    expect(Object.keys(doc.show.outputs).sort()).toEqual([projector, monitor].sort());
    expect(doc.live.outputs[projector]).toEqual({ blackout: false, freeze: false, status: "ok" });
    expect(doc.live.outputs[monitor]).toEqual({ blackout: false, freeze: false, status: "ok" });
    expect(doc.live.dirty).toBe(true);
  });

  it("blackout e freeze valgono per una sola uscita", async () => {
    const { room, stage } = presentation();
    const { id: projector } = await ok("output.create", displayOutput("Proiettore", "2", room.id));
    const { id: monitor } = await ok("output.create", displayOutput("Palco", "3", stage.id));
    await ok("output.blackout", { outputId: projector, on: true });
    await ok("output.freeze", { outputId: monitor, on: true });
    const live = state().live.outputs;
    expect(live[projector]).toMatchObject({ blackout: true, freeze: false });
    expect(live[monitor]).toMatchObject({ blackout: false, freeze: true });
    // Blackout e freeze sono stato live: non rendono lo show da salvare.
    await ok("output.blackout", { outputId: projector, on: false });
    expect(state().live.outputs[projector]?.blackout).toBe(false);
  });

  it("rifiuta tipi senza modulo, destinazioni non valide e monitor gia' occupati", async () => {
    const { room } = presentation();
    const base = displayOutput("A", "2", room.id);
    expect(await fails("output.create", { ...base, kind: "ndi", provider: "core" })).toEqual([
      4220,
      "core.error.outputKindUnavailable",
    ]);
    expect(await fails("output.create", { ...base, target: { displayId: "2" } })).toEqual([
      4220,
      "core.error.displayTargetInvalid",
    ]);
    await ok("output.create", base);
    expect(await fails("output.create", displayOutput("B", "2", room.id))).toEqual([
      4220,
      "core.error.displayInUse",
    ]);
    // In finestra lo stesso monitor si puo' usare (prove con un solo schermo).
    await ok("output.create", displayOutput("C", "2", room.id, "window"));
  });

  it("rifiuta un feed verso sorgenti o look inesistenti", async () => {
    const { room } = presentation();
    const bad = {
      ...displayOutput("A", "2", room.id),
      feed: { type: "source", sourceId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
    };
    expect(await fails("output.create", bad)).toEqual([4220, "core.error.feedInvalid"]);
  });

  it("modifica ed elimina un'uscita; non si elimina un'uscita copiata da un'altra", async () => {
    const { room, stage, sourceId } = presentation();
    const { id } = await ok("output.create", displayOutput("Proiettore", "2", room.id));
    await ok("output.update", {
      id,
      name: "Proiettore sala",
      feed: { type: "source", sourceId, lookId: stage.id },
    });
    expect(state().show.outputs[id]).toMatchObject({
      name: "Proiettore sala",
      feed: { lookId: stage.id },
    });

    const { id: copy } = await ok("output.create", {
      ...displayOutput("Copia", "3", room.id),
      feed: { type: "mirror", outputId: id },
    });
    expect(await fails("output.delete", { id })).toEqual([4220, "core.error.outputMirrored"]);
    await ok("output.delete", { id: copy });
    await ok("output.delete", { id });
    expect(state().show.outputs).toEqual({});
    expect(state().live.outputs).toEqual({});
  });

  it("le finestre di uscita (visualizzatori) non possono comandare le uscite", async () => {
    const { room } = presentation();
    const { id } = await ok("output.create", displayOutput("Proiettore", "2", room.id));
    const renderer = await TestClient.connect(engine);
    await renderer.login(engine.tokens.renderer);
    expect(await expectError(renderer, "output.blackout", { outputId: id, on: true })).toEqual([
      4030,
      "core.error.forbidden",
    ]);
    await renderer.close();
  });

  it("chi esegue l'uscita ne riporta lo stato, es. monitor scollegato", async () => {
    const { room } = presentation();
    const { id } = await ok("output.create", displayOutput("Proiettore", "2", room.id));
    engine.setOutputStatus(id, "error", "core.output.displayMissing");
    expect(state().live.outputs[id]).toMatchObject({
      status: "error",
      error: "core.output.displayMissing",
    });
    engine.setOutputStatus(id, "ok");
    expect(state().live.outputs[id]).toEqual({ blackout: false, freeze: false, status: "ok" });
  });
});

describe("palco e timer (protocollo 1.7)", () => {
  it("un messaggio va solo all'uscita scelta; il testo vuoto lo toglie", async () => {
    const { room, stage } = presentation();
    const { id: projector } = await ok("output.create", displayOutput("Proiettore", "2", room.id));
    const { id: monitor } = await ok("output.create", displayOutput("Palco", "3", stage.id));
    await ok("message.send", { outputId: monitor, text: "  5 minuti " });
    expect(state().live.outputs[monitor]?.message).toBe("5 minuti");
    expect(state().live.outputs[projector]?.message).toBeUndefined();
    expect(state().live.dirty).toBe(true); // per la creazione delle uscite, non per il messaggio
    await ok("message.send", { outputId: monitor, text: "" });
    expect(state().live.outputs[monitor]?.message).toBeUndefined();
    expect(
      await fails("message.send", { outputId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", text: "x" }),
    ).toEqual([4040, "core.error.outputNotFound"]);
  });

  it("timer: durata, partenza, pausa che tiene il rimanente, azzera, togli", async () => {
    await ok("timer.set", { durationMs: 600_000 });
    expect(state().live.timer).toEqual({ durationMs: 600_000, remainingMs: 600_000 });
    await ok("timer.start", {});
    const started = state().live.timer;
    expect(started?.startedAt).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await ok("timer.pause", {});
    const paused = state().live.timer;
    expect(paused?.startedAt).toBeUndefined();
    expect(paused?.remainingMs).toBeLessThan(600_000);
    expect(paused?.remainingMs).toBeGreaterThan(590_000);
    await ok("timer.reset", {});
    expect(state().live.timer).toEqual({ durationMs: 600_000, remainingMs: 600_000 });
    await ok("timer.clear", {});
    expect(state().live.timer).toBeUndefined();
    expect(state().live.dirty).toBe(false);
  });
});
