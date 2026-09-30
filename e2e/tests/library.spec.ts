import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { chooseFiles, screenshotsDir, test } from "./app.js";

const tab = (station: Page, name: string) => station.getByRole("tab", { name, exact: true });

async function openLibraries(station: Page): Promise<void> {
  await tab(station, "Librerie").click();
  await expect(station.getByRole("combobox", { name: "Libreria" })).toBeVisible();
}

async function newLibrary(station: Page, name: string): Promise<void> {
  await station.getByRole("button", { name: "Azioni sulle librerie" }).click();
  await station.getByRole("menuitem", { name: "Nuova libreria…" }).click();
  const dialog = station.getByRole("dialog", { name: "Nuova libreria…" });
  await dialog.getByLabel("Nome").fill(name);
  await dialog.getByRole("button", { name: "Crea" }).click();
  await expect(dialog).toBeHidden();
}

const libraryRows = (station: Page) =>
  station.getByRole("list", { name: "Elementi" }).getByRole("listitem");

test("librerie: canto con crediti, tag e base; ricerca, versioni, in scaletta e crediti in onda", async ({
  running,
}) => {
  const { app, station, problems } = running;
  await openLibraries(station);
  await expect(station.getByText("Qui non c’è ancora nulla.")).toBeVisible();
  await newLibrary(station, "Innario");
  await expect(station.getByRole("combobox", { name: "Libreria" })).toHaveValue(/.+/);

  // Nuovo elemento nella libreria scelta: testo, crediti, tag e base musicale.
  await station.getByRole("button", { name: "+ Nuovo" }).click();
  const editor = station.getByRole("dialog", { name: "Nuovo elemento in libreria" });
  await editor.getByLabel("Titolo").fill("Luce del mattino");
  await editor.getByLabel("Testo").fill("Vieni su di noi\n\nResta con noi");
  await editor.getByRole("tab", { name: "Crediti" }).click();
  await editor.getByRole("button", { name: "+ Aggiungi autore" }).click();
  await editor.getByLabel("Nome dell’autore 1").fill("Anna Rossi");
  await editor.getByLabel("Copyright").fill("2024 Edizioni Aurora");
  await editor.getByLabel("Numero CCLI").fill("CCLI 7012345");
  await expect(editor.getByRole("button", { name: "Salva" })).toBeDisabled();
  await expect(editor.getByText("Il numero CCLI contiene solo cifre.")).toBeVisible();
  await editor.getByLabel("Numero CCLI").fill("7012345");
  await editor
    .getByLabel("Mostra i crediti sulle uscite")
    .selectOption({ label: "Sull’ultima slide" });
  await editor.getByRole("tab", { name: "Tag e file" }).click();
  await editor.getByLabel("Aggiungi un tag").fill("Lode");
  await editor.getByLabel("Aggiungi un tag").press("Enter");
  const base = path.join(mkdtempSync(path.join(os.tmpdir(), "cuelith-base-")), "Base Luce.mp3");
  writeFileSync(base, Buffer.from("ID3 finta base"));
  await chooseFiles(app, base);
  await editor.getByRole("button", { name: "+ Aggiungi file audio…" }).click();
  await expect(editor.getByRole("list", { name: "File allegati" })).toContainText("Base Luce.mp3");
  await expect(editor.getByLabel("Uso di Base Luce.mp3")).toHaveValue("backing");
  await station.screenshot({ path: path.join(screenshotsDir, "libreria-editor.png") });
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(editor).toBeHidden();

  const song = libraryRows(station).filter({ hasText: "Luce del mattino" });
  await expect(song).toContainText("Anna Rossi · 2 slide · #Lode");
  await expect(song.getByLabel("Con file allegati")).toBeVisible();

  // Ricerca senza accenti e per parti di parola; filtro per tag.
  const search = station.getByRole("searchbox", { name: "Cerca nell’archivio" });
  await search.fill("vien");
  await expect(libraryRows(station)).toHaveCount(1);
  await search.fill("nessuna corrispondenza");
  await expect(station.getByText("Nessun elemento trovato.")).toBeVisible();
  await search.fill("");

  // Duplica: una versione indipendente, segnata come tale.
  await song.hover();
  await song.getByRole("button", { name: "Altre azioni per «Luce del mattino»" }).click();
  await station.getByRole("menuitem", { name: "Duplica come nuova versione" }).click();
  await expect(libraryRows(station)).toHaveCount(2);
  await expect(libraryRows(station).filter({ hasText: "versione" })).toHaveCount(1);
  await station.screenshot({ path: path.join(screenshotsDir, "libreria.png") });

  // In scaletta (la copia ricorda l'originale).
  const original = libraryRows(station).filter({ hasNotText: "versione" });
  await original.hover();
  await original.getByRole("button", { name: "In scaletta" }).click();
  await tab(station, "Scaletta").click();
  const entries = station.getByRole("list", { name: "Voci della scaletta" }).getByRole("listitem");
  await expect(entries).toHaveCount(1);
  await entries.first().click();
  await expect(station.getByTestId("library-link")).toContainText("Dalla libreria");

  // In onda fino all'ultima slide: compaiono i crediti.
  const program = station.locator('[data-screen="live"]');
  await station.keyboard.press("Enter");
  await expect(program).toContainText("Vieni su di noi");
  await expect(program.getByTestId("credits")).toHaveCount(0);
  await station.keyboard.press("ArrowRight");
  await expect(program.getByTestId("credits")).toHaveText(
    "Luce del mattino — Anna Rossi · © 2024 Edizioni Aurora · CCLI 7012345",
  );
  await expect(program.locator(".cl-fade-out")).toHaveCount(0);
  await station.screenshot({ path: path.join(screenshotsDir, "libreria-crediti-in-onda.png") });
  expect(problems).toEqual([]);
});

