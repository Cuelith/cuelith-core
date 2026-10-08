import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineMethodName, EngineMethodParams, PluginManifest } from "@cuelith/protocol";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type { Engine } from "../src/index.js";
import { acceptsSetting, PluginSettings, type SettingDef } from "../src/modules/settings.js";
import { expectError, expectOk, startTestEngine, TestClient } from "./helpers.js";

const ID = "cuelith.settingsdemo";

const settings = [
  { key: "greeting", title: `${ID}.s.greeting`, type: "string", default: "Ciao" },
  { key: "size", title: `${ID}.s.size`, type: "number", default: 40, min: 10, max: 100 },
  { key: "on", title: `${ID}.s.on`, type: "boolean", default: true },
  {
    key: "mode",
    title: `${ID}.s.mode`,
    type: "string",
    default: "a",
    choices: [
      { value: "a", title: `${ID}.s.mode.a` },
      { value: "b", title: `${ID}.s.mode.b` },
    ],
  },
  { key: "nodefault", title: `${ID}.s.nodefault`, type: "string" },
] as const;

/** Un plugin di soli dati con cinque impostazioni. */
function pluginPackage(version: string, extra: object[] = []): Uint8Array {
  const manifest = {
    id: ID,
    name: "Prove delle impostazioni",
    version,
    publisher: "Cuelith",
    license: "Apache-2.0",
    repository: "https://github.com/Cuelith/plugin-settings-demo",
    family: "function",
    engines: { cuelith: ">=0.1.0 <1.0.0", protocol: "^1.4.0" },
    runtime: { type: "none" },
    permissions: [],
    dependencies: {},
    extends: [],
    provides: [],
    contributes: {
      locales: [{ lang: "it", file: "locales/it.json" }],
      settings: [...settings, ...extra],
    },
  };
  return zipSync({
    "cuelith-plugin.json": strToU8(JSON.stringify(manifest)),
    "locales/it.json": strToU8(JSON.stringify({ [`${ID}.s.greeting`]: "Saluto" })),
  });
}

const running: { engine: Engine; client: TestClient }[] = [];
afterEach(async () => {
  for (const { engine, client } of running.splice(0)) {
    await client.close();
    await engine.stop();
  }
});

async function boot(data: string) {
  const engine = await startTestEngine({ data });
  const client = await TestClient.connect(engine);
  await client.login(engine.tokens.station);
  running.push({ engine, client });
  const ok = <N extends EngineMethodName>(method: N, params: EngineMethodParams<N>) =>
    expectOk(client, method, params);
  return { engine, client, ok };
}

const folder = () => mkdtempSync(join(tmpdir(), "cuelith-settings-"));

describe("controllo dei valori", () => {
  const def = (extra: object): SettingDef =>
    ({ key: "x", title: `${ID}.s.x`, ...extra }) as unknown as SettingDef;

  it("tipo, limiti e scelte", () => {
    expect(acceptsSetting(def({ type: "string" }), "ok")).toBe(true);
    expect(acceptsSetting(def({ type: "string" }), 3)).toBe(false);
    expect(acceptsSetting(def({ type: "string" }), "x".repeat(2001))).toBe(false);
    expect(acceptsSetting(def({ type: "number", min: 1, max: 5 }), 5)).toBe(true);
    expect(acceptsSetting(def({ type: "number", min: 1, max: 5 }), 6)).toBe(false);
    expect(acceptsSetting(def({ type: "number" }), Number.NaN)).toBe(false);
    expect(acceptsSetting(def({ type: "boolean" }), false)).toBe(true);
    const choices = [
      { value: "a", title: `${ID}.s.a` },
      { value: "b", title: `${ID}.s.b` },
    ];
    expect(acceptsSetting(def({ type: "string", choices }), "b")).toBe(true);
    expect(acceptsSetting(def({ type: "string", choices }), "z")).toBe(false);
  });
});

