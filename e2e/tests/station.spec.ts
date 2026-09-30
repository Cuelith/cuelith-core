import path from "node:path";
import { expect } from "@playwright/test";
import { screenshotsDir, test } from "./app.js";

test("la postazione vuota mostra barra, dock col + e le tre colonne di Presenta", async ({
  running,
}) => {
  const { station, problems } = running;
  const mode = station.locator('main[data-mode="core.present"]');
  await expect(mode).toBeVisible();

  // Barra in alto: marchio, sola modalita' Presenta attiva, nessuna uscita.
  const header = station.locator("header").first();
  await expect(header.getByText("CUELITH", { exact: true })).toBeVisible();
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
