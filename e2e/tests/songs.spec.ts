import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  type ElectronApplication,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";
import { chooseFiles, panelWindowVisible, screenshotsDir, shownPanelWindow, test } from "./app.js";

/**
 * Il modulo Brani vero (repo affiancato plugin-songs, costruito con
 * `pnpm build`): installazione, scheda Brani con selezione e barra fissa,
 * editor in una finestra propria, scaletta, tasti delle sezioni, fuori
 * scaletta, importazione ed esportazione. Senza il pacchetto la prova si salta.
 *
 * I pannelli dei moduli sono iframe isolati in un processo separato: sotto
 * carico Chromium puo' perdere un clic sintetico appena dato. Per questo ogni
 * clic dentro un pannello verifica il suo effetto e, se non e' arrivato,
 * riprova (al massimo 3 volte, solo dove ripetere e' innocuo).
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

const SOON = { timeout: 4000 };

/** Clic dentro un pannello con verifica dell'effetto (vedi sopra). */
async function clickUntil(
  target: Locator,
  done: () => Promise<unknown>,
  options: { double?: boolean; modifiers?: ("ControlOrMeta" | "Shift")[] } = {},
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    if (options.double === true) await target.dblclick();
    else
      await target.click(options.modifiers === undefined ? {} : { modifiers: options.modifiers });
    try {
      await done();
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}

async function install(station: Page, app: ElectronApplication, file: string) {
  await chooseFiles(app, file);
  await station.getByRole("button", { name: "Aggiungi plugin" }).click();
  const window = station.getByRole("dialog", { name: "Plugin" });
  await window.getByRole("tab", { name: "Installati" }).click();
  await window.getByRole("button", { name: "Installa da file…" }).click();

  // La guida al primo uso, coi testi del modulo.
  const guide = station.getByRole("dialog", { name: "Primi passi con «Brani»" });
  await expect(guide).toContainText("I brani in Cuelith");
  await guide.getByRole("button", { name: "Avanti" }).click();
  await guide.getByRole("button", { name: "Avanti" }).click();
  await expect(guide).toContainText("V C P B I E O");
  await guide.getByRole("button", { name: "Ho capito" }).click();
  await expect(guide).toBeHidden();
  const installed = window.getByRole("list", { name: "Installati" });
  await expect(installed).toContainText("Brani");
  // Modulo attivo: e' uno strumento, con la sua icona.
  await expect(installed.getByRole("listitem").filter({ hasText: "Brani" })).toContainText(
    "Strumento",
  );
  await window.getByRole("button", { name: "Chiudi" }).click();
  await expect(window).toBeHidden();
}

/** Apre la scheda Brani dalla colonna degli strumenti (icona del modulo). */
async function openSongs(station: Page): Promise<FrameLocator> {
  const tool = station.getByRole("navigation", { name: "Plugin" }).getByRole("button", {
    name: "Brani",
    exact: true,
  });
  await expect(tool.locator("img")).toHaveAttribute("src", /icon\.svg$/);
  await tool.click();
  const side = station.frameLocator('[data-module-panel="cuelith.songs.songs"]');
  await expect(side.getByRole("button", { name: "+ Nuovo brano" })).toBeVisible();
  return side;
}

const EDITOR = '[data-module-panel="cuelith.songs.editor"]';

const EDITOR_ID = "cuelith.songs.editor";
/** Tempi di apertura dell'editor (ms), per controllare che sia immediata. */
const openingTimes: number[] = [];

/**
 * L'editor si apre in una finestra propria (la zona centrale resta
 * dell'operatore). La finestra e' preparata in anticipo: qui si mostra.
 */
async function editorOpenedBy(app: ElectronApplication, click: Locator) {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    await click.click();
    try {
      const page = await shownPanelWindow(app, EDITOR_ID);
      const editor = page.frameLocator(EDITOR);
      await expect(editor.getByRole("button", { name: "Salva", exact: true })).toBeVisible();
      openingTimes.push(Date.now() - started);
      return { page, editor };
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}

/** «Chiudi» dell'editor nasconde la sua finestra (pronta per la prossima volta). */
async function closeEditor(app: ElectronApplication, editor: FrameLocator): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    if (!(await panelWindowVisible(app, EDITOR_ID))) return;
    await editor
      .getByRole("button", { name: "Chiudi", exact: true })
      .click({ timeout: 5000 })
      .catch(() => undefined);
    // Qui non deve mai comparire «modifiche non salvate»: se succede e' un difetto.
    const unsaved = await editor
      .getByRole("alertdialog")
      .isVisible()
      .catch(() => false);
    expect(unsaved, "l'editor chiede di salvare: non dovrebbe").toBe(false);
    try {
      await expect.poll(() => panelWindowVisible(app, EDITOR_ID), SOON).toBe(false);
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}

/** Aggiunge una sezione dalla fila «+ Verse», «+ Chorus»... */
async function addSection(editor: FrameLocator, kind: string, id: string): Promise<void> {
  await clickUntil(editor.getByRole("button", { name: `+ ${kind}` }), () =>
    expect(editor.getByLabel(`Testo della sezione ${id}`)).toBeVisible(SOON),
  );
}

const bar = (side: FrameLocator) =>
  side.getByRole("toolbar", { name: "Azioni sui brani selezionati" });
const songRow = (side: FrameLocator, title: string) =>
  side.getByRole("option").filter({ hasText: title }).getByRole("button");

test("modulo Brani: nuovo brano nell'editor, scaletta, tasti delle sezioni, importazione ed esportazione", async ({
  running,
}) => {
  test.skip(songsPackage === undefined, "pacchetto plugin-songs non costruito");
  const { app, station, problems } = running;
  await install(station, app, songsPackage ?? "");
  const side = await openSongs(station);
  await expect(side.getByText("Nessun brano ancora.", { exact: false })).toBeVisible();

  // Nuovo brano: l'editor si apre in una finestra sua; la postazione non cambia.
  const { page, editor } = await editorOpenedBy(
    app,
    side.getByRole("button", { name: "+ Nuovo brano" }),
  );
  await expect(editor.getByText("Nuovo brano", { exact: true })).toBeVisible();
  await expect(station.getByRole("region", { name: "Slide" })).toBeVisible();

  // Titolo, autore e testo sono obbligatori.
  const issues = editor.getByRole("alert");
  await clickUntil(editor.getByRole("button", { name: "Salva", exact: true }), () =>
    expect(issues).toContainText("Manca il titolo.", SOON),
  );
  await expect(issues).toContainText("Serve almeno un autore");
  await expect(issues).toContainText("Manca il testo");

  await editor.getByLabel("Titolo").fill("Santo");
  // Autore sconosciuto con un clic.
  await clickUntil(editor.getByRole("button", { name: "Autore sconosciuto" }), () =>
    expect(editor.getByLabel("Autore 1", { exact: true })).toHaveValue("Autore sconosciuto", SOON),
  );
  await editor.getByLabel("Autore 1", { exact: true }).fill("Tradizionale");
  await editor.getByLabel("Testo della sezione V1").fill("Santo, santo\n[---]\nsanto il Signore");
  await addSection(editor, "Chorus", "C1");
  await editor.getByLabel("Testo della sezione C1").fill("[G]Osanna, [D]osanna");
  await addSection(editor, "Verse", "V2");
  await editor.getByLabel("Testo della sezione V2").fill("Benedetto colui che viene");
  await editor.getByLabel("Ordine di proiezione").fill("v1 c1 v2 c1");
  await expect(editor.getByTestId("song-order")).toContainText("V1 → C1 → V2 → C1");
  await expect(issues).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshotsDir, "canti-editor.png") });

  // Salva e metti in scaletta: si ripete solo se non e' successo nulla.
  const savedAdded = page.getByText("«Santo» salvato e messo in scaletta.");
  await clickUntil(editor.getByRole("button", { name: "Salva e metti in scaletta" }), () =>
    expect(savedAdded).toBeVisible({ timeout: 6000 }),
  );

  // Esportazione di un brano in OpenLyrics (formato aperto, per gli altri programmi).
  const exported = path.join(mkdtempSync(path.join(os.tmpdir(), "cuelith-canto-")), "Santo.xml");
  await chooseFiles(app, exported);
  await clickUntil(editor.getByRole("button", { name: "Esporta OpenLyrics" }), () =>
    expect
      .poll(() => (existsSync(exported) ? readFileSync(exported, "utf8") : ""), SOON)
      .toContain("<title>Santo</title>"),
  );
  expect(readFileSync(exported, "utf8")).toContain("<verseOrder>v1 c1 v2 c1</verseOrder>");
  await closeEditor(app, editor);
  await expect(songRow(side, "Santo")).toBeVisible();

  // Backup: tutti i brani in un file ChordPro, scritto dove sceglie l'operatore.
  const backup = path.join(mkdtempSync(path.join(os.tmpdir(), "cuelith-canti-")), "canti.cho");
  await chooseFiles(app, backup);
  await clickUntil(side.getByRole("button", { name: "Esporta tutti…" }), () =>
    expect
      .poll(() => (existsSync(backup) ? readFileSync(backup, "utf8") : ""), SOON)
      .toContain("{title: Santo}"),
  );
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
  await openSongs(station);
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
  await expect(report).toContainText("1 brano importato.");
  await expect(report).toContainText("Alleluia");
  await expect(songRow(side, "Come l'aurora")).toBeVisible();
  const completing = await editorOpenedBy(app, report.getByRole("button", { name: "Completa" }));
  await expect(completing.editor.getByLabel("Titolo")).toHaveValue("Alleluia");
  await expect(completing.editor.getByLabel("Testo della sezione C1")).toHaveValue("Alleluia");
  await closeEditor(app, completing.editor);

  // Editor preparato in anticipo: si apre all'istante (sotto il mezzo secondo).
  expect(Math.min(...openingTimes)).toBeLessThan(500);
  expect(problems).toEqual([]);
});

