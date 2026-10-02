import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { launchApp } from "./app.js";

// La lingua dell'interfaccia si sceglie in Impostazioni → Generale (decisione
// 0010): cambia subito, senza riavviare, e resta al prossimo avvio. L'inglese
// sta nel repo affiancato plugin-locale-en: dove manca, la prova si salta.

const here = path.dirname(fileURLToPath(import.meta.url));
const hasEnglish = existsSync(path.resolve(here, "../../../plugin-locale-en/cuelith-plugin.json"));
const env = { CUELITH_LANG: "it", CUELITH_LANGS: "it,en" };

test("la lingua si sceglie nelle impostazioni e resta dopo un riavvio", async () => {
  test.skip(!hasEnglish, "lingua inglese non affiancata (plugin-locale-en)");
  test.setTimeout(120_000);
  const userData = await mkdtemp(path.join(os.tmpdir(), "cuelith-e2e-lingua-"));
  try {
    const first = await launchApp({ userData, env });
    try {
      const { station, problems } = first;
      await expect(station.getByRole("button", { name: "Presenta", exact: true })).toBeVisible();
      await station.getByRole("button", { name: "Impostazioni" }).click();
      const settings = station.getByRole("dialog", { name: "Impostazioni" });
      // L'elenco delle lingue arriva un attimo dopo l'apertura: col solo
      // italiano c'e' il nome, con due lingue la scelta.
      const language = settings.locator('select[data-testid="settings-language"]');
      await expect(language.locator("option")).toHaveText(["Italiano", "English"]);
      await expect(language).toHaveValue("it");
      await language.selectOption({ label: "English" });

      // Tutto cambia sotto gli occhi: finestra aperta, barra, pannelli.
      const english = station.getByRole("dialog", { name: "Settings" });
      await expect(english.locator('select[data-testid="settings-language"]')).toHaveValue("en");
      await expect(station.locator("html")).toHaveAttribute("lang", "en");
      await english.getByRole("button", { name: "Close" }).click();
      await expect(station.getByRole("button", { name: "Present", exact: true })).toBeVisible();
      await expect(station.getByRole("tab", { name: "Playlist", exact: true })).toBeVisible();
      await expect(station.getByRole("region", { name: "Program" })).toContainText(
        "Nothing on air",
      );
      expect(problems).toEqual([]);
    } finally {
      // Un riavvio vero: la cartella dati resta, la lingua pure.
      await first.app.close();
    }

    const second = await launchApp({ userData, env });
    try {
      await expect(second.station.locator("html")).toHaveAttribute("lang", "en");
      await expect(
        second.station.getByRole("button", { name: "Present", exact: true }),
      ).toBeVisible();
    } finally {
      await second.app.close();
    }
  } finally {
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
