import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newId,
  PROTOCOL_VERSION,
  type EngineMethodName,
  type EngineMethodParams,
  type RegistryPlugin,
} from "@cuelith/protocol";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type { Engine } from "../src/index.js";
import { sha256Hex } from "../src/modules/package.js";
import {
  expectError,
  expectOk,
  startTestEngine,
  TestClient,
  type TestEngineOptions,
} from "./helpers.js";

const REGISTRY = "https://cuelith.github.io/cuelith-registry/index.json";
const folder = () => mkdtempSync(join(tmpdir(), "cuelith-modules-"));

/** Manifest di un modulo di prova di soli dati, con le sue traduzioni. */
function manifest(id: string, version: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Modulo ${id}`,
    description: "Modulo di prova.",
    version,
    publisher: "Prove",
    license: "Apache-2.0",
    repository: `https://github.com/Cuelith/${id}`,
    family: "function",
    engines: { cuelith: "^0.1.0", protocol: `^${PROTOCOL_VERSION}` },
    runtime: { type: "none" },
    permissions: [],
    dependencies: {},
    extends: [],
    provides: [],
    contributes: { locales: [{ lang: "it", file: "locales/it.json" }] },
    ...extra,
  };
}

function cpkg(files: Record<string, unknown>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, value]) => [
        name,
        strToU8(typeof value === "string" ? value : JSON.stringify(value)),
      ]),
    ),
  );
}

function greetings(version: string, text = "Ciao"): Uint8Array {
  return cpkg({
    "cuelith-plugin.json": manifest("cuelith.greetings", version),
    "locales/it.json": { "cuelith.greetings.hello": text },
  });
}

/** Rete finta: l'indice e i pacchetti pubblicati. */
class FakeNet {
  readonly packages = new Map<string, Uint8Array>();
  plugins: RegistryPlugin[] = [];
  online = true;

  publish(
    id: string,
    version: string,
    data: Uint8Array,
    engines = { cuelith: "^0.1.0", protocol: `^${PROTOCOL_VERSION}` },
  ) {
    const url = `https://github.com/Cuelith/${id}/releases/download/v${version}/${id}-${version}.cpkg`;
    this.packages.set(url, data);
    const entry = {
      version,
      engines,
      url,
      sha256: sha256Hex(data),
      size: data.byteLength,
      permissions: [],
      published: "2026-09-30T10:00:00.000Z",
    };
    const existing = this.plugins.find((p) => p.id === id);
    if (existing !== undefined) existing.versions.unshift(entry);
    else {
      this.plugins.push({
        id,
        name: `Modulo ${id}`,
        description: "Modulo di prova.",
        publisher: "Prove",
        license: "Apache-2.0",
        repository: `https://github.com/Cuelith/${id}`,
        family: "function",
        verified: true,
        versions: [entry],
      });
    }
    return entry;
  }

  readonly fetch: typeof fetch = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!this.online) return Promise.reject(new Error("offline"));
    if (url === REGISTRY) {
      return Promise.resolve(
        Response.json({
          schema: 1,
          generatedAt: "2026-09-30T10:00:00.000Z",
          plugins: this.plugins,
        }),
      );
    }
    const data = this.packages.get(url);
    return Promise.resolve(
      data === undefined ? new Response("", { status: 404 }) : new Response(data),
    );
  };
}

const running: { engine: Engine; client: TestClient }[] = [];

async function start(net: FakeNet, options: TestEngineOptions = {}) {
  const engine = await startTestEngine({ ...options, fetch: net.fetch });
  const client = await TestClient.connect(engine);
  await client.login(engine.tokens.station);
  running.push({ engine, client });
  const ok = <N extends EngineMethodName>(method: N, params: EngineMethodParams<N>) =>
    expectOk(client, method, params);
  const fails = (method: EngineMethodName, params: unknown) => expectError(client, method, params);
  const plugin = async (id: string) =>
    (await ok("plugin.list", {})).plugins.find((p) => p.manifest.id === id);
  const hello = async () =>
    (await ok("locale.catalog", { lang: "it" })).catalog["cuelith.greetings.hello"];
  return { engine, ok, fails, plugin, hello };
}

async function stop(): Promise<void> {
  for (const { engine, client } of running.splice(0)) {
    await client.close();
    await engine.stop();
  }
}

afterEach(stop);

