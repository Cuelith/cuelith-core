import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineMethodName, EngineMethodParams } from "@cuelith/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { Engine } from "../src/index.js";
import { expectOk, startTestEngine, TestClient, type TestEngineOptions } from "./helpers.js";

// Processi dei moduli (passo 9b, cap. 21, 24 e 27). Il modulo di prova parla
// il protocollo a mano, senza SDK, come potrebbe fare un modulo di terzi in
// qualunque linguaggio: e' il contratto del motore che si prova qui.

const FIXTURE = String.raw`
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import net from "node:net";

const mode = readFileSync(new URL("./mode.txt", import.meta.url), "utf8").trim();
const out = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
let next = 1000;
const pending = new Map();
const call = (method, params) =>
  new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    out({ id, method, params });
  });
const attempt = (fn) => { try { fn(); return "permesso"; } catch (e) { return "bloccato " + e.code; } };
let ctx;
const events = [];
const commands = {
  info: () => ({ dataDir: ctx.dataDir, permissions: ctx.permissions, pid: process.pid }),
  crash: () => process.exit(3),
  hang: () => new Promise(() => undefined),
  read: ({ path }) => attempt(() => readFileSync(path)),
  writeOwn: () => attempt(() => writeFileSync(ctx.dataDir + "/prova.txt", "x")),
  writeElsewhere: ({ path }) => attempt(() => writeFileSync(path, "x")),
  spawn: () => attempt(() => execSync("echo ciao")),
  net: ({ host }) => attempt(() => net.connect(9, host).on("error", () => undefined).destroy()),
  server: () => attempt(() => net.createServer().listen(0).close()),
  engine: async ({ method, params }) => {
    try { return { result: await call(method, params) }; } catch (error) { return { error }; }
  },
  emit: ({ name }) => { out({ method: "event.emit", params: { name, payload: { n: 1 } } }); return null; },
  events: () => events,
  log: () => { console.log("riga sullo stdout fuori protocollo"); return "scritto"; },
};
createInterface({ input: process.stdin }).on("line", async (line) => {
  const m = JSON.parse(line);
  if (m.method === undefined) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(m.error); else p.resolve(m.result);
    return;
  }
  if (m.method === "event") { events.push(m.params); return; }
  if (m.id === undefined) return;
  const reply = (result) => out({ id: m.id, result });
  switch (m.method) {
    case "plugin.activate":
      ctx = m.params.context;
      if (mode !== "hang-activate") reply({});
      break;
    case "plugin.ping":
      if (mode !== "hang-ping") reply({});
      break;
    case "plugin.deactivate":
      reply({});
      setImmediate(() => process.exit(0));
      break;
    case "command.execute": {
      const { command, params } = m.params;
      reply({ result: (await commands[command](params ?? {})) ?? null });
      break;
    }
  }
});
`;

const ID = "cuelith.fixture";
// Processi veri da avviare e fermare: sotto carico (prove in parallelo) servono
// piu' dei 5 s predefiniti per prova.

function fixture(
  options: { permissions?: string[]; mode?: string; id?: string; extra?: object } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "cuelith-fixture-"));
  const id = options.id ?? ID;
  writeFileSync(
    join(dir, "cuelith-plugin.json"),
    JSON.stringify({
      id,
      name: "Modulo di prova",
      version: "1.0.0",
      publisher: "Cuelith",
      license: "Apache-2.0",
      repository: "https://github.com/Cuelith/plugin-fixture",
      family: "integration",
      engines: { cuelith: "^0.1.0", protocol: "^1.8.0" },
      runtime: { type: "node", entry: "main.mjs" },
      permissions: options.permissions ?? [],
      dependencies: {},
      extends: [],
      provides: [],
      contributes: {
        commands: [
          "info",
          "crash",
          "hang",
          "read",
          "writeOwn",
          "writeElsewhere",
          "spawn",
          "net",
          "server",
          "engine",
          "emit",
          "events",
          "log",
        ].map((c) => ({ id: c, title: `${id}.command.${c}` })),
        events: ["greeted"],
      },
      ...options.extra,
    }),
  );
  writeFileSync(join(dir, "main.mjs"), FIXTURE);
  writeFileSync(join(dir, "mode.txt"), options.mode ?? "");
  return dir;
}

