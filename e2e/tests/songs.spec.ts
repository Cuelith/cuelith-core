import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { chooseFiles, screenshotsDir, test } from "./app.js";

/**
 * Il modulo Canti vero (repo affiancato plugin-songs, costruito con
 * `pnpm build`): installazione, editor, scaletta, tasti delle sezioni e
 * importazione. Senza il pacchetto la prova si salta.
 */
const distDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../plugin-songs/dist",
);
const songsPackage = existsSync(distDir)
  ? readdirSync(distDir)
      .filter((name) => /^cuelith\.songs-.+\.cpkg$/.test(name))
      .map((name) => path.join(distDir, name))
      .at(-1)
  : undefined;

async function install(station: Page, app: Parameters<typeof chooseFiles>[0], file: string) {
  await chooseFiles(app, file);
  await station.getByRole("button", { name: "Aggiungi moduli" }).click();
  const window = station.getByRole("dialog", { name: "Moduli" });
  await window.getByRole("tab", { name: "Installati" }).click();
  await window.getByRole("button", { name: "Installa da file…" }).click();

  // La guida al primo uso, coi testi del modulo.
  const guide = station.getByRole("dialog", { name: "Primi passi con «Canti»" });
  await expect(guide).toContainText("I canti in Cuelith");
  await guide.getByRole("button", { name: "Avanti" }).click();
  await guide.getByRole("button", { name: "Avanti" }).click();
  await expect(guide).toContainText("V C P B I E O");
  await guide.getByRole("button", { name: "Ho capito" }).click();
  await expect(guide).toBeHidden();
  await expect(window.getByRole("list", { name: "Installati" })).toContainText("Canti");
  await window.getByRole("button", { name: "Chiudi" }).click();
  await expect(window).toBeHidden();
}

