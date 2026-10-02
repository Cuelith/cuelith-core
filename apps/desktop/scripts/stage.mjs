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

// Le lingue preinstallate (extraResources): solo i file del modulo. Italiano
// e inglese stanno nell'installatore (decisione 0010): senza uno dei due repo
// affiancati il pacchetto non si fa.
rmSync(path.join(root, "pack", "plugins"), { recursive: true, force: true });
for (const lang of ["it", "en"]) {
  const from = path.resolve(root, `../../../plugin-locale-${lang}`);
  const to = path.join(root, "pack", "plugins", `cuelith.locale.${lang}`);
  for (const name of ["cuelith-plugin.json", "LICENSE", "icon.svg", "locales"]) {
    if (existsSync(path.join(from, name))) {
      cpSync(path.join(from, name), path.join(to, name), { recursive: true });
    }
  }
  if (!existsSync(path.join(to, "cuelith-plugin.json"))) {
    console.error(`Manca la lingua "${lang}" in ${from} (repo affiancato plugin-locale-${lang}).`);
    process.exit(1);
  }
}
console.log("pack/app pronta");
