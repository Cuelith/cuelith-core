import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type FrameLocator, type Page } from "@playwright/test";
import {
  addOutput,
  chooseFiles,
  createText,
  launchBrowser,
  outputWindow,
  test,
  type RunningApp,
} from "../tests/app.js";

// Schermate per il sito di Cuelith: non e' una prova, e' il programma vero
// con uno show credibile, fotografato. Si rifanno con `pnpm site:shots`, cosi'
// il sito mostra sempre l'interfaccia di adesso. Testi e immagini sono
// originali (nessun diritto di terzi).

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../screenshots/site");
const songsDist = path.resolve(here, "../../../plugin-songs/dist");
const songsPackage = existsSync(songsDist)
  ? readdirSync(songsDist)
      .filter((name) => /^cuelith\.songs-.+\.cpkg$/.test(name))
      .sort()
      .map((name) => path.join(songsDist, name))
      .at(-1)
  : undefined;

/** Sfondo originale: un gradiente con aloni, come un cielo. */
function backdrop(name: string, from: string, to: string, glow: string): string {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "cuelith-sito-")), `${name}.svg`);
  writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
<radialGradient id="a" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${glow}" stop-opacity="0.75"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1920" height="1080" fill="url(#g)"/>
<ellipse cx="1480" cy="230" rx="760" ry="520" fill="url(#a)"/>
<ellipse cx="330" cy="980" rx="820" ry="420" fill="url(#a)" opacity="0.5"/>
</svg>`,
  );
  return file;
}

const SONGS = [
  {
    name: "strade-di-sera.cho",
    text: `{title: Strade di sera}
{artist: Cuelith demo}
{start_of_verse: Verse 1}
Strade di sera, luci accese su di noi
la città respira piano insieme a noi
{end_of_verse}
{start_of_chorus: Chorus 1}
Resta ancora un po'
la notte è appena qui
{end_of_chorus}
{start_of_verse: Verse 2}
Passi sul selciato, voci che non so
ogni finestra accesa è una storia in più
{end_of_verse}
{start_of_bridge: Bridge 1}
E quando tornerà il mattino
saremo ancora qui
{end_of_bridge}
`,
  },
  {
    name: "mare-aperto.cho",
    text: `{title: Mare aperto}
{artist: Cuelith demo}
{start_of_verse: Verse 1}
Vento sulla prua, il porto è già lontano
davanti solo il blu, il resto lo lasciamo
{end_of_verse}
{start_of_chorus: Chorus 1}
Mare aperto
portaci più in là
{end_of_chorus}
`,
  },
  {
    name: "il-viaggio.cho",
    text: `{title: Il viaggio}
{artist: Cuelith demo}
{start_of_verse: Verse 1}
Una valigia, un treno e poco più
{end_of_verse}
{start_of_chorus: Chorus 1}
Il viaggio comincia da qui
{end_of_chorus}
`,
  },
];

async function size(running: RunningApp, width: number, height: number): Promise<void> {
  await running.app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const station = BrowserWindow.getAllWindows().find(
        (win) =>
          win.webContents.getURL().startsWith("http://127.0.0.1") &&
          !win.webContents.getURL().includes("output=") &&
          !win.webContents.getURL().includes("panelWindow="),
      );
      station?.unmaximize();
      station?.setContentSize(w ?? 1440, h ?? 900);
    },
    [width, height],
  );
  await expect.poll(() => running.station.evaluate(() => window.innerWidth)).toBe(width);
}

async function installSongs(running: RunningApp, file: string): Promise<FrameLocator> {
  const { app, station } = running;
  await chooseFiles(app, file);
  await station.getByRole("button", { name: "Aggiungi moduli" }).click();
  const modules = station.getByRole("dialog", { name: "Moduli" });
  await modules.getByRole("tab", { name: "Installati" }).click();
  await modules.getByRole("button", { name: "Installa da file…" }).click();
  const guide = station.getByRole("dialog", { name: "Primi passi con «Canti»" });
  await guide.getByRole("button", { name: "Avanti" }).click();
  await guide.getByRole("button", { name: "Avanti" }).click();
  await guide.getByRole("button", { name: "Ho capito" }).click();
  await modules.getByRole("button", { name: "Chiudi" }).click();
  await station
    .getByRole("navigation", { name: "Moduli" })
    .getByRole("button", { name: "Canti", exact: true })
    .click();
  const side = station.frameLocator('[data-module-panel="cuelith.songs.songs"]');
  await expect(side.getByRole("button", { name: "+ Nuovo canto" })).toBeVisible();
  return side;
}

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });

test("schermate per il sito", async ({ running }) => {
  test.skip(songsPackage === undefined, "pacchetto plugin-songs non costruito");
  test.setTimeout(300_000);
  mkdirSync(out, { recursive: true });
  const { app, station } = running;
  await size(running, 1440, 900);

  await station.getByRole("button", { name: /Nuovo show/ }).click();
  await station.getByRole("menuitem", { name: "Rinomina…" }).click();
  const rename = station.getByRole("dialog", { name: "Rinomina lo show" });
  await rename.getByLabel("Nome").fill("Serata d'estate");
  await rename.getByRole("button", { name: "Salva" }).click();
  await expect(rename).toBeHidden();

  // Uno show come quello di una serata: canzoni, un saluto, il programma.
  const side = await installSongs(running, songsPackage ?? "");
  await side.getByTestId("songs-import").setInputFiles(
    SONGS.map((song) => ({
      name: song.name,
      mimeType: "text/plain",
      buffer: Buffer.from(song.text),
    })),
  );
  const row = (title: string) => side.getByRole("option").filter({ hasText: title });
  await expect(row("Il viaggio")).toBeVisible();
  const actions = side.getByRole("toolbar", { name: "Azioni sui canti selezionati" });
  const entries = station.getByRole("list", { name: "Voci della scaletta" }).getByRole("listitem");
  const playlist = station.getByRole("tab", { name: "Scaletta", exact: true });
  const songsTab = station.getByRole("tab", { name: "Canti", exact: true });
  let count = 0;
  for (const title of ["Strade di sera", "Mare aperto", "Il viaggio"]) {
    count++;
    const wanted = count;
    await expect(async () => {
      await songsTab.click();
      await row(title).getByRole("button").click();
      await expect(row(title)).toHaveAttribute("aria-selected", "true", { timeout: 2000 });
      await actions.getByRole("button", { name: "In scaletta", exact: true }).click();
      await playlist.click();
      await expect(entries).toHaveCount(wanted, { timeout: 2000 });
    }).toPass({ timeout: 30_000 });
  }
  await shotSongs(station, songsTab);
  await playlist.click();
  await createText(station, "Benvenuti", ["Benvenuti\nLa serata inizia tra poco"]);
  await createText(station, "Programma della serata", [
    "Ore 21:00\nApertura e saluti",
    "Ore 22:30\nOspiti sul palco",
  ]);
  await expect(entries).toHaveCount(5);

  // Due uscite: la sala e il palco.
  await addOutput(station, "Proiettore", "Sala");
  await addOutput(station, "Palco", "Palco");
  const projector = await outputWindow(running, "Proiettore");
  const stage = await outputWindow(running, "Palco");

  // Sfondi: uno per il primo canto, uno predefinito per tutto il resto.
  const backgrounds = station.getByRole("region", { name: "Sfondi" });
  const add = backgrounds.getByRole("button", { name: "Aggiungi un'immagine dal computer" });
  await entries.filter({ hasText: "Strade di sera" }).click();
  await backgrounds.getByRole("radio", { name: /^Predefinito/ }).click();
  await chooseFiles(app, backdrop("notte", "#0E1B3A", "#1D3F6E", "#3E7FC4"));
  await add.click();
  await expect(backgrounds.getByRole("button", { name: "notte.svg" })).toBeVisible();
  await backgrounds.getByRole("radio", { name: "Tutto l'elemento" }).click();
  await chooseFiles(app, backdrop("alba", "#3A1A2E", "#B4532A", "#F2B441"));
  await add.click();
  await expect(backgrounds.getByRole("button", { name: "alba.svg" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await backgrounds.getByRole("combobox", { name: "Velo" }).selectOption({ label: "leggero" });

  // In onda la prima strofa, in anteprima il ritornello.
  await station.getByRole("button", { name: "Slide 1" }).dblclick();
  await station.getByRole("button", { name: "Slide 2" }).click();
  await expect(projector.locator("body")).toHaveAttribute("data-text", /Strade di sera/);
  await expect(projector.locator("body")).toHaveAttribute("data-background", /^\/media\//);
  await station.locator("header").first().hover();
  await station.waitForTimeout(600);
  await shot(station, "regia");
  await shot(projector, "uscita-sala");
  await shot(stage, "uscita-palco");

  // Disposizione Band: le sezioni del canto come grossi pulsanti.
  await station.getByRole("button", { name: "Band", exact: true }).click();
  await station.waitForTimeout(400);
  await shot(station, "band");
  await station.getByRole("button", { name: "Presenta", exact: true }).click();

  // Moduli e risorse.
  await station.getByRole("button", { name: "Aggiungi moduli" }).click();
  const modules = station.getByRole("dialog", { name: "Moduli" });
  await modules.getByRole("tab", { name: "Installati" }).click();
  await expect(modules.getByRole("list", { name: "Installati" })).toContainText("Canti");
  await shot(station, "moduli");
  await modules.getByRole("button", { name: "Chiudi" }).click();
  await station.getByRole("button", { name: /^Risorse del computer/ }).click();
  const settings = station.getByRole("dialog", { name: "Impostazioni" });
  await expect(settings.getByRole("list", { name: "Uscite" })).toContainText(
    /[1-9]\d* fotogrammi/,
    {
      timeout: 30_000,
    },
  );
  await shot(station, "risorse");

  // Postazioni in rete: il telefono come telecomando.
  await settings.getByRole("button", { name: "Rete e postazioni" }).click();
  await settings.getByRole("switch", { name: "Consenti altre postazioni in rete locale" }).click();
  const url = (await settings.getByTestId("network-url").textContent()) ?? "";
  await settings.getByRole("combobox", { name: "Ruolo" }).selectOption({ label: "Telecomando" });
  await settings.getByRole("button", { name: "Mostra codice" }).click();
  const code = (await settings.getByTestId("pairing-code").textContent()) ?? "";
  await shot(station, "rete");
  const phone = await launchBrowser(url, { width: 400, height: 800 });
  try {
    await phone.page.getByLabel("Codice di abbinamento").fill(code);
    await phone.page.getByLabel("Nome di questa postazione").fill("Telefono");
    await phone.page.getByRole("button", { name: "Abbina" }).click();
    await expect(phone.page.getByRole("region", { name: "Programma" })).toContainText(
      "Strade di sera",
    );
    await shot(phone.page, "telecomando");
  } finally {
    await phone.close();
  }
});

/** La scheda Canti con l'elenco e la barra delle azioni. */
async function shotSongs(station: Page, songsTab: ReturnType<Page["getByRole"]>): Promise<void> {
  await songsTab.click();
  await station.waitForTimeout(500);
  await shot(station, "canti");
}
