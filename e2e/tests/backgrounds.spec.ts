import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { addOutput, chooseFiles, createText, outputWindow, screenshotsDir, test } from "./app.js";

/** Un'immagine di prova (SVG, uno dei formati ammessi) di un colore pieno con un cerchio. */
function image(name: string, color: string): string {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "cuelith-sfondi-")), `${name}.svg`);
  writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">` +
      `<rect width="1600" height="900" fill="${color}"/>` +
      `<circle cx="1250" cy="250" r="180" fill="#ffffff" fill-opacity="0.35"/></svg>`,
  );
  return file;
}

/** Voce del menu «Sfondo» nel pannello delle slide. */
async function backgroundMenu(station: Page, item: string | RegExp): Promise<void> {
  await station.getByRole("button", { name: "Sfondo dei testi" }).click();
  await station.getByRole("menuitem", { name: item }).click();
}

// Passo 6c, decisione 0003: sfondi immagine per slide, per elemento e
// predefinito del look, con il velo; le uscite li caricano prima di mostrarli.
test("sfondi: elemento, singola slide e look Sala; l'uscita li mostra, il velo scurisce", async ({
  running,
}) => {
  const { app, station, problems } = running;
  await createText(station, "Luce del mattino", ["Vieni su di noi", "Resta con noi"]);
  await addOutput(station, "Proiettore", "Sala");
  const projector = await outputWindow(running, "Proiettore");
  const output = projector.locator("body");
  await station.keyboard.press("Enter");
  await expect(output).toHaveAttribute("data-text", "Vieni su di noi");
  await expect(output).toHaveAttribute("data-background", "");

  // Sfondo per tutto l'elemento: ogni slide lo prende, l'uscita lo mostra.
  await chooseFiles(app, image("cielo", "#1F4E8C"));
  await backgroundMenu(station, "Immagine per tutto l'elemento…");
  const tiles = station.getByRole("list", { name: "Slide" }).getByTestId("slide-background");
  await expect(tiles).toHaveCount(2);
  const sky = (await tiles.first().getAttribute("data-background")) ?? "";
  expect(sky).toMatch(/^\/media\/[a-f0-9]{64}\.svg$/);
  await expect(output).toHaveAttribute("data-background", sky);
  await expect(
    station.locator('[data-screen="live"]').getByTestId("slide-background"),
  ).toHaveAttribute("data-background", sky);

  // Sfondo solo per la slide 2 (quella in anteprima): vince su quello dell'elemento.
  await station.getByRole("button", { name: "Slide 2" }).click();
  await chooseFiles(app, image("tramonto", "#8C2F1F"));
  await backgroundMenu(station, "Immagine per la slide 2…");
  await expect(tiles.nth(1)).not.toHaveAttribute("data-background", sky);
  const sunset = (await tiles.nth(1).getAttribute("data-background")) ?? "";
  // L'uscita mostra ancora la slide 1, col suo sfondo.
  await expect(output).toHaveAttribute("data-background", sky);
  await station.locator("body").click({ position: { x: 700, y: 600 } });
  await station.keyboard.press("ArrowRight");
  await expect(output).toHaveAttribute("data-text", "Resta con noi");
  await expect(output).toHaveAttribute("data-background", sunset);
  await projector.waitForTimeout(400); // fine della dissolvenza
  await projector.screenshot({ path: path.join(screenshotsDir, "sfondo-uscita.png") });

  // Velo: il testo resta leggibile; la scelta si vede nel menu.
  await backgroundMenu(station, "Velo: medio");
  await station.getByRole("button", { name: "Sfondo dei testi" }).click();
  await expect(station.getByRole("menuitem", { name: "Velo: medio ✓" })).toBeVisible();
  await station.keyboard.press("Escape");
  await projector.waitForTimeout(400);
  await projector.screenshot({ path: path.join(screenshotsDir, "sfondo-uscita-velo.png") });
  await station.screenshot({ path: path.join(screenshotsDir, "sfondo-postazione.png") });

  // Tolto lo sfondo della slide, torna quello dell'elemento; tolto anche quello, niente.
  await backgroundMenu(station, "Togli lo sfondo dalla slide 2");
  await expect(output).toHaveAttribute("data-background", sky);
  await backgroundMenu(station, "Togli lo sfondo dell'elemento");
  await expect(output).toHaveAttribute("data-background", "");
  await expect(tiles).toHaveCount(0);

  // Sfondo predefinito del look Sala: vale per ogni testo senza sfondo proprio.
  await chooseFiles(app, image("sala", "#1F6B4A"));
  await backgroundMenu(station, /^Immagine predefinita del look Sala/);
  await expect(output).toHaveAttribute("data-background", /^\/media\/[a-f0-9]{64}\.svg$/);
  await expect(tiles).toHaveCount(2);
  expect(problems).toEqual([]);
});
