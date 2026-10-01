import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { createText, screenshotsDir, test } from "./app.js";

/**
 * Le cinque disposizioni fisse (decisione 0006): si cambiano con Ctrl+1..5 o
 * dalla barra in alto, ognuna fa il suo lavoro, e cambiarle non tocca mai
 * cio' che e' in onda.
 */
const program = (station: Page) => station.locator('[data-screen="live"]').first();

async function choose(station: Page, key: string, mode: string): Promise<void> {
  // Il fuoco sulla postazione (non in un campo) prima della scorciatoia.
  await station
    .locator("header")
    .first()
    .click({ position: { x: 700, y: 20 } });
  await station.keyboard.press(`Control+${key}`);
  await expect(station.locator(`main[data-mode="${mode}"]`)).toBeVisible();
}

test("disposizioni: Presenta, Band, Conferenza, Regia, Compatta; la diretta non cambia mai", async ({
  running,
}) => {
  const { station, problems } = running;
  await createText(station, "Benvenuto", ["Uno", "Due", "Tre"]);
  const entry = station.getByRole("list", { name: "Voci della scaletta" }).getByRole("listitem");
  await entry.first().click({ position: { x: 24, y: 12 } });
  await station.keyboard.press("Enter");
  await expect(program(station)).toContainText("Uno");

  // Il selettore in alto mostra le cinque disposizioni.
  const modes = station.getByRole("navigation", { name: "Modalità" });
  await expect(modes.getByRole("button")).toHaveText([
    "Presenta",
    "Band",
    "Conferenza",
    "Regia",
    "Compatta",
  ]);

  // Band: le sezioni (qui le slide) come grossi pulsanti e l'ordine sotto.
  await choose(station, "2", "core.band");
  await expect(program(station)).toContainText("Uno");
  const sections = station.getByRole("list", { name: "Sezioni" });
  await expect(sections.getByRole("button", { name: /Manda in onda/ })).toHaveCount(3);
  await sections.getByRole("button", { name: "Manda in onda 2" }).click();
  await expect(program(station)).toContainText("Due");
  await expect(
    station.getByRole("list", { name: "Ordine" }).locator('[data-state="live"]'),
  ).toHaveText("2");
  await station.screenshot({ path: path.join(screenshotsDir, "disposizione-band.png") });

  // Conferenza: timer coi colori del tempo, note, palco.
  await choose(station, "3", "core.conference");
  await expect(program(station)).toContainText("Due");
  const timer = station.getByRole("region", { name: "Timer" });
  await timer.getByRole("button", { name: "10 min" }).click();
  await expect(timer.getByTestId("timer-display")).toHaveText("10:00");
  await expect(timer.getByTestId("timer-display")).toHaveAttribute("data-phase", "ok");
  await timer.getByRole("button", { name: "Avvia" }).click();
  await expect(timer.getByTestId("timer-display")).toHaveText(/^9:5\d$/, { timeout: 5000 });
  await timer.getByRole("button", { name: "Pausa" }).click();
  await timer.getByLabel("Minuti").fill("1");
  await timer.getByRole("button", { name: "Imposta" }).click();
  await expect(timer.getByTestId("timer-display")).toHaveAttribute("data-phase", "warning");
  await expect(station.getByRole("region", { name: "Palco" })).toContainText(
    "aggiungi un monitor del palco",
  );
  await station.screenshot({ path: path.join(screenshotsDir, "disposizione-conferenza.png") });

  // Regia: anteprima e programma grandi uguali, MANDA IN ONDA in mezzo.
  await choose(station, "4", "core.director");
  await expect(program(station)).toContainText("Due");
  const preview = await station.locator('[data-screen="cue"]').first().boundingBox();
  const live = await program(station).boundingBox();
  expect(Math.abs((preview?.width ?? 0) - (live?.width ?? 1))).toBeLessThan(40);
  await station.getByRole("button", { name: "MANDA IN ONDA", exact: true }).click();
  await expect(program(station)).toContainText("Tre");
  await station.screenshot({ path: path.join(screenshotsDir, "disposizione-regia.png") });

  // Compatta: scaletta, slide e librerie a schede; scegliendo una voce si vedono le slide.
  await choose(station, "5", "core.compact");
  await expect(program(station)).toContainText("Tre");
  await station.getByRole("tab", { name: "Scaletta", exact: true }).click();
  await entry.first().click({ position: { x: 24, y: 12 } });
  await expect(station.getByRole("tab", { name: "Slide", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await station.screenshot({ path: path.join(screenshotsDir, "disposizione-compatta.png") });

  // Di nuovo Presenta: tutto com'era, la diretta mai toccata.
  await choose(station, "1", "core.present");
  await expect(program(station)).toContainText("Tre");
  await expect(station.getByRole("region", { name: "Slide" })).toBeVisible();
  expect(problems).toEqual([]);
});
