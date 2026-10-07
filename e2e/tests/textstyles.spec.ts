import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { addOutput, createText, outputWindow, screenshotsDir, test } from "./app.js";

/**
 * Stili del testo (decisione 0015), con la finestra di un'uscita vera: la dimensione reale
 * del testo si legge da data-textstyle del corpo della finestra.
 * - lo stile dell'editor (scala) si somma al look;
 * - uno stile globale scelto sotto gli sfondi lo sostituisce, e togliendolo tornano le modifiche;
 * - l'adattamento rimpicciolisce senza uscire dai limiti;
 * - uno stile che non entra non si puo' scegliere e non tocca cio' che e' in onda.
 */
interface Shown {
  size: number;
  bold: boolean;
  uppercase: boolean;
  color: string;
}
const shown = async (page: Page): Promise<Shown> =>
  JSON.parse((await page.locator("body").getAttribute("data-textstyle")) ?? "{}") as Shown;

test("stili del testo: editor, stile globale che lo sostituisce, adattamento e blocco", async ({
  running,
}) => {
  test.setTimeout(180_000);
  const { station, problems } = running;
  await createText(station, "Salmo", ["Il Signore e' il mio pastore", "non manco di nulla"]);
  await addOutput(station, "Proiettore", "Sala");
  const projector = await outputWindow(running, "Proiettore");
  await station.keyboard.press("Enter");
  await expect(projector.locator("body")).toHaveAttribute(
    "data-text",
    "Il Signore e' il mio pastore",
  );
  const base = await shown(projector);
  expect(base.size).toBeGreaterThan(0);
  expect(base.bold).toBe(false);

  // --- Stile dell'editor: scala 150% e grassetto, subito sull'uscita in onda ---
  await station
    .getByRole("region", { name: "Slide" })
    .getByRole("button", { name: "Modifica" })
    .click();
  let editor = station.getByRole("dialog", { name: "Modifica testo" });
  await editor.getByRole("tab", { name: "Stile" }).click();
  await editor.getByLabel("Dimensione %").fill("150");
  await editor.getByLabel("Grassetto").selectOption("bold");
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(editor).toBeHidden();
  await expect.poll(async () => (await shown(projector)).size).toBeCloseTo(base.size * 1.5, 0);
  expect((await shown(projector)).bold).toBe(true);

  // --- Uno stile globale: nasce da quello in uso e si modifica ---
  const styles = station.getByRole("region", { name: "Stili del testo" });
  await styles.getByRole("button", { name: "Nuovo stile dallo stato attuale" }).click();
  const form = station.getByRole("dialog", { name: "Stile Stile 1" });
  await expect(form).toBeVisible();
  await form.getByLabel("Dimensione", { exact: true }).fill("144");
  await form.getByLabel("Maiuscolo").check();
  await form.getByLabel("Grassetto").uncheck();
  await station.waitForTimeout(400);
  await form.getByRole("button", { name: "Chiudi" }).click();
  await expect(form).toBeHidden();
  // Salvato (con un attimo di pausa) ma non ancora scelto: l'uscita non cambia.
  await station.waitForTimeout(600);
  expect((await shown(projector)).size).toBeCloseTo(base.size * 1.5, 0);

  // Lo scelgo: sostituisce le modifiche dell'editor (150% e grassetto).
  await styles.getByRole("button", { name: "Stile 1", exact: true }).click();
  await expect.poll(async () => (await shown(projector)).uppercase).toBe(true);
  const withGlobal = await shown(projector);
  expect(withGlobal.size).toBeCloseTo((144 / 72) * base.size, 0);
  expect(withGlobal.bold).toBe(false);
  await expect(styles.getByText("Stile «Stile 1» attivo")).toBeVisible();
  await station.screenshot({ path: path.join(screenshotsDir, "stili-testo-attivo.png") });

  // Nell'editor le modifiche sono sospese, non perse.
  await station
    .getByRole("region", { name: "Slide" })
    .getByRole("button", { name: "Modifica" })
    .click();
  editor = station.getByRole("dialog", { name: "Modifica testo" });
  await editor.getByRole("tab", { name: "Stile" }).click();
  await expect(editor.getByText("queste modifiche restano salvate ma sono sospese")).toBeVisible();
  await expect(editor.getByLabel("Dimensione %")).toHaveValue("150");
  await editor.getByRole("button", { name: "Annulla" }).click();
  await expect(editor).toBeHidden();

  // Tolto lo stile globale (Nessuno) tornano le modifiche dell'editor.
  await styles.getByRole("button", { name: "Nessuno" }).click();
  await expect.poll(async () => (await shown(projector)).uppercase).toBe(false);
  const back = await shown(projector);
  expect(back.size).toBeCloseTo(base.size * 1.5, 0);
  expect(back.bold).toBe(true);

  // --- Adattamento: uno stile enorme con "adatta" entra rimpicciolendo ---
  await styles.getByRole("button", { name: "Nuovo stile dallo stato attuale" }).click();
  const huge = station.getByRole("dialog", { name: "Stile Stile 2" });
  await huge.getByLabel("Dimensione", { exact: true }).fill("330");
  await station.waitForTimeout(600);
  await huge.getByRole("button", { name: "Chiudi" }).click();
  await expect(huge).toBeHidden();
  await styles.getByRole("button", { name: "Stile 2", exact: true }).click();
  await expect.poll(async () => (await shown(projector)).size).toBeGreaterThan(base.size * 1.5);
  const fitted = await shown(projector);
  // Piu' piccolo di quanto chiede lo stile (330) ma non meno del minimo (60%).
  expect(fitted.size).toBeLessThan((330 / 72) * base.size);
  expect(fitted.size).toBeGreaterThanOrEqual((330 / 72) * base.size * 0.6 - 1);

  // --- Blocco: senza adattamento lo stesso stile non entra e l'uscita non cambia ---
  await styles.getByRole("button", { name: "Modifica lo stile Stile 2" }).click();
  await huge.getByLabel("Adatta se non entra").uncheck();
  await station.waitForTimeout(600);
  await expect(huge.getByRole("alert")).toContainText("Non entra");
  await expect(huge.getByRole("alert")).toContainText("Il testo proiettato non cambia");
  await huge.getByRole("button", { name: "Chiudi" }).click();
  await expect(huge).toBeHidden();
  // L'uscita e' rimasta com'era (con l'adattamento).
  expect((await shown(projector)).size).toBeCloseTo(fitted.size, 0);

  // Uno stile non scelto che non entrerebbe e' disabilitato; Nessuno lo libera.
  await styles.getByRole("button", { name: "Nessuno" }).click();
  await expect.poll(async () => (await shown(projector)).size).toBeCloseTo(base.size * 1.5, 0);
  await station.waitForTimeout(800);
  await expect(styles.getByRole("button", { name: "Stile 2", exact: true })).toBeEnabled();
  await styles.getByRole("button", { name: "Nuovo stile dallo stato attuale" }).click();
  const third = station.getByRole("dialog", { name: "Stile Stile 3" });
  await third.getByLabel("Dimensione", { exact: true }).fill("400");
  await third.getByLabel("Adatta se non entra").uncheck();
  await station.waitForTimeout(600);
  await third.getByRole("button", { name: "Chiudi" }).click();
  await expect(third).toBeHidden();
  await expect(styles.getByRole("button", { name: "Stile 3", exact: true })).toBeDisabled();
  await expect(styles.getByRole("button", { name: "Stile 3", exact: true })).toHaveAttribute(
    "title",
    /Non entra/,
  );
  await station.screenshot({ path: path.join(screenshotsDir, "stili-testo-bloccato.png") });
  // E il programma non e' mai cambiato per questo.
  expect((await shown(projector)).size).toBeCloseTo(base.size * 1.5, 0);

  // --- Scrivere con uno stile attivo: se il testo non entra, l'editor lo dice ---
  await styles.getByRole("button", { name: "Nuovo stile dallo stato attuale" }).click();
  const fourth = station.getByRole("dialog", { name: "Stile Stile 4" });
  await fourth.getByLabel("Dimensione", { exact: true }).fill("120");
  await fourth.getByLabel("Adatta se non entra").uncheck();
  await station.waitForTimeout(600);
  await fourth.getByRole("button", { name: "Chiudi" }).click();
  await expect(fourth).toBeHidden();
  await styles.getByRole("button", { name: "Stile 4", exact: true }).click();
  await expect
    .poll(async () => (await shown(projector)).size)
    .toBeCloseTo((120 / 72) * base.size, 0);
  await station
    .getByRole("region", { name: "Slide" })
    .getByRole("button", { name: "Modifica" })
    .click();
  const editing = station.getByRole("dialog", { name: "Modifica testo" });
  await expect(editing.getByRole("alert")).toHaveCount(0);
  await editing.getByLabel("Testo").fill("parola ".repeat(120));
  await expect(editing.getByRole("alert")).toContainText("Stile 4");
  await expect(editing.getByRole("alert")).toContainText("non entra");
  await editing.getByRole("button", { name: "Annulla" }).click();
  await expect(editing).toBeHidden();
  expect(problems).toEqual([]);
});
