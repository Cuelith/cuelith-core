import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Il motore non scrive testi per l'utente: manda chiavi (errori, stati dei
// moduli, rete) che il modulo lingua traduce. Questa prova fallisce se una
// chiave usata nel motore manca nel modulo italiano.

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src");
const catalog = JSON.parse(
  readFileSync(resolve(here, "../../../../plugin-locale-it/locales/it.json"), "utf8"),
) as Record<string, string>;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) return files(file);
    return name.endsWith(".ts") ? [file] : [];
  });
}

describe("testi del motore", () => {
  it("ogni chiave di errore o di stato usata dal motore esiste nel modulo italiano", () => {
    const pattern =
      /"(core\.(?:error|module|pairing|network|connection|resources\.reason)\.[A-Za-z0-9.]+)"/g;
    const missing = new Set<string>();
    for (const file of files(src)) {
      for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
        const key = match[1] ?? "";
        if (!Object.hasOwn(catalog, key)) missing.add(`${relative(src, file)} ${key}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
