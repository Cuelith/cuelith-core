import type { EngineMethodName, EngineMethodParams, StateDocument } from "@cuelith/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Engine } from "../src/index.js";
import { expectOk, startTestEngine, TestClient } from "./helpers.js";

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
const state = (): StateDocument => engine.context.store.snapshot();

const session = {
  owner: "acme.editor",
  field: "slide-1",
  text: "Il Signore è il mio pastore",
  selection: { start: 3, end: 10 },
};

describe("parole formattate in un testo in modifica (protocollo 1.22)", () => {
  it("l'editor descrive il testo, il plugin annesso chiede la modifica, lo stato la porta indietro", async () => {
    expect(state().live.richText).toBeUndefined();
    await ok("richtext.session", session);
    expect(state().live.richText).toMatchObject({ ...session, applied: 0 });

    await ok("richtext.apply", { change: { size: 1.5, bold: "toggle" } });
    const after = state().live.richText;
    expect(after?.applied).toBe(1);
    expect(after?.spans).toEqual([{ start: 3, end: 10, size: 1.5, bold: true }]);
    // Il testo non cambia mai: lo scrive solo chi lo possiede.
    expect(after?.text).toBe(session.text);

    // Ancora grassetto: si spegne, la dimensione resta.
    await ok("richtext.apply", { change: { bold: "toggle" } });
    expect(state().live.richText?.spans).toEqual([{ start: 3, end: 10, size: 1.5 }]);
    expect(state().live.richText?.applied).toBe(2);

    // Tolta ogni formattazione: niente intervalli.
    await ok("richtext.apply", { change: { size: null } });
    expect(state().live.richText?.spans).toBeUndefined();
  });

  it("l'editor che riaggiorna il testo non perde il conto delle modifiche chieste da fuori", async () => {
    await ok("richtext.session", session);
    await ok("richtext.apply", { change: { italic: true } });
    // Chi scrive manda lo stato nuovo (con gli intervalli appena adottati): il conto non riparte.
    await ok("richtext.session", {
      ...session,
      spans: [{ start: 3, end: 10, italic: true }],
    });
    expect(state().live.richText).toMatchObject({ applied: 1 });
    // Un altro testo e' un'altra sessione: riparte da zero.
    await ok("richtext.session", { ...session, field: "slide-2" });
    expect(state().live.richText).toMatchObject({ field: "slide-2", applied: 0 });
  });

  it("senza testo in modifica o senza selezione non c'e' niente da formattare", async () => {
    const noSession = await client.call("richtext.apply", { change: { bold: true } });
    expect(noSession).toMatchObject({ error: { message: "core.error.richTextNoSession" } });
    await ok("richtext.session", { ...session, selection: { start: 4, end: 4 } });
    const noSelection = await client.call("richtext.apply", { change: { bold: true } });
    expect(noSelection).toMatchObject({ error: { message: "core.error.richTextNoSelection" } });
    expect(state().live.richText?.applied).toBe(0);
  });

  it("la selezione fuori dal testo si porta dentro; gli intervalli si puliscono", async () => {
    await ok("richtext.session", {
      ...session,
      text: "abc",
      selection: { start: 1, end: 99 },
      spans: [
        { start: 0, end: 2, bold: true },
        { start: 1, end: 3, bold: true },
      ],
    });
    expect(state().live.richText?.selection).toEqual({ start: 1, end: 3 });
    expect(state().live.richText?.spans).toEqual([{ start: 0, end: 3, bold: true }]);
  });

  it("solo chi ha aperto la sessione la chiude", async () => {
    await ok("richtext.session", session);
    await ok("richtext.end", { owner: "altro.plugin", field: session.field });
    expect(state().live.richText).toBeDefined();
    await ok("richtext.end", { owner: session.owner, field: session.field });
    expect(state().live.richText).toBeUndefined();
  });

  it("non entra nello show e non lo segna da salvare", async () => {
    await ok("richtext.session", session);
    await ok("richtext.apply", { change: { bold: true } });
    expect(state().live.dirty).toBe(false);
  });
});
