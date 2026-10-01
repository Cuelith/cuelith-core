import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { RPC_PATH } from "@cuelith/protocol";
import type { Logger } from "../log.js";
import { serveMedia } from "./media.js";
import { serveFile } from "./static.js";

export interface StaticPaths {
  /** Postazione (React), costruita. */
  readonly client: string;
  /** Renderer delle uscite, costruito. Assente finche' non esiste. */
  readonly renderer?: string;
  /** dist di @cuelith/ui: colori, font, classi comuni. */
  readonly ui: string;
  /** Archivio media (cartella dati/media), servito sotto /media/. */
  readonly media?: string;
  /** Cartella di un modulo installato (id + versione), per i suoi file (guide, pannelli). */
  readonly pluginDir?: (id: string, version: string) => string | undefined;
}

/**
 * File di un modulo: stanno in un'area a parte. Le pagine dei moduli girano
 * isolate (sandbox) e senza rete verso l'esterno (cap. 24 e 27).
 */
const PLUGIN_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'; sandbox allow-scripts",
  "Referrer-Policy": "no-referrer",
  // I pannelli girano isolati (origine "null"): per caricare script e font del
  // modulo serve il permesso esplicito. Sono file pubblici, come quelli di /ui/.
  "Access-Control-Allow-Origin": "*",
};

/** Colori, font e stili comuni: pubblici, usati anche dai pannelli isolati dei moduli. */
const UI_HEADERS = { "Access-Control-Allow-Origin": "*" };

/** Politica di sicurezza delle pagine del nucleo: niente risorse esterne. */
function csp(host: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self' ws://${host}`,
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function send(res: ServerResponse, status: number): void {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(String(status));
}

export function createHttpServer(paths: StaticPaths, logger: Logger): Server {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405);
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const head = req.method === "HEAD";
    const pageHeaders = {
      "Content-Security-Policy": csp(req.headers.host ?? "localhost"),
      "Referrer-Policy": "no-referrer",
    };

    if (path === RPC_PATH) {
      send(res, 426);
      return;
    }
    if (path.startsWith("/ui/")) {
      const served = await serveFile(res, paths.ui, path.slice("/ui".length), {
        head,
        headers: UI_HEADERS,
      });
      if (!served) send(res, 404);
      return;
    }
    const plugin = /^\/plugins\/([a-z0-9.-]+)\/([0-9A-Za-z.+-]+)(\/.*)$/.exec(path);
    if (plugin !== null) {
      const [, id = "", version = "", rest = "/"] = plugin;
      const dir = paths.pluginDir?.(id, version);
      const served =
        dir !== undefined && (await serveFile(res, dir, rest, { head, headers: PLUGIN_HEADERS }));
      if (!served) send(res, 404);
      return;
    }
    if (path.startsWith("/media/")) {
      const served =
        paths.media !== undefined &&
        (await serveMedia(res, paths.media, path.slice("/media/".length), {
          head,
          range: req.headers.range,
        }));
      if (!served) send(res, 404);
      return;
    }
    if (path === "/renderer" || path.startsWith("/renderer/")) {
      const root = paths.renderer;
      const served =
        root !== undefined &&
        (await serveFile(res, root, path.slice("/renderer".length) || "/", {
          head,
          headers: pageHeaders,
          ...(extname(path) === "" ? { fallback: join(root, "index.html") } : {}),
        }));
      if (!served) send(res, 404);
      return;
    }
    // Postazione: pagina unica. Un percorso senza estensione torna a
    // index.html; un file mancante (script, font) resta un 404 esplicito.
    const served = await serveFile(res, paths.client, path, {
      head,
      headers: pageHeaders,
      ...(extname(path) === "" ? { fallback: join(paths.client, "index.html") } : {}),
    });
    if (!served) send(res, 404);
  };

  // Diagnosi: CUELITH_HTTP_LOG=1 registra ogni richiesta, all'arrivo e alla fine.
  const trace = process.env["CUELITH_HTTP_LOG"] === "1";
  return createServer((req, res) => {
    if (trace) {
      const started = Date.now();
      const label = `${req.method ?? ""} ${req.url ?? ""}`;
      logger.info(`http > ${label}`);
      res.once("close", () => {
        logger.info(
          `http < ${label} ${String(res.statusCode)} ${String(Date.now() - started)}ms ${res.writableFinished ? "completa" : "interrotta"}`,
        );
      });
    }
    handle(req, res).catch((error: unknown) => {
      logger.error("errore servendo una risorsa", error);
      if (!res.headersSent) send(res, 500);
      else res.destroy();
    });
  });
}
