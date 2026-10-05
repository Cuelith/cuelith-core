import { readFile } from "node:fs/promises";
import {
  ErrorCode,
  PROTOCOL_VERSION,
  RegistryIndexSchema,
  RpcError,
  type RegistryPlugin,
  type RegistryVersion,
} from "@cuelith/protocol";
import { satisfies } from "semver";
import type { Logger } from "../log.js";
import { writeFileAtomic } from "../show/files.js";
import { PACKAGE_LIMITS, sha256Hex } from "./package.js";

export type Fetch = typeof fetch;

export interface MarketplaceOptions {
  readonly url: string;
  /**
   * Indice di ripiego se il primo non risponde o non si legge (indice 1, solo plugin
   * gratuiti): finché l'indice 2 non è pubblicato il marketplace funziona lo stesso.
   */
  readonly fallbackUrl?: string;
  /** Copia dell'ultimo indice scaricato, per lavorare senza internet. */
  readonly cacheFile: string;
  readonly engineVersion: string;
  readonly logger: Logger;
  /** Solo per le prove: si sostituisce la rete. */
  readonly fetch?: Fetch;
}

export interface MarketplaceList {
  readonly plugins: RegistryPlugin[];
  readonly source: "network" | "cache" | "none";
  readonly fetchedAt?: string;
}

const TIMEOUT_MS = 15_000;

/**
 * Marketplace (cap. 26): indice dei moduli su GitHub Pages, pacchetti nelle
 * GitHub Releases. Si mostrano solo le versioni compatibili con questo nucleo;
 * ogni pacchetto si verifica con l'impronta SHA-256 prima di installarlo.
 */
export class Marketplace {
  readonly #o: MarketplaceOptions;
  #last: MarketplaceList | undefined;

  constructor(options: MarketplaceOptions) {
    this.#o = options;
  }

  get #fetch(): Fetch {
    return this.#o.fetch ?? fetch;
  }

  #compatible(plugins: readonly RegistryPlugin[]): RegistryPlugin[] {
    return plugins.flatMap((plugin) => {
      const versions = plugin.versions.filter(
        (v) =>
          satisfies(this.#o.engineVersion, v.engines.cuelith, { includePrerelease: true }) &&
          satisfies(PROTOCOL_VERSION, v.engines.protocol),
      );
      return versions.length === 0 ? [] : [{ ...plugin, versions }];
    });
  }

  async list(refresh = false): Promise<MarketplaceList> {
    if (!refresh && this.#last?.source === "network") return this.#last;
    const errors: string[] = [];
    for (const url of [this.#o.url, this.#o.fallbackUrl]) {
      if (url === undefined) continue;
      try {
        const response = await this.#fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        const index = RegistryIndexSchema.parse(await response.json());
        const fetchedAt = new Date().toISOString();
        await writeFileAtomic(this.#o.cacheFile, `${JSON.stringify({ fetchedAt, index })}\n`).catch(
          (error: unknown) => {
            this.#o.logger.warn("copia dell'indice dei moduli non salvata", error);
          },
        );
        this.#last = { plugins: this.#compatible(index.plugins), source: "network", fetchedAt };
        return this.#last;
      } catch (error) {
        errors.push(`${url}: ${String(error)}`);
      }
    }
    this.#o.logger.warn("indice dei moduli non raggiungibile, uso la copia salvata", errors);
    this.#last = await this.#fromCache();
    return this.#last;
  }

  async #fromCache(): Promise<MarketplaceList> {
    try {
      const raw = JSON.parse(await readFile(this.#o.cacheFile, "utf8")) as {
        fetchedAt?: unknown;
        index?: unknown;
      };
      const index = RegistryIndexSchema.parse(raw.index);
      const fetchedAt = typeof raw.fetchedAt === "string" ? raw.fetchedAt : undefined;
      return {
        plugins: this.#compatible(index.plugins),
        source: "cache",
        ...(fetchedAt === undefined ? {} : { fetchedAt }),
      };
    } catch {
      return { plugins: [], source: "none" };
    }
  }

  /** La voce di un plugin nel marketplace (con le sole versioni compatibili), se c'è. */
  async pluginOf(id: string): Promise<RegistryPlugin | undefined> {
    const known = (await this.list(false)).plugins.find((p) => p.id === id);
    if (known !== undefined) return known;
    return (await this.list(true)).plugins.find((p) => p.id === id);
  }

  /** Versione richiesta (o la piu' recente compatibile) di un modulo del marketplace. */
  async find(id: string, version?: string): Promise<RegistryVersion> {
    // "L'ultima versione" si chiede all'indice aggiornato; una versione precisa
    // si cerca prima nella copia gia' letta.
    let list = await this.list(version === undefined);
    const known = list.plugins.find((p) => p.id === id);
    if (
      known === undefined ||
      (version !== undefined && !known.versions.some((v) => v.version === version))
    ) {
      list = await this.list(true);
    }
    const plugin = list.plugins.find((p) => p.id === id);
    if (plugin === undefined)
      throw new RpcError(ErrorCode.NotFound, "core.error.moduleNotInRegistry");
    const chosen =
      version === undefined
        ? plugin.versions[0]
        : plugin.versions.find((v) => v.version === version);
    if (chosen === undefined)
      throw new RpcError(ErrorCode.NotFound, "core.error.moduleVersionNotFound");
    return chosen;
  }

  /** Scarica il pacchetto e ne verifica dimensione e impronta. */
  async download(version: RegistryVersion): Promise<Uint8Array> {
    if (version.size > PACKAGE_LIMITS.maxDownloadBytes) {
      throw new RpcError(ErrorCode.InvalidParameters, "core.error.packageTooLarge");
    }
    let data: Uint8Array;
    try {
      const response = await this.#fetch(version.url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      data = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      this.#o.logger.error(`download non riuscito: ${version.url}`, String(error));
      throw new RpcError(ErrorCode.InternalError, "core.error.downloadFailed");
    }
    if (data.byteLength !== version.size || sha256Hex(data) !== version.sha256) {
      throw new RpcError(ErrorCode.InvalidParameters, "core.error.packageHashMismatch");
    }
    return data;
  }
}
