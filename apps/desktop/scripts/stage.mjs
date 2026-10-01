// Prepara pack/app, la cartella che diventa l'app installata: processo
// principale in un solo file (vite.pack.config.ts), preload, postazione,
// finestre di uscita, colori e font, icona. Niente node_modules.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "pack", "app");
const require = createRequire(path.join(root, "package.json"));
const dirOf = (specifier) => path.dirname(require.resolve(specifier));

if (!existsSync(path.join(app, "main.mjs"))) {
  console.error("Manca pack/app/main.mjs: esegui prima vite build --config vite.pack.config.ts");
  process.exit(1);
}
const copy = (from, to, filter) => {
  if (!existsSync(from)) {
    console.error(`Manca ${from}: esegui prima pnpm build.`);
    process.exit(1);
  }
  cpSync(from, path.join(app, to), { recursive: true, ...(filter ? { filter } : {}) });
};

copy(path.join(root, "dist", "preload.cjs"), "preload.cjs");
copy(path.join(dirOf("@cuelith-core/client/package.json"), "dist"), "client");
copy(path.join(dirOf("@cuelith-core/renderer/package.json"), "dist"), "renderer");
// Solo fogli di stile e font: il resto del pacchetto ui serve allo sviluppo.
copy(dirOf("@cuelith/ui/tokens.css"), "ui", (src) => !/\.(?:js|ts|map)$/.test(src));
copy(path.join(root, "build", "icon.png"), path.join("build", "icon.png"));

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
writeFileSync(
  path.join(app, "package.json"),
  `${JSON.stringify(
    {
      name: "cuelith",
      productName: pkg.productName,
      version: pkg.version,
      description: "Cuelith: proiezione e regia live.",
      license: pkg.license,
      author: "Cuelith",
      homepage: "https://github.com/Cuelith/cuelith-core",
      type: "module",
      main: "main.mjs",
    },
    null,
    2,
  )}\n`,
);

// La lingua italiana preinstallata (extraResources): solo i file del modulo.
const locale = path.resolve(root, "../../../plugin-locale-it");
const plugins = path.join(root, "pack", "plugins", "cuelith.locale.it");
rmSync(path.join(root, "pack", "plugins"), { recursive: true, force: true });
for (const name of ["cuelith-plugin.json", "LICENSE", "icon.svg", "locales"]) {
  if (existsSync(path.join(locale, name))) {
    cpSync(path.join(locale, name), path.join(plugins, name), { recursive: true });
  }
}
if (!existsSync(path.join(plugins, "cuelith-plugin.json"))) {
  console.error(`Manca la lingua italiana in ${locale} (repo affiancato plugin-locale-it).`);
  process.exit(1);
}
console.log("pack/app pronta");
