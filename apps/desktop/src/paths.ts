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
}): AppPaths {
  if (options.packaged) {
    return {
      client: path.join(options.appPath, "client"),
      renderer: path.join(options.appPath, "renderer"),
      ui: path.join(options.appPath, "ui"),
      bundledPlugins: [path.join(options.resourcesPath, "plugins", "cuelith.locale.it")],
    };
  }
  const bundledPlugins = [path.resolve(options.appPath, "../../../plugin-locale-it")];
  return {
    client: path.join(packageDir("@cuelith-core/client/package.json"), "dist"),
    renderer: path.join(packageDir("@cuelith-core/renderer/package.json"), "dist"),
    ui: packageDir("@cuelith/ui/tokens.css"),
    bundledPlugins,
  };
}
