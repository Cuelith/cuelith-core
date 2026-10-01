import {
  applyStatePatch,
  ErrorCode,
  isNextRev,
  Notifications,
  parseRpcMessage,
  PROTOCOL_VERSION,
  rpcRequest,
  type Catalog,
  type EngineMethodName,
  type EngineMethodParams,
  type EngineMethodResult,
  type JsonPatchOperation,
  type Lang,
  type RoleId,
  type RpcErrorObject,
  type RpcResponse,
  type StateDocument,
} from "@cuelith/protocol";

export type ConnectionStatus =
  | { readonly kind: "connecting" }
  | { readonly kind: "connected" }
  | { readonly kind: "lost" }
  | { readonly kind: "incompatible"; readonly engineProtocol: string }
  | { readonly kind: "unpaired" };

export interface EngineSnapshot {
  readonly status: ConnectionStatus;
  readonly state: StateDocument | undefined;
  readonly lang: Lang;
  readonly catalog: Catalog;
  readonly role: RoleId | undefined;
  /** Versione del motore collegato (dal saluto iniziale). */
  readonly engineVersion: string | undefined;
}

/** Errore restituito dal motore: chiave di traduzione + parametri. */
export class EngineCallError extends Error {
  readonly code: number;
  readonly params: Readonly<Record<string, string>>;

  constructor(error: RpcErrorObject) {
    super(error.message);
    this.name = "EngineCallError";
    this.code = error.code;
    this.params = error.data?.params ?? {};
  }
}

/** Chi e' la postazione: nome mostrato al motore e token (assente = da abbinare). */
export interface Credentials {
  readonly name: string;
  readonly token: string | undefined;
}

/** Per le postazioni in rete: dove tenere il token ricevuto con l'abbinamento. */
export interface PairingStore {
  /** Abbinata: il token va conservato per i prossimi collegamenti. */
  save(token: string, name: string): void;
  /** Il motore non riconosce piu' il token (postazione revocata): va dimenticato. */
  clear(): void;
}

const CALL_TIMEOUT_MS = 10_000;
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 5_000;
const CATALOG_CACHE_KEY = "cuelith.catalog";

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface CachedCatalog {
  lang: Lang;
  catalog: Catalog;
}

function readCachedCatalog(): CachedCatalog | undefined {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    return raw === null ? undefined : (JSON.parse(raw) as CachedCatalog);
  } catch {
    return undefined;
  }
}

function writeCachedCatalog(value: CachedCatalog): void {
  try {
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(value));
  } catch {
    // Senza memoria locale la postazione funziona comunque: i testi arrivano dal motore.
  }
}

/**
 * Collegamento della postazione al motore (cap. 23): presentazione, accesso,
 * lingua, istantanea dello stato e poi patch in ordine. Se una patch arriva
 * fuori sequenza si chiede una nuova istantanea; se il collegamento cade si
 * riprova da solo, e lo stato mostrato resta l'ultimo valido.
 */
export class EngineConnection {
  readonly #url: string;
  readonly #credentials: () => Promise<Credentials>;
  readonly #pairing: PairingStore | undefined;
  readonly #listeners = new Set<() => void>();
  readonly #pending = new Map<number, Pending>();
  #ws: WebSocket | undefined;
  #next = 1;
  #rev = -1;
  #retryMs = RETRY_MIN_MS;
  #stopped = false;
  /** Patch arrivate mentre l'istantanea e' in viaggio: si applicano dopo. */
  #buffer: { rev: number; ops: readonly JsonPatchOperation[] }[] | undefined;
  #snapshot: EngineSnapshot;