describe("marketplace", () => {
  it("mostra solo le versioni compatibili; senza internet usa l'ultima copia", async () => {
    const net = new FakeNet();
    net.publish("cuelith.greetings", "1.0.0", greetings("1.0.0"));
    net.publish("cuelith.future", "1.0.0", greetings("1.0.0"), {
      cuelith: "^9.0.0",
      protocol: "^1.0.0",
    });
    const { ok } = await start(net);
    const online = await ok("registry.list", { refresh: true });
    expect(online.source).toBe("network");
    expect(online.plugins.map((p) => p.id)).toEqual(["cuelith.greetings"]);
    net.online = false;
    const offline = await ok("registry.list", { refresh: true });
    expect(offline).toMatchObject({ source: "cache", plugins: [{ id: "cuelith.greetings" }] });
  });

  it("senza internet e senza copia: elenco vuoto, nessun errore", async () => {
    const net = new FakeNet();
    net.online = false;
    const { ok } = await start(net);
    expect(await ok("registry.list", {})).toEqual({ plugins: [], source: "none" });
  });
});

describe("installazione", () => {
  it("scarica, verifica, installa e attiva senza riavvio; le traduzioni arrivano subito", async () => {
    const net = new FakeNet();
    net.publish("cuelith.greetings", "1.0.0", greetings("1.0.0"));
    const data = folder();
    const { ok, plugin, hello, engine } = await start(net, { data });
    expect(await ok("plugin.installFromRegistry", { id: "cuelith.greetings" })).toEqual({
      id: "cuelith.greetings",
      version: "1.0.0",
    });
    expect(await plugin("cuelith.greetings")).toMatchObject({
      enabled: true,
      source: "registry",
      bundled: false,
      status: { state: "active" },
    });
    expect(await hello()).toBe("Ciao");
    expect(engine.context.store.snapshot().live.plugins).toContainEqual({
      id: "cuelith.greetings",
      version: "1.0.0",
      state: "active",
    });
    expect(
      existsSync(join(data, "plugins", "cuelith.greetings", "1.0.0", "cuelith-plugin.json")),
    ).toBe(true);
  });

  it("rifiuta un pacchetto con impronta diversa da quella del registry", async () => {
    const net = new FakeNet();
    const entry = net.publish("cuelith.greetings", "1.0.0", greetings("1.0.0"));
    net.packages.set(entry.url, greetings("1.0.0", "Manomesso"));
    const { fails, plugin } = await start(net);
    expect(await fails("plugin.installFromRegistry", { id: "cuelith.greetings" })).toEqual([
      4220,
      "core.error.packageHashMismatch",
    ]);
    expect(await plugin("cuelith.greetings")).toBeUndefined();
  });

  it("uno zip che prova a uscire dalla cartella non scrive nulla fuori", async () => {
    const net = new FakeNet();
    net.publish(
      "cuelith.greetings",
      "1.0.0",
      cpkg({
        "cuelith-plugin.json": manifest("cuelith.greetings", "1.0.0"),
        "../../fuori.txt": "x",
      }),
    );
    const data = folder();
    const { fails } = await start(net, { data });
    const [code, key] = await fails("plugin.installFromRegistry", { id: "cuelith.greetings" });
    expect([code, key]).toEqual([4220, "core.error.packageUnsafePath"]);
    expect(existsSync(join(data, "fuori.txt"))).toBe(false);
    expect(readdirSync(join(data, "plugins")).filter((n) => !n.startsWith("."))).toEqual([]);
  });

  it("un pacchetto senza manifest o con manifest non valido non si installa", async () => {
    const net = new FakeNet();
    net.publish("cuelith.greetings", "1.0.0", cpkg({ "leggimi.txt": "ciao" }));
    net.publish("cuelith.bad", "1.0.0", cpkg({ "cuelith-plugin.json": { id: "cuelith.bad" } }));
    const { fails } = await start(net);
    expect(await fails("plugin.installFromRegistry", { id: "cuelith.greetings" })).toEqual([
      4220,
      "core.error.packageNoManifest",
    ]);
    expect(await fails("plugin.installFromRegistry", { id: "cuelith.bad" })).toEqual([
      4220,
      "core.module.manifestInvalid",
    ]);
  });

  it("aggiornando si tiene la versione precedente, non quelle piu' vecchie", async () => {
    const net = new FakeNet();
    const data = folder();
    const { ok, hello } = await start(net, { data });
    for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
      net.publish("cuelith.greetings", version, greetings(version, `Ciao ${version}`));
      await ok("plugin.installFromRegistry", { id: "cuelith.greetings" });
    }
    expect(await hello()).toBe("Ciao 1.2.0");
    expect(readdirSync(join(data, "plugins", "cuelith.greetings")).sort()).toEqual([
      "1.1.0",
      "1.2.0",
    ]);
  });

  it("si installa anche da un file .cpkg o da una cartella del computer", async () => {
    const net = new FakeNet();
    const { ok, plugin } = await start(net);
    const dir = folder();
    const file = join(dir, "greetings.cpkg");
    writeFileSync(file, greetings("2.0.0"));
    await ok("plugin.install", { path: file });
    expect(await plugin("cuelith.greetings")).toMatchObject({
      source: "local",
      manifest: { version: "2.0.0" },
    });

    const source = join(dir, "sorgente");
    mkdirSync(join(source, "locales"), { recursive: true });
    writeFileSync(
      join(source, "cuelith-plugin.json"),
      JSON.stringify(manifest("cuelith.other", "0.1.0")),
    );
    writeFileSync(join(source, "locales", "it.json"), JSON.stringify({ "cuelith.other.x": "x" }));
    await ok("plugin.install", { path: source });
    expect(await plugin("cuelith.other")).toMatchObject({ source: "local" });
  });
});