test("scheda Brani: selezione e barra fissa; fuori scaletta; tasti V1 V2 C1 V3 C1 B1 C1 in cerchio", async ({
  running,
}) => {
  test.skip(songsPackage === undefined, "pacchetto plugin-songs non costruito");
  const { app, station, problems } = running;
  await install(station, app, songsPackage ?? "");
  const side = await openSongs(station);
  const { page, editor } = await editorOpenedBy(
    app,
    bar(side).getByRole("button", { name: "Editor", exact: true }),
  );

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
  await addSection(editor, "Verse", "V2");
  await editor.getByLabel("Testo della sezione V2").fill("Strofa due");
  await addSection(editor, "Verse", "V3");
  await editor.getByLabel("Testo della sezione V3").fill("Strofa tre");
  await addSection(editor, "Chorus", "C1");
  await editor.getByLabel("Testo della sezione C1").fill("Tu mi hai chiamato");
  await addSection(editor, "Bridge", "B1");
  await editor.getByLabel("Testo della sezione B1").fill("Ero legato");
  await editor.getByLabel("Ordine di proiezione").fill("V1 V2 C1 V3 C1 B1 C1");
  await clickUntil(editor.getByRole("button", { name: "Salva", exact: true }), () =>
    expect(page.getByText("«Glorioso giorno» salvato.")).toBeVisible({ timeout: 6000 }),
  );
  await closeEditor(app, editor);

  // Un clic seleziona e basta (nessun editor si apre); senza selezione le azioni sono spente.
  const actions = bar(side);
  const inOnda = actions.getByRole("button", { name: "In onda", exact: true });
  await expect(inOnda).toBeDisabled();
  const glorioso = side.getByRole("option", { name: /Glorioso giorno/ });
  await clickUntil(songRow(side, "Glorioso giorno"), () =>
    expect(glorioso).toHaveAttribute("aria-selected", "true", SOON),
  );
  expect(await panelWindowVisible(app, EDITOR_ID)).toBe(false);

  // Doppio clic = in anteprima, senza scaletta.
  await clickUntil(
    songRow(side, "Glorioso giorno"),
    () => expect(station.locator('[data-screen="cue"]')).toContainText("Strofa uno", SOON),
    { double: true },
  );

  // Dalla barra fissa, subito in onda senza passare dalla scaletta.
  const program = station.locator('[data-screen="live"]');
  await clickUntil(inOnda, () => expect(program).toContainText("Strofa uno", SOON));
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

  // Piu' brani selezionati (Ctrl+clic): «In scaletta» li aggiunge tutti, nell'ordine scelto.
  const second = await editorOpenedBy(app, side.getByRole("button", { name: "+ Nuovo brano" }));
  await second.editor.getByLabel("Titolo").fill("Alba");
  await clickUntil(second.editor.getByRole("button", { name: "Autore sconosciuto" }), () =>
    expect(second.editor.getByLabel("Autore 1", { exact: true })).toHaveValue(
      "Autore sconosciuto",
      SOON,
    ),
  );
  await second.editor.getByLabel("Testo della sezione V1").fill("Luce");
  await clickUntil(second.editor.getByRole("button", { name: "Salva", exact: true }), () =>
    expect(second.page.getByText("«Alba» salvato.")).toBeVisible({ timeout: 6000 }),
  );
  await closeEditor(app, second.editor);
  await clickUntil(songRow(side, "Glorioso giorno"), () =>
    expect(glorioso).toHaveAttribute("aria-selected", "true", SOON),
  );
  const alba = side.getByRole("option", { name: /Alba/ });
  await clickUntil(
    songRow(side, "Alba"),
    () => expect(alba).toHaveAttribute("aria-selected", "true", SOON),
    { modifiers: ["ControlOrMeta"] },
  );
  await expect(inOnda).toBeDisabled();
  const entries = station.getByRole("list", { name: "Voci della scaletta" }).getByRole("listitem");
  await clickUntil(actions.getByRole("button", { name: "In scaletta", exact: true }), async () => {
    await station.getByRole("tab", { name: "Scaletta", exact: true }).click();
    await expect(entries).toHaveCount(3, SOON);
    await station.getByRole("tab", { name: "Brani", exact: true }).click();
  });
  await station.getByRole("tab", { name: "Scaletta", exact: true }).click();
  await expect(entries).toHaveText([/Glorioso giorno/, /Glorioso giorno/, /Alba/]);

  // Editor preparato in anticipo: si apre all'istante (sotto il mezzo secondo).
  expect(Math.min(...openingTimes)).toBeLessThan(500);
  expect(problems).toEqual([]);
});
