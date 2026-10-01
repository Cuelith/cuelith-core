import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { addOutput, createText, outputWindow, screenshotsDir, test } from "./app.js";

// Criterio del cap. 28: due uscite con look diversi; blackout e freeze per uscita.
test("due uscite con look Sala e Palco, blackout e freeze per singola uscita", async ({
  running,
}) => {
  const { station, problems } = running;
  await createText(station, "Luce del mattino", ["Vieni su di noi", "Resta con noi", "Amen"]);

  await addOutput(station, "Proiettore", "Sala");
  await addOutput(station, "Palco", "Palco");
  const projector = await outputWindow(running, "Proiettore");
  const stage = await outputWindow(running, "Palco");
  const text = (page: Page) => page.locator("body");

  // Invio: la stessa slide va su entrambe, ognuna col suo look.
  await station.keyboard.press("Enter");
  await expect(text(projector)).toHaveAttribute("data-text", "Vieni su di noi");
  await expect(text(stage)).toHaveAttribute("data-text", "Vieni su di noi");
  await projector.waitForTimeout(400); // fine della dissolvenza di Sala
  await projector.screenshot({ path: path.join(screenshotsDir, "uscita-sala.png") });
  await stage.screenshot({ path: path.join(screenshotsDir, "uscita-palco.png") });

  // Nero solo sul proiettore.
  const projectorBar = station.getByRole("group", { name: "Proiettore", exact: true });
  const stageBar = station.getByRole("group", { name: "Palco", exact: true });
  await projectorBar.getByRole("button", { name: "Nero" }).click();
  await expect(projectorBar.getByRole("button", { name: "Nero" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(text(projector)).toHaveAttribute("data-blackout", "true");
  await expect(text(stage)).toHaveAttribute("data-blackout", "false");
  await projectorBar.getByRole("button", { name: "Nero" }).click();
  await expect(text(projector)).toHaveAttribute("data-blackout", "false");

  // Blocca solo il palco: avanti cambia il proiettore, il palco resta fermo.
  await stageBar.getByRole("button", { name: "Blocca" }).click();
  await expect(text(stage)).toHaveAttribute("data-freeze", "true");
  await station.locator("body").click({ position: { x: 700, y: 600 } });
  await station.keyboard.press("ArrowRight");
  await expect(text(projector)).toHaveAttribute("data-text", "Resta con noi");
  await expect(text(stage)).toHaveAttribute("data-text", "Vieni su di noi");
  await stageBar.getByRole("button", { name: "Blocca" }).click();
  await expect(text(stage)).toHaveAttribute("data-text", "Resta con noi");

  // Le uscite disegnano davvero: fotogrammi in corso e nessuna pausa lunga.
  const stats = await projector.evaluate(
    () =>
      (window as unknown as { cuelithOutput?: { stats: { frames: number } } }).cuelithOutput?.stats,
  );
  expect(stats?.frames).toBeGreaterThan(30);

  await expect(station.locator('[data-screen="live"] .cl-fade-out')).toHaveCount(0);
  await station.screenshot({ path: path.join(screenshotsDir, "presenta-due-uscite.png") });
  expect(problems).toEqual([]);
});

test("eliminare un'uscita ne chiude la finestra", async ({ running }) => {
  const { station, problems } = running;
  await addOutput(station, "Proiettore", "Sala");
  const projector = await outputWindow(running, "Proiettore");

  await station.getByRole("button", { name: "Uscite…" }).click();
  const dialog = station.getByRole("dialog", { name: "Uscite" });
  const row = dialog.getByRole("listitem").filter({ hasText: "Proiettore" });
  await row.getByRole("button", { name: "Rimuovi" }).click();
  await row.getByRole("button", { name: "Elimina davvero" }).click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => projector.isClosed()).toBe(true);
  expect(problems).toEqual([]);
});

// Contatore delle risorse (protocollo 1.9): indicatore nella barra in alto,
// dettaglio nelle Impostazioni, fotogrammi delle uscite misurati davvero.
test("risorse: semaforo nella barra, memoria e processore, fotogrammi delle uscite", async ({
  running,
}) => {
  const { station, problems } = running;
  await createText(station, "Luce del mattino", ["Vieni su di noi"]);
  await addOutput(station, "Proiettore", "Sala");
  await outputWindow(running, "Proiettore");
  await station.keyboard.press("Enter");

  const indicator = station.getByRole("button", { name: /^Risorse del computer:/ });
  await expect(indicator).toBeVisible({ timeout: 20_000 });
  await indicator.click();
  const settings = station.getByRole("dialog", { name: "Impostazioni" });
  await expect(settings.getByRole("meter", { name: "Memoria" })).toBeVisible();
  await expect(settings.getByRole("meter", { name: "Processore" })).toBeVisible();
  const outputs = settings.getByRole("list", { name: "Uscite" });
  // Dopo due misure l'uscita ha i suoi fotogrammi al secondo.
  await expect(outputs).toContainText("Proiettore", { timeout: 20_000 });
  await expect(outputs).toContainText(/[1-9]\d* fotogrammi\/s/, { timeout: 20_000 });
  const table = settings.getByRole("table", { name: "Consumo per parte" });
  await expect(table).toContainText("Motore e app");
  await expect(table).toContainText("Postazione");
  await expect(table).toContainText("Uscita «Proiettore»");
  await station.screenshot({ path: path.join(screenshotsDir, "impostazioni-risorse.png") });
  expect(problems).toEqual([]);
});
