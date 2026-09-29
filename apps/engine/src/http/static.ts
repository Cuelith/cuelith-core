import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Risolve un percorso richiesto dentro una cartella, o undefined se esce
 * dalla cartella (../, percorsi assoluti, caratteri nulli, codifiche rotte).
 */
export function resolveInside(root: string, requestPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const base = resolve(root);
  const target = resolve(base, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  if (target !== base && !target.startsWith(base + sep)) return undefined;
  return target;
}

export interface ServeOptions {
  /** File da servire se il percorso non esiste (pagina unica della postazione). */
  readonly fallback?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly head?: boolean;
}

/** Serve un file; restituisce false se non esiste (e non c'e' fallback). */
export async function serveFile(
  res: ServerResponse,
  root: string,
  requestPath: string,
  options: ServeOptions = {},
): Promise<boolean> {
  let file = resolveInside(root, requestPath);
  if (file !== undefined) {
    const info = await stat(file).catch(() => undefined);
    if (info?.isDirectory() === true) file = join(file, "index.html");
    else if (info === undefined) file = undefined;
  }
  if (file === undefined || !(await stat(file).catch(() => undefined))?.isFile()) {
    if (options.fallback === undefined) return false;
    file = options.fallback;
  }

  const info = await stat(file);
  res.writeHead(200, {
    "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": String(info.size),
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    ...options.headers,
  });
  if (options.head === true) {
    res.end();
    return true;
  }
  await new Promise<void>((done, fail) => {
    const stream = createReadStream(file);
    stream.on("error", fail);
    stream.on("end", done);
    stream.pipe(res);
  });
  return true;
}
