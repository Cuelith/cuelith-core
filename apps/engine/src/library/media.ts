import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { ErrorCode, RpcError, type MediaInfo, type MediaKind } from "@cuelith/protocol";

/** Formati accettati (decisioni 0001 e 0003): estensione -> tipo e MIME. */
export const MEDIA_FORMATS: Readonly<Record<string, { kind: MediaKind; mime: string }>> = {
  png: { kind: "image", mime: "image/png" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  webp: { kind: "image", mime: "image/webp" },
  gif: { kind: "image", mime: "image/gif" },
  svg: { kind: "image", mime: "image/svg+xml" },
  mp3: { kind: "audio", mime: "audio/mpeg" },
  wav: { kind: "audio", mime: "audio/wav" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  aac: { kind: "audio", mime: "audio/aac" },
  flac: { kind: "audio", mime: "audio/flac" },
  ogg: { kind: "audio", mime: "audio/ogg" },
  opus: { kind: "audio", mime: "audio/ogg" },
  mp4: { kind: "video", mime: "video/mp4" },
  m4v: { kind: "video", mime: "video/mp4" },
  webm: { kind: "video", mime: "video/webm" },
  mov: { kind: "video", mime: "video/quicktime" },
};

/** Limite di un singolo file: 4 GB (un video lungo ci sta, un errore di scelta no). */
export const MEDIA_MAX_BYTES = 4 * 1024 ** 3;

export function formatOf(
  fileName: string,
): { ext: string; kind: MediaKind; mime: string } | undefined {
  const ext = extname(fileName).slice(1).toLowerCase();
  const format = MEDIA_FORMATS[ext];
  return format === undefined ? undefined : { ext: ext === "jpeg" ? "jpg" : ext, ...format };
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/**
 * Archivio media: i file si copiano con nome = impronta del contenuto,
 * cosi' spostare o cancellare l'originale non rompe nulla e due copie
 * uguali occupano spazio una volta sola.
 */
export class MediaFiles {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async start(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  pathOf(id: string): string {
    return join(this.dir, id);
  }

  async import(source: string): Promise<Omit<MediaInfo, "name"> & { name: string }> {
    const format = formatOf(source);
    if (format === undefined)
      throw new RpcError(ErrorCode.InvalidParameters, "core.error.mediaUnsupported");
    let size: number;
    try {
      const info = await stat(source);
      if (!info.isFile()) throw new Error("non e' un file");
      size = info.size;
    } catch {
      throw new RpcError(ErrorCode.NotFound, "core.error.mediaNotFound");
    }
    if (size > MEDIA_MAX_BYTES)
      throw new RpcError(ErrorCode.InvalidParameters, "core.error.mediaTooLarge");

    const id = `${await sha256(source)}.${format.ext}`;
    const target = this.pathOf(id);
    const exists = await stat(target).then(
      () => true,
      () => false,
    );
    if (!exists) {
      const temp = join(this.dir, `.${randomBytes(6).toString("hex")}.tmp`);
      try {
        await copyFile(source, temp);
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true });
        throw new RpcError(ErrorCode.InternalError, "core.error.mediaCopyFailed", {
          params: { reason: (error as NodeJS.ErrnoException).code ?? "EIO" },
        });
      }
    }
    return { id, name: basename(source), kind: format.kind, mime: format.mime, size };
  }
}
