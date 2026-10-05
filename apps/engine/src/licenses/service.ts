import {
  ErrorCode,
  LICENSE_NOTARY_URL,
  licenseProofMessage,
  NOTARY_PUBLIC_KEYS,
  RpcError,
  verifyLicenseToken,
  type LicenseProof,
  type LicenseState,
  type LicenseStatus,
  type LicenseTokenPayload,
} from "@cuelith/protocol";
import type { Logger } from "../log.js";
import type { Fetch } from "../modules/marketplace.js";
import { Notary, NotaryFailure, PERMANENT, type NotaryCode } from "./notary.js";
import type { SecretStore } from "./secrets.js";
import { Vault, type VaultEntry } from "./vault.js";

export interface LicenseTimings {
  /** Primo controllo dopo l'avvio (non rallenta la partenza). */
  readonly firstTickMs: number;
  /** Ogni quanto si controlla se c'è da rinnovare. */
  readonly tickMs: number;
  /** In onda una revoca si rimanda: ogni quanto si riprova. */
  readonly deferMs: number;
}

const DEFAULT_TIMINGS: LicenseTimings = {
  firstTickMs: 30_000,
  tickMs: 6 * 60 * 60 * 1000,
  deferMs: 60_000,
};

export interface LicenseServiceOptions {
  /** Cartella delle licenze (dentro i dati dell'app). */
  readonly dir: string;
  /** Custodia del sistema; senza, le licenze non si possono attivare. */
  readonly secrets?: SecretStore | undefined;
  readonly notaryUrl?: string | undefined;
  /** Solo per le prove: chiavi del Notaio al posto di quelle del progetto. */
  readonly notaryKeys?: Readonly<Record<string, string>> | undefined;
  readonly fetch: Fetch;
  readonly logger: Logger;
  /** Si è in onda? (`isOnAir` del protocollo): mai togliere un plugin in diretta. */
  readonly isOnAir: () => boolean;
  /** I plugin ammessi sono cambiati: il registro dei moduli si ricalcola. */
  readonly onChange: () => void;
  readonly now?: () => number;
  readonly timings?: Partial<LicenseTimings>;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** Chiave di traduzione di un errore del Notaio (`core.error.license<Codice>`). */
function failure(code: NotaryCode): RpcError {
  const key = `core.error.license${code.charAt(0).toUpperCase()}${code.slice(1)}`;
  const kind =
    code === "unreachable" || code === "unavailable" || code === "invalidAnswer"
      ? ErrorCode.InternalError
      : ErrorCode.InvalidParameters;
  return new RpcError(kind, key);
}

/**
 * Licenze dei plugin a pagamento (decisione 0013).
 *
 * - Il permesso lo firma il Notaio ed è legato alla chiave del computer; qui si
 *   verifica senza internet, con le chiavi pubbliche del Notaio.
 * - Il permesso dice «rinnova dopo 30 giorni» e «scade dopo 90»: dal trentesimo
 *   giorno si prova a rinnovare in silenzio; se non si riesce (offline) il
 *   plugin funziona fino alla scadenza.
 * - Chiavi e permessi stanno in un solo file cifrato dal sistema (Vault).
 * - **Mai fermare una diretta**: l'elenco dei plugin ammessi è «agganciato».
 *   Concedere è immediato; togliere (scadenza, revoca, disattivazione) si
 *   applica solo fuori onda: in onda si rimanda e si riprova ogni minuto.
 *   Nessun controllo avviene mentre un plugin lavora, solo quando il registro
 *   dei moduli decide chi parte.
 */
export class LicenseService {
  readonly #o: LicenseServiceOptions;
  readonly #timings: LicenseTimings;
  readonly #vault: Vault | undefined;
  readonly #notary: Notary;
  readonly #keys: Readonly<Record<string, string>>;
  /** Permessi del caveau con firma e computer verificati (la scadenza si guarda dopo). */
  readonly #payloads = new Map<string, LicenseTokenPayload>();
  /** Plugin ammessi adesso: cambia solo in `#reevaluate`. */
  readonly #granted = new Map<string, boolean>();
  #timers: NodeJS.Timeout[] = [];
  #deferTimer: NodeJS.Timeout | undefined;
  #stopped = false;

