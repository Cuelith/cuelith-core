import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../show/files.js";
import type { SecretStore } from "./secrets.js";

const FILE = "vault.bin";

const Ed25519Key = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const EntrySchema = z.strictObject({
  /** La chiave ricevuta dal negozio: serve a rinnovare; non esce dal computer se non verso il Notaio. */
  licenseKey: z.string().min(8).max(80),
  /** Il posto di questo computer presso il fornitore. */
  instanceId: z.string().min(8).max(64),
  /** Il permesso firmato dal Notaio. */
  token: z.string().min(1).max(2048),
  activatedAt: z.iso.datetime(),
  /** Ultimo rinnovo riuscito. */
  checkedAt: z.iso.datetime(),
  /** Il fornitore ha disattivato la chiave (rimborso): quando e perché (codice del Notaio). */
  revoked: z.strictObject({ at: z.iso.datetime(), code: z.string().max(40) }).optional(),
});
export type VaultEntry = z.infer<typeof EntrySchema>;

const VaultSchema = z.strictObject({
  v: z.literal(1),
  /** Coppia di chiavi del computer: casuale, nata qui, mai uscita da qui (la pubblica va al Notaio). */
  device: z.strictObject({ publicKey: Ed25519Key, privateKey: z.string().min(1) }),
  licenses: z.record(z.string(), EntrySchema),
});
type VaultData = z.infer<typeof VaultSchema>;

/** Una coppia di chiavi Ed25519 nuova: pubblica in base64url (32 byte), privata PKCS8 in base64. */
export function newDeviceKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("base64url"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

/**
 * Il "caveau" delle licenze: un solo file cifrato con la custodia del sistema,
 * che contiene la chiave del computer e, per ogni plugin, chiave di licenza,
 * posto e permesso. Si legge una volta all'avvio e resta in memoria; ogni
 * modifica lo riscrive per intero in modo atomico. Se non si riesce a
 * decifrarlo (profilo spostato, utente diverso) si riparte vuoti senza
 * toccare il file: l'utente riattiva le sue licenze.
 */
export class Vault {
  readonly #file: string;
  readonly #secrets: SecretStore;
  #data: VaultData | undefined;

  constructor(dir: string, secrets: SecretStore) {
    this.#file = join(dir, FILE);
    this.#secrets = secrets;
  }

  /** Legge il caveau. Restituisce false se il file c'è ma non si decifra (da riattivare). */
  async load(): Promise<boolean> {
    let raw: string;
    try {
      raw = await readFile(this.#file, "utf8");
    } catch {
      return true; // nessun caveau ancora
    }
    try {
      const parsed = VaultSchema.safeParse(
        JSON.parse(this.#secrets.decrypt(Buffer.from(raw.trim(), "base64"))),
      );
      if (!parsed.success) return false;
      this.#data = parsed.data;
      return true;
    } catch {
      return false;
    }
  }

  /** La chiave pubblica del computer se già esiste (senza crearla). */
  peekDevice(): string | undefined {
    return this.#data?.device.publicKey;
  }

  /** La coppia di chiavi del computer; si crea la prima volta che serve. */
  async device(): Promise<{ publicKey: string }> {
    if (this.#data === undefined) {
      this.#data = { v: 1, device: newDeviceKeys(), licenses: {} };
      await this.#save();
    }
    return { publicKey: this.#data.device.publicKey };
  }

  entries(): Readonly<Record<string, VaultEntry>> {
    return this.#data?.licenses ?? {};
  }

  entry(pluginId: string): VaultEntry | undefined {
    return this.#data?.licenses[pluginId];
  }

  async set(pluginId: string, entry: VaultEntry): Promise<void> {
    await this.device();
    const data = this.#require();
    this.#data = { ...data, licenses: { ...data.licenses, [pluginId]: entry } };
    await this.#save();
  }

  async remove(pluginId: string): Promise<void> {
    const data = this.#data;
    if (data === undefined || !(pluginId in data.licenses)) return;
    const { [pluginId]: _gone, ...rest } = data.licenses;
    this.#data = { ...data, licenses: rest };
    await this.#save();
  }

  /** Firma con la chiave privata del computer (sfida di un plugin). Base64url. */
  signWithDevice(message: string): string {
    const key = createPrivateKey({
      key: Buffer.from(this.#require().device.privateKey, "base64"),
      format: "der",
      type: "pkcs8",
    });
    return sign(null, Buffer.from(message), key).toString("base64url");
  }

  /** Cancella il file (per le prove). */
  async destroy(): Promise<void> {
    this.#data = undefined;
    await rm(this.#file, { force: true });
  }

  #require(): VaultData {
    if (this.#data === undefined) throw new Error("caveau non inizializzato");
    return this.#data;
  }

  async #save(): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true });
    const sealed = this.#secrets.encrypt(JSON.stringify(this.#require()));
    await writeFileAtomic(this.#file, Buffer.from(sealed).toString("base64"));
  }
}
