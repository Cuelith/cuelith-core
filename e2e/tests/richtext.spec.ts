import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { addOutput, createText, outputWindow, screenshotsDir, test } from "./app.js";

/**
 * Testo con parole formattate (protocollo 1.21, decisione 0021): si selezionano delle parole
 * nell'editor, si cambia dimensione e grassetto, e la formattazione arriva dappertutto:
 * anteprima, programma e uscita vera. Il testo semplice resta intatto.
 */
interface Shown {
  size: number;
  rich: boolean;
}

const shown = async (page: Page): Promise<Shown> =>
  JSON.parse((await page.locator("body").getAttribute("data-textstyle")) ?? "{}") as Shown;

/** Quanto il testo di ogni riquadro esce dallo spazio utile: deve essere 0. */
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

test("parole formattate: dimensione e grassetto dall'editor all'uscita, il testo semplice non cambia", async ({
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
  expect((await shown(projector)).rich).toBe(false);

  // --- Nell'editor: selezionare "Signore" (dal carattere 3) e cambiare dimensione e grassetto ---
  await station
    .getByRole("region", { name: "Slide" })
    .getByRole("button", { name: "Modifica" })
    .click();
  const editor = station.getByRole("dialog", { name: "Modifica testo" });
  const area = editor.getByLabel("Testo", { exact: true });
  await area.click();
  await station.keyboard.press("Control+Home");
  for (let i = 0; i < 3; i += 1) await station.keyboard.press("ArrowRight");
  for (let i = 0; i < 7; i += 1) await station.keyboard.press("Shift+ArrowRight");
  const bar = editor.getByRole("toolbar", { name: "Formattazione delle parole" });
  await bar.getByLabel("Dimensione").selectOption("2");
  await bar.getByRole("button", { name: "Grassetto" }).click();
  // Il testo scritto non cambia, e si vede come lo vedra' il pubblico.
  await expect(area).toHaveValue("Il Signore e' il mio pastore\n\nnon manco di nulla");
  await expect(editor.getByText("Come lo vede il pubblico")).toBeVisible();
  await expect(editor.locator("span[style*='font-size: 200%']").first()).toHaveText("Signore");
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(editor).toBeHidden();

  // --- Programma e uscita: la parola e' piu' grande, il testo e' lo stesso ---
  await expect(projector.locator("body")).toHaveAttribute(
    "data-text",
    "Il Signore e' il mio pastore",
  );
  await expect.poll(async () => (await shown(projector)).rich).toBe(true);
  const program = station.getByRole("region", { name: "Programma" });
  await expect(program.locator("span[style*='font-size: 200%']")).toHaveText("Signore");
  await expect(program.locator("span[style*='font-weight']").first()).toHaveText("Signore");
  expect(await overflow(station)).toEqual(expect.arrayContaining([0]));
  expect(Math.max(...(await overflow(station)))).toBe(0);
  await projector.screenshot({ path: path.join(screenshotsDir, "testo-formattato-uscita.png") });
  await station.screenshot({ path: path.join(screenshotsDir, "testo-formattato.png") });

  // --- Scrivere davanti alla parola porta con se' la formattazione ---
  await station
    .getByRole("region", { name: "Slide" })
    .getByRole("button", { name: "Modifica" })
    .click();
  const again = station.getByRole("dialog", { name: "Modifica testo" });
  const box = again.getByLabel("Testo", { exact: true });
  await box.click();
  await station.keyboard.press("Control+Home");
  await station.keyboard.type("Oh, ");
  await expect(again.locator("span[style*='font-size: 200%']").first()).toHaveText("Signore");
  // Togliere la formattazione: selezionare tutto e usare «Togli formattazione».
  await station.keyboard.press("Control+a");
  await again.getByRole("button", { name: "Togli formattazione" }).click();
  await expect(again.getByText("Come lo vede il pubblico")).toHaveCount(0);
  await again.getByRole("button", { name: "Annulla" }).click();
  await expect(again).toBeHidden();
  expect(problems).toEqual([]);
});