describe("attiva, disattiva, disinstalla", () => {
  it("disattivare toglie il modulo senza disinstallarlo; riattivarlo lo rimette", async () => {
    const net = new FakeNet();
    net.publish("cuelith.greetings", "1.0.0", greetings("1.0.0"));
    const { ok, plugin, hello } = await start(net);
    await ok("plugin.installFromRegistry", { id: "cuelith.greetings" });
    await ok("plugin.disable", { pluginId: "cuelith.greetings" });
    expect(await plugin("cuelith.greetings")).toMatchObject({
      enabled: false,
      status: { state: "disabled" },
    });
    expect(await hello()).toBeUndefined();
    await ok("plugin.enable", { pluginId: "cuelith.greetings" });
    expect(await hello()).toBe("Ciao");
    await ok("plugin.uninstall", { pluginId: "cuelith.greetings" });
    expect(await plugin("cuelith.greetings")).toBeUndefined();
  });

  it("l'unica lingua non si spegne; il modulo preinstallato non si disinstalla", async () => {
    const net = new FakeNet();
    const { fails } = await start(net);
    expect(await fails("plugin.disable", { pluginId: "cuelith.locale.it" })).toEqual([
      4220,
      "core.error.moduleRequired",
    ]);
    expect(await fails("plugin.uninstall", { pluginId: "cuelith.locale.it" })).toEqual([
      4220,
      "core.error.moduleBundled",
    ]);
  });

  it("con una seconda lingua l'italiano si puo' spegnere e il motore passa all'altra", async () => {
    const net = new FakeNet();
    net.publish(
      "cuelith.locale.en",
      "0.1.0",
      cpkg({
        "cuelith-plugin.json": manifest("cuelith.locale.en", "0.1.0", {
          family: "locale",
          contributes: { locales: [{ lang: "en", file: "locales/en.json", name: "English" }] },
        }),
        "locales/en.json": { "core.mode.present": "Present" },
      }),
    );
    const { ok, engine } = await start(net);
    await ok("plugin.installFromRegistry", { id: "cuelith.locale.en" });
    expect((await ok("locale.list", {})).langs.map((l) => l.lang).sort()).toEqual(["en", "it"]);
    await ok("plugin.disable", { pluginId: "cuelith.locale.it" });
    expect((await ok("locale.list", {})).active).toBe("en");
    expect(engine.context.locales.t("core.mode.present")).toBe("Present");
  });

  it("installazioni e scelte restano dopo un riavvio", async () => {
    const net = new FakeNet();
    net.publish("cuelith.greetings", "1.0.0", greetings("1.0.0"));
    const data = folder();
    const first = await start(net, { data });
    await first.ok("plugin.installFromRegistry", { id: "cuelith.greetings" });
    await first.ok("plugin.disable", { pluginId: "cuelith.greetings" });
    await stop();

    const second = await start(net, { data });
    expect(await second.plugin("cuelith.greetings")).toMatchObject({
      enabled: false,
      source: "registry",
    });
  });

  it("un modulo con codice si installa ma parte solo col passo 9b", async () => {
    const net = new FakeNet();
    net.publish(
      "cuelith.coded",
      "1.0.0",
      cpkg({
        "cuelith-plugin.json": manifest("cuelith.coded", "1.0.0", {
          runtime: { type: "node", entry: "dist/index.js" },
          contributes: {},
        }),
        "dist/index.js": "export {}",
      }),
    );
    const { ok, plugin } = await start(net);
    await ok("plugin.installFromRegistry", { id: "cuelith.coded" });
    expect(await plugin("cuelith.coded")).toMatchObject({
      enabled: true,
      status: { state: "installed", error: "core.module.runtimeNotYet" },
    });
  });
});