const FAST: NonNullable<TestEngineOptions["moduleTimings"]> = {
  responseMs: 1500,
  pingMs: 60_000,
  restartDelayMs: 20,
};

const running: { engine: Engine; client: TestClient }[] = [];

async function start(timings = FAST) {
  const data = mkdtempSync(join(tmpdir(), "cuelith-processes-"));
  const engine = await startTestEngine({ data, moduleTimings: timings });
  const client = await TestClient.connect(engine);
  await client.login(engine.tokens.station);
  running.push({ engine, client });
  const ok = <N extends EngineMethodName>(method: N, params: EngineMethodParams<N>) =>
    expectOk(client, method, params);
  const status = async (id = ID) =>
    (await ok("plugin.list", {})).plugins.find((p) => p.manifest.id === id)?.status;
  const until = async (check: () => Promise<boolean>, timeoutMs = 8000) => {
    const begin = Date.now();
    while (!(await check())) {
      if (Date.now() - begin > timeoutMs) throw new Error("condizione non verificata in tempo");
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const active = (id = ID) => until(async () => (await status(id))?.state === "active");
  const command = (name: string, params: Record<string, unknown> = {}, pluginId = ID) =>
    client.call("plugin.command", { pluginId, command: name, params });
  const result = async (name: string, params: Record<string, unknown> = {}, pluginId = ID) =>
    (await ok("plugin.command", { pluginId, command: name, params })).result;
  const install = async (dir: string) => {
    await ok("plugin.install", { path: dir });
  };
  return { engine, client, data, ok, status, until, active, command, result, install };
}

afterEach(async () => {
  for (const { engine, client } of running.splice(0)) {
    await client.close();
    await engine.stop();
  }
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("processo del modulo", { timeout: 30_000 }, () => {
  it("parte nel suo processo, esegue i comandi e si ferma quando lo si spegne", async () => {
    const { install, active, result, ok, status, until, engine, data } = await start();
    await install(fixture());
    await active();
    const info = (await result("info")) as { dataDir: string; pid: number };
    expect(info.dataDir).toBe(join(data, "plugin-data", ID));
    expect(info.pid).toBe(engine.context.supervisor.pid(ID));
    expect(info.pid).not.toBe(process.pid);

    // Righe scritte fuori protocollo non rompono nulla.
    expect(await result("log")).toBe("scritto");

    await ok("plugin.disable", { pluginId: ID });
    await until(async () => (await status())?.state === "disabled");
    await until(() => Promise.resolve(!alive(info.pid)));
    await ok("plugin.enable", { pluginId: ID });
    await active();
    expect(engine.context.supervisor.pid(ID)).not.toBe(info.pid);
  });

  it("si ferma insieme al motore", async () => {
    const { install, active, engine } = await start();
    await install(fixture());
    await active();
    const pid = engine.context.supervisor.pid(ID) ?? 0;
    expect(alive(pid)).toBe(true);
    const index = running.findIndex((r) => r.engine === engine);
    const [{ client }] = running.splice(index, 1) as [{ engine: Engine; client: TestClient }];
    await client.close();
    await engine.stop();
    expect(alive(pid)).toBe(false);
  });
});

describe("permessi (cap. 27)", { timeout: 30_000 }, () => {
  it("senza permessi: niente file fuori dalla sua cartella, niente programmi, niente rete", async () => {
    const { install, active, result, data } = await start();
    const secret = join(tmpdir(), `cuelith-segreto-${String(Date.now())}.txt`);
    writeFileSync(secret, "segreto");
    await install(fixture());
    await active();
    expect(await result("read", { path: secret })).toBe("bloccato ERR_ACCESS_DENIED");
    expect(await result("writeElsewhere", { path: `${secret}.copia` })).toBe(
      "bloccato ERR_ACCESS_DENIED",
    );
    expect(await result("writeOwn")).toBe("permesso");
    expect(existsSync(join(data, "plugin-data", ID, "prova.txt"))).toBe(true);
    expect(await result("spawn")).toBe("bloccato ERR_ACCESS_DENIED");
    expect(await result("net", { host: "example.com" })).toBe("bloccato ERR_ACCESS_DENIED");
    expect(await result("net", { host: "127.0.0.1" })).toBe("bloccato ERR_ACCESS_DENIED");
    expect(await result("server")).toBe("bloccato ERR_ACCESS_DENIED");
  });

  it("network:<host> apre solo quell'host (e i sottodomini); fs:read e process aprono il resto", async () => {
    const { install, active, result } = await start();
    const secret = join(tmpdir(), `cuelith-segreto-${String(Date.now())}.txt`);
    writeFileSync(secret, "segreto");
    await install(fixture({ permissions: ["network:example.org", "fs:read", "process"] }));
    await active();
    expect(await result("net", { host: "api.example.org" })).toBe("permesso");
    expect(await result("net", { host: "example.org" })).toBe("permesso");
    expect(await result("net", { host: "example.com" })).toBe("bloccato ERR_ACCESS_DENIED");
    expect(await result("server")).toBe("bloccato ERR_ACCESS_DENIED");
    expect(await result("read", { path: secret })).toBe("permesso");
    expect(await result("spawn")).toBe("permesso");
  });

  it("lo spazio dati richiede il permesso storage e resta su disco", async () => {
    const first = await start();
    await first.install(fixture());
    await first.active();
    expect(
      await first.result("engine", { method: "storage.set", params: { key: "k", value: 1 } }),
    ).toMatchObject({ error: { code: 4030, message: "core.error.permissionMissing" } });

    const { install, active, result, data } = await start();
    await install(fixture({ permissions: ["storage"] }));
    await active();
    expect(
      await result("engine", { method: "storage.set", params: { key: "saluti", value: [1, 2] } }),
    ).toEqual({ result: {} });
    expect(await result("engine", { method: "storage.get", params: { key: "saluti" } })).toEqual({
      result: { found: true, value: [1, 2] },
    });
    expect(await result("engine", { method: "storage.get", params: { key: "altro" } })).toEqual({
      result: { found: false },
    });
    expect(JSON.parse(readFileSync(join(data, "plugin-data", ID, "storage.json"), "utf8"))).toEqual(
      { saluti: [1, 2] },
    );
  });

  it("il ruolo del modulo: regia si', amministrazione e sessione no", async () => {
    const { install, active, result } = await start();
    await install(fixture());
    await active();
    expect(await result("engine", { method: "display.list", params: {} })).not.toHaveProperty(
      "error",
    );
    expect(
      await result("engine", { method: "plugin.install", params: { path: "/x" } }),
    ).toMatchObject({ error: { code: 4030 } });
    expect(
      await result("engine", {
        method: "session.auth",
        params: { token: "x".repeat(40) },
      }),
    ).toMatchObject({ error: { code: 4030 } });
    // I comandi di altri moduli solo se ne dipende.
    expect(
      await result("engine", {
        method: "plugin.command",
        params: { pluginId: "cuelith.altro", command: "info" },
      }),
    ).toMatchObject({ error: { code: 4030 } });
  });
});

describe("crash e blocchi (cap. 24)", { timeout: 30_000 }, () => {
  it("riavvia fino a 3 volte in 60 secondi, poi resta spento finche' non lo si riaccende", async () => {
    const { install, active, command, status, until, ok, engine } = await start();
    await install(fixture());
    await active();
    const pids = new Set<number | undefined>();
    for (let i = 0; i < 3; i++) {
      pids.add(engine.context.supervisor.pid(ID));
      expect(await command("crash")).toMatchObject({ error: { code: 5030 } });
      await active();
    }
    pids.add(engine.context.supervisor.pid(ID));
    expect(pids.size).toBe(4);

    expect(await command("crash")).toMatchObject({ error: { code: 5030 } });
    await until(async () => (await status())?.error === "core.module.crashedTooOften");
    expect(await status()).toMatchObject({ state: "crashed" });
    await new Promise((r) => setTimeout(r, 200));
    expect(await status()).toMatchObject({ state: "crashed" });
    expect(await command("info")).toMatchObject({
      error: { code: 5030, message: "core.error.pluginNotActive" },
    });

    await ok("plugin.disable", { pluginId: ID });
    await ok("plugin.enable", { pluginId: ID });
    await active();
  });

  it("un comando che non risponde entro il tempo massimo: 5040, processo terminato e riavviato", async () => {
    const { install, active, command, engine, until } = await start();
    await install(fixture());
    await active();
    const pid = engine.context.supervisor.pid(ID);
    expect(await command("hang")).toMatchObject({
      error: { code: 5040, message: "core.error.pluginTimeout" },
    });
    // Terminato e ripartito con un altro processo.
    await until(() => Promise.resolve(engine.context.supervisor.pid(ID) !== pid));
    await active();
  });

  it("un modulo che smette di rispondere ai controlli viene terminato e riavviato", async () => {
    const { install, active, until, engine } = await start({
      ...FAST,
      responseMs: 300,
      pingMs: 100,
    });
    await install(fixture({ mode: "hang-ping" }));
    await active();
    const pid = engine.context.supervisor.pid(ID) ?? 0;
    await until(() => Promise.resolve(!alive(pid)));
  });

  it("un'attivazione che non risponde finisce in errore senza bloccare il motore", async () => {
    const { install, status, until, ok } = await start({ ...FAST, responseMs: 200 });
    await install(fixture({ mode: "hang-activate" }));
    await until(async () => (await status())?.error === "core.module.crashedTooOften");
    // Il motore intanto risponde.
    expect((await ok("display.list", {})).displays).toHaveLength(1);
  });

  it("un eseguibile mancante si segnala subito, senza riavvii", async () => {
    const { install, status, until } = await start();
    const dir = fixture({ extra: { runtime: { type: "node", entry: "manca.mjs" } } });
    await install(dir);
    await until(async () => (await status())?.error === "core.module.entryMissing");
    expect(await status()).toMatchObject({ state: "crashed" });
  });
});

describe("eventi", { timeout: 30_000 }, () => {
  it("il modulo riceve gli eventi del nucleo e i propri, solo quelli a cui si iscrive", async () => {
    const { install, active, result, ok } = await start();
    await install(fixture());
    await active();
    expect(
      await result("engine", {
        method: "events.subscribe",
        params: { names: ["core.show.opened", `${ID}.greeted`, `${ID}.segreto`] },
      }),
    ).toEqual({ result: {} });

    await ok("show.new", { name: "Culto di domenica" });
    await result("emit", { name: "greeted" });
    await result("emit", { name: "segreto" });
    // Un ultimo comando: gli eventi precedenti sono gia' arrivati.
    const events = (await result("events")) as { name: string; payload: unknown }[];
    expect(events).toEqual([
      { name: "core.show.opened", payload: { name: "Culto di domenica" } },
      { name: `${ID}.greeted`, payload: { n: 1 } },
    ]);
  });
});

describe("risorse (protocollo 1.9)", { timeout: 30_000 }, () => {
  it("system.resources: motore, moduli attivi col consumo dichiarato, computer e semaforo", async () => {
    const { install, active, ok } = await start();
    await install(
      fixture({
        extra: {
          resources: { memoryMB: { idle: 40, peak: 200 }, cpuPercent: { idle: 1, peak: 50 } },
        },
      }),
    );
    await active();
    const report = await ok("system.resources", {});
    expect(report.system.cpuCores).toBeGreaterThan(0);
    expect(report.system.memoryTotalMB).toBeGreaterThan(0);
    expect(report.parts.find((p) => p.id === "core.engine")?.current?.memoryMB).toBeGreaterThan(0);
    expect(report.parts.find((p) => p.id === ID)).toMatchObject({
      kind: "module",
      name: "Modulo di prova",
      declared: { memoryMB: { idle: 40, peak: 200 } },
    });
    expect(report.totals.max.memoryMB).toBeGreaterThanOrEqual(report.totals.current.memoryMB);
    expect(["ok", "warning", "danger"]).toContain(report.level);
  });
});
