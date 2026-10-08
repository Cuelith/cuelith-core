import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_VERSION,
  REGISTRY_INDEX_URL,
  REGISTRY_INDEX_V2_URL,
  type EngineMethodName,
  type EngineMethodParams,
  type RegistryPlugin,
} from "@cuelith/protocol";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type { Engine } from "../src/index.js";
import { sha256Hex } from "../src/modules/package.js";
import { FakeNotary, FakeSecrets, NOTARY_URL } from "./license-helpers.js";
import { expectError, expectOk, startTestEngine, TestClient } from "./helpers.js";

// Plugin a pagamento dal marketplace al riavvio (decisione 0013), via RPC come
// farebbe la postazione: indice 2 con ripiego sull'indice 1, installazione solo
// con licenza, partenza solo con licenza valida, rinnovo e revoca.

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 6, 10);
const PAID = "acme.lyrics-pro";
const FREE = "acme.gratis";
const KEY = "38b1460a-5104-4067-a91d-77b872934d51";
const CHECKOUT = "https://acme.lemonsqueezy.com/checkout/buy/abc?aff=cuelith";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function manifest(id: string, version: string) {
  return {
    id,
    name: `Plugin ${id}`,
    description: "Plugin di prova.",
    version,
    publisher: "Acme",
    license: "Proprietaria",
    repository: `https://github.com/acme/${id}`,
    family: "function",
    engines: { cuelith: "^0.1.0", protocol: `^${PROTOCOL_VERSION}` },
    runtime: { type: "none" },
    permissions: [],
    dependencies: {},
    extends: [],
    provides: [],
    contributes: {},
  };
}

function cpkg(id: string, version: string): Uint8Array {
  return zipSync({
    "cuelith-plugin.json": strToU8(JSON.stringify(manifest(id, version))),
  });
}

/** Rete finta: i due indici del marketplace, i pacchetti e il Notaio. */
class World {
  readonly notary = new FakeNotary();
  readonly packages = new Map<string, Uint8Array>();
  plugins: RegistryPlugin[] = [];
  /** L'indice 2 è pubblicato? Se no, risponde 404 e vale solo l'indice 1. */
  index2 = true;
  online = true;

  publish(id: string, version: string, paid: boolean) {
    const data = cpkg(id, version);
    const url = `https://downloads.acme.example/${id}-${version}.cpkg`;
    this.packages.set(url, data);
    this.plugins.push({
      id,
      name: `Plugin ${id}`,
      description: "Plugin di prova.",
      publisher: "Acme",
      license: "Proprietaria",
      repository: `https://github.com/acme/${id}`,
      family: "function",
      verified: false,
      access: paid ? "paid" : "free",
      ...(paid
        ? {
            price: "9 €",
            checkoutUrl: CHECKOUT,
            licensing: { provider: "lemonsqueezy" as const, storeId: 12345, productId: 67890 },
          }
        : {}),
      versions: [
        {
          version,
          engines: { cuelith: "^0.1.0", protocol: `^${PROTOCOL_VERSION}` },
          url,
          sha256: sha256Hex(data),
          size: data.byteLength,
          permissions: [],
          published: "2026-10-06T10:00:00.000Z",
        },
      ],
    });
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!this.online) throw new Error("offline");
    if (url.startsWith(`${NOTARY_URL}/`)) return this.notary.fetch(url, init);
    if (url === REGISTRY_INDEX_V2_URL) {
      if (!this.index2) return new Response("", { status: 404 });
      return Response.json({
        schema: 2,
        generatedAt: "2026-10-06T10:00:00.000Z",
        plugins: this.plugins,
      });
    }
    if (url === REGISTRY_INDEX_URL) {
      // L'indice 1 non ha mai plugin a pagamento né campi nuovi.
      const legacy = this.plugins
        .filter((p) => p.access === "free")
        .map(({ access: _a, ...rest }) => rest);
      return Response.json({ schema: 1, generatedAt: "2026-10-06T10:00:00.000Z", plugins: legacy });
    }
    const data = this.packages.get(url);
    return data === undefined ? new Response("", { status: 404 }) : new Response(data);
  };
}

const running: { engine: Engine; client: TestClient }[] = [];
afterEach(async () => {
  for (const { engine, client } of running.splice(0)) {
    await client.close();
    await engine.stop();
  }
});

async function boot(
  world: World,
  options: { data?: string; secrets?: FakeSecrets; now?: () => number; tick?: boolean } = {},
) {
  const engine = await startTestEngine({
    ...(options.data === undefined ? {} : { data: options.data }),
    fetch: world.fetch,
    secrets: options.secrets ?? new FakeSecrets(),
    licenseUrl: NOTARY_URL,
    notaryKeys: { n1: world.notary.keys.publicKey },
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.tick === true
      ? { licenseTimings: { firstTickMs: 20, tickMs: 40, deferMs: 20 } }
      : {}),
  });
  const client = await TestClient.connect(engine);
  await client.login(engine.tokens.station);
  running.push({ engine, client });
  const ok = <N extends EngineMethodName>(method: N, params: EngineMethodParams<N>) =>
    expectOk(client, method, params);
  const fails = async (method: EngineMethodName, params: unknown) => {
    const [code, message] = await expectError(client, method, params);
    return { code, message };
  };
  const plugin = async (id: string) =>
    (await ok("plugin.list", {})).plugins.find((p) => p.manifest.id === id);
  return { engine, client, ok, fails, plugin };
}

