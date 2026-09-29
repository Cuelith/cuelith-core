import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  CatalogSchema,
  PLUGIN_MANIFEST_FILE,
  PluginManifestSchema,
  PROTOCOL_VERSION,
  type Catalog,
  type Lang,
  type PluginManifest,
} from "@cuelith/protocol";
import { satisfies } from "semver";

export interface LoadedModule {
  readonly manifest: PluginManifest;
  /** Cartella del modulo sul disco. */
  readonly dir: string;
  /** Installato insieme al nucleo. */
  readonly bundled: boolean;
  /** Cataloghi di traduzione che il modulo porta, per lingua. */
  readonly catalogs: ReadonlyMap<Lang, Catalog>;
}

/** Errore di caricamento con chiave di traduzione, mostrabile all'utente. */
export class ModuleLoadError extends Error {
  readonly key: string;
  readonly params: Readonly<Record<string, string>>;

  constructor(key: string, params: Record<string, string>, options?: ErrorOptions) {
    super(`${key} ${JSON.stringify(params)}`, options);
    this.name = "ModuleLoadError";
    this.key = key;
    this.params = params;
  }
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

/** Percorso dentro la cartella del modulo; il manifest lo garantisce gia', qui lo si ricontrolla. */
function inside(dir: string, relative: string): string {
  const root = resolve(dir);
  const target = resolve(root, relative);
  if (!target.startsWith(root + sep)) {
    throw new ModuleLoadError("core.module.pathOutside", { path: relative });
  }
  return target;
}

export async function loadModule(
  dir: string,
  engineVersion: string,
  bundled: boolean,
): Promise<LoadedModule> {
  let raw: unknown;
  try {
    raw = await readJson(join(dir, PLUGIN_MANIFEST_FILE));
  } catch (error) {
    throw new ModuleLoadError("core.module.manifestUnreadable", { dir }, { cause: error });
  }
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ModuleLoadError("core.module.manifestInvalid", { dir }, { cause: parsed.error });
  }
  const manifest = parsed.data;

  if (!satisfies(engineVersion, manifest.engines.cuelith, { includePrerelease: true })) {
    throw new ModuleLoadError("core.module.engineIncompatible", {
      id: manifest.id,
      required: manifest.engines.cuelith,
      engine: engineVersion,
    });
  }
  if (!satisfies(PROTOCOL_VERSION, manifest.engines.protocol)) {
    throw new ModuleLoadError("core.module.protocolIncompatible", {
      id: manifest.id,
      required: manifest.engines.protocol,
      protocol: PROTOCOL_VERSION,
    });
  }

  const catalogs = new Map<Lang, Catalog>();
  for (const locale of manifest.contributes.locales ?? []) {
    const file = inside(dir, locale.file);
    let catalogRaw: unknown;
    try {
      catalogRaw = await readJson(file);
    } catch (error) {
      throw new ModuleLoadError(
        "core.module.catalogUnreadable",
        { id: manifest.id, file: locale.file },
        { cause: error },
      );
    }
    const catalog = CatalogSchema.safeParse(catalogRaw);
    if (!catalog.success) {
      throw new ModuleLoadError(
        "core.module.catalogInvalid",
        { id: manifest.id, file: locale.file },
        { cause: catalog.error },
      );
    }
    // Una lingua traduce il nucleo; ogni altro modulo traduce solo le sue chiavi.
    if (manifest.family !== "locale") {
      const foreign = Object.keys(catalog.data).find((key) => !key.startsWith(`${manifest.id}.`));
      if (foreign !== undefined) {
        throw new ModuleLoadError("core.module.catalogForeignKey", {
          id: manifest.id,
          key: foreign,
        });
      }
    }
    catalogs.set(locale.lang, { ...(catalogs.get(locale.lang) ?? {}), ...catalog.data });
  }

  return { manifest, dir: resolve(dir), bundled, catalogs };
}
