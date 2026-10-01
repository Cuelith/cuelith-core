import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import type { Duplex } from "node:stream";
import { MDNS_SERVICE_TYPE, type NetworkState } from "@cuelith/protocol";
import { Bonjour } from "bonjour-service";
import type { Logger } from "./log.js";
import { writeFileAtomic } from "./show/files.js";
import type { StateStore } from "./state/store.js";

export interface NetworkOptions {
  /** Il server locale (127.0.0.1): quello in rete gli passa richieste e WebSocket. */
  readonly local: Server;
  readonly store: StateStore;
  readonly logger: Logger;
  /** Dove resta la scelta dell'utente (accesa/spenta, indirizzo). */
  readonly file: string;
  /** Porta in rete: fissa, cosi' le postazioni la ritrovano (0 = qualsiasi, per le prove). */
  readonly port: number;
  /** Nome mostrato nell'annuncio in rete. */
  readonly name: string;
  /** Annuncio mDNS `_cuelith._tcp` (spento nelle prove). */
  readonly announce: boolean;
}

interface Saved {
  enabled: boolean;
  address?: string;
}

const RETRY_MS = 10_000;

/** Indirizzi IPv4 del computer raggiungibili dalla rete locale. */
export function lanInterfaces(): { name: string; address: string }[] {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? [])
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => ({ name, address: entry.address })),
  );
}

/**
 * Postazioni in rete locale (cap. 9 e 27). Di base il motore ascolta solo su
 * 127.0.0.1. Se l'utente lo chiede si apre un secondo ascolto sull'indirizzo
 * di rete che ha scelto (mai su tutti): serve le stesse pagine e lo stesso
 * protocollo, ma chi arriva da li' deve abbinarsi con un codice. La scelta
 * resta tra un avvio e l'altro; se la rete non c'e' si riprova da soli.
 */
export class NetworkService {
  readonly #options: NetworkOptions;
  #saved: Saved = { enabled: false };
  #lan: Server | undefined;
  /** Connessioni arrivate dalla rete (anche i WebSocket): si chiudono con l'ascolto. */
  readonly #sockets = new Set<Duplex>();
  #bonjour: Bonjour | undefined;
  #retry: NodeJS.Timeout | undefined;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: NetworkOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.#options.file, "utf8")) as Partial<Saved>;
      this.#saved = {
        enabled: raw.enabled === true,
        ...(typeof raw.address === "string" ? { address: raw.address } : {}),
      };
    } catch {
      this.#saved = { enabled: false };
    }
    await this.#apply();
  }

  /** Accende o spegne l'ascolto in rete; senza indirizzo, il primo disponibile. */
  set(enabled: boolean, address?: string): Promise<void> {
    const run = this.#queue.then(async () => {
      this.#saved = { enabled, ...(address === undefined ? {} : { address }) };
      await writeFileAtomic(this.#options.file, `${JSON.stringify(this.#saved, null, 2)}\n`);
      await this.#apply();
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async stop(): Promise<void> {
    if (this.#retry !== undefined) clearTimeout(this.#retry);
    this.#retry = undefined;
    await this.#close();
  }

  #publish(state: NetworkState | undefined): void {
    this.#options.store.update((draft) => {
      if (state === undefined) delete draft.live.network;
      else draft.live.network = state;
    });
  }

  async #close(): Promise<void> {
    this.#bonjour?.unpublishAll();
    this.#bonjour?.destroy();
    this.#bonjour = undefined;
    const lan = this.#lan;
    this.#lan = undefined;
    if (lan === undefined) return;
    await new Promise<void>((resolve) => {
      lan.close(() => {
        resolve();
      });
      // Spenta la rete, le postazioni collegate da li' vengono scollegate.
      for (const socket of this.#sockets) socket.destroy();
      this.#sockets.clear();
    });
  }

  async #apply(): Promise<void> {
    if (this.#retry !== undefined) clearTimeout(this.#retry);
    this.#retry = undefined;
    await this.#close();
    if (!this.#saved.enabled) {
      this.#publish(undefined);
      return;
    }
    const available = lanInterfaces().map((i) => i.address);
    const address =
      this.#saved.address !== undefined && available.includes(this.#saved.address)
        ? this.#saved.address
        : this.#saved.address === undefined
          ? available[0]
          : undefined;
    if (address === undefined) {
      this.#failed("core.network.addressMissing", this.#saved.address);
      return;
    }
    try {
      const port = await this.#listen(address);
      this.#publish({ enabled: true, address, port, urls: [`http://${address}:${port}/`] });
      this.#options.logger.info(`postazioni in rete: http://${address}:${port}/`);
      this.#announce(port);
    } catch (error) {
      this.#options.logger.warn("ascolto in rete non riuscito", error);
      this.#failed(
        (error as NodeJS.ErrnoException).code === "EADDRINUSE"
          ? "core.network.portBusy"
          : "core.network.listenFailed",
        address,
      );
    }
  }

  /** L'ascolto non e' partito: lo si dice e si riprova (la rete puo' tornare). */
  #failed(error: string, address: string | undefined): void {
    this.#publish({
      enabled: true,
      ...(address === undefined ? {} : { address }),
      urls: [],
      error,
    });
    this.#retry = setTimeout(() => {
      this.#queue = this.#queue.then(() => this.#apply()).catch(() => undefined);
    }, RETRY_MS);
    this.#retry.unref();
  }

  #listen(address: string): Promise<number> {
    const { local } = this.#options;
    // Solo richieste rivolte a questo indirizzo: una pagina web qualunque non
    // puo' far puntare il browser al motore con un altro nome (DNS rebinding).
    const hostAllowed = (request: IncomingMessage, port: number) => {
      const host = request.headers.host;
      return host === `${address}:${port}` || (port === 80 && host === address);
    };
    const lan = createServer();
    lan.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.once("close", () => this.#sockets.delete(socket));
    });
    lan.on("request", (request, response) => {
      if (!hostAllowed(request, (lan.address() as AddressInfo).port)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("403");
        return;
      }
      local.emit("request", request, response);
    });
    lan.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!hostAllowed(request, (lan.address() as AddressInfo).port)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      local.emit("upgrade", request, socket, head);
    });
    return new Promise<number>((resolve, reject) => {
      lan.once("error", reject);
      lan.listen(this.#options.port, address, () => {
        lan.off("error", reject);
        lan.on("error", (error) => {
          this.#options.logger.warn("errore sull'ascolto in rete", error);
        });
        this.#lan = lan;
        resolve((lan.address() as AddressInfo).port);
      });
    });
  }

  /** Annuncio `_cuelith._tcp`: programmi e dispositivi possono trovare il motore da soli. */
  #announce(port: number): void {
    if (!this.#options.announce) return;
    try {
      this.#bonjour = new Bonjour(undefined, (error: unknown) => {
        this.#options.logger.warn("annuncio in rete non riuscito", error);
      });
      this.#bonjour.publish({ name: this.#options.name, type: MDNS_SERVICE_TYPE, port });
    } catch (error) {
      this.#options.logger.warn("annuncio in rete non riuscito", error);
    }
  }
}
