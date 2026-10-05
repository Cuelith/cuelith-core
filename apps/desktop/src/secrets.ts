import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SecretStore } from "@cuelith-core/engine";
import { safeStorage } from "electron";

/**
 * Custodia dei segreti con la cifratura del sistema operativo (`safeStorage`):
 * DPAPI su Windows, Portachiavi su macOS, libsecret su Linux. I dati si
 * decifrano solo sullo stesso computer e per lo stesso utente: copiare la
 * cartella dei dati altrove non porta con sé le licenze.
 *
 * Su Linux, se non c'è un portachiavi, Electron ripiega su un testo non
 * protetto ("basic_text"): lì NON si custodisce nulla, e le licenze dei plugin
 * a pagamento non si attivano (meglio dirlo che fingere sicurezza).
 */
export function electronSecrets(): SecretStore {
  return {
    isAvailable: () => {
      if (!safeStorage.isEncryptionAvailable()) return false;
      if (process.platform !== "linux") return true;
      const backend = safeStorage.getSelectedStorageBackend();
      return backend !== "basic_text" && backend !== "unknown";
    },
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(Buffer.from(data)),
  };
}

/**
 * SOLO per le prove automatiche (variabile CUELITH_TEST_SECRETS=memory): una
 * custodia con una chiave casuale che vive nella memoria del processo, così le
 * prove non dipendono dal portachiavi della macchina. Mai in produzione: senza
 * la variabile si usa sempre `electronSecrets`.
 */
export function memorySecrets(): SecretStore {
  const key = randomBytes(32);
  return {
    isAvailable: () => true,
    encrypt: (plain) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decrypt: (data) => {
      const buffer = Buffer.from(data);
      const decipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString(
        "utf8",
      );
    },
  };
}
