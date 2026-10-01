import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  BUILTIN_ROLES,
  ErrorCode,
  newId,
  RpcError,
  type BuiltinRoleId,
  type ClientKind,
  type PairedStation,
} from "@cuelith/protocol";
import { writeFileAtomic } from "./show/files.js";

export interface TokenGrant {
  readonly role: BuiltinRoleId;
  readonly kind: ClientKind;
  readonly local: boolean;
  /** Postazione abbinata in rete: il suo id stabile. */
  readonly pairedId?: string;
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

interface StoredStation extends PairedStation {
  /** Impronta SHA-256 del token: il token vero lo conosce solo la postazione. */
  readonly tokenHash: string;
}

/** Il codice vale 5 minuti e si brucia dopo 5 tentativi sbagliati (cap. 27). */
export const PAIRING_CODE_MS = 5 * 60 * 1000;
export const PAIRING_MAX_ATTEMPTS = 5;
const MAX_NAME = 80;

interface PendingPairing {
  readonly code: string;
  readonly role: BuiltinRoleId;
  readonly expiresAt: number;
  attempts: number;
}

/**
 * Credenziali delle postazioni (cap. 23 e 27). Le due locali (postazione e
 * finestre di uscita sullo stesso computer) nascono a ogni avvio e arrivano
 * alle finestre Electron dal processo principale, mai via rete. Le postazioni
 * in rete si abbinano con un codice a 6 cifre mostrato sul motore e ricevono
 * un token loro, revocabile; sul disco resta solo l'impronta del token.
 */
export class Tokens {
  readonly station = randomToken();
  readonly renderer = randomToken();
  #stations: StoredStation[] = [];
  #file: string | undefined;
  #pending: PendingPairing | undefined;
  #queue: Promise<unknown> = Promise.resolve();

  /** Legge le postazioni abbinate; un file rovinato non blocca l'avvio (si riabbinano). */
  async load(file: string): Promise<void> {
    this.#file = file;
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as { stations?: StoredStation[] };
      this.#stations = (raw.stations ?? []).filter(
        (s) =>
          typeof s.id === "string" &&
          typeof s.name === "string" &&
          typeof s.tokenHash === "string" &&
          Object.hasOwn(BUILTIN_ROLES, s.role),
      );
    } catch {
      this.#stations = [];
    }
  }

  #save(): Promise<void> {
    const file = this.#file;
    if (file === undefined) return Promise.resolve();
    const write = () =>
      writeFileAtomic(
        file,
        `${JSON.stringify({ schema: 1, stations: this.#stations }, null, 2)}\n`,
      );
    const run = this.#queue.then(write, write);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  resolve(token: string): TokenGrant | undefined {
    if (sameToken(token, this.station)) return { role: "director", kind: "client", local: true };
    if (sameToken(token, this.renderer)) return { role: "viewer", kind: "renderer", local: true };
    const hash = hashOf(token);
    const paired = this.#stations.find((s) => sameToken(s.tokenHash, hash));
    if (paired === undefined) return undefined;
    return {
      role: paired.role as BuiltinRoleId,
      kind: "client",
      local: false,
      pairedId: paired.id,
    };
  }

  /** Nuovo codice a 6 cifre per abbinare una postazione con quel ruolo (uno alla volta). */
  startPairing(role: BuiltinRoleId, now = Date.now()): { code: string; expiresAt: string } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = now + PAIRING_CODE_MS;
    this.#pending = { code, role, expiresAt, attempts: 0 };
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  cancelPairing(): void {
    this.#pending = undefined;
  }

  /**
   * La postazione nuova presenta il codice: se e' giusto riceve il suo token
   * (una volta sola) e il codice non vale piu'.
   */
  async redeem(
    code: string,
    name: string,
    now = Date.now(),
  ): Promise<{ token: string; station: PairedStation }> {
    const pending = this.#pending;
    if (pending === undefined || now > pending.expiresAt) {
      this.#pending = undefined;
      throw new RpcError(ErrorCode.NotPaired, "core.pairing.codeExpired");
    }
    if (!sameToken(code, pending.code)) {
      pending.attempts++;
      if (pending.attempts >= PAIRING_MAX_ATTEMPTS) this.#pending = undefined;
      throw new RpcError(ErrorCode.NotPaired, "core.pairing.codeWrong");
    }
    this.#pending = undefined;
    const token = randomToken();
    const station: PairedStation = {
      id: newId(),
      name: name.trim().slice(0, MAX_NAME) || "?",
      role: pending.role,
      createdAt: new Date(now).toISOString(),
    };
    this.#stations = [...this.#stations, { ...station, tokenHash: hashOf(token) }];
    await this.#save();
    return { token, station };
  }

  paired(): PairedStation[] {
    return this.#stations.map(({ tokenHash: _hash, ...station }) => station);
  }

  /** Segna l'ultimo accesso (salvato senza far aspettare la postazione). */
  seen(id: string, now = Date.now()): void {
    this.#stations = this.#stations.map((s) =>
      s.id === id ? { ...s, lastSeenAt: new Date(now).toISOString() } : s,
    );
    void this.#save().catch(() => undefined);
  }

  /** Revoca: il token smette di valere subito. Restituisce false se non c'era. */
  async revoke(id: string): Promise<boolean> {
    const before = this.#stations.length;
    this.#stations = this.#stations.filter((s) => s.id !== id);
    if (this.#stations.length === before) return false;
    await this.#save();
    return true;
  }
}
