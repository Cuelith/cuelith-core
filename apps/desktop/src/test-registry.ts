import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { REGISTRY_INDEX_URL, REGISTRY_INDEX_V2_URL } from "@cuelith/protocol";

/**
 * Solo per le prove automatiche (variabile CUELITH_TEST_REGISTRY_DIR): il
 * marketplace legge gli indici e i pacchetti da una cartella invece che da
 * internet (`index.json` e `index-2.json`). Le richieste verso questo stesso
 * computer (il Notaio di prova) passano invece alla rete vera. Senza la
 * variabile Cuelith usa sempre GitHub.
 */
export function folderFetch(dir: string): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const host = URL.canParse(url) ? new URL(url).hostname : "";
    if (host === "127.0.0.1" || host === "localhost") return fetch(input, init);
    const file =
      url === REGISTRY_INDEX_URL
        ? "index.json"
        : url === REGISTRY_INDEX_V2_URL
          ? "index-2.json"
          : basename(new URL(url).pathname);
    try {
      return new Response(await readFile(join(dir, file)));
    } catch {
      return new Response("", { status: 404 });
    }
  };
}

/**
 * Solo per le prove (CUELITH_TEST_NOTARY_KEYS): le chiavi pubbliche del Notaio di
 * prova, come JSON `{"n1":"<43 caratteri>"}`. Qualsiasi altra cosa vale come «non impostate».
 */
export function parseNotaryKeys(text: string | undefined): Record<string, string> | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value);
    return entries.every(([, key]) => typeof key === "string" && /^[A-Za-z0-9_-]{43}$/.test(key))
      ? Object.fromEntries(entries)
      : undefined;
  } catch {
    return undefined;
  }
}
