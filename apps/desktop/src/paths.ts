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
 * Dove stanno i file serviti dal motore. In sviluppo i moduli preinstallati
 * sono le cartelle dei loro repo affiancati a cuelith-core; nel pacchetto
 * installato vengono copiati sotto resources/plugins.
 */
export function resolveAppPaths(options: {
  packaged: boolean;
  appPath: string;
  resourcesPath: string;
}): AppPaths {
  const bundledPlugins = options.packaged
    ? [path.join(options.resourcesPath, "plugins", "cuelith.locale.it")]
    : [path.resolve(options.appPath, "../../../plugin-locale-it")];
  return {
    client: path.join(packageDir("@cuelith-core/client/package.json"), "dist"),
    renderer: path.join(packageDir("@cuelith-core/renderer/package.json"), "dist"),
    ui: packageDir("@cuelith/ui/tokens.css"),
    bundledPlugins,
  };
}
