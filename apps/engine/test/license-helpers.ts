import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import type { SecretStore } from "../src/licenses/secrets.js";

/**
 * Custodia finta che cifra davvero (AES-256-GCM con una chiave sua): chi non ha
 * la stessa chiave non decifra, come con un altro utente del sistema.
 */
export class FakeSecrets implements SecretStore {
  readonly #key = randomBytes(32);
  available = true;
  /** Quante volte si è cifrato (per le prove). */
  encrypted = 0;

  isAvailable(): boolean {
    return this.available;
  }

  encrypt(plain: string): Uint8Array {
    this.encrypted += 1;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  decrypt(data: Uint8Array): string {
    const buffer = Buffer.from(data);
    const decipher = createDecipheriv("aes-256-gcm", this.#key, buffer.subarray(0, 12));
    decipher.setAuthTag(buffer.subarray(12, 28));
    return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8");
  }
}

/** Corpo di una richiesta finta: sempre testo (JSON o modulo). */
export const bodyText = (init?: RequestInit): string =>
  typeof init?.body === "string" ? init.body : "";

const b64u = (data: Uint8Array | string) => Buffer.from(data).toString("base64url");

export const NOTARY_URL = "https://notary.test/api/license";
const DAY = 86400;

/** Chiavi del Notaio di prova. */
export function notaryKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKey: b64u(publicKey.export({ format: "der", type: "spki" }).subarray(-32)),
  };
}

interface Call {
  readonly action: string;
  readonly body: Record<string, string>;
}

/**
 * Notaio finto: fa quello che fa il vero (firma permessi legati al computer,
 * 30 giorni per rinnovare, 90 di validità) senza il fornitore delle licenze.
 * Si comanda con i campi pubblici: `revoke()`, `online`, `limit`.
 */
export class FakeNotary {
  readonly keys = notaryKeys();
  readonly calls: Call[] = [];
  online = true;
  /** Posti già usati sulla chiave (si compara con `limit`). */
  seats = new Set<string>();
  limit = 3;
  /** Chiavi che il fornitore non riconosce o ha disattivato. */
  invalid = new Set<string>();
  revoked = new Set<string>();
  /** Se vero, risponde con un permesso firmato da un'altra chiave (non del Notaio). */
  forge = false;
  /** Orologio del Notaio (millisecondi). */
  clock = () => Date.now();
  #next = 1;

  // eslint-disable-next-line @typescript-eslint/require-await -- la firma asincrona la chiede il tipo di fetch
  fetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!this.online) throw new Error("offline");
    if (!url.startsWith(`${NOTARY_URL}/`)) return new Response("", { status: 404 });
    const action = url.slice(NOTARY_URL.length + 1);
    const body = JSON.parse(bodyText(init) || "{}") as Record<string, string>;
    this.calls.push({ action, body });
    const key = body.licenseKey ?? "";
    if (this.invalid.has(key)) return Response.json({ error: "invalidKey" }, { status: 403 });
    if (action === "activate") {
      if (this.seats.size >= this.limit) return Response.json({ error: "limit" }, { status: 409 });
      const instance = `inst-${String(this.#next++).padStart(8, "0")}`;
      this.seats.add(instance);
      return this.#grant(body, instance);
    }
    if (action === "refresh") {
      if (this.revoked.has(key) || !this.seats.has(body.instanceId ?? "")) {
        return Response.json({ error: "revoked" }, { status: 403 });
      }
      return this.#grant(body, body.instanceId ?? "");
    }
    if (action === "deactivate") {
      this.seats.delete(body.instanceId ?? "");
      return Response.json({ ok: true });
    }
    return new Response("", { status: 404 });
  };

  #grant(body: Record<string, string>, instance: string): Response {
    const iat = Math.floor(this.clock() / 1000);
    const payload = {
      v: 1,
      kid: "n1",
      plugin: body.pluginId,
      device: body.devicePublicKey,
      instance,
      iat,
      renewAfter: iat + 30 * DAY,
      exp: iat + 90 * DAY,
    };
    const text = b64u(JSON.stringify(payload));
    const signer = this.forge ? notaryKeys().privateKey : this.keys.privateKey;
    const signature = b64u(sign(null, Buffer.from(`cuelith-license-v1\n${text}`), signer));
    return Response.json({
      ok: true,
      token: `${text}.${signature}`,
      instanceId: instance,
      renewAfter: payload.renewAfter,
      expires: payload.exp,
    });
  }
}