  constructor(options: LicenseServiceOptions) {
    this.#o = options;
    this.#timings = { ...DEFAULT_TIMINGS, ...options.timings };
    this.#keys = options.notaryKeys ?? NOTARY_PUBLIC_KEYS;
    this.#vault =
      options.secrets?.isAvailable() === true ? new Vault(options.dir, options.secrets) : undefined;
    this.#notary = new Notary({
      url: options.notaryUrl ?? LICENSE_NOTARY_URL,
      keys: this.#keys,
      fetch: options.fetch,
    });
  }

  #now(): number {
    return this.#o.now?.() ?? Date.now();
  }

  /** Il sistema sa custodire le chiavi? Senza, niente attivazioni. */
  available(): boolean {
    return this.#vault !== undefined;
  }

  /** Legge il caveau e decide chi è ammesso all'avvio. */
  async load(): Promise<void> {
    if (this.#vault === undefined) return;
    if (!(await this.#vault.load())) {
      this.#o.logger.warn("caveau delle licenze illeggibile: le licenze vanno riattivate");
      return;
    }
    const device = this.#vault.peekDevice();
    for (const [id, entry] of Object.entries(this.#vault.entries())) {
      // now = 0: qui si verificano solo firma, plugin e computer; la scadenza è affare di #state.
      const payload =
        device === undefined
          ? undefined
          : await verifyLicenseToken(entry.token, {
              keys: this.#keys,
              pluginId: id,
              devicePublicKey: device,
              now: 0,
            });
      if (payload === undefined) {
        this.#o.logger.warn(`permesso della licenza non valido per ${id}: lo ignoro`);
        continue;
      }
      this.#payloads.set(id, payload);
    }
    this.#reevaluate(true);
  }

  // ---- stato ----

  #state(id: string, now: number): LicenseState {
    const entry = this.#vault?.entry(id);
    const payload = this.#payloads.get(id);
    if (entry === undefined || payload === undefined) return "none";
    if (entry.revoked !== undefined) return "revoked";
    if (now >= payload.exp * 1000) return "expired";
    if (now >= payload.renewAfter * 1000) return "renew";
    return "active";
  }

  status(id: string): LicenseStatus {
    const state = this.#state(id, this.#now());
    const payload = this.#payloads.get(id);
    return {
      pluginId: id,
      state,
      ...(payload === undefined || state === "none"
        ? {}
        : { expires: iso(payload.exp * 1000), renewAfter: iso(payload.renewAfter * 1000) }),
      ...(payload?.test === true && state !== "none" ? { test: true } : {}),
    };
  }

  /** Stato di tutti i plugin con una licenza o che ne richiedono una. */
  list(extraIds: readonly string[] = []): LicenseStatus[] {
    const ids = new Set([...Object.keys(this.#vault?.entries() ?? {}), ...extraIds]);
    return [...ids].sort().map((id) => this.status(id));
  }

  /** Il plugin può partire? Decisione «agganciata»: vedi la descrizione della classe. */
  allows(id: string): boolean {
    return this.#granted.get(id) === true;
  }

  /** Perché non può partire: chiave di traduzione per lo stato del plugin. */
  reason(id: string): string {
    const state = this.#state(id, this.#now());
    return state === "expired"
      ? "core.license.expired"
      : state === "revoked"
        ? "core.license.revoked"
        : "core.license.needed";
  }

  /**
   * Ricalcola chi è ammesso. Concedere è sempre immediato; togliere si rimanda
   * se si è in onda (a meno che `force`, solo all'avvio).
   */
  #reevaluate(force = false): void {
    const now = this.#now();
    let changed = false;
    let deferred = false;
    const ids = new Set([...this.#granted.keys(), ...Object.keys(this.#vault?.entries() ?? {})]);
    for (const id of ids) {
      const state = this.#state(id, now);
      const want = state === "active" || state === "renew";
      const have = this.#granted.get(id) === true;
      if (want === have) continue;
      if (!want && !force && this.#o.isOnAir()) {
        deferred = true;
        continue;
      }
      this.#granted.set(id, want);
      changed = true;
    }
    if (deferred) this.#scheduleDefer();
    if (changed) this.#o.onChange();
  }

  #scheduleDefer(): void {
    if (this.#deferTimer !== undefined || this.#stopped) return;
    this.#deferTimer = setTimeout(() => {
      this.#deferTimer = undefined;
      this.#reevaluate();
    }, this.#timings.deferMs);
    this.#deferTimer.unref();
  }

  // ---- azioni dell'utente ----

  #requireVault(): Vault {
    if (this.#vault === undefined) {
      throw new RpcError(ErrorCode.InvalidParameters, "core.error.licenseNoSecretStore");
    }
    return this.#vault;
  }

  /** Attiva la chiave del negozio per questo computer. */
  async activate(pluginId: string, licenseKey: string): Promise<LicenseStatus> {
    const vault = this.#requireVault();
    const device = await vault.device();
    const now = this.#now();
    let grant;
    try {
      grant = await this.#notary.activate(
        { licenseKey, pluginId, devicePublicKey: device.publicKey },
        now,
      );
    } catch (error) {
      if (error instanceof NotaryFailure) throw failure(error.code);
      throw error;
    }
    // Una chiave o un posto precedenti per questo plugin: si libera il vecchio posto (se si riesce).
    const old = vault.entry(pluginId);
    if (
      old !== undefined &&
      (old.instanceId !== grant.instanceId || old.licenseKey !== licenseKey)
    ) {
      await this.#notary
        .deactivate({ licenseKey: old.licenseKey, pluginId, instanceId: old.instanceId })
        .catch(() => undefined);
    }
    const entry: VaultEntry = {
      licenseKey,
      instanceId: grant.instanceId,
      token: grant.token,
      activatedAt: iso(now),
      checkedAt: iso(now),
    };
    await vault.set(pluginId, entry);
    this.#payloads.set(pluginId, grant.payload);
    this.#reevaluate();
    return this.status(pluginId);
  }

  /** Chiede subito un permesso nuovo; gli errori passeggeri tornano all'utente. */
  async refresh(pluginId: string): Promise<LicenseStatus> {
    const vault = this.#requireVault();
    const entry = vault.entry(pluginId);
    if (entry === undefined) {
      throw new RpcError(ErrorCode.NotFound, "core.error.licenseNone");
    }
    await this.#renew(pluginId, entry, true);
    return this.status(pluginId);
  }

  /** Libera il posto di questo computer e dimentica la chiave. */
  async deactivate(pluginId: string): Promise<void> {
    const vault = this.#requireVault();
    const entry = vault.entry(pluginId);
    if (entry === undefined) return;
    try {
      await this.#notary.deactivate({
        licenseKey: entry.licenseKey,
        pluginId,
        instanceId: entry.instanceId,
      });
    } catch (error) {
      // Una chiave che il fornitore non riconosce più non occupa posti: si dimentica comunque.
      if (!(error instanceof NotaryFailure) || !PERMANENT.has(error.code)) {
        throw error instanceof NotaryFailure ? failure(error.code) : error;
      }
    }
    await vault.remove(pluginId);
    this.#payloads.delete(pluginId);
    this.#reevaluate();
  }

  /**
   * Prova della licenza per un plugin (`license.prove`): il permesso e la firma
   * di questo computer sulla sfida. Solo se la licenza vale davvero adesso.
   */
  prove(pluginId: string, nonce: string): LicenseProof {
    const state = this.#state(pluginId, this.#now());
    const entry = this.#vault?.entry(pluginId);
    if (
      (state !== "active" && state !== "renew") ||
      entry === undefined ||
      this.#vault === undefined
    ) {
      throw new RpcError(ErrorCode.Forbidden, "core.error.licenseRequired");
    }
    return {
      token: entry.token,
      signature: this.#vault.signWithDevice(licenseProofMessage(pluginId, nonce)),
    };
  }

  // ---- rinnovo ----

  /**
   * Rinnova un permesso. Un rifiuto definitivo del Notaio (rimborso, chiave
   * cambiata) segna la licenza come revocata; un guasto passeggero non cambia
   * nulla (e con `rethrow` tornerà all'utente).
   */
  async #renew(id: string, entry: VaultEntry, rethrow: boolean): Promise<void> {
    const vault = this.#requireVault();
    const device = await vault.device();
    const now = this.#now();
    try {
      const grant = await this.#notary.refresh(
        {
          licenseKey: entry.licenseKey,
          pluginId: id,
          devicePublicKey: device.publicKey,
          instanceId: entry.instanceId,
        },
        now,
      );
      await vault.set(id, {
        ...entry,
        token: grant.token,
        checkedAt: iso(now),
        revoked: undefined,
      });
      this.#payloads.set(id, grant.payload);
      this.#reevaluate();
    } catch (error) {
      if (!(error instanceof NotaryFailure)) throw error;
      if (PERMANENT.has(error.code)) {
        await vault.set(id, { ...entry, revoked: { at: iso(now), code: error.code } });
        this.#o.logger.info(`licenza di ${id} non più valida (${error.code})`);
        this.#reevaluate();
      } else {
        this.#o.logger.warn(`rinnovo della licenza di ${id} non riuscito (${error.code}): riprovo`);
      }
      if (rethrow) throw failure(error.code);
    }
  }

  /** Un giro di controllo: rinnova ciò che va rinnovato e ricalcola chi è ammesso. */
  async tick(): Promise<void> {
    if (this.#vault === undefined) return;
    const now = this.#now();
    for (const [id, entry] of Object.entries(this.#vault.entries())) {
      if (entry.revoked !== undefined) continue;
      const state = this.#state(id, now);
      // «renew»: passati 30 giorni; «expired»: passati 90, un ultimo tentativo prima di arrendersi.
      if (state === "renew" || state === "expired")
        await this.#renew(id, entry, false).catch(() => undefined);
    }
    this.#reevaluate();
  }

  /** Avvia i controlli in background (il primo poco dopo l'avvio). */
  start(): void {
    if (this.#vault === undefined || this.#stopped) return;
    const run = () => {
      void this.tick().catch((error: unknown) => {
        this.#o.logger.error("controllo delle licenze non riuscito", error);
      });
    };
    const first = setTimeout(run, this.#timings.firstTickMs);
    const every = setInterval(run, this.#timings.tickMs);
    first.unref();
    every.unref();
    this.#timers = [first, every];
  }

  stop(): void {
    this.#stopped = true;
    for (const timer of this.#timers) clearTimeout(timer);
    if (this.#deferTimer !== undefined) clearTimeout(this.#deferTimer);
    this.#timers = [];
    this.#deferTimer = undefined;
  }
}