test("l'originale cambia in libreria: la copia in scaletta si aggiorna a richiesta", async ({
  running,
}) => {
  const { station, problems } = running;
  await openLibraries(station);
  await station.getByRole("button", { name: "+ Nuovo" }).click();
  let editor = station.getByRole("dialog", { name: "Nuovo elemento in libreria" });
  await editor.getByLabel("Titolo").fill("Avvisi");
  await editor.getByLabel("Testo").fill("Cena domenica");
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(editor).toBeHidden();

  const row = libraryRows(station).first();
  await row.hover();
  await row.getByRole("button", { name: "In scaletta" }).click();
  await row.getByRole("button", { name: "Modifica" }).click();
  editor = station.getByRole("dialog", { name: "Modifica elemento della libreria" });
  await expect(editor.getByLabel("Testo")).toHaveValue("Cena domenica");
  await editor.getByLabel("Testo").fill("Cena domenica alle 19");
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(editor).toBeHidden();

  await tab(station, "Scaletta").click();
  await station
    .getByRole("list", { name: "Voci della scaletta" })
    .getByRole("listitem")
    .first()
    .click();
  const link = station.getByTestId("library-link");
  await expect(link).toContainText("C’è una versione più recente in libreria.");
  await link.getByRole("button", { name: "Aggiorna" }).click();
  await expect(link).not.toContainText("più recente");
  await expect(station.getByRole("list", { name: "Slide" })).toContainText("Cena domenica alle 19");
  expect(problems).toEqual([]);
});

test("un testo della scaletta si salva in una libreria; si trascina dalla libreria alla scaletta", async ({
  running,
}) => {
  const { station, problems } = running;
  await openLibraries(station);
  await newLibrary(station, "Avvisi");

  // Dalla scaletta alla libreria.
  await tab(station, "Scaletta").click();
  await station.getByRole("button", { name: "+ Testo" }).click();
  const editor = station.getByRole("dialog", { name: "Nuovo testo" });
  await editor.getByLabel("Titolo").fill("Benvenuti");
  await editor.getByLabel("Testo").fill("Benvenuti a tutti");
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(editor).toBeHidden();
  await station.getByRole("button", { name: "Salva in libreria" }).click();
  const choose = station.getByRole("dialog", { name: "Salva «Benvenuti» in libreria" });
  await choose.getByLabel("Libreria").selectOption({ label: "Avvisi" });
  await choose.getByRole("button", { name: "Salva" }).click();
  await expect(station.getByText("«Benvenuti» salvato in libreria.")).toBeVisible();
  await expect(station.getByTestId("library-link")).toContainText("Dalla libreria");

  // Dalla libreria alla scaletta trascinando: passando sulla scheda Scaletta la si apre.
  await openLibraries(station);
  const row = libraryRows(station).filter({ hasText: "Benvenuti" });
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  const tabBox = await tab(station, "Scaletta").boundingBox();
  if (box === null || tabBox === null) throw new Error("elementi non visibili");
  await station.mouse.move(box.x + 20, box.y + box.height / 2);
  await station.mouse.down();
  await station.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2, { steps: 8 });
  const list = station.getByRole("list", { name: "Voci della scaletta" });
  await expect(list).toBeVisible();
  const listBox = await list.getByRole("listitem").first().boundingBox();
  if (listBox === null) throw new Error("scaletta non visibile");
  await station.mouse.move(listBox.x + 40, listBox.y + listBox.height - 4, { steps: 8 });
  await station.mouse.up();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  expect(problems).toEqual([]);
});