function world(): World {
  const w = new World();
  w.publish(PAID, "1.0.0", true);
  w.publish(FREE, "1.0.0", false);
  return w;
}
const folder = () => mkdtempSync(join(tmpdir(), "cuelith-flow-"));

describe("marketplace con plugin a pagamento", () => {
  it("legge l'indice 2: i plugin a pagamento hanno prezzo e acquisto; i gratuiti restano gratuiti", async () => {
    const w = world();
    const { ok } = await boot(w);
    const { plugins, source } = await ok("registry.list", {});
    expect(source).toBe("network");
    const paid = plugins.find((p) => p.id === PAID);
    expect(paid?.access).toBe("paid");
    expect(paid?.price).toBe("9 €");
    expect(paid?.checkoutUrl).toBe(CHECKOUT);
    expect(plugins.find((p) => p.id === FREE)?.access).toBe("free");
  });

  it("finché l'indice 2 non è pubblicato usa l'indice 1: solo i gratuiti, e funziona lo stesso", async () => {
    const w = world();
    w.index2 = false;
    const { ok } = await boot(w);
    const { plugins, source } = await ok("registry.list", {});
    expect(source).toBe("network");
    expect(plugins.map((p) => p.id)).toEqual([FREE]);
    expect(plugins[0]?.access).toBe("free");
  });

  it("un plugin gratuito si installa come prima, senza licenza", async () => {
    const { ok, plugin } = await boot(world());
    await ok("plugin.installFromRegistry", { id: FREE });
    expect((await plugin(FREE))?.status.state).toBe("active");
    expect(await ok("license.list", {})).toEqual({ available: true, licenses: [] });
  });
});

describe("installare un plugin a pagamento", () => {
  it("senza licenza non si installa; con la licenza sì, e parte", async () => {
    const w = world();
    const data = folder();
    const { ok, fails, plugin } = await boot(w, { data, now: () => START });
    const refused = await fails("plugin.installFromRegistry", { id: PAID });
    expect(refused.message).toBe("core.error.licenseRequired");
    expect(await plugin(PAID)).toBeUndefined();

    const status = await ok("license.activate", { pluginId: PAID, licenseKey: KEY });
    expect(status.state).toBe("active");
    await ok("plugin.installFromRegistry", { id: PAID });
    expect((await plugin(PAID))?.status.state).toBe("active");
    expect(JSON.parse(readFileSync(join(data, "plugins", "installed.json"), "utf8"))).toMatchObject(
      {
        installed: { [PAID]: { licensed: true, source: "registry" } },
      },
    );
    const list = await ok("license.list", {});
    expect(list.licenses.map((l) => `${l.pluginId}:${l.state}`)).toEqual([`${PAID}:active`]);
    // La chiave di licenza non esce mai verso le postazioni.
    expect(JSON.stringify(list)).not.toContain(KEY);
  });

  it("attivare la licenza di un plugin non a pagamento o sconosciuto non ha senso", async () => {
    const { fails } = await boot(world());
    for (const pluginId of [FREE, "acme.sconosciuto"]) {
      const error = await fails("license.activate", { pluginId, licenseKey: KEY });
      expect(error.message).toBe("core.error.licenseNotPaid");
    }
  });

  it("gli errori del Notaio arrivano alla postazione come chiavi tradotte", async () => {
    const w = world();
    const { fails } = await boot(w);
    w.notary.invalid.add(KEY);
    expect((await fails("license.activate", { pluginId: PAID, licenseKey: KEY })).message).toBe(
      "core.error.licenseInvalidKey",
    );
    w.notary.invalid.clear();
    w.notary.limit = 0;
    expect((await fails("license.activate", { pluginId: PAID, licenseKey: KEY })).message).toBe(
      "core.error.licenseLimit",
    );
    w.notary.limit = 3;
    w.online = false;
    const registryDown = await fails("license.activate", { pluginId: PAID, licenseKey: KEY });
    expect(registryDown.message).toMatch(/^core\.error\.license/);
  });

  it("senza custodia del sistema niente licenze", async () => {
    const secrets = new FakeSecrets();
    secrets.available = false;
    const { ok, fails } = await boot(world(), { secrets });
    expect(await ok("license.list", {})).toEqual({ available: false, licenses: [] });
    expect((await fails("license.activate", { pluginId: PAID, licenseKey: KEY })).message).toBe(
      "core.error.licenseNoSecretStore",
    );
  });
});