test("modulo Canti: nuovo canto con sezioni e ordine, in scaletta, tasti delle sezioni, importazione", async ({
  running,
}) => {
  test.skip(songsPackage === undefined, "pacchetto plugin-songs non costruito");
  const { app, station, problems } = running;
  await install(station, app, songsPackage ?? "");

  const dock = station.getByRole("navigation", { name: "Moduli" });
  await dock.getByRole("button", { name: "Canti", exact: true }).click();
  const side = station.frameLocator('[data-module-panel="cuelith.songs.songs"]');
  await expect(side.getByText("Nessun canto ancora.", { exact: false })).toBeVisible();

  // Nuovo canto: l'editor prende il posto delle Slide.
  await side.getByRole("button", { name: "+ Nuovo canto" }).click();
  const editor = station.frameLocator('[data-module-panel="cuelith.songs.editor"]');
  await expect(editor.getByText("Nuovo canto", { exact: true })).toBeVisible();
  await expect(station.getByRole("region", { name: "Slide" })).toHaveCount(0);

  // Titolo, autore e testo sono obbligatori.
  await editor.getByRole("button", { name: "Salva", exact: true }).click();
  const issues = editor.getByRole("alert");
  await expect(issues).toContainText("Manca il titolo.");
  await expect(issues).toContainText("Serve almeno un autore");
  await expect(issues).toContainText("Manca il testo");

  await editor.getByLabel("Titolo").fill("Santo");
  await editor.getByLabel("Autore 1", { exact: true }).fill("Tradizionale");
  await editor.getByLabel("Testo della sezione V1").fill("Santo, santo\n[---]\nsanto il Signore");
  await editor.getByRole("button", { name: "+ Chorus" }).click();
  await editor.getByLabel("Testo della sezione C1").fill("[G]Osanna, [D]osanna");
  await editor.getByRole("button", { name: "+ Verse" }).click();
  await editor.getByLabel("Testo della sezione V2").fill("Benedetto colui che viene");
  await editor.getByLabel("Ordine di proiezione").fill("v1 c1 v2 c1");
  await expect(editor.getByTestId("song-order")).toContainText("V1 → C1 → V2 → C1");
  await expect(issues).toHaveCount(0);
  await station.screenshot({ path: path.join(screenshotsDir, "canti-editor.png") });

  await editor.getByRole("button", { name: "Salva e metti in scaletta" }).click();
  await expect(station.getByText("«Santo» salvato e messo in scaletta.")).toBeVisible();

  // Esportazione di un canto in OpenLyrics (formato aperto, per gli altri programmi).
  const exported = path.join(mkdtempSync(path.join(os.tmpdir(), "cuelith-canto-")), "Santo.xml");
  await chooseFiles(app, exported);
  await editor.getByRole("button", { name: "Esporta OpenLyrics" }).click();
  await expect
    .poll(() => (existsSync(exported) ? readFileSync(exported, "utf8") : ""))
    .toContain("<title>Santo</title>");
  expect(readFileSync(exported, "utf8")).toContain("<verseOrder>v1 c1 v2 c1</verseOrder>");
  await editor.getByRole("button", { name: "Chiudi", exact: true }).click();
  await expect(station.getByRole("region", { name: "Slide" })).toBeVisible();
  await expect(side.getByRole("list", { name: "Canti" })).toContainText("Santo");

  // Backup: tutti i canti in un file ChordPro, scritto dove sceglie l'operatore.
  const backup = path.join(mkdtempSync(path.join(os.tmpdir(), "cuelith-canti-")), "canti.cho");
  await chooseFiles(app, backup);
  await side.getByRole("button", { name: "Esporta tutti…" }).click();
  await expect
    .poll(() => (existsSync(backup) ? readFileSync(backup, "utf8") : ""))
    .toContain("{title: Santo}");
  expect(readFileSync(backup, "utf8")).toContain("[G]Osanna, [D]osanna");

  // In scaletta: le slide portano il nome della sezione, nell'ordine di proiezione.
  await station.getByRole("tab", { name: "Scaletta", exact: true }).click();
  const entries = station.getByRole("list", { name: "Voci della scaletta" }).getByRole("listitem");
  await expect(entries).toHaveCount(1);
  await entries.first().click({ position: { x: 24, y: 12 } });
  await expect(station.getByTestId("slide-group")).toHaveText(["V1", "V1", "C1", "V2", "C1"]);

  // In onda: gli accordi non si vedono. I tasti vanno per sezioni, non per
  // slide: da V1 (due slide) V porta a V2, non alla seconda slide di V1.
  const program = station.locator('[data-screen="live"]');
  const position = station
    .getByRole("region", { name: "Programma" })
    .getByText(/^Santo · \d di 5$/);
  await station.keyboard.press("Enter");
  await expect(program).toContainText("Santo, santo");
  await station.keyboard.press("v");
  await expect(position).toHaveText("Santo · 4 di 5");
  await expect(program).toContainText("Benedetto colui che viene");
  await station.keyboard.press("c");
  await expect(position).toHaveText("Santo · 5 di 5");
  await expect(program).toContainText("Osanna, osanna");
  await expect(program).not.toContainText("[G]");
  // In cerchio: dopo l'ultimo Chorus C torna al primo, dopo l'ultimo Verse V torna a V1.
  await station.keyboard.press("c");
  await expect(position).toHaveText("Santo · 3 di 5");
  await station.keyboard.press("v");
  await expect(position).toHaveText("Santo · 4 di 5");
  await station.keyboard.press("v");
  await expect(position).toHaveText("Santo · 1 di 5");
  await expect(program).toContainText("Santo, santo");
  await station.screenshot({ path: path.join(screenshotsDir, "canti-in-onda.png") });

  // Importazione: un ChordPro completo si salva, un testo senza autore va completato.
  await dock.getByRole("button", { name: "Canti", exact: true }).click();
  await side.getByTestId("songs-import").setInputFiles([
    {
      name: "aurora.cho",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "{title: Come l'aurora}\n{artist: Gen Verde}\n{soc}\nVieni, Signore\n{eoc}\n",
      ),
    },
    {
      name: "Alleluia.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Strofa 1\nPrima riga\n\nRit.\nAlleluia\n"),
    },
  ]);
  const report = side.getByRole("region", { name: "Importazione" });
  await expect(report).toContainText("1 canto importato.");
  await expect(report).toContainText("Alleluia");
  await expect(side.getByRole("list", { name: "Canti" })).toContainText("Come l'aurora");
  await report.getByRole("button", { name: "Completa" }).click();
  await expect(editor.getByLabel("Titolo")).toHaveValue("Alleluia");
  await expect(editor.getByLabel("Testo della sezione C1")).toHaveValue("Alleluia");
  await editor.getByRole("button", { name: "Chiudi", exact: true }).click();
  await expect(station.getByRole("region", { name: "Slide" })).toBeVisible();

  expect(problems).toEqual([]);
});