  constructor(url: string, credentials: () => Promise<Credentials>, pairing?: PairingStore) {
    this.#url = url;
    this.#credentials = credentials;
    this.#pairing = pairing;
    const cached = readCachedCatalog();
    this.#snapshot = {
      status: { kind: "connecting" },
      state: undefined,
      lang: cached?.lang ?? "it",
      catalog: cached?.catalog ?? {},
      role: undefined,
      engineVersion: undefined,
    };
  }

  start(): void {
    this.#stopped = false;
    this.#open();
  }

  stop(): void {
    this.#stopped = true;
    this.#ws?.close();
  }

  getSnapshot = (): EngineSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  call<N extends EngineMethodName>(
    method: N,
    params?: EngineMethodParams<N>,
  ): Promise<EngineMethodResult<N>> {
    const ws = this.#ws;
    if (ws?.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new EngineCallError({ code: ErrorCode.InternalError, message: "core.connection.lost" }),
      );
    }
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new EngineCallError({
            code: ErrorCode.InternalError,
            message: "core.connection.timeout",
          }),
        );
      }, CALL_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify(rpcRequest(id, method, params ?? {})));
    });
  }

  #set(patch: Partial<EngineSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const listener of this.#listeners) listener();
  }

  #open(): void {
    if (this.#stopped) return;
    const ws = new WebSocket(this.#url);
    this.#ws = ws;
    ws.addEventListener("open", () => {
      this.#handshake().catch((error: unknown) => {
        this.#onHandshakeError(error);
      });
    });
    ws.addEventListener("message", (event: MessageEvent<string>) => {
      this.#onMessage(event.data);
    });
    ws.addEventListener("close", () => {
      this.#onClose(ws);
    });
  }

  async #handshake(): Promise<void> {
    const { name, token } = await this.#credentials();
    const hello = await this.call("session.hello", {
      protocol: PROTOCOL_VERSION,
      client: { name, kind: "client" },
    });
    this.#set({ engineVersion: hello.engine.version });
    // I testi prima dell'accesso: servono anche alla schermata di abbinamento.
    await this.#loadCatalog();
    if (token === undefined) {
      this.#set({ status: { kind: "unpaired" } });
      return;
    }
    await this.#enter(token);
  }

  /** Accesso col token, poi lo stato: da qui la postazione e' collegata. */
  async #enter(token: string): Promise<void> {
    const auth = await this.call("session.auth", { token });
    this.#set({ role: auth.role });
    await this.#resync();
    this.#retryMs = RETRY_MIN_MS;
    this.#set({ status: { kind: "connected" } });
  }

  /**
   * Abbinamento di una postazione in rete (cap. 23): col codice a 6 cifre
   * mostrato sul motore si riceve un token, che resta in questa postazione.
   * Lancia EngineCallError se il codice e' sbagliato o scaduto.
   */
  async pair(code: string, name: string): Promise<void> {
    const { token } = await this.call("session.pair", { code, name });
    this.#pairing?.save(token, name);
    await this.#enter(token);
  }

  #onHandshakeError(error: unknown): void {
    if (error instanceof EngineCallError && error.code === ErrorCode.ProtocolIncompatible) {
      this.#stopped = true;
      this.#set({
        status: { kind: "incompatible", engineProtocol: error.params["engine"] ?? "?" },
      });
      this.#ws?.close();
      return;
    }
    if (error instanceof EngineCallError && error.code === ErrorCode.NotPaired) {
      // Token non piu' valido (postazione revocata): si torna all'abbinamento.
      this.#pairing?.clear();
      this.#set({ status: { kind: "unpaired" }, state: undefined, role: undefined });
      return;
    }
    this.#ws?.close();
  }

  async #resync(): Promise<void> {
    const buffer: { rev: number; ops: readonly JsonPatchOperation[] }[] = [];
    this.#buffer = buffer;
    const { rev, state } = await this.call("state.subscribe", {});
    let current = state;
    let currentRev = rev;
    for (const patch of buffer.sort((a, b) => a.rev - b.rev)) {
      if (patch.rev <= currentRev) continue;
      if (!isNextRev(currentRev, patch.rev)) break;
      current = applyStatePatch(current, patch.ops);
      currentRev = patch.rev;
    }
    this.#buffer = undefined;
    this.#rev = currentRev;
    this.#set({ state: current });
  }

  /** Lingua attiva e testi: all'accesso e ogni volta che i moduli cambiano. */
  async #loadCatalog(): Promise<void> {
    const locales = await this.call("locale.list", {});
    const { catalog } = await this.call("locale.catalog", { lang: locales.active });
    writeCachedCatalog({ lang: locales.active, catalog });
    this.#set({ lang: locales.active, catalog });
  }

  #onMessage(raw: string): void {
    const parsed = parseRpcMessage(raw);
    if (parsed.kind === "response") {
      this.#settle(parsed.message);
      return;
    }
    if (parsed.kind !== "notification" || parsed.message.method !== "state.patch") return;
    const patch = Notifications["state.patch"].safeParse(parsed.message.params);
    if (!patch.success) return;
    if (this.#buffer !== undefined) {
      this.#buffer.push(patch.data);
      return;
    }
    const state = this.#snapshot.state;
    if (state === undefined || !isNextRev(this.#rev, patch.data.rev)) {
      this.#resync().catch(() => this.#ws?.close());
      return;
    }
    try {
      const next = applyStatePatch(state, patch.data.ops);
      this.#rev = patch.data.rev;
      this.#set({ state: next });
      // Un modulo acceso, spento o aggiornato puo' portare o togliere testi e lingue.
      if (patch.data.ops.some((op) => op.path.startsWith("/live/plugins"))) {
        this.#loadCatalog().catch(() => undefined);
      }
    } catch {
      this.#resync().catch(() => this.#ws?.close());
    }
  }

  #settle(response: RpcResponse): void {
    if (typeof response.id !== "number") return;
    const pending = this.#pending.get(response.id);
    if (pending === undefined) return;
    this.#pending.delete(response.id);
    clearTimeout(pending.timer);
    if ("error" in response) pending.reject(new EngineCallError(response.error));
    else pending.resolve(response.result);
  }

  #onClose(ws: WebSocket): void {
    if (this.#ws !== ws) return;
    this.#ws = undefined;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new EngineCallError({ code: ErrorCode.InternalError, message: "core.connection.lost" }),
      );
      this.#pending.delete(id);
    }
    const status = this.#snapshot.status.kind;
    if (this.#stopped || status === "incompatible") return;
    if (status !== "unpaired")
      this.#set({ status: { kind: this.#snapshot.state === undefined ? "connecting" : "lost" } });
    const delay = this.#retryMs;
    this.#retryMs = Math.min(this.#retryMs * 2, RETRY_MAX_MS);
    setTimeout(() => {
      this.#open();
    }, delay);
  }
}