describe("riavvio, scadenza e revoca", () => {
  async function installed(w: World, data: string, secrets: FakeSecrets) {
    const first = await boot(w, { data, secrets, now: () => START });
    await first.ok("license.activate", { pluginId: PAID, licenseKey: KEY });
    await first.ok("plugin.installFromRegistry", { id: PAID });
    await first.client.close();
    await first.engine.stop();
    running.pop();
  }

  it("dopo un riavvio senza internet il plugin parte con il suo permesso", async () => {
    const w = world();
    const data = folder();
    const secrets = new FakeSecrets();
    await installed(w, data, secrets);
    w.online = false;
    const { plugin } = await boot(w, { data, secrets, now: () => START + 5 * DAY });
    expect((await plugin(PAID))?.status.state).toBe("active");
  });

  it("dopo i 90 giorni senza rinnovo il plugin non parte e dice perché; la licenza resta riattivabile", async () => {
    const w = world();
    const data = folder();
    const secrets = new FakeSecrets();
    await installed(w, data, secrets);
    w.online = false;
    const { plugin, ok } = await boot(w, { data, secrets, now: () => START + 100 * DAY });
    const status = (await plugin(PAID))?.status;
    expect(status?.state).toBe("disabled");
    expect(status?.error).toBe("core.license.expired");
    // Il plugin resta installato: tornata la rete, "verifica ora" lo rimette in piedi.
    w.online = true;
    w.notary.clock = () => START + 100 * DAY;
    const renewed = await ok("license.refresh", { pluginId: PAID });
    expect(renewed.state).toBe("active");
    expect((await plugin(PAID))?.status.state).toBe("active");
  });

  it("senza licenza (mai attivata su questo computer) un plugin a pagamento installato non parte", async () => {
    const w = world();
    const data = folder();
    await installed(w, data, new FakeSecrets());
    // Un altro utente del sistema: la custodia non decifra il caveau.
    const { plugin } = await boot(w, { data, secrets: new FakeSecrets(), now: () => START });
    const status = (await plugin(PAID))?.status;
    expect(status?.state).toBe("disabled");
    expect(status?.error).toBe("core.license.needed");
  });

  it("un rimborso: al controllo in background il plugin si spegne da solo e dice perché", async () => {
    const w = world();
    // Il Notaio finto firma con l'ora del sistema: qui il tempo parte da START, come nel resto della prova.
    w.notary.clock = () => START;
    const data = folder();
    const secrets = new FakeSecrets();
    await installed(w, data, secrets);
    w.notary.revoked.add(KEY);
    // Siamo al giorno 31: il programma prova a rinnovare, il fornitore dice «revocata».
    const { plugin } = await boot(w, { data, secrets, now: () => START + 31 * DAY, tick: true });
    expect((await plugin(PAID))?.status.state).toBe("active");
    // Si aspetta l'esito, non un istante fisso: dipende da quanto e' carica la macchina.
    for (let i = 0; i < 40 && (await plugin(PAID))?.status.state !== "disabled"; i += 1) {
      await sleep(100);
    }
    const status = (await plugin(PAID))?.status;
    expect(status?.state).toBe("disabled");
    expect(status?.error).toBe("core.license.revoked");
  });

  it("disattivare libera il posto e il plugin si ferma", async () => {
    const w = world();
    const { ok, plugin } = await boot(w, { now: () => START });
    await ok("license.activate", { pluginId: PAID, licenseKey: KEY });
    await ok("plugin.installFromRegistry", { id: PAID });
    expect(w.notary.seats.size).toBe(1);
    await ok("license.deactivate", { pluginId: PAID });
    expect(w.notary.seats.size).toBe(0);
    const status = (await plugin(PAID))?.status;
    expect(status?.state).toBe("disabled");
    expect(status?.error).toBe("core.license.needed");
  });

  it("reinstallare da file lo stesso plugin non toglie il vincolo della licenza", async () => {
    const w = world();
    const data = folder();
    const { ok, plugin } = await boot(w, { data, now: () => START });
    await ok("license.activate", { pluginId: PAID, licenseKey: KEY });
    await ok("plugin.installFromRegistry", { id: PAID });
    await ok("license.deactivate", { pluginId: PAID });
    // Il pacchetto è pubblico: reinstallarlo da file con lo stesso id non aggira il controllo del nucleo.
    const file = join(folder(), "copia.cpkg");
    writeFileSync(file, cpkg(PAID, "1.0.1"));
    await ok("plugin.install", { path: file });
    expect((await plugin(PAID))?.status.state).toBe("disabled");
    expect(
      (
        JSON.parse(readFileSync(join(data, "plugins", "installed.json"), "utf8")) as {
          installed: Record<string, { licensed?: boolean }>;
        }
      ).installed[PAID]?.licensed,
    ).toBe(true);
  });
});
