import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import { ErrorCode, RpcError } from "@cuelith/protocol";

/** Limiti di un pacchetto: nessun modulo serio li sfiora, uno zip malevolo si'. */
export const PACKAGE_LIMITS = {
  /** Pacchetto compresso scaricato. */
  maxDownloadBytes: 200 * 1024 ** 2,
  /** Somma dei file estratti. */
  maxExtractedBytes: 500 * 1024 ** 2,
  maxFiles: 10_000,
} as const;

const invalid = (key: string, params?: Record<string, string>) =>
  new RpcError(ErrorCode.InvalidParameters, key, params === undefined ? undefined : { params });

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Percorso sicuro di un file dello zip dentro la cartella di destinazione:
 * niente assoluti, niente "..", niente barre rovesciate, niente caratteri nulli.
 */
export function safeEntryPath(root: string, name: string): string | undefined {
  if (name === "" || name.includes("\0") || name.includes("\\") || name.startsWith("/")) {
    return undefined;
  }
  if (/^[a-zA-Z]:/.test(name)) return undefined;
  const parts = name.split("/");
  if (parts.some((part) => part === "..")) return undefined;
  const base = resolve(root);
  const target = resolve(base, ...parts.filter((part) => part !== "" && part !== "."));
  return target.startsWith(base + sep) ? target : undefined;
}

/**
 * Estrae un pacchetto .cpkg (zip) in una cartella vuota, controllando ogni
 * voce. Il manifest deve stare nella radice dello zip (cap. 26).
 */
export async function extractPackage(data: Uint8Array, target: string): Promise<void> {
  if (data.byteLength > PACKAGE_LIMITS.maxDownloadBytes)
    throw invalid("core.error.packageTooLarge");
  let entries: Record<string, Uint8Array>;
  let files = 0;
  let total = 0;
  try {
    entries = unzipSync(data, {
      // Controllo prima di decomprimere: niente sorprese da uno zip gonfiato.
      filter: (file) => {
        files += 1;
        total += file.originalSize;
        if (files > PACKAGE_LIMITS.maxFiles || total > PACKAGE_LIMITS.maxExtractedBytes) {
          throw invalid("core.error.packageTooLarge");
        }
        return !file.name.endsWith("/");
      },
    });
  } catch (error) {
    if (error instanceof RpcError) throw error;
    throw invalid("core.error.packageUnreadable");
  }
  for (const [name, content] of Object.entries(entries)) {
    const path = safeEntryPath(target, name);
    if (path === undefined) throw invalid("core.error.packageUnsafePath", { path: name });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  if (!Object.keys(entries).includes("cuelith-plugin.json")) {
    throw invalid("core.error.packageNoManifest");
  }
}

/** Percorso di una cartella di lavoro dentro quella dei moduli. */
export const stagingDir = (pluginsDir: string, name: string): string =>
  join(pluginsDir, ".staging", name);
