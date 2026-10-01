import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
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

/** Il pannello Sfondi, sotto l'anteprima. */
const panel = (station: Page): Locator => station.getByRole("region", { name: "Sfondi" });

/** Dove mettere lo sfondo: «Slide N», «Tutto l'elemento» o il predefinito del look. */
async function target(station: Page, name: string | RegExp): Promise<void> {
  const radio = panel(station).getByRole("radio", { name });
  await radio.click();
  await expect(radio).toBeChecked();
}

// Passo 6c, decisione 0003: sfondi immagine per slide, per elemento e
// predefinito del look, con il velo; le uscite li caricano prima di mostrarli.
test("sfondi: pannello con le miniature; elemento, singola slide e look Sala; velo", async ({
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

  const backgrounds = panel(station);
  const images = backgrounds.getByRole("list", { name: "Immagini" });
  const none = images.getByRole("button", { name: "Nessuno" });
  const add = images.getByRole("button", { name: "Aggiungi un'immagine dal computer" });
  await expect(none).toHaveAttribute("aria-pressed", "true");

  // Un'immagine dal computer, per tutto l'elemento: ogni slide la prende, l'uscita la mostra.
  await target(station, "Tutto l'elemento");
  await chooseFiles(app, image("cielo", "#1F4E8C"));
  await add.click();
  const sky = images.getByRole("button", { name: "cielo.svg" });
  await expect(sky).toHaveAttribute("aria-pressed", "true");
  const tiles = station.getByRole("list", { name: "Slide" }).getByTestId("slide-background");
  await expect(tiles).toHaveCount(2);
  const skyUrl = (await tiles.first().getAttribute("data-background")) ?? "";
  expect(skyUrl).toMatch(/^\/media\/[a-f0-9]{64}\.svg$/);
  await expect(output).toHaveAttribute("data-background", skyUrl);

  // Un'altra immagine solo per la slide 2 (quella in anteprima): vince su quella dell'elemento.
  await station.getByRole("button", { name: "Slide 2" }).click();
  await target(station, "Slide 2");
  await expect(none).toHaveAttribute("aria-pressed", "true");
  await chooseFiles(app, image("tramonto", "#8C2F1F"));
  await add.click();
  await expect(images.getByRole("button", { name: "tramonto.svg" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tiles.nth(1)).not.toHaveAttribute("data-background", skyUrl);
  const sunsetUrl = (await tiles.nth(1).getAttribute("data-background")) ?? "";
  // L'uscita mostra ancora la slide 1, col suo sfondo.
  await expect(output).toHaveAttribute("data-background", skyUrl);
  await station.locator("body").click({ position: { x: 700, y: 600 } });
  await station.keyboard.press("ArrowRight");
  await expect(output).toHaveAttribute("data-text", "Resta con noi");
  await expect(output).toHaveAttribute("data-background", sunsetUrl);

  // Velo: il testo resta leggibile sopra l'immagine.
  await backgrounds.getByRole("combobox", { name: "Velo" }).selectOption({ label: "medio" });
  await expect(backgrounds.getByRole("combobox", { name: "Velo" })).toHaveValue("0.45");
  await projector.waitForTimeout(400); // fine della dissolvenza
  await projector.screenshot({ path: path.join(screenshotsDir, "sfondo-uscita-velo.png") });
  await station.screenshot({ path: path.join(screenshotsDir, "sfondo-postazione.png") });

  // Un'immagine gia' caricata si riusa con un clic: la slide 2 passa al cielo.
  await target(station, "Slide 2");
  await sky.click();
  await expect(output).toHaveAttribute("data-background", skyUrl);
  // «Nessuno» toglie: prima dalla slide (resta quello dell'elemento), poi dall'elemento.
  await none.click();
  await expect(output).toHaveAttribute("data-background", skyUrl);
  await target(station, "Tutto l'elemento");
  await none.click();
  await expect(output).toHaveAttribute("data-background", "");
  await expect(tiles).toHaveCount(0);

  // Sfondo predefinito del look Sala: vale per ogni testo senza sfondo proprio.
  await target(station, /^Predefinito \(Sala\)/);
  await images.getByRole("button", { name: "tramonto.svg" }).click();
  await expect(output).toHaveAttribute("data-background", sunsetUrl);
  await expect(tiles).toHaveCount(2);
  expect(problems).toEqual([]);
});
