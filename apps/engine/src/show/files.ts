import { randomBytes } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  ErrorCode,
  RpcError,
  SHOW_FILE_EXTENSION,
  SHOW_SCHEMA_VERSION,
  ShowSchema,
  type Show,
} from "@cuelith/protocol";

/** Solo percorsi assoluti che finiscono con .cuelith: il motore non scrive altri file. */
export function checkShowPath(path: string): string {
  if (!isAbsolute(path) || !path.toLowerCase().endsWith(SHOW_FILE_EXTENSION)) {
    throw new RpcError(ErrorCode.InvalidParameters, "core.error.showPathInvalid");
  }
  return path;
}

export function serializeShow(show: Show): string {
  return `${JSON.stringify(show, null, 2)}\n`;
}

/**
 * Scrittura atomica (cap. 27): si scrive un file temporaneo nella stessa
 * cartella, lo si forza sul disco e lo si rinomina sopra quello vero. Se
 * qualcosa va storto il file precedente resta intatto e il temporaneo sparisce.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeShowFile(path: string, show: Show): Promise<void> {
  try {
    await writeFileAtomic(path, serializeShow(show));
  } catch (error) {
    throw new RpcError(ErrorCode.InternalError, "core.error.showSaveFailed", {
      params: { reason: (error as NodeJS.ErrnoException).code ?? "EIO" },
    });
  }
}

/** Legge e valida un file di show; ogni problema diventa un errore tradotto. */
export async function readShowFile(path: string): Promise<Show> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new RpcError(ErrorCode.NotFound, "core.error.showNotFound");
    throw new RpcError(ErrorCode.InternalError, "core.error.showUnreadable");
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new RpcError(ErrorCode.InvalidParameters, "core.error.showUnreadable");
  }
  const schema = (data as { schema?: unknown } | null)?.schema;
  if (typeof schema === "number" && schema > SHOW_SCHEMA_VERSION) {
    throw new RpcError(ErrorCode.InvalidParameters, "core.error.showTooNew");
  }
  const result = ShowSchema.safeParse(data);
  if (!result.success) {
    throw new RpcError(ErrorCode.InvalidParameters, "core.error.showInvalid", {
      issues: result.error.issues.slice(0, 20).map((i) => ({
        message: i.message,
        path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
      })),
    });
  }
  return result.data;
}