describe("archivio delle scelte", () => {
  const manifest = {
    id: ID,
    contributes: { settings },
  } as unknown as Pick<PluginManifest, "id" | "contributes">;

  it("senza scelte valgono i predefiniti; una chiave senza predefinito non c'e'", async () => {
    const store = new PluginSettings(join(folder(), "s.json"));
    await store.load();
    expect(store.effective(manifest)).toEqual({ greeting: "Ciao", size: 40, on: true, mode: "a" });
  });

  it("le scelte si conservano, anche dopo un riavvio, e null le toglie", async () => {
    const file = join(folder(), "s.json");
    const store = new PluginSettings(file);
    await store.load();
    expect(await store.set(manifest, { size: 70, nodefault: "x" })).toMatchObject({
      size: 70,
      nodefault: "x",
    });
    const again = new PluginSettings(file);
    await again.load();
    expect(again.effective(manifest)).toMatchObject({ size: 70, nodefault: "x" });
    expect(await again.set(manifest, { size: null, nodefault: null })).toEqual({
      greeting: "Ciao",
      size: 40,
      on: true,
      mode: "a",
    });
    // Senza scelte il file non tiene tracce del plugin.
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({});
  });

  it("un valore sbagliato o una chiave inesistente non cambia niente", async () => {
    const store = new PluginSettings(join(folder(), "s.json"));
    await store.load();
    await expect(store.set(manifest, { size: 70, mode: "z" })).rejects.toMatchObject({
      message: "core.error.settingInvalid",
    });
    await expect(store.set(manifest, { nope: 1 })).rejects.toMatchObject({
      message: "core.error.settingUnknown",
    });
    expect(store.effective(manifest).size).toBe(40);
  });

  it("una scelta che non vale piu' dopo un aggiornamento si ignora", async () => {
    const file = join(folder(), "s.json");
    writeFileSync(file, JSON.stringify({ [ID]: { size: 500, mode: "z", on: "si", extra: 1 } }));
    const store = new PluginSettings(file);
    await store.load();
    expect(store.effective(manifest)).toEqual({ greeting: "Ciao", size: 40, on: true, mode: "a" });
  });

  it("un file rovinato non impedisce di partire", async () => {
    const file = join(folder(), "s.json");
    writeFileSync(file, "{ non e' json");
    const store = new PluginSettings(file);
    await store.load();
    expect(store.effective(manifest).size).toBe(40);
  });
});

describe("comandi pluginsettings", () => {
  it("get e set passano dal motore, restano al riavvio e si ripuliscono con null", async () => {
    const data = folder();
    const { client, ok } = await boot(data);
    const file = join(folder(), "demo.cpkg");
    writeFileSync(file, pluginPackage("1.0.0"));
    await ok("plugin.install", { path: file });

    expect((await ok("pluginsettings.get", { pluginId: ID })).values).toMatchObject({
      size: 40,
      mode: "a",
    });
    await ok("pluginsettings.set", { pluginId: ID, values: { size: 80, mode: "b" } });
    expect((await ok("pluginsettings.get", { pluginId: ID })).values).toMatchObject({
      size: 80,
      mode: "b",
    });

    expect(
      await expectError(client, "pluginsettings.set", { pluginId: ID, values: { size: 5 } }),
    ).toEqual([4220, "core.error.settingInvalid"]);
    expect(
      await expectError(client, "pluginsettings.get", { pluginId: "cuelith.nonesiste" }),
    ).toEqual([4040, "core.error.moduleNotFound"]);

    // Riavvio del motore: le scelte restano.
    await client.close();
    await running.pop()?.engine.stop();
    const second = await boot(data);
    expect((await second.ok("pluginsettings.get", { pluginId: ID })).values).toMatchObject({
      size: 80,
      mode: "b",
    });
    await second.ok("pluginsettings.set", { pluginId: ID, values: { size: null } });
    expect((await second.ok("pluginsettings.get", { pluginId: ID })).values.size).toBe(40);
  });
});
