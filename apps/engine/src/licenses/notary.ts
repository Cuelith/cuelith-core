import { verifyLicenseToken, type LicenseTokenPayload } from "@cuelith/protocol";
import type { Fetch } from "../modules/marketplace.js";

/** Codici con cui il Notaio (o la rete) dice di no. */
export type NotaryCode =
  | "invalidInput"
  | "notPaid"
  | "invalidKey"
  | "limit"
  | "wrongProduct"
  | "badLimit"
  | "testMode"
  | "revoked"
  | "unavailable"
  | "unreachable"
  | "invalidAnswer";

export class NotaryFailure extends Error {
  constructor(readonly code: NotaryCode) {
    super(code);
  }
}

/**
 * Codici che dicono "questa licenza non è più buona" (rimborso, chiave
 * cambiata, prodotto che non rispetta le regole). Gli altri (rete, servizio
 * giù) sono guasti passeggeri: non tolgono nulla a nessuno.
 */
export const PERMANENT: ReadonlySet<NotaryCode> = new Set([
  "revoked",
  "invalidKey",
  "wrongProduct",
  "badLimit",
  "testMode",
]);

export interface NotaryOptions {
  readonly url: string;
  readonly keys: Readonly<Record<string, string>>;
  readonly fetch: Fetch;
}

export interface NotaryGrant {
  readonly token: string;
  readonly instanceId: string;
  readonly payload: LicenseTokenPayload;
}

const TIMEOUT_MS = 15_000;
const KNOWN: ReadonlySet<string> = new Set([
  "invalidInput",
  "notPaid",
  "invalidKey",
  "limit",
  "wrongProduct",
  "badLimit",
  "testMode",
  "revoked",
  "unavailable",
]);

/**
 * Il Notaio del progetto (funzioni del sito): verifica la chiave presso il
 * fornitore e firma il permesso. Al Notaio vanno SOLO: la chiave di licenza,
 * l'identificativo del plugin e la chiave pubblica casuale di questo computer
 * (e il posto, per rinnovare). Niente nome del computer, niente hardware,
 * niente dati personali. Il permesso che torna si controlla qui con le chiavi
 * pubbliche del Notaio: se non è valido per quel plugin e quel computer, si
 * scarta anche se il Notaio dicesse "ok".
 */
export class Notary {
  readonly #o: NotaryOptions;

  constructor(options: NotaryOptions) {
    this.#o = options;
  }

  async #post(action: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.#o.fetch(`${this.#o.url}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new NotaryFailure("unreachable");
    }
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = await response.json();
      if (parsed !== null && typeof parsed === "object") data = parsed as Record<string, unknown>;
    } catch {
      // risposta senza JSON: conta solo il codice HTTP
    }
    if (response.ok) return data;
    // Un codice non previsto, o una risposta che non è del Notaio, è un guasto: non una revoca.
    const code = typeof data.error === "string" && KNOWN.has(data.error) ? data.error : undefined;
    throw new NotaryFailure(
      (code as NotaryCode | undefined) ??
        (response.status >= 500 ? "unavailable" : "invalidAnswer"),
    );
  }

  async #grant(
    data: Record<string, unknown>,
    pluginId: string,
    devicePublicKey: string,
    now: number,
  ): Promise<NotaryGrant> {
    const token = typeof data.token === "string" ? data.token : "";
    const payload = await verifyLicenseToken(token, {
      keys: this.#o.keys,
      pluginId,
      devicePublicKey,
      now,
    });
    if (payload === undefined) throw new NotaryFailure("invalidAnswer");
    return { token, instanceId: payload.instance, payload };
  }

  async activate(
    input: { licenseKey: string; pluginId: string; devicePublicKey: string },
    now: number,
  ): Promise<NotaryGrant> {
    const data = await this.#post("activate", input);
    return this.#grant(data, input.pluginId, input.devicePublicKey, now);
  }

  async refresh(
    input: { licenseKey: string; pluginId: string; devicePublicKey: string; instanceId: string },
    now: number,
  ): Promise<NotaryGrant> {
    const data = await this.#post("refresh", input);
    return this.#grant(data, input.pluginId, input.devicePublicKey, now);
  }

  async deactivate(input: {
    licenseKey: string;
    pluginId: string;
    instanceId: string;
  }): Promise<void> {
    await this.#post("deactivate", input);
  }
}
