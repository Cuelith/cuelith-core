import { rename as fsRename } from "node:fs/promises";
import { setTimeout as sleepFor } from "node:timers/promises";

/** Errori che su Windows vuol dire «un altro programma ha ancora il file aperto»: passano da soli. */
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);

export interface RenameOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
  /** Solo per le prove. */
  readonly rename?: (from: string, to: string) => Promise<void>;
  readonly sleep?: (ms: number) => Promise<unknown>;
}

/**
 * Rinomina una cartella riprovando se Windows la tiene occupata (antivirus che
 * controlla i file appena scritti, indicizzazione). Ogni tentativo aspetta un
 * poco di piu' del precedente; un errore diverso (cartella che non c'e', disco
 * pieno) si segnala subito, senza riprovare.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  options: RenameOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 6;
  const delayMs = options.delayMs ?? 60;
  const rename = options.rename ?? fsRename;
  const sleep = options.sleep ?? ((ms: number) => sleepFor(ms));
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === undefined || !TRANSIENT.has(code) || attempt >= attempts) throw error;
      await sleep(delayMs * attempt);
    }
  }
}
