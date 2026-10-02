import {
  applyStatePatch,
  EngineMethods,
  ErrorCode,
  Notifications,
  StateDocumentSchema,
  type EngineMethodName,
  type EngineMethodResult,
  type RpcResponse,
} from "@cuelith/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Engine } from "../src/index.js";
import { startTestEngine, TestClient, waitFor } from "./helpers.js";

let engine: Engine;
const clients: TestClient[] = [];

beforeEach(async () => {
  engine = await startTestEngine();
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  await engine.stop();
});

async function connect(origin?: string): Promise<TestClient> {
  const client = await TestClient.connect(engine, origin);
  clients.push(client);
  return client;
}

function errorCode(response: RpcResponse): number | undefined {
  return "error" in response ? response.error.code : undefined;
}

/** Risultato di una chiamata, validato con lo schema del protocollo per quel metodo. */
function result<N extends EngineMethodName>(
  method: N,
  response: RpcResponse,
): EngineMethodResult<N> {
  if ("error" in response) throw new Error(JSON.stringify(response.error));
  return EngineMethods[method].result.parse(response.result) as EngineMethodResult<N>;
}

describe("HTTP", () => {
  const url = (path: string) => `http://127.0.0.1:${engine.port}${path}`;

  it("serve la postazione con una politica di sicurezza", async () => {
    const res = await fetch(url("/"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("postazione");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("torna alla pagina unica per i percorsi senza estensione e da' 404 per i file mancanti", async () => {
    expect((await fetch(url("/uscite/impostazioni"))).status).toBe(200);
    expect((await fetch(url("/assets/mancante.js"))).status).toBe(404);
  });

  it("non esce mai dalla cartella servita", async () => {
    for (const path of [
      "/../segreto.txt",
      "/%2e%2e/segreto.txt",
      "/ui/../../segreto.txt",
      "/%00",
    ]) {
      const res = await fetch(url(path));
      expect(await res.text()).not.toContain("non deve uscire");
    }
  });

  it("serve gli stili condivisi sotto /ui", async () => {
    expect((await fetch(url("/ui/tokens.css"))).status).toBe(200);
  });

  it("rifiuta metodi diversi da GET e HEAD", async () => {
    expect((await fetch(url("/"), { method: "POST" })).status).toBe(405);
  });
});

describe("sessione", () => {
  it("rifiuta connessioni da pagine web di altri siti", async () => {
    await expect(TestClient.connect(engine, "http://sito-malevolo.example")).rejects.toThrow();
  });

  it("accetta connessioni dalla pagina servita dal motore stesso", async () => {
    await expect(connect(`http://127.0.0.1:${engine.port}`)).resolves.toBeInstanceOf(TestClient);
  });

  it("richiede la presentazione prima di qualsiasi comando", async () => {
    const client = await connect();
    expect(errorCode(await client.call("state.subscribe"))).toBe(ErrorCode.InvalidRequest);
  });

  it("rifiuta un protocollo con versione maggiore diversa", async () => {
    const client = await connect();
    const response = await client.call("session.hello", {
      protocol: "2.0.0",
      client: { name: "x", kind: "client" },
    });
    expect(errorCode(response)).toBe(ErrorCode.ProtocolIncompatible);
  });

  it("senza accesso consente solo i comandi di sessione", async () => {
    const client = await connect();
    await client.call("session.hello", {
      protocol: "1.0.0",
      client: { name: "x", kind: "client" },
    });
    expect(errorCode(await client.call("state.subscribe"))).toBe(ErrorCode.NotPaired);
    expect(errorCode(await client.call("session.auth", { token: "x".repeat(43) }))).toBe(
      ErrorCode.NotPaired,
    );
  });

  it("risponde con errori precisi a metodi sconosciuti e parametri sbagliati", async () => {
    const client = await connect();
    await client.login(engine.tokens.station);
    expect(errorCode(await client.call("non.esiste"))).toBe(ErrorCode.MethodNotFound);
    expect(errorCode(await client.call("locale.catalog", { lang: 42 }))).toBe(
      ErrorCode.InvalidParameters,
    );
  });

  it("il renderer ha un ruolo di sola lettura", async () => {
    const client = await connect();
    await client.login(engine.tokens.renderer, "Uscita");
    expect(errorCode(await client.call("cue.next"))).toBe(ErrorCode.Forbidden);
    expect(errorCode(await client.call("state.subscribe"))).toBeUndefined();
  });
});

describe("stato", () => {
  it("parte con uno show valido in italiano, con i look Sala e Palco e la lingua attiva", async () => {
    const client = await connect();
    await client.login(engine.tokens.station);
    const { rev, state } = result("state.subscribe", await client.call("state.subscribe"));
    expect(StateDocumentSchema.safeParse(state).success).toBe(true);
    expect(state.show.name).toBe("Nuovo show");
    expect(
      Object.values(state.show.looks)
        .map((l) => l.name)
        .sort(),
    ).toEqual(["Palco", "Sala"]);
    expect(state.live.plugins).toContainEqual(
      expect.objectContaining({ id: "cuelith.locale.it", state: "active" }),
    );
    expect(state.live.clients).toHaveLength(1);
    expect(state.live.rev).toBe(rev);
  });

  it("distribuisce le patch in ordine e senza buchi, e chi le applica resta allineato", async () => {
    const watcher = await connect();
    await watcher.login(engine.tokens.station, "Regia");
    let { rev, state } = result("state.subscribe", await watcher.call("state.subscribe"));

    const other = await connect();
    await other.login(engine.tokens.station, "Seconda postazione");
    await other.close();

    await waitFor(() => watcher.notifications.length >= 2);
    for (const notification of watcher.notifications) {
      const patch = Notifications["state.patch"].parse(notification.params);
      expect(patch.rev).toBe(rev + 1);
      state = applyStatePatch(state, patch.ops);
      rev = patch.rev;
    }
    const fresh = result("state.subscribe", await watcher.call("state.subscribe")).state;
    expect(state).toEqual(fresh);
    expect(fresh.live.clients.map((c) => c.name)).toEqual(["Regia"]);
  });
});

describe("lingue e moduli", () => {
  it("elenca l'italiano e ne fornisce il catalogo", async () => {
    const client = await connect();
    await client.login(engine.tokens.station);
    const list = result("locale.list", await client.call("locale.list"));
    expect(list).toEqual({ langs: [{ lang: "it", name: "Italiano" }], active: "it" });
    const { catalog } = result(
      "locale.catalog",
      await client.call("locale.catalog", { lang: "it" }),
    );
    expect(catalog["core.mode.present"]).toBe("Presenta");
    expect(errorCode(await client.call("locale.catalog", { lang: "fr" }))).toBe(ErrorCode.NotFound);
  });

  it("segna la lingua come obbligatoria finche' e' l'unica", async () => {
    const client = await connect();
    await client.login(engine.tokens.station);
    const { plugins } = result("plugin.list", await client.call("plugin.list"));
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      manifest: { id: "cuelith.locale.it" },
      bundled: true,
      required: true,
    });
  });

  it("elenca i monitor dal fornitore", async () => {
    const client = await connect();
    await client.login(engine.tokens.station);
    const { displays } = result("display.list", await client.call("display.list"));
    expect(displays).toHaveLength(1);
  });
});
