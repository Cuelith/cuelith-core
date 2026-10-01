import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EngineMethods,
  PROTOCOL_VERSION,
  type EngineMethodName,
  type EngineMethodParams,
  type EngineMethodResult,
  rpcRequest,
  type RpcNotification,
  type RpcResponse,
} from "@cuelith/protocol";
import WebSocket from "ws";
import { silentLogger, startEngine, type Engine } from "../src/index.js";
import type { SupervisorTimings } from "../src/modules/supervisor.js";

const here = dirname(fileURLToPath(import.meta.url));
/** Il modulo lingua vero, dal repo affiancato. */
export const LOCALE_IT_DIR = resolve(here, "../../../../plugin-locale-it");

export interface TestEngineOptions {
  /** Cartella dati da riusare (per simulare un riavvio). */
  readonly data?: string;
  readonly autosaveIntervalMs?: number;
  /** Rete finta per il marketplace. */
  readonly fetch?: typeof fetch;
  /** Tempi dei processi dei moduli (riavvii, risposte) accorciati per le prove. */
  readonly moduleTimings?: Partial<SupervisorTimings>;
}

export async function startTestEngine(options: TestEngineOptions = {}): Promise<Engine> {
  const root = mkdtempSync(join(tmpdir(), "cuelith-engine-"));
  const client = join(root, "client");
  const ui = join(root, "ui");
  mkdirSync(join(client, "assets"), { recursive: true });
  mkdirSync(ui, { recursive: true });
  writeFileSync(join(client, "index.html"), "<!doctype html><title>postazione</title>");
  writeFileSync(join(client, "assets", "app.js"), "console.log(1)");
  writeFileSync(join(root, "segreto.txt"), "non deve uscire");
  writeFileSync(join(ui, "tokens.css"), ":root{}");
  return startEngine({
    version: "0.1.0",
    port: 0,
    paths: {
      client,
      ui,
      bundledPlugins: [LOCALE_IT_DIR],
      data: options.data ?? join(root, "data"),
    },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.moduleTimings === undefined ? {} : { moduleTimings: options.moduleTimings }),
    ...(options.autosaveIntervalMs === undefined
      ? {}
      : { autosaveIntervalMs: options.autosaveIntervalMs }),
    displays: {
      list: () => [
        {
          id: "1",
          label: "Integrato",
          primary: true,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          scaleFactor: 1,
        },
      ],
    },
    logger: silentLogger,
  });
}

/** Client RPC minimo per i test: richieste con risposta e notifiche raccolte. */
export class TestClient {
  readonly notifications: RpcNotification[] = [];
  readonly #ws: WebSocket;
  readonly #pending = new Map<number, (response: RpcResponse) => void>();
  #next = 1;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.on("message", (data) => {
      const raw = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Buffer.concat(data as Buffer[]).toString("utf8");
      const message = JSON.parse(raw) as RpcResponse | RpcNotification;
      if ("id" in message && typeof message.id === "number") {
        this.#pending.get(message.id)?.(message);
        this.#pending.delete(message.id);
      } else if ("method" in message) {
        this.notifications.push(message);
      }
    });
  }

  static async connect(engine: Engine, origin?: string): Promise<TestClient> {
    const ws = new WebSocket(
      `ws://127.0.0.1:${engine.port}/rpc`,
      origin === undefined ? {} : { origin },
    );
    await new Promise<void>((resolveOpen, reject) => {
      ws.once("open", () => {
        resolveOpen();
      });
      ws.once("error", reject);
    });
    return new TestClient(ws);
  }

  call(method: string, params?: unknown): Promise<RpcResponse> {
    const id = this.#next++;
    return new Promise((resolveCall) => {
      this.#pending.set(id, resolveCall);
      this.#ws.send(JSON.stringify(rpcRequest(id, method, params)));
    });
  }

  async login(token: string, name = "Postazione di prova"): Promise<void> {
    await this.call("session.hello", {
      protocol: PROTOCOL_VERSION,
      client: { name, kind: "client" },
    });
    const auth = await this.call("session.auth", { token });
    if ("error" in auth) throw new Error(JSON.stringify(auth.error));
  }

  close(): Promise<void> {
    if (this.#ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolveClose) => {
      this.#ws.once("close", () => {
        resolveClose();
      });
      this.#ws.close();
    });
  }
}

export async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("condizione non verificata in tempo");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Chiamata che deve riuscire; il risultato e' validato con lo schema del protocollo. */
export async function expectOk<N extends EngineMethodName>(
  client: TestClient,
  method: N,
  params: EngineMethodParams<N>,
): Promise<EngineMethodResult<N>> {
  const response = await client.call(method, params);
  if ("error" in response) throw new Error(`${method}: ${JSON.stringify(response.error)}`);
  return EngineMethods[method].result.parse(response.result) as EngineMethodResult<N>;
}

/** Chiamata che deve fallire: restituisce [codice, chiave del messaggio]. */
export async function expectError(
  client: TestClient,
  method: EngineMethodName,
  params: unknown,
): Promise<[number, string]> {
  const response = await client.call(method, params);
  if (!("error" in response)) throw new Error(`${method} doveva fallire`);
  return [response.error.code, response.error.message];
}
