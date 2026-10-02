import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LoadedModule } from "../src/modules/load.js";
import { PanelWarmer } from "../src/modules/warm.js";

// La prima lettura dei file di un modulo appena installato puo' essere
// trattenuta per secondi dai controlli del sistema: il motore li legge subito,
// in background, cosi' il pannello non resta vuoto alla prima apertura.

function module(dir: string, entry?: string): LoadedModule {
  return {
    manifest: { id: "prova.pannello", version: "1.0.0", ...(entry ? { ui: { entry } } : {}) },
    dir,
    bundled: false,
    catalogs: new Map(),
  } as unknown as LoadedModule;
}

describe("lettura anticipata dei pannelli", () => {
  it("legge l'interfaccia del modulo e non si ferma se manca qualcosa", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cuelith-warm-"));
    mkdirSync(join(dir, "ui", "assets"), { recursive: true });
    writeFileSync(join(dir, "ui", "index.html"), "<!doctype html>");
    writeFileSync(join(dir, "ui", "assets", "app.js"), "console.log(1)");
    const warmer = new PanelWarmer();
    await expect(warmer.warm([module(dir, "ui/index.html")])).resolves.toBeUndefined();
    // Gia' letto, senza interfaccia, cartella sparita: nessun errore.
    await expect(warmer.warm([module(dir, "ui/index.html")])).resolves.toBeUndefined();
    await expect(warmer.warm([module(dir)])).resolves.toBeUndefined();
    await expect(
      warmer.warm([module(join(dir, "non-esiste"), "ui/index.html")]),
    ).resolves.toBeUndefined();
  });
});