test("canto V1 V2 C1 V3 C1 B1 C1 mandato in onda senza scaletta; i tasti vanno per sezioni, in cerchio", async ({
  running,
}) => {
  test.skip(songsPackage === undefined, "pacchetto plugin-songs non costruito");
  const { app, station, problems } = running;
  await install(station, app, songsPackage ?? "");
  const dock = station.getByRole("navigation", { name: "Moduli" });
  await dock.getByRole("button", { name: "Canti", exact: true }).click();
  const side = station.frameLocator('[data-module-panel="cuelith.songs.songs"]');
  await side.getByRole("button", { name: "+ Nuovo canto" }).click();
  const editor = station.frameLocator('[data-module-panel="cuelith.songs.editor"]');

  // Nomi delle sezioni fissi (Verse, Chorus, ...), non tradotti.
  await expect(editor.getByLabel("Tipo della sezione V1")).toHaveValue("verse");
  await expect(editor.getByLabel("Tipo della sezione V1").locator("option")).toHaveText([
    "Verse",
    "Chorus",
    "Pre-Chorus",
    "Bridge",
    "Intro",
    "Ending",
    "Others",
  ]);
  await editor.getByLabel("Titolo").fill("Glorioso giorno");
  await editor.getByLabel("Autore 1", { exact: true }).fill("Autore");
  await editor.getByLabel("Testo della sezione V1").fill("Strofa uno");
  await editor.getByRole("button", { name: "+ Verse" }).click();
  await editor.getByLabel("Testo della sezione V2").fill("Strofa due");
  await editor.getByRole("button", { name: "+ Verse" }).click();
  await editor.getByLabel("Testo della sezione V3").fill("Strofa tre");
  await editor.getByRole("button", { name: "+ Chorus" }).click();
  await editor.getByLabel("Testo della sezione C1").fill("Tu mi hai chiamato");
  await editor.getByRole("button", { name: "+ Bridge" }).click();
  await editor.getByLabel("Testo della sezione B1").fill("Ero legato");
  await editor.getByLabel("Ordine di proiezione").fill("V1 V2 C1 V3 C1 B1 C1");
  await editor.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(station.getByText("«Glorioso giorno» salvato.")).toBeVisible();
  await editor.getByRole("button", { name: "Chiudi", exact: true }).click();

  // Dalla scheda Canti, subito in onda senza passare dalla scaletta.
  await side
    .getByRole("button", { name: "Manda subito in onda «Glorioso giorno» senza scaletta" })
    .click();
  const program = station.locator('[data-screen="live"]');
  await expect(program).toContainText("Strofa uno");
  await expect(station.getByTestId("direct-badge")).toContainText("Fuori scaletta");
  await expect(station.getByTestId("slide-group")).toHaveText([
    "V1",
    "V2",
    "C1",
    "V3",
    "C1",
    "B1",
    "C1",
  ]);

  // I tasti premuti subito dopo il clic nel pannello arrivano alla regia.
  const position = station
    .getByRole("region", { name: "Programma" })
    .getByText(/^Glorioso giorno · \d di 7$/);
  const expectAfter = async (key: string, n: number) => {
    await station.keyboard.press(key);
    await expect(position).toHaveText(`Glorioso giorno · ${String(n)} di 7`);
  };
  await expectAfter("v", 2);
  await expectAfter("v", 4);
  await expectAfter("v", 1);
  await expectAfter("c", 3);
  await expectAfter("c", 5);
  await expectAfter("c", 7);
  await expectAfter("c", 3);
  await expectAfter("b", 6);
  await expectAfter("ArrowRight", 7);
  await station.screenshot({ path: path.join(screenshotsDir, "canti-fuori-scaletta.png") });

  // Lo show non cambia; dal pannello Slide lo si puo' mettere in scaletta.
  await station
    .getByRole("region", { name: "Slide" })
    .getByRole("button", { name: "Metti in scaletta" })
    .click();
  await expect(station.getByText("«Glorioso giorno» messo in scaletta.")).toBeVisible();
  await station.getByRole("tab", { name: "Scaletta", exact: true }).click();
  await expect(
    station.getByRole("list", { name: "Voci della scaletta" }).getByRole("listitem"),
  ).toHaveCount(1);

  // Dalla scheda Librerie del nucleo: in anteprima senza scaletta.
  await station.getByRole("tab", { name: "Librerie", exact: true }).click();
  const row = station.getByRole("listitem").filter({ hasText: "Glorioso giorno" }).first();
  await row.hover();
  await row
    .getByRole("button", { name: "Metti in anteprima «Glorioso giorno» senza scaletta" })
    .click();
  await expect(station.locator('[data-screen="cue"]')).toContainText("Strofa uno");
  expect(problems).toEqual([]);
});