describe("file dei moduli", () => {
  it("si servono solo dalla cartella del modulo in uso, isolati", async () => {
    const net = new FakeNet();
    net.publish(
      "cuelith.greetings",
      "1.0.0",
      cpkg({
        "cuelith-plugin.json": manifest("cuelith.greetings", "1.0.0"),
        "locales/it.json": { "cuelith.greetings.hello": "Ciao" },
        "guide/passo1.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
      }),
    );
    const { ok, engine } = await start(net);
    await ok("plugin.installFromRegistry", { id: "cuelith.greetings" });
    const base = `http://127.0.0.1:${String(engine.port)}/plugins/cuelith.greetings`;
    const image = await fetch(`${base}/1.0.0/guide/passo1.svg`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-security-policy")).toContain("sandbox");
    // I pannelli isolati possono leggere i file del modulo; le pagine della postazione no.
    expect(image.headers.get("access-control-allow-origin")).toBe("*");
    const station = await fetch(`http://127.0.0.1:${String(engine.port)}/`);
    expect(station.headers.get("access-control-allow-origin")).toBeNull();
    expect((await fetch(`${base}/9.9.9/guide/passo1.svg`)).status).toBe(404);
    expect((await fetch(`${base}/1.0.0/..%2F..%2Finstalled.json`)).status).toBe(404);
  });
});

describe("elementi dei moduli", () => {
  function cardModule(): Uint8Array {
    return cpkg({
      "cuelith-plugin.json": manifest("cuelith.greetings", "1.2.0", {
        contributes: {
          itemTypes: [{ id: "card", title: "cuelith.greetings.card" }],
          locales: [{ lang: "it", file: "locales/it.json" }],
        },
      }),
      "locales/it.json": { "cuelith.greetings.card": "Biglietto" },
    });
  }

  it("un elemento di un modulo entra nello show e lo show dichiara il modulo", async () => {
    const net = new FakeNet();
    net.publish("cuelith.greetings", "1.2.0", cardModule());
    const { ok, fails, engine } = await start(net);
    expect(await fails("item.create", { type: "cuelith.greetings.card", title: "x" })).toEqual([
      4220,
      "core.error.itemTypeUnknown",
    ]);
    await ok("plugin.installFromRegistry", { id: "cuelith.greetings" });
    const { id } = await ok("item.create", { type: "cuelith.greetings.card", title: "Benvenuti" });
    const show = engine.context.store.snapshot().show;
    expect(show.items[id]?.type).toBe("cuelith.greetings.card");
    expect(show.plugins).toEqual({ "cuelith.greetings": "^1.2.0" });
  });

  it("nelle librerie si filtra per tipo, e dalla libreria allo show il modulo si dichiara", async () => {
    const net = new FakeNet();
    net.publish("cuelith.greetings", "1.2.0", cardModule());
    const { ok, engine } = await start(net);
    await ok("plugin.installFromRegistry", { id: "cuelith.greetings" });
    const item = (type: string, title: string) => ({
      id: newId(),
      type,
      title,
      slides: [{ id: newId(), fields: { text: { kind: "text" as const, value: title } } }],
      meta: {},
    });
    const card = item("cuelith.greetings.card", "Biglietto");
    await ok("library.saveItem", { item: card });
    await ok("library.saveItem", { item: item("core.text", "Testo") });
    const cards = await ok("library.items", { type: "cuelith.greetings.card" });
    expect(cards.items.map((i) => i.title)).toEqual(["Biglietto"]);
    await ok("playlist.addFromLibrary", { itemId: card.id });
    expect(engine.context.store.snapshot().show.plugins).toEqual({ "cuelith.greetings": "^1.2.0" });
  });
});
