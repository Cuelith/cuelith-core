import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ErrorCode, RpcError } from "@cuelith/protocol";
import { writeFileAtomic } from "../show/files.js";

const FILE = "storage.json";
const MAX_KEY = 200;
/** Un modulo non deve poter riempire il disco del motore. */
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

/**
 * Spazio dati di un modulo (permesso "storage", cap. 24): coppie chiave/valore
 * JSON in un file della sua cartella privata, scritto in modo atomico.
 */
export class ModuleStorage {
  readonly #file: string;
  #data: Record<string, unknown> | undefined;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.#file = join(dataDir, FILE);
  }

  async #load(): Promise<Record<string, unknown>> {
    if (this.#data !== undefined) return this.#data;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#file, "utf8"));
      this.#data =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      this.#data = {};
    }
    return this.#data;
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async get(key: string): Promise<{ found: boolean; value?: unknown }> {
    const data = await this.#load();
    return Object.hasOwn(data, key) ? { found: true, value: data[key] } : { found: false };
  }

  set(key: string, value: unknown): Promise<void> {
    if (key.length > MAX_KEY) {
      return Promise.reject(new RpcError(ErrorCode.InvalidParameters, "core.error.storageKey"));
    }
    return this.#serial(async () => {
      const data = { ...(await this.#load()), [key]: value };
      const text = JSON.stringify(data);
      if (Buffer.byteLength(text) > MAX_TOTAL_BYTES) {
        throw new RpcError(ErrorCode.InvalidParameters, "core.error.storageFull");
      }
      await writeFileAtomic(this.#file, text);
      this.#data = data;
    });
  }

  delete(key: string): Promise<void> {
    return this.#serial(async () => {
      const current = await this.#load();
      if (!Object.hasOwn(current, key)) return;
      const data = Object.fromEntries(Object.entries(current).filter(([k]) => k !== key));
      await writeFileAtomic(this.#file, JSON.stringify(data));
      this.#data = data;
    });
  }
}
