import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  EngineMethods,
  ErrorCode,
  isEngineMethod,
  pluginRole,
  PROTOCOL_VERSION,
  rpcError,
  RpcError,
  rpcNotification,
  type Lang,
  type PluginState,
  type RpcRequest,
  type RpcResponse,
} from "@cuelith/protocol";
import type { Logger } from "../log.js";
import { Session } from "../rpc/session.js";
import type { StateStore } from "../state/store.js";
import { coreEvents, eventView, type EngineEvent, type EventView } from "./events.js";
import type { LoadedModule } from "./load.js";
import { ModuleProcess } from "./process.js";
import type { ModuleRegistry } from "./registry.js";
import {
  defaultNodeRuntime,
  networkGuardSource,
  spawnSpec,
  SpawnError,
  type NodeRuntime,
} from "./sandbox.js";
import { ModuleStorage } from "./storage.js";

/** Regole del cap. 24, sostituibili solo nelle prove. */
export interface SupervisorTimings {
  /** Tempo massimo di risposta del modulo (5 s). */
  readonly responseMs: number;
  /** Ogni quanto si controlla che il modulo risponda. */
  readonly pingMs: number;
  /** Finestra dei riavvii (60 s) e riavvii consentiti in quella finestra (3). */
  readonly restartWindowMs: number;
  readonly maxRestarts: number;
  /** Attesa prima di un riavvio, moltiplicata per il numero di crash recenti. */
  readonly restartDelayMs: number;
}

export const DEFAULT_TIMINGS: SupervisorTimings = {
  responseMs: 5000,
  pingMs: 10_000,
  restartWindowMs: 60_000,
  maxRestarts: 3,
  restartDelayMs: 500,
};

export interface SupervisorOptions {
  readonly registry: ModuleRegistry;
  readonly store: StateStore;
  readonly logger: Logger;
  /** Cartella dati dell'app: dentro, plugin-data/<id> per ogni modulo. */
  readonly dataDir: string;
  readonly lang: () => Lang;
  /** Esegue una richiesta di un modulo come quelle delle postazioni (ruolo, parametri). */
  readonly dispatch: (request: RpcRequest, session: Session) => Promise<RpcResponse>;
  readonly nodeRuntime?: NodeRuntime;
  readonly timings?: Partial<SupervisorTimings>;
  /** Chiamata quando cambia lo stato di un modulo (per aggiornare live.plugins). */
  readonly onStatus: () => void;
}

interface Running {
  readonly module: LoadedModule;
  readonly dataDir: string;
  proc: ModuleProcess | undefined;
  session: Session | undefined;
  state: PluginState;
  error: string | undefined;
  /** Istanti dei crash recenti (finestra dei riavvii). */
  crashes: number[];
  stopping: Promise<void> | undefined;
  restartTimer: NodeJS.Timeout | undefined;
  pingTimer: NodeJS.Timeout | undefined;
}

const MAX_LOG = 4000;

/**
 * Processi dei moduli con codice (cap. 21, 24 e 27; passo 9b). Ogni modulo
 * attivo con runtime node o native gira nel suo processo, avviato con i
 * permessi approvati; il motore non dipende mai da lui: se si blocca o cade,
 * viene terminato e riavviato fino a 3 volte in 60 secondi, poi resta spento
 * e la postazione mostra l'errore. Le uscite non ne risentono.
 */
export class ModuleSupervisor {
  readonly #options: SupervisorOptions;
  readonly #timings: SupervisorTimings;
  readonly #running = new Map<string, Running>();
  readonly #storages = new Map<string, ModuleStorage>();
  #guardFile = "";
  #view: EventView | undefined;
  #stopped = false;
  #unsubscribe: (() => void) | undefined;
  #statusQueued = false;

  constructor(options: SupervisorOptions) {
    this.#options = options;
    this.#timings = { ...DEFAULT_TIMINGS, ...options.timings };
  }

  async start(): Promise<void> {
    const runtimeDir = join(this.#options.dataDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });
    this.#guardFile = join(runtimeDir, "network-guard.cjs");
    await writeFile(this.#guardFile, networkGuardSource);
    this.#view = this.#options.store.read(eventView);
    this.#unsubscribe = this.#options.store.onPatch((rev, ops) => {
      this.#onPatch(rev, ops);
    });
    this.sync();
  }

