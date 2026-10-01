import { mkdtempSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_VERSION,
  type EngineMethodName,
  type EngineMethodParams,
} from "@cuelith/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { PAIRING_CODE_MS, PAIRING_MAX_ATTEMPTS, Tokens } from "../src/auth.js";
import type { Engine } from "../src/index.js";
import { lanInterfaces } from "../src/network.js";
import { expectError, expectOk, startTestEngine, TestClient, waitFor } from "./helpers.js";

// Postazioni in rete locale (passo 8, cap. 9, 23 e 27): abbinamento con
// codice, token revocabili, ruoli, ascolto solo sulla rete scelta.

const engines: Engine[] = [];
const clients: TestClient[] = [];

async function start(data = mkdtempSync(join(tmpdir(), "cuelith-network-"))) {
  const engine = await startTestEngine({ data });
  engines.push(engine);
  const local = await TestClient.connect(engine);
  clients.push(local);
  await local.login(engine.tokens.station);
  const ok = <N extends EngineMethodName>(method: N, params: EngineMethodParams<N>) =>
    expectOk(local, method, params);
  /** Una postazione nuova: si presenta ma non ha ancora un token. */
  const newcomer = async (host?: string) => {
    const client = await TestClient.connect(engine, undefined, host);
    clients.push(client);
    await client.call("session.hello", {
      protocol: PROTOCOL_VERSION,
      client: { name: "Tablet", kind: "client" },
    });
    return client;
  };
  return { engine, local, ok, newcomer, data };
}

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const engine of engines.splice(0)) await engine.stop();
});

describe("abbinamento con codice", () => {
  it("la postazione nuova riceve un token col ruolo scelto e comanda il motore", async () => {
    const { ok, newcomer, engine } = await start();
    const tablet = await newcomer();
    // Prima dell'abbinamento: solo i testi (per la schermata del codice), non lo show.
    expect((await expectOk(tablet, "locale.list", {})).active).toBe("it");
    expect(await expectError(tablet, "state.subscribe", {})).toEqual([
      4010,
      "core.error.notPaired",
    ]);

    const { code } = await ok("pairing.start", { role: "operator" });
    expect(code).toMatch(/^\d{6}$/);
    const paired = await expectOk(tablet, "session.pair", { code, name: "Tablet del palco" });
    expect(paired.role).toBe("operator");
    // Il codice vale una volta sola.
    const other = await newcomer();
    expect(await expectError(other, "session.pair", { code, name: "Altro" })).toEqual([
      4010,
      "core.pairing.codeExpired",
    ]);

    const auth = await expectOk(tablet, "session.auth", { token: paired.token });
    expect(auth.role).toBe("operator");
    const { state } = await expectOk(tablet, "state.subscribe", {});
    expect(state.live.clients.find((c) => c.pairedId === paired.clientId)).toMatchObject({
      name: "Tablet",
      role: "operator",
      local: false,
    });
    // L'operatore fa la regia, non amministra; i file del computer restano locali.
    await expectOk(tablet, "show.rename", { name: "Dal tablet" });
    expect(engine.context.store.snapshot().show.name).toBe("Dal tablet");
    expect((await expectError(tablet, "plugin.install", { path: "/x" }))[0]).toBe(4030);
    expect((await expectError(tablet, "pairing.start", { role: "director" }))[0]).toBe(4030);
    expect(await expectError(tablet, "media.import", { path: "/x.png" })).toEqual([
      4030,
      "core.error.localOnly",
    ]);
  });

  it("codice sbagliato: errore; dopo troppi tentativi il codice si brucia", async () => {
    const { ok, newcomer } = await start();
    const { code } = await ok("pairing.start", { role: "remote" });
    const wrong = code === "000000" ? "000001" : "000000";
    const tablet = await newcomer();
    for (let i = 0; i < PAIRING_MAX_ATTEMPTS; i++) {
      expect(await expectError(tablet, "session.pair", { code: wrong, name: "T" })).toEqual([
        4010,
        "core.pairing.codeWrong",
      ]);
    }
    expect(await expectError(tablet, "session.pair", { code, name: "T" })).toEqual([
      4010,
      "core.pairing.codeExpired",
    ]);
  });

  it("il codice scade; sul disco resta solo l'impronta del token", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "cuelith-tokens-")), "stations.json");
    const tokens = new Tokens();
    await tokens.load(file);
    const t0 = 1_000_000;
    const { code } = tokens.startPairing("viewer", t0);
    await expect(tokens.redeem(code, "Tardi", t0 + PAIRING_CODE_MS + 1)).rejects.toMatchObject({
      message: "core.pairing.codeExpired",
    });
    const again = tokens.startPairing("viewer", t0);
    const { token, station } = await tokens.redeem(again.code, "  Schermo sala  ", t0 + 1000);
    expect(station.name).toBe("Schermo sala");
    expect(readFileSync(file, "utf8")).not.toContain(token);
    expect(tokens.resolve(token)).toMatchObject({ role: "viewer", local: false });

    // Dopo un riavvio la postazione entra ancora; revocata, non piu'.
    const reloaded = new Tokens();
    await reloaded.load(file);
    expect(reloaded.resolve(token)?.pairedId).toBe(station.id);
    expect(await reloaded.revoke(station.id)).toBe(true);
    expect(reloaded.resolve(token)).toBeUndefined();
    expect(await reloaded.revoke(station.id)).toBe(false);
  });

  it("revoca: la postazione viene scollegata e il suo token non vale piu'", async () => {
    const { ok, newcomer, local } = await start();
    const { code } = await ok("pairing.start", { role: "remote" });
    const phone = await newcomer();
    const paired = await expectOk(phone, "session.pair", { code, name: "Telefono" });
    await expectOk(phone, "session.auth", { token: paired.token });
    // Il telecomando fa solo avanti e indietro.
    expect((await expectError(phone, "show.rename", { name: "x" }))[0]).toBe(4030);
    expect((await ok("pairing.list", {})).stations).toMatchObject([
      { id: paired.clientId, name: "Telefono", role: "remote" },
    ]);

    await ok("session.revoke", { clientId: paired.clientId });
    await waitFor(() => phone.closed);
    expect((await ok("pairing.list", {})).stations).toEqual([]);
    const back = await newcomer();
    expect(await expectError(back, "session.auth", { token: paired.token })).toEqual([
      4010,
      "core.error.notPaired",
    ]);
    expect(await expectError(local, "session.revoke", { clientId: paired.clientId })).toEqual([
      4040,
      "core.error.stationNotFound",
    ]);
  });
});

