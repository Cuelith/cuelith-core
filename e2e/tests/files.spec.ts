import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, type ElectronApplication } from "@playwright/test";
import {
  answerQuestions,
  asked,
  chooseFiles,
  createText,
  launchApp,
  screenshotsDir,
  test,
} from "./app.js";

/** Termina di colpo l'app con tutti i suoi processi, come un blocco o un'interruzione di corrente. */
async function crash(app: ElectronApplication): Promise<void> {
  const child = app.process();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (process.platform === "win32" && child.pid !== undefined) {
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
  await exited;
}

const folder = () => mkdtempSync(path.join(os.tmpdir(), "cuelith-show-"));

test("salva con nome, nuovo, apri: lo show torna identico", async ({ running }) => {
  const { app, station, problems } = running;
  const entries = station.getByRole("list", { name: "Voci della scaletta" }).getByRole("listitem");
  const unsaved = station.getByTestId("unsaved");

  await createText(station, "Luce del mattino", ["Vieni su di noi", "Resta con noi"]);
  await expect(unsaved).toBeVisible();

  const file = path.join(folder(), "Domenica.cuelith");
  await chooseFiles(app, file);
  await station.keyboard.press("Control+Shift+S");
  await expect(unsaved).toBeHidden();
  expect(existsSync(file)).toBe(true);
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ schema: 1, name: "Nuovo show" });

  // Rinomina dal menu, poi Ctrl+S salva sullo stesso file senza chiedere.
  await station.getByRole("button", { name: /Nuovo show/ }).click();
  await station.getByRole("menuitem", { name: "Rinomina…" }).click();
  const rename = station.getByRole("dialog", { name: "Rinomina lo show" });
  await rename.getByLabel("Nome").fill("Culto di domenica");
  await rename.getByRole("button", { name: "Salva" }).click();
  await expect(unsaved).toBeVisible();
  await chooseFiles(app, undefined); // se chiedesse il percorso, annullerebbe
  await station.keyboard.press("Control+S");
  await expect(unsaved).toBeHidden();
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ name: "Culto di domenica" });
  await station.screenshot({ path: path.join(screenshotsDir, "show-salvato.png") });

  // Nuovo: scaletta vuota (niente da chiedere, era salvato).
  await station.keyboard.press("Control+N");
  await expect(entries).toHaveCount(0);
  await expect(station.getByRole("button", { name: /Nuovo show/ })).toBeVisible();

  // Apri: torna tutto.
  await chooseFiles(app, file);
  await station.keyboard.press("Control+O");
  await expect(entries).toHaveCount(1);
  await expect(entries).toContainText("Luce del mattino");
  await expect(station.getByRole("button", { name: /Culto di domenica/ })).toBeVisible();
  await expect(unsaved).toBeHidden();
  expect(problems).toEqual([]);
});

test("con modifiche non salvate chiede prima di sostituire lo show", async ({ running }) => {
  const { station, problems } = running;
  const entries = station.getByRole("list", { name: "Voci della scaletta" }).getByRole("listitem");
  await createText(station, "Avvisi", ["Primo avviso"]);

  await station.keyboard.press("Control+N");
  const question = station.getByRole("dialog", { name: "Salvare le modifiche a «Nuovo show»?" });
  await expect(question).toBeVisible();
  await station.screenshot({ path: path.join(screenshotsDir, "show-salvare.png") });
  await question.getByRole("button", { name: "Annulla" }).click();
  await expect(question).toBeHidden();
  await expect(entries).toHaveCount(1);

  // Esc e subito di nuovo Ctrl+N: la nuova domanda deve restare aperta.
  await station.keyboard.press("Control+N");
  await expect(question).toBeVisible();
  await station.keyboard.press("Escape");
  await station.keyboard.press("Control+N");
  await expect(question).toBeVisible();
  await station.waitForTimeout(300);
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Non salvare" }).click();
  await expect(entries).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("chiudendo Cuelith con modifiche non salvate si puo' ancora annullare", async ({
  running,
}) => {
  const { app, station, problems } = running;
  await createText(station, "Avvisi", ["Primo avviso"]);
  await answerQuestions(app, "Annulla");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
  await expect.poll(() => asked(app)).toEqual(["Salvare le modifiche a «Nuovo show»?"]);
  // Annullato: la postazione e' ancora li', con lo show intatto.
  await expect(station.getByRole("heading", { name: "Avvisi" })).toBeVisible();
  expect(station.isClosed()).toBe(false);
  expect(problems).toEqual([]);
});

test("dopo un arresto improvviso propone la copia automatica e la riapre", async () => {
  const first = await launchApp({ env: { CUELITH_AUTOSAVE_MS: "300" } });
  await createText(first.station, "Luce del mattino", ["Vieni su di noi"]);
  const autosave = path.join(first.userData, "autosave");
  await expect.poll(() => (existsSync(autosave) ? readdirSync(autosave).length : 0)).toBe(1);
  // Arresto brusco di tutto il programma: niente chiusura corretta, la copia resta.
  await crash(first.app);

  const second = await launchApp({ userData: first.userData });
  try {
    const { station, problems } = second;
    const banner = station
      .getByRole("status")
      .filter({ hasText: "non è stato chiuso correttamente" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Nuovo show");
    await station.screenshot({ path: path.join(screenshotsDir, "show-recupero.png") });
    await banner.getByRole("button", { name: "Riapri la copia" }).click();
    await expect(banner).toBeHidden();
    const entries = station
      .getByRole("list", { name: "Voci della scaletta" })
      .getByRole("listitem");
    await expect(entries).toContainText("Luce del mattino");
    // E' una copia: va salvata con un nome.
    await expect(station.getByTestId("unsaved")).toBeVisible();
    expect(problems).toEqual([]);
  } finally {
    await second.close();
  }
});
