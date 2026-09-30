import path from "node:path";
import { expect } from "@playwright/test";
import { screenshotsDir, test } from "./app.js";

test("la postazione vuota mostra barra, dock col + e le tre colonne di Presenta", async ({
  running,
}) => {
  const { app, station, problems } = running;
  const mode = station.locator('main[data-mode="core.present"]');
  await expect(mode).toBeVisible();

  // Pronta l'interfaccia, la finestra di avvio col logo sparisce e resta la postazione, visibile.
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), visible: w.isVisible() })),
      ),
    )
    .toEqual([{ title: "Cuelith", visible: true }]);

  // Barra in alto: marchio, sola modalita' Presenta attiva, nessuna uscita.
  const header = station.locator("header").first();
  await expect(header.getByRole("img", { name: "Cuelith" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Presenta" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(header.getByText("Nessuna uscita")).toBeVisible();

  // Dock: col nucleo nudo c'e' solo il "+".
  const dock = station.getByRole("navigation", { name: "Moduli" });
  await expect(dock.getByRole("button")).toHaveCount(1);
  await expect(dock.getByRole("button", { name: "Aggiungi moduli" })).toBeVisible();

  // Tre colonne: Scaletta | Slide | Programma sopra l'Anteprima.
  const box = async (area: string) => {
    const rect = await station.locator(`[data-area="${area}"]`).boundingBox();
    if (rect === null) throw new Error(`area ${area} non visibile`);
    return rect;
  };
  const playlist = await box("playlist");
  const slides = await box("slides");
  const program = await box("program");
  const preview = await box("preview");
  expect(playlist.x).toBeLessThan(slides.x);
  expect(slides.x).toBeLessThan(program.x);
  expect(program.x).toBe(preview.x);
  expect(program.y).toBeLessThan(preview.y);
  expect(playlist.height).toBeGreaterThan(program.height);
  await expect(station.getByRole("heading", { name: "Scaletta" })).toBeVisible();
  await expect(station.getByText("La scaletta è vuota.")).toBeVisible();

  // Lingua dal modulo italiano, nessuna chiave non tradotta, font inclusi.
  expect(await station.evaluate(() => document.documentElement.lang)).toBe("it");
  expect(await station.locator("body").innerText()).not.toMatch(/\b(core|protocol)\.[a-z]/);
  expect(
    await station.evaluate(() => document.fonts.check("16px 'Schibsted Grotesk Variable'")),
  ).toBe(true);

  await station.screenshot({ path: path.join(screenshotsDir, "presenta-vuota.png") });
  expect(problems).toEqual([]);
});

test("impostazioni: ingranaggio e Ctrl+, ; la legenda dei tasti sta in Scorciatoie", async ({
  running,
}) => {
  const { station, problems } = running;
  // Niente scritte di spiegazione nell'interfaccia: la legenda e' nelle impostazioni.
  await expect(station.locator("main")).not.toContainText("Invio manda in onda");

  await station.getByRole("button", { name: "Impostazioni" }).click();
  const settings = station.getByRole("dialog", { name: "Impostazioni" });
  await expect(settings.getByTestId("settings-language")).toHaveText("Italiano");
  await settings.getByRole("button", { name: "Scorciatoie" }).click();
  const legend = settings.getByTestId("shortcuts");
  await expect(legend).toContainText("Manda in onda ciò che è in anteprima");
  await expect(legend).toContainText("Inizio del prossimo Verse");
  await expect(legend).toContainText("Inizio del prossimo Others");
  await station.screenshot({ path: path.join(screenshotsDir, "impostazioni-scorciatoie.png") });
  await settings.getByRole("button", { name: "Informazioni e licenza" }).click();
  await expect(settings).toContainText("Community, gratuita");
  await settings.getByRole("button", { name: "Chiudi" }).last().click();
  await expect(settings).toBeHidden();

  await station.keyboard.press("Control+,");
  await expect(settings).toBeVisible();
  expect(problems).toEqual([]);
});