describe("ascolto in rete", () => {
  const address = lanInterfaces()[0]?.address;

  it("di base il motore non ascolta in rete", async () => {
    const { engine } = await start();
    expect(engine.context.store.snapshot().live.network).toBeUndefined();
  });

  it.skipIf(address === undefined)(
    "acceso: ascolta sull'indirizzo scelto, rifiuta altri nomi, si spegne; la scelta resta",
    async () => {
      const lan = address ?? "";
      const { ok, engine, newcomer, data } = await start();
      expect((await ok("network.interfaces", {})).interfaces.map((i) => i.address)).toContain(lan);
      await ok("network.set", { enabled: true, address: lan });
      const network = engine.context.store.snapshot().live.network;
      expect(network).toMatchObject({ enabled: true, address: lan });
      const port = network?.port ?? 0;
      expect(network?.urls).toEqual([`http://${lan}:${String(port)}/`]);

      // La postazione in rete arriva da li' e si abbina.
      const tablet = await newcomer(`${lan}:${String(port)}`);
      const { code } = await ok("pairing.start", { role: "operator" });
      const paired = await expectOk(tablet, "session.pair", { code, name: "Tablet" });
      await expectOk(tablet, "session.auth", { token: paired.token });

      // Stesso indirizzo ma con un altro nome nell'intestazione Host: rifiutato.
      const status = await new Promise<number>((resolve, reject) => {
        request(
          { host: lan, port, path: "/", headers: { host: "sito-malevolo.example:80" } },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        )
          .on("error", reject)
          .end();
      });
      expect(status).toBe(403);
      const page = await fetch(`http://${lan}:${String(port)}/`);
      expect(page.status).toBe(200);

      // Riavvio: la rete riparte da sola e la postazione entra col suo token.
      await engine.stop();
      engines.splice(engines.indexOf(engine), 1);
      const second = await start(data);
      const reopened = second.engine.context.store.snapshot().live.network;
      expect(reopened).toMatchObject({ enabled: true, address: lan });
      const again = await second.newcomer(`${lan}:${String(reopened?.port ?? 0)}`);
      expect((await expectOk(again, "session.auth", { token: paired.token })).role).toBe(
        "operator",
      );

      await second.ok("network.set", { enabled: false });
      expect(second.engine.context.store.snapshot().live.network).toBeUndefined();
      await expect(fetch(`http://${lan}:${String(reopened?.port ?? 0)}/`)).rejects.toThrow();
    },
  );

  it("un indirizzo che il computer non ha viene rifiutato", async () => {
    const { local } = await start();
    expect(
      await expectError(local, "network.set", { enabled: true, address: "203.0.113.7" }),
    ).toEqual([4220, "core.network.addressMissing"]);
  });
});
