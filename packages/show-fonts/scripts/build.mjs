// Costruisce dist/fonts.css con i caratteri del testo proiettato e copia i file dei caratteri:
// le uscite e l'anteprima devono funzionare senza internet (mai font da servizi esterni).
// L'elenco dei caratteri e' uno solo, in core-looks (FONTS): qui si leggono i pacchetti che lo servono.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FONTS } from "@cuelith-core/core-looks";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const fontsDir = join(dist, "fonts");
const filesDir = join(fontsDir, "files");
mkdirSync(filesDir, { recursive: true });

const imports = [];
const take = (pkg, cssFile, outName) => {
  const pkgDir = join(root, "node_modules", pkg);
  const path = join(pkgDir, cssFile);
  if (!existsSync(path)) return false;
  const css = readFileSync(path, "utf8");
  const urls = [...css.matchAll(/url\(\.\/files\/([^)]+)\)/g)].map((m) => m[1]);
  if (urls.length === 0) throw new Error(`Nessun file di carattere in ${pkg}/${cssFile}`);
  for (const file of new Set(urls)) copyFileSync(join(pkgDir, "files", file), join(filesDir, file));
  writeFileSync(join(fontsDir, outName), css);
  imports.push(`@import "./fonts/${outName}";`);
  return true;
};

let count = 0;
for (const font of FONTS) {
  if (font.source === "ui") continue; // i primi tre arrivano gia' da @cuelith/ui
  if (font.source === "variable") {
    const pkg = `@fontsource-variable/${font.id}`;
    if (!take(pkg, "wght.css", `${font.id}.css`)) throw new Error(`Manca ${pkg}`);
    if (font.italic && !take(pkg, "wght-italic.css", `${font.id}-italic.css`)) {
      throw new Error(`${font.name}: dichiara il corsivo ma ${pkg} non lo ha`);
    }
  } else {
    const pkg = `@fontsource/${font.id}`;
    for (const weight of font.weights) {
      if (!take(pkg, `${weight}.css`, `${font.id}-${weight}.css`))
        throw new Error(`Manca ${pkg} ${weight}`);
      if (font.italic && !take(pkg, `${weight}-italic.css`, `${font.id}-${weight}-italic.css`)) {
        throw new Error(`${font.name}: manca il corsivo ${weight}`);
      }
    }
  }
  count += 1;
}
// Il nome con cui il programma chiede un carattere deve essere quello che il css dichiara.
const declared = readdirSync(fontsDir)
  .filter((file) => file.endsWith(".css"))
  .map((file) => readFileSync(join(fontsDir, file), "utf8"))
  .join("\n");
for (const font of FONTS) {
  if (font.source === "ui") continue;
  if (!declared.includes(`font-family: '${font.family}'`)) {
    throw new Error(`${font.name}: il css non dichiara la famiglia "${font.family}"`);
  }
}
writeFileSync(join(dist, "fonts.css"), `${imports.join("\n")}\n`);
console.log(`show-fonts: ${count} caratteri, ${imports.length} file css in dist/`);
