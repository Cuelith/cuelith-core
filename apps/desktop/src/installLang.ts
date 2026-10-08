import { readFileSync } from "node:fs";
import path from "node:path";

// Lingua scelta nell'installatore (decisione 0018): l'installatore scrive `install-lang.txt` nella
// cartella delle risorse dell'app, e al primo avvio Cuelith parte in quella lingua. Dopo il primo
// avvio vale la scelta fatta nelle Impostazioni (settings.json), mai questo file.

/** «it» o «en» (spazi e a capo ammessi), altrimenti niente. */
export function parseInstallLang(text: string): string | undefined {
  const lang = text.trim().toLowerCase();
  return /^[a-z]{2}$/.test(lang) ? lang : undefined;
}

/** La lingua scelta all'installazione, se c'e' (app installata, file presente e leggibile). */
export function readInstallLang(resourcesPath: string): string | undefined {
  try {
    return parseInstallLang(readFileSync(path.join(resourcesPath, "install-lang.txt"), "utf8"));
  } catch {
    return undefined;
  }
}
