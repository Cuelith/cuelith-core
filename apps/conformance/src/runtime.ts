import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger, startEngine, type Engine } from "@cuelith-core/engine";
import {
  PROTOCOL_VERSION,
  rpcRequest,
  type InstalledPlugin,
  type PluginManifest,
  type RpcResponse,
} from "@cuelith/protocol";
import WebSocket from "ws";
import { Collector, type CheckOptions } from "./types.js";

/** Collegamento minimo al motore: richieste con risposta. */
class Client {
  readonly #ws: WebSocket;
  readonly #pending = new Map<number, (response: RpcResponse) => void>();
  #next = 1;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.on("message", (data) => {
      const raw = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Buffer.concat(data as Buffer[]).toString("utf8");
      const message = JSON.parse(raw) as { id?: unknown };
      if (typeof message.id === "number") {
        this.#pending.get(message.id)?.(message as RpcResponse);
        this.#pending.delete(message.id);
      }
    });
  }

  static async connect(port: number): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/rpc`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => {
        resolve();
      });
      ws.once("error", reject);
    });
    return new Client(ws);
  }

  call(method: string, params?: unknown): Promise<RpcResponse> {
    const id = this.#next++;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#ws.send(JSON.stringify(rpcRequest(id, method, params)));
    });
  }

  async ok(method: string, params?: unknown): Promise<unknown> {
    const response = await this.call(method, params);
    if ("error" in response) throw new Error(`${method}: ${response.error.message}`);
    return response.result;
  }

  close(): void {
    this.#ws.close();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const begin = Date.now();
  while (!(await check())) {
    if (Date.now() - begin > timeoutMs) return false;
    await sleep(40);
  }
  return true;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prove con il motore vero: installa il plugin, lo accende, controlla che resti su,
 * che risorga dopo un arresto brusco e che si fermi pulito. `dir` e' la cartella
 * gia' estratta del plugin.
 */
export async function checkRuntime(
  dir: string,
  manifest: PluginManifest,
  options: CheckOptions,
  out: Collector,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "cuelith-conformance-engine-"));
  const client = join(root, "client");
  const ui = join(root, "ui");
  mkdirSync(join(client, "assets"), { recursive: true });
  mkdirSync(ui, { recursive: true });
  writeFileSync(join(client, "index.html"), "<!doctype html><title>station</title>");
  writeFileSync(join(ui, "tokens.css"), ":root{}");

  let engine: Engine | undefined;
  let rpc: Client | undefined;
  const id = manifest.id;
  try {
    out.ran("engine-start");
    engine = await startEngine({
      version: options.coreVersion,
      port: 0,
      paths: { client, ui, bundledPlugins: [], data: join(root, "data") },
      lanPort: 0,
      announce: false,
      displays: { list: () => [] },
      logger: silentLogger,
    });
    rpc = await Client.connect(engine.port);
    await rpc.ok("session.hello", {
      protocol: PROTOCOL_VERSION,
      client: { name: "conformance", kind: "client" },
    });
    await rpc.ok("session.auth", { token: engine.tokens.station });

    const status = async (): Promise<InstalledPlugin | undefined> => {
      const list = (await rpc?.ok("plugin.list", {})) as { plugins: InstalledPlugin[] };
      return list.plugins.find((p) => p.manifest.id === id);
    };

    // --- installazione dal motore vero ---
    out.ran("install");
    const installed = await rpc.call("plugin.install", { path: dir });
    if ("error" in installed) {
      out.add({
        id: "install",
        level: "error",
        message: `The engine refuses to install the plugin: ${installed.error.message}.`,
        fix: "Run the static checks above first: the same rules apply.",
      });
      return;
    }

    // --- pannelli e testi raggiungibili come li serve il motore ---
    out.ran("served-files");
    const served = [manifest.ui?.entry, manifest.icon].filter(
      (path): path is string => path !== undefined,
    );
    for (const path of served) {
      const response = await fetch(
        `http://127.0.0.1:${String(engine.port)}/plugins/${id}/${manifest.version}/${path}`,
      );
      if (response.status !== 200) {
        out.add({
          id: "served-files",
          level: "error",
          message: `The engine serves "${path}" with status ${String(response.status)}.`,
          fix: "Check the path in the manifest and that the file is in the package.",
          file: path,
        });
      } else if (
        path === manifest.ui?.entry &&
        !(response.headers.get("content-security-policy") ?? "").includes("default-src 'self'")
      ) {
        out.add({
          id: "served-files",
          level: "error",
          message: "The panel is served without the isolation policy.",
          file: path,
        });
      }
    }

    if (manifest.runtime.type === "none") {
      out.ran("activation");
      const entry = await status();
      if (entry === undefined || entry.status.state === "crashed") {
        out.add({
          id: "activation",
          level: "error",
          message: "A data-only plugin should install without errors.",
        });
      }
      return;
    }

    // --- attivazione ---
    out.ran("activation");
    await rpc.ok("plugin.enable", { pluginId: id }).catch(() => undefined);
    const active = await until(async () => (await status())?.status.state === "active", 20_000);
    if (!active) {
      const entry = await status();
      out.add({
        id: "activation",
        level: "error",
        message: `The plugin did not become active (state: ${entry?.status.state ?? "unknown"}${entry?.status.error === undefined ? "" : `, error: ${entry.status.error}`}). It must answer plugin.activate within a few seconds.`,
        fix: "Use the SDK runPlugin() (it answers the engine for you) and do not start slow work before it. If you do not use the SDK, answer plugin.activate and plugin.ping with a JSON-RPC result on stdout.",
      });
      return;
    }
    const firstPid = engine.context.supervisor.pid(id);

    // --- stabilita': non deve cadere da solo ---
    out.ran("stability");
    const seconds = options.stableSeconds ?? 3;
    const stable = !(await until(
      async () => (await status())?.status.state !== "active",
      seconds * 1000,
    ));
    if (!stable) {
      out.add({
        id: "stability",
        level: "error",
        message: `The plugin did not stay active for ${String(seconds)} seconds on its own (it crashed or stopped).`,
        fix: "Look at its error output: run it with the same permissions and handle unexpected errors without exiting.",
      });
      return;
    }

    // --- risorge dopo un arresto brusco ---
    out.ran("recovery");
    if (firstPid !== undefined) {
      process.kill(firstPid, "SIGKILL");
      const back = await until(async () => {
        const pid = engine?.context.supervisor.pid(id);
        return (await status())?.status.state === "active" && pid !== undefined && pid !== firstPid;
      }, 20_000);
      if (!back) {
        out.add({
          id: "recovery",
          level: "error",
          message: "After a sudden kill the plugin did not come back by itself.",
          fix: "It must start cleanly every time, with no leftover lock files or state that prevent a restart.",
        });
        return;
      }
    }

    // --- si ferma pulito e riparte ---
    out.ran("clean-stop");
    const pid = engine.context.supervisor.pid(id);
    const begin = Date.now();
    await rpc.ok("plugin.disable", { pluginId: id });
    const stopped = await until(async () => (await status())?.status.state === "disabled", 15_000);
    const gone = pid === undefined ? true : await until(() => !alive(pid), 15_000);
    if (!stopped || !gone) {
      out.add({
        id: "clean-stop",
        level: "error",
        message: "When disabled, the plugin did not stop (or its process is still running).",
        fix: "Answer plugin.deactivate and exit. Close timers, sockets and child processes.",
      });
    } else if (Date.now() - begin > 4000) {
      out.add({
        id: "clean-stop",
        level: "warning",
        message: `The plugin took ${String(Math.round((Date.now() - begin) / 1000))} s to stop: the engine had to force it.`,
        fix: "Exit quickly after plugin.deactivate.",
      });
    }

    out.ran("re-enable");
    await rpc.ok("plugin.enable", { pluginId: id });
    if (!(await until(async () => (await status())?.status.state === "active", 20_000))) {
      out.add({
        id: "re-enable",
        level: "error",
        message: "After being disabled and enabled again the plugin did not become active.",
      });
    }
  } catch (error) {
    out.add({
      id: "engine-start",
      level: "error",
      message: `The runtime check could not complete: ${error instanceof Error ? error.message : String(error)}.`,
    });
  } finally {
    rpc?.close();
    await engine?.stop().catch(() => undefined);
  }
}
