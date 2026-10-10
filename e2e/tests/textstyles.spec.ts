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
  outline: number;
  shadow: number;
  weight: number;
  italic: boolean;
  letterSpacing: number;
  vAlign: string;
  font: string;
}

/** Quanto il testo di ogni riquadro (programma, anteprima) esce dallo spazio utile: deve essere 0. */
const overflow = (page: Page): Promise<number[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("span.relative.w-full")].map((span) => {
      const box = span.parentElement;
      if (box === null) return 0;
      const pad = parseFloat(getComputedStyle(box).paddingLeft);
      const range = document.createRange();
      range.selectNodeContents(span);
      return Math.max(0, range.getBoundingClientRect().width - (box.clientWidth - 2 * pad));
    }),
  );
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
  await editor.getByLabel("Spessore").selectOption("bold");
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
  await form.getByLabel("Spessore").selectOption("normal");
  await form.getByLabel("Bordo", { exact: true }).check();
  await form.getByLabel("Ombra", { exact: true }).check();
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
  // Lo stile ha l'adattamento: la riga in maiuscolo non entra intera alla dimensione chiesta,
  // quindi si rimpicciolisce (non va a capo), ma non oltre il minimo.
  expect(withGlobal.size).toBeLessThanOrEqual((144 / 72) * base.size + 0.5);
  expect(withGlobal.size).toBeGreaterThanOrEqual((144 / 72) * base.size * 0.6 - 1);
  expect(withGlobal.bold).toBe(false);
  expect(withGlobal.outline).toBe(3);
  expect(withGlobal.shadow).toBe(4);
  await expect(styles.getByText("Stile «Stile 1» attivo")).toBeVisible();
  // Nei riquadri il testo resta dentro lo spazio utile (le lettere non si allargano nel piccolo).
  for (const excess of await overflow(station)) expect(excess).toBeLessThan(2);
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
  await huge.getByLabel("Dimensione", { exact: true }).fill("180");
  await station.waitForTimeout(600);
  await huge.getByRole("button", { name: "Chiudi" }).click();
  await expect(huge).toBeHidden();
  await styles.getByRole("button", { name: "Stile 2", exact: true }).click();
  await expect.poll(async () => (await shown(projector)).size).toBeGreaterThan(base.size * 1.2);
  const fitted = await shown(projector);
  // Piu' piccolo di quanto chiede lo stile (180) ma non meno del minimo (60%).
  expect(fitted.size).toBeLessThan((180 / 72) * base.size);
  expect(fitted.size).toBeGreaterThanOrEqual((180 / 72) * base.size * 0.6 - 1);

  // --- Blocco: senza adattamento lo stesso stile non entra e l'uscita non cambia ---
  await styles.getByRole("button", { name: "Modifica lo stile Stile 2" }).click();
  await huge.getByLabel("Adatta se non entra").uncheck();
  await huge.getByLabel("Dimensione", { exact: true }).fill("400");
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

test("editor degli stili: tanti caratteri veri, spessore e corsivo solo se esistono, esempio dalla slide", async ({
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

  const styles = station.getByRole("region", { name: "Stili del testo" });
  await styles.getByRole("button", { name: "Nuovo stile dallo stato attuale" }).click();
  const form = station.getByRole("dialog", { name: "Stile Stile 1" });

  // L'esempio e' il testo della slide in anteprima (qui c'e': la seconda slide e' ancora li').
  const preview = form.getByTestId("style-preview");
  await expect(preview).toContainText(/Signore|manco/);
  await expect(form.getByText("Anteprima con il testo della slide in anteprima.")).toBeVisible();

  // Cinque famiglie, tanti caratteri; ognuno si presenta con il suo stesso carattere.
  const fonts = form.getByRole("listbox", { name: "Carattere" });
  await expect(fonts.getByRole("option")).toHaveCount(7);
  await form.getByRole("tab", { name: "Titoli" }).click();
  await expect(fonts.getByRole("option")).toHaveCount(5);
  await form.getByRole("tab", { name: "Senza grazie" }).click();
  await expect(fonts.getByRole("option")).toHaveCount(10);

  // Bebas Neue ha un solo spessore e nessun corsivo: non si offrono quelli finti.
  await form.getByRole("tab", { name: "Titoli" }).click();
  await fonts.getByRole("option", { name: /Bebas Neue/ }).click();
  const weights = form.getByLabel("Spessore");
  await expect(weights.locator("option")).toHaveCount(1);
  await expect(form.getByLabel("Corsivo")).toBeDisabled();

  // Lora: spessori veri e corsivo vero; spaziatura e posizione arrivano alle uscite.
  await form.getByRole("tab", { name: "Con grazie" }).click();
  await fonts.getByRole("option", { name: /Lora/ }).click();
  await expect(form.getByLabel("Corsivo")).toBeEnabled();
  await form.getByLabel("Corsivo").check();
  await form.getByLabel("Spessore").selectOption("semibold");
  await form.getByLabel("Spaziatura lettere %").fill("8");
  await form.getByRole("radio", { name: "In basso" }).click();
  await station.waitForTimeout(600);
  await station.screenshot({ path: path.join(screenshotsDir, "stili-testo-editor.png") });
  await form.getByRole("button", { name: "Chiudi" }).click();
  await expect(form).toBeHidden();
  await styles.getByRole("button", { name: "Stile 1", exact: true }).click();
  await expect
    .poll(async () => {
      const now = await shown(projector);
      return [now.font, now.weight, now.italic, now.letterSpacing, now.vAlign].join("|");
    })
    .toBe("lora|600|true|0.08|bottom");
  // Il carattere e' davvero caricato nell'uscita e il testo non esce dallo spazio.
  expect(
    await projector.evaluate(() => document.fonts.check('italic 600 40px "Lora Variable"')),
  ).toBe(true);
  expect(await overflow(station)).toEqual(expect.arrayContaining([0]));
  await station.screenshot({ path: path.join(screenshotsDir, "stili-testo-caratteri.png") });

  expect(problems).toEqual([]);
});

test("editor degli stili senza slide in anteprima: testo di prova nella lingua in uso, righe di lunghezze diverse", async ({
  running,
}) => {
  const { station, problems } = running;
  const styles = station.getByRole("region", { name: "Stili del testo" });
  await styles.getByRole("button", { name: "Nuovo stile dallo stato attuale" }).click();
  const form = station.getByRole("dialog", { name: "Stile Stile 1" });
  const preview = form.getByTestId("style-preview");
  await expect(preview).toContainText("Strade di sera");
  await expect(preview).toContainText("ogni finestra accesa");
  await expect(
    form.getByText("Nessuna slide in anteprima: questo è un testo di prova", { exact: false }),
  ).toBeVisible();
  const lines = await preview.evaluate((box) =>
    box.textContent.split(String.fromCharCode(10)).map((line) => line.length),
  );
  expect(new Set(lines).size).toBeGreaterThanOrEqual(3);
  expect(problems).toEqual([]);
});
