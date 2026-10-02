import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function packageDir(specifier: string): string {
  return path.dirname(fileURLToPath(import.meta.resolve(specifier)));
}

export interface AppPaths {
  readonly client: string;
  readonly renderer: string;
  readonly ui: string;
  readonly bundledPlugins: readonly string[];
}

/**
 * Dove stanno i file serviti dal motore. In sviluppo sono le cartelle dist
 * dei pacchetti e i moduli preinstallati sono i repo affiancati a
 * cuelith-core; nell'app installata stanno dentro l'app (scripts/stage.mjs)
 * e i moduli preinstallati sotto resources/plugins.
 */
export function resolveAppPaths(options: {
  packaged: boolean;
  appPath: string;
  resourcesPath: string;
  /** Solo per le prove: le lingue incluse da caricare (predefinito: tutte quelle presenti). */
  langs?: readonly string[];
}): AppPaths {
  const wanted = (lang: string) => options.langs === undefined || options.langs.includes(lang);
  // L'italiano c'e' sempre; l'inglese se e' stato messo nel pacchetto (o, in
  // sviluppo, se il suo repo e' affiancato).
  if (options.packaged) {
    const plugins = path.join(options.resourcesPath, "plugins");
    return {
      client: path.join(options.appPath, "client"),
      renderer: path.join(options.appPath, "renderer"),
      ui: path.join(options.appPath, "ui"),
      bundledPlugins: [
        path.join(plugins, "cuelith.locale.it"),
        path.join(plugins, "cuelith.locale.en"),
      ].filter((dir, index) => index === 0 || (wanted("en") && existsSync(dir))),
    };
  }
  const bundledPlugins = [
    path.resolve(options.appPath, "../../../plugin-locale-it"),
    path.resolve(options.appPath, "../../../plugin-locale-en"),
  ].filter((dir, index) => index === 0 || (wanted("en") && existsSync(dir)));
  return {
    client: path.join(packageDir("@cuelith-core/client/package.json"), "dist"),
    renderer: path.join(packageDir("@cuelith-core/renderer/package.json"), "dist"),
    ui: packageDir("@cuelith/ui/tokens.css"),
    bundledPlugins,
  };
}