  /** Allinea i processi ai moduli attivi: avvia i nuovi, ferma i tolti, riavvia gli aggiornati. */
  sync(): void {
    if (this.#stopped) return;
    const wanted = new Map(
      this.#options.registry
        .active()
        .filter((m) => m.manifest.runtime.type !== "none")
        .map((m) => [m.manifest.id, m]),
    );
    for (const [id, running] of this.#running) {
      const next = wanted.get(id);
      if (next === undefined || next.manifest.version !== running.module.manifest.version) {
        void this.#stop(id, running);
      }
    }
    for (const [id, module] of wanted) {
      if (!this.#running.has(id)) this.#launch(id, module, []);
    }
  }

  /** Stato del processo di un modulo con codice, se il supervisore lo segue. */
  status(id: string): { state: PluginState; error?: string } | undefined {
    const running = this.#running.get(id);
    if (running === undefined) return undefined;
    return running.error === undefined
      ? { state: running.state }
      : { state: running.state, error: running.error };
  }

  /** Pid del processo (per le prove "le uscite non cadono"). */
  pid(id: string): number | undefined {
    return this.#running.get(id)?.proc?.pid;
  }

  storage(pluginId: string): ModuleStorage {
    let storage = this.#storages.get(pluginId);
    if (storage === undefined) {
      storage = new ModuleStorage(this.#dataDirOf(pluginId));
      this.#storages.set(pluginId, storage);
    }
    return storage;
  }

  #dataDirOf(pluginId: string): string {
    return join(this.#options.dataDir, "plugin-data", pluginId);
  }

  /**
   * Comando di un modulo, chiesto da una postazione o (caller) da un altro
   * modulo: un modulo puo' chiamare i propri comandi e quelli dei moduli da
   * cui dipende (cap. 10, "Unione").
   */
  async command(
    caller: string | undefined,
    pluginId: string,
    command: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    if (caller !== undefined && caller !== pluginId) {
      const own = this.#options.registry.find(caller);
      if (own === undefined || !Object.hasOwn(own.manifest.dependencies, pluginId)) {
        throw new RpcError(ErrorCode.Forbidden, "core.error.forbidden");
      }
    }
    const module = this.#options.registry.find(pluginId);
    if (module === undefined)
      throw new RpcError(ErrorCode.PluginNotActive, "core.error.pluginNotActive");
    if (!(module.manifest.contributes.commands ?? []).some((c) => c.id === command)) {
      throw new RpcError(ErrorCode.NotFound, "core.error.commandNotFound");
    }
    const running = this.#running.get(pluginId);
    const proc = running?.proc;
    if (running?.state !== "active" || proc === undefined) {
      throw new RpcError(ErrorCode.PluginNotActive, "core.error.pluginNotActive");
    }
    try {
      const result = (await proc.request(
        "command.execute",
        { command, params },
        this.#timings.responseMs,
      )) as { result?: unknown } | undefined;
      return result?.result ?? null;
    } catch (error) {
      // Non ha risposto in tempo: per il cap. 24 e' bloccato.
      if (error instanceof RpcError && error.code === ErrorCode.PluginTimeout) {
        this.#blocked(pluginId, running, proc);
      }
      throw error;
    }
  }

  /** Eventi che la sessione di un modulo vuole ricevere (sostituisce l'elenco precedente). */
  subscribeEvents(session: Session, names: readonly string[]): void {
    session.events = new Set(names);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#unsubscribe?.();
    await Promise.all([...this.#running].map(([id, running]) => this.#stop(id, running)));
  }

  #statusChanged(): void {
    // Lo stato si aggiorna fuori dalle callback in corso (patch annidate fuori ordine).
    if (this.#statusQueued) return;
    this.#statusQueued = true;
    setImmediate(() => {
      this.#statusQueued = false;
      this.#options.onStatus();
    });
  }

  #launch(id: string, module: LoadedModule, crashes: number[]): void {
    const running: Running = {
      module,
      dataDir: this.#dataDirOf(id),
      proc: undefined,
      session: undefined,
      state: "activating",
      error: undefined,
      crashes,
      stopping: undefined,
      restartTimer: undefined,
      pingTimer: undefined,
    };
    this.#running.set(id, running);
    this.#statusChanged();
    void this.#spawn(id, running);
  }

  async #spawn(id: string, running: Running): Promise<void> {
    const { manifest, dir } = running.module;
    try {
      await mkdir(running.dataDir, { recursive: true });
    } catch (error) {
      this.#options.logger.error(`modulo ${id}: cartella dati non creata`, error);
    }
    let spec;
    try {
      spec = spawnSpec(
        manifest,
        dir,
        running.dataDir,
        this.#guardFile,
        this.#options.nodeRuntime ?? defaultNodeRuntime(),
      );
    } catch (error) {
      // Manca l'eseguibile o la piattaforma non e' supportata: riprovare non serve.
      running.state = "crashed";
      running.error = error instanceof SpawnError ? error.key : "core.module.startFailed";
      this.#statusChanged();
      return;
    }
    if (running.stopping !== undefined || this.#running.get(id) !== running) return;

    const session = new Session({
      send: (text) => {
        proc.transport.send(text);
      },
      close: () => {
        proc.kill();
      },
    });
    const proc: ModuleProcess = new ModuleProcess(
      spec,
      {
        onRequest: (request) => this.#onRequest(request, session),
        onNotification: (method, params) => {
          this.#onNotification(id, running, method, params);
        },
        onExit: (code, signal) => {
          this.#onExit(id, running, proc, code, signal);
        },
      },
      this.#options.logger,
      id,
    );
    session.state = "authed";
    session.kind = "plugin";
    session.name = manifest.name;
    session.role = pluginRole(id);
    session.pluginId = id;
    session.connectedAt = new Date().toISOString();
    running.proc = proc;
    running.session = session;

    const settings = Object.fromEntries(
      (manifest.contributes.settings ?? []).flatMap((s) =>
        s.default === undefined ? [] : [[s.key, s.default]],
      ),
    );
    try {
      await proc.request(
        "plugin.activate",
        {
          context: {
            pluginId: id,
            version: manifest.version,
            protocol: PROTOCOL_VERSION,
            lang: this.#options.lang(),
            settings,
            permissions: manifest.permissions,
            dataDir: running.dataDir,
          },
        },
        this.#timings.responseMs,
      );
    } catch (error) {
      if (this.#halted(running, proc)) return;
      running.error =
        error instanceof RpcError && error.code === ErrorCode.PluginTimeout
          ? "core.module.notResponding"
          : error instanceof RpcError && error.message.startsWith("core.")
            ? error.message
            : "core.module.activateFailed";
      this.#options.logger.error(`modulo ${id}: attivazione non riuscita (${running.error})`);
      proc.kill();
      return;
    }
    if (this.#halted(running, proc)) return;
    running.state = "active";
    running.error = undefined;
    this.#options.logger.info(`modulo ${id} ${manifest.version} attivo (pid ${proc.pid ?? "?"})`);
    this.#statusChanged();
    this.#schedulePing(id, running, proc);
  }

  /** Il processo e' gia' finito o lo si sta fermando (si rilegge dopo ogni attesa). */
  #halted(running: Running, proc: ModuleProcess): boolean {
    return proc.exited || running.stopping !== undefined;
  }

  #schedulePing(id: string, running: Running, proc: ModuleProcess): void {
    running.pingTimer = setTimeout(() => {
      running.pingTimer = undefined;
      if (proc.exited || running.state !== "active") return;
      proc.request("plugin.ping", {}, this.#timings.responseMs).then(
        () => {
          this.#schedulePing(id, running, proc);
        },
        (error: unknown) => {
          if (error instanceof RpcError && error.code === ErrorCode.PluginTimeout) {
            this.#blocked(id, running, proc);
          }
        },
      );
    }, this.#timings.pingMs);
    running.pingTimer.unref();
  }

  /** Il modulo non risponde: lo si termina, e il crash segue le regole dei riavvii. */
  #blocked(id: string, running: Running, proc: ModuleProcess): void {
    if (proc.exited || running.stopping !== undefined) return;
    this.#options.logger.error(
      `modulo ${id}: non risponde entro ${this.#timings.responseMs} ms, terminato`,
    );
    running.error = "core.module.notResponding";
    proc.kill();
  }

  #onExit(
    id: string,
    running: Running,
    proc: ModuleProcess,
    code: number | null,
    signal: string | null,
  ): void {
    if (running.pingTimer !== undefined) clearTimeout(running.pingTimer);
    running.pingTimer = undefined;
    if (running.session !== undefined) running.session.subscribed = false;
    if (running.stopping !== undefined || this.#stopped || this.#running.get(id) !== running)
      return;

    const tail = proc.stderrTail.length > 0 ? `\n${proc.stderrTail.join("\n")}` : "";
    this.#options.logger.error(
      `modulo ${id}: processo terminato (codice ${String(code)}, segnale ${String(signal)})${tail}`,
    );
    const now = Date.now();
    const crashes = [...running.crashes, now].filter(
      (t) => now - t <= this.#timings.restartWindowMs,
    );
    running.crashes = crashes;
    running.error ??= "core.module.crashed";
    if (crashes.length > this.#timings.maxRestarts) {
      // Troppi crash di fila: resta spento finche' l'utente non lo riaccende.
      running.state = "crashed";
      running.error = "core.module.crashedTooOften";
      this.#statusChanged();
      return;
    }
    running.state = "crashed";
    this.#statusChanged();
    running.restartTimer = setTimeout(() => {
      running.restartTimer = undefined;
      if (this.#stopped || this.#running.get(id) !== running || running.stopping !== undefined)
        return;
      this.#options.logger.info(
        `modulo ${id}: riavvio (${crashes.length}/${this.#timings.maxRestarts})`,
      );
      this.#launch(id, running.module, crashes);
    }, this.#timings.restartDelayMs * crashes.length);
  }

  #stop(id: string, running: Running): Promise<void> {
    running.stopping ??= (async () => {
      if (running.restartTimer !== undefined) clearTimeout(running.restartTimer);
      if (running.pingTimer !== undefined) clearTimeout(running.pingTimer);
      const proc = running.proc;
      if (proc !== undefined && !proc.exited) {
        running.state = "deactivating";
        this.#statusChanged();
        await proc
          .request("plugin.deactivate", {}, this.#timings.responseMs)
          .catch(() => undefined);
        proc.closeInput();
        await proc.waitExit(2000);
      }
      if (this.#running.get(id) === running) this.#running.delete(id);
      this.#statusChanged();
      // Riacceso (o aggiornato) mentre si chiudeva: ora riparte.
      this.sync();
    })();
    return running.stopping;
  }

  async #onRequest(request: RpcRequest, session: Session): Promise<RpcResponse> {
    // I metodi di sessione (abbinamento, presentazione) non servono a un modulo.
    if (isEngineMethod(request.method) && EngineMethods[request.method].scope === "session") {
      return rpcError(request.id, ErrorCode.Forbidden, "core.error.forbidden");
    }
    return this.#options.dispatch(request, session);
  }

  #onNotification(id: string, running: Running, method: string, params: unknown): void {
    const p = (typeof params === "object" && params !== null ? params : {}) as Record<
      string,
      unknown
    >;
    if (method === "log") {
      const level = p.level;
      const message = typeof p.message === "string" ? p.message.slice(0, MAX_LOG) : "";
      const text = `modulo ${id}: ${message}`;
      if (level === "error") this.#options.logger.error(text);
      else if (level === "warn") this.#options.logger.warn(text);
      else if (level === "debug") this.#options.logger.debug(text);
      else this.#options.logger.info(text);
      return;
    }
    if (method === "event.emit") {
      const name = p.name;
      const declared = running.module.manifest.contributes.events ?? [];
      if (typeof name !== "string" || !declared.includes(name)) {
        this.#options.logger.warn(`modulo ${id}: evento non dichiarato scartato`);
        return;
      }
      this.#deliver({ name: `${id}.${name}`, payload: p.payload });
    }
  }

  #deliver(event: EngineEvent): void {
    const message = JSON.stringify(rpcNotification("event", event));
    for (const running of this.#running.values()) {
      if (running.session?.events.has(event.name) === true) running.proc?.transport.send(message);
    }
  }

  #onPatch(rev: number, ops: unknown): void {
    // Lo stato ai moduli iscritti, come alle postazioni.
    let message: string | undefined;
    let listening = false;
    for (const running of this.#running.values()) {
      const session = running.session;
      if (session === undefined) continue;
      if (session.events.size > 0) listening = true;
      if (!session.subscribed) continue;
      message ??= JSON.stringify(rpcNotification("state.patch", { rev, ops }));
      running.proc?.transport.send(message);
    }
    const before = this.#view;
    const after = this.#options.store.read(eventView);
    this.#view = after;
    if (!listening || before === undefined) return;
    for (const event of coreEvents(before, after)) this.#deliver(event);
  }
}
