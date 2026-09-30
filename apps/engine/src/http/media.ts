import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { MediaIdSchema } from "@cuelith/protocol";
import { formatOf } from "../library/media.js";

/**
 * I file dell'archivio non sono pagine: anche un SVG con script dentro, se
 * aperto direttamente, non esegue nulla e non vede la postazione.
 */
const MEDIA_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  "X-Content-Type-Options": "nosniff",
  // Il nome e' l'impronta del contenuto: non cambia mai.
  "Cache-Control": "public, max-age=31536000, immutable",
  "Accept-Ranges": "bytes",
};

/** "bytes=a-b" -> intervallo valido dentro il file, o null se non soddisfacibile. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || size === 0) return null;
  const [, a = "", b = ""] = match;
  if (a === "" && b === "") return null;
  let start: number;
  let end: number;
  if (a === "") {
    // Ultimi N byte.
    start = Math.max(0, size - Number(b));
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

/** Serve un file dell'archivio; false se l'id non e' valido o il file non c'e'. */
export async function serveMedia(
  res: ServerResponse,
  dir: string,
  id: string,
  options: { head: boolean; range: string | undefined },
): Promise<boolean> {
  if (!MediaIdSchema.safeParse(id).success) return false;
  const format = formatOf(id);
  const file = join(dir, id);
  const info = await stat(file).catch(() => undefined);
  if (format === undefined || info?.isFile() !== true) return false;

  const type = { "Content-Type": format.mime, ...MEDIA_HEADERS };
  if (options.range !== undefined) {
    const range = parseRange(options.range, info.size);
    if (range === null) {
      res.writeHead(416, { ...type, "Content-Range": `bytes */${String(info.size)}` });
      res.end();
      return true;
    }
    res.writeHead(206, {
      ...type,
      "Content-Range": `bytes ${String(range.start)}-${String(range.end)}/${String(info.size)}`,
      "Content-Length": String(range.end - range.start + 1),
    });
    if (options.head) {
      res.end();
      return true;
    }
    await pipe(res, file, range);
    return true;
  }
  res.writeHead(200, { ...type, "Content-Length": String(info.size) });
  if (options.head) {
    res.end();
    return true;
  }
  await pipe(res, file);
  return true;
}

function pipe(
  res: ServerResponse,
  file: string,
  range?: { start: number; end: number },
): Promise<void> {
  return new Promise((done, fail) => {
    const stream = createReadStream(file, range);
    stream.on("error", fail);
    stream.on("end", done);
    stream.pipe(res);
  });
}
