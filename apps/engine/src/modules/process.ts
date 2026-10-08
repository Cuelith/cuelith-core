import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import {
  ErrorCode,
  RpcError,
  type RpcErrorObject,
  type RpcId,
  type RpcRequest,
  type RpcResponse,
} from "@cuelith/protocol";
import type { Logger } from "../log.js";
import type { SessionTransport } from "../rpc/session.js";
import type { SpawnSpec } from "./sandbox.js";

/** Una riga del protocollo non puo' superare questa misura: oltre, il modulo sbaglia. */
const MAX_LINE = 8 * 1024 * 1024;
/** Righe di stderr tenute per spiegare un crash. */
const STDERR_LINES = 20;

export interface ModuleProcessEvents {
  /** Richiesta del modulo al motore (gia' come JSON-RPC). */
  onRequest(request: RpcRequest): Promise<RpcResponse>;
  onNotification(method: string, params: unknown): void;
  /** Il processo e' finito (da solo, per errore o perche' terminato). */
  onExit(code: number | null, signal: string | null): void;
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/**
 * Il processo di un modulo e il suo canale JSON-RPC su stdio (cap. 21): una
 * riga JSON per messaggio, in entrambe le direzioni. stderr finisce nel log
 * del motore. Nulla di cio' che fa il processo puo' far cadere il motore: le
 * righe sbagliate si scartano, quelle troppo lunghe terminano il processo.
 */
export class ModuleProcess {
  readonly #child: ChildProcess;
  readonly #pending = new Map<RpcId, Pending>();
  readonly #logger: Logger;
  readonly #label: string;
  readonly #stderr: string[] = [];
  #nextId = 1;
  #exited = false;
  #queue: Promise<void> = Promise.resolve();

  constructor(spec: SpawnSpec, events: ModuleProcessEvents, logger: Logger, label: string) {
    this.#logger = logger;
    this.#label = label;
    this.#child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    if (spec.lowPriority === true && this.#child.pid !== undefined) {
      try {
        os.setPriority(this.#child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // Il sistema non lo permette: il plugin gira comunque, a priorita' normale.
      }
    }

    let buffer = "";
    this.#child.stdout?.setEncoding("utf8");
    this.#child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line !== "") this.#onLine(line, events);
        index = buffer.indexOf("\n");
      }
      if (buffer.length > MAX_LINE) {
        this.#logger.error(`modulo ${label}: riga del protocollo troppo lunga, processo terminato`);
        buffer = "";
        this.kill();
      }
    });

    let errBuffer = "";
    this.#child.stderr?.setEncoding("utf8");
    this.#child.stderr?.on("data", (chunk: string) => {
      errBuffer += chunk;
      const lines = errBuffer.split(/\r?\n/);
      errBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() === "") continue;
        this.#stderr.push(line);
        if (this.#stderr.length > STDERR_LINES) this.#stderr.shift();
        this.#logger.warn(`modulo ${label}: ${line}`);
      }
    });

    // Scrivere su un processo appena morto genera EPIPE: non e' un errore del motore.
    this.#child.stdin?.on("error", () => undefined);
    this.#child.on("error", (error) => {
      this.#logger.error(`modulo ${label}: impossibile avviare il processo`, error);
      this.#finish(events, null, null);
    });
    this.#child.on("exit", (code, signal) => {
      this.#finish(events, code, signal);
    });
  }

  get pid(): number | undefined {
    return this.#child.pid;
  }

  get exited(): boolean {
    return this.#exited;
  }

  /** Ultime righe scritte dal modulo su stderr (per il log di un crash). */
  get stderrTail(): readonly string[] {
    return this.#stderr;
  }

  /** Il canale verso il modulo, per la sessione che lo rappresenta nel motore. */
  get transport(): SessionTransport {
    return {
      send: (text) => {
        this.#write(text);
      },
      close: () => {
        this.kill();
      },
    };
  }

  #write(text: string): void {
    if (this.#exited) return;
    this.#child.stdin?.write(`${text}\n`);
  }

  #finish(events: ModuleProcessEvents, code: number | null, signal: string | null): void {
    if (this.#exited) return;
    this.#exited = true;
    for (const [, waiting] of this.#pending) {
      clearTimeout(waiting.timer);
      waiting.reject(new RpcError(ErrorCode.PluginNotActive, "core.error.pluginNotActive"));
    }
    this.#pending.clear();
    events.onExit(code, signal);
  }

  #onLine(line: string, events: ModuleProcessEvents): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.#logger.warn(`modulo ${this.#label}: riga non JSON scartata`);
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const message = parsed as {
      id?: RpcId | null;
      method?: unknown;
      params?: unknown;
      result?: unknown;
      error?: RpcErrorObject;
    };

    if (typeof message.method === "string") {
      if (message.id === undefined || message.id === null) {
        events.onNotification(message.method, message.params);
        return;
      }
      const request: RpcRequest = {
        jsonrpc: "2.0",
        id: message.id,
        method: message.method,
        ...(message.params === undefined ? {} : { params: message.params }),
      };
      // Come per le postazioni: le richieste di un modulo si eseguono in ordine.
      this.#queue = this.#queue
        .then(async () => {
          this.#write(JSON.stringify(await events.onRequest(request)));
        })
        .catch((error: unknown) => {
          this.#logger.error(`modulo ${this.#label}: errore gestendo una richiesta`, error);
        });
      return;
    }

    if (message.id === undefined || message.id === null) return;
    const waiting = this.#pending.get(message.id);
    if (waiting === undefined) return;
    this.#pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error !== undefined) {
      const { code, message: key, data } = message.error;
      waiting.reject(
        new RpcError(
          typeof code === "number" ? code : ErrorCode.InternalError,
          typeof key === "string" ? key : "core.error.internal",
          data?.params === undefined ? {} : { params: data.params },
        ),
      );
    } else waiting.resolve(message.result);
  }

  /**
   * Richiesta al modulo. Se non risponde entro `timeoutMs` si rifiuta con
   * PluginTimeout: chi chiama decide se il modulo e' bloccato.
   */
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.#exited) {
      return Promise.reject(new RpcError(ErrorCode.PluginNotActive, "core.error.pluginNotActive"));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new RpcError(ErrorCode.PluginTimeout, "core.error.pluginTimeout"));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  notify(method: string, params: unknown): void {
    this.#write(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  /** Chiude stdin: un modulo scritto con l'SDK esce da solo. */
  closeInput(): void {
    this.#child.stdin?.end();
  }

  kill(): void {
    if (this.#exited) return;
    this.#child.kill("SIGKILL");
  }

  /** Aspetta la fine del processo (al massimo `timeoutMs`, poi lo termina). */
  async waitExit(timeoutMs: number): Promise<void> {
    if (this.#exited) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.kill();
      }, timeoutMs);
      this.#child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      this.#child.once("error", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
