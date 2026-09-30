import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { REGISTRY_INDEX_URL } from "@cuelith/protocol";

/**
 * Solo per le prove automatiche (variabile CUELITH_TEST_REGISTRY_DIR): il
 * marketplace legge indice e pacchetti da una cartella invece che da internet.
 * Senza la variabile Cuelith usa sempre GitHub.
 */
export function folderFetch(dir: string): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const file = url === REGISTRY_INDEX_URL ? "index.json" : basename(new URL(url).pathname);
    try {
      return new Response(await readFile(join(dir, file)));
    } catch {
      return new Response("", { status: 404 });
    }
  };
}
