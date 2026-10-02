import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type FrameLocator, type Page } from "@playwright/test";
import {
  addOutput,
  chooseFiles,
  createText,
  launchApp,
  launchBrowser,
  outputWindow,
  test,
  type RunningApp,
} from "../tests/app.js";

// Schermate per il sito di Cuelith: non e' una prova, e' il programma vero
// con uno show credibile, fotografato. Si rifanno con `pnpm site:shots`, cosi'
// il sito mostra sempre l'interfaccia di adesso. Testi e immagini sono
// originali (nessun diritto di terzi) e neutri: Cuelith e' per ogni evento.
//
// Due serie: in italiano e in inglese (show, canzoni e nomi compresi). La
// regia si guida sempre in italiano; per la serie inglese si passa
// all'inglese solo nel momento della fotografia.

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../screenshots/site");
const songsDist = path.resolve(here, "../../../plugin-songs/dist");
const songsPackage = existsSync(songsDist)
  ? readdirSync(songsDist)
      .filter((name) => /^cuelith\.songs-.+\.cpkg$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => path.join(songsDist, name))
      .at(-1)
  : undefined;
const hasEnglish = existsSync(path.resolve(here, "../../../plugin-locale-en/cuelith-plugin.json"));

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

interface Demo {
  readonly lang: "it" | "en";
  readonly dir: string;
  /** Nome dello show appena creato e dei due look, nella lingua d'avvio. */
  readonly newShow: string;
  readonly looks: { readonly room: string; readonly stage: string };
  readonly show: string;
  readonly songs: readonly { readonly name: string; readonly title: string; text: string }[];
  readonly welcome: readonly [string, string[]];
  readonly programme: readonly [string, string[]];
  readonly outputs: { readonly room: string; readonly stage: string };
  readonly backdrops: { readonly night: string; readonly dawn: string };
  readonly phone: string;
}

const ITALIAN: Demo = {
  lang: "it",
  dir: out,
  newShow: "Nuovo show",
  looks: { room: "Sala", stage: "Palco" },
  show: "Serata d'estate",
  songs: [
    {
      name: "strade-di-sera.cho",
      title: "Strade di sera",
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
      title: "Mare aperto",
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
      title: "Il viaggio",
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
  ],
  welcome: ["Benvenuti", ["Benvenuti\nLa serata inizia tra poco"]],
  programme: [
    "Programma della serata",
    ["Ore 21:00\nApertura e saluti", "Ore 22:30\nOspiti sul palco"],
  ],
  outputs: { room: "Proiettore", stage: "Palco" },
  backdrops: { night: "notte", dawn: "alba" },
  phone: "Telefono",
};

const ENGLISH: Demo = {
  lang: "en",
  dir: path.join(out, "en"),
  newShow: "New show",
  looks: { room: "Room", stage: "Stage" },
  show: "Summer night",
  songs: [
    {
      name: "city-lights.cho",
      title: "City lights",
      text: `{title: City lights}
{artist: Cuelith demo}
{start_of_verse: Verse 1}
City lights are calling, shining over you and me
every street is breathing slow, as far as we can see
{end_of_verse}
{start_of_chorus: Chorus 1}
Stay a little longer
the night has just begun
{end_of_chorus}
{start_of_verse: Verse 2}
Footsteps on the pavement, voices I don't know
every lighted window tells a story of its own
{end_of_verse}
{start_of_bridge: Bridge 1}
And when the morning finds us
we will still be here
{end_of_bridge}
`,
    },
    {
      name: "open-sea.cho",
      title: "Open sea",
      text: `{title: Open sea}
{artist: Cuelith demo}
{start_of_verse: Verse 1}
Wind across the bow now, the harbour far behind
nothing but the blue ahead, we leave the rest behind
{end_of_verse}
{start_of_chorus: Chorus 1}
Open sea
carry us away
{end_of_chorus}
`,
    },
    {
      name: "the-journey.cho",
      title: "The journey",
      text: `{title: The journey}
{artist: Cuelith demo}
{start_of_verse: Verse 1}
One old suitcase, one last train and little more
{end_of_verse}
{start_of_chorus: Chorus 1}
The journey starts from here
{end_of_chorus}
`,
    },
  ],
  welcome: ["Welcome", ["Welcome\nThe evening starts soon"]],
  programme: ["Tonight's programme", ["9:00 pm\nOpening and welcome", "10:30 pm\nGuests on stage"]],
  outputs: { room: "Projector", stage: "Stage" },
  backdrops: { night: "night", dawn: "dawn" },
  phone: "Phone",
};

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

/**
 * Cambia la lingua dell'interfaccia come farebbe Impostazioni → Generale, ma
 * senza toccare cio' che e' aperto sullo schermo: un collegamento a parte al
 * motore, con le credenziali della postazione locale.
 */
async function setLanguage(station: Page, lang: string): Promise<void> {
  await station.evaluate(async (wanted) => {
    const desktop = (
      window as unknown as { cuelithDesktop: { getLocalSession(): Promise<{ token: string }> } }
    ).cuelithDesktop;
    const { token } = await desktop.getLocalSession();
    const ws = new WebSocket(`ws://${location.host}/rpc`);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    let id = 0;
    const call = (method: string, params: unknown) =>
      new Promise<void>((resolve, reject) => {
        const mine = ++id;
        const onMessage = (event: MessageEvent<string>) => {
          const message = JSON.parse(event.data) as { id?: number; error?: { message: string } };
          if (message.id !== mine) return;
          ws.removeEventListener("message", onMessage);
          if (message.error) reject(new Error(message.error.message));
          else resolve();
        };
        ws.addEventListener("message", onMessage);
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: mine, method, params }));
      });
    await call("session.hello", { protocol: "1.13.0", client: { name: "Foto", kind: "client" } });
    await call("session.auth", { token });
    await call("locale.set", { lang: wanted });
    ws.close();
  }, lang);
  await expect(station.locator("html")).toHaveAttribute("lang", lang);
  // I pannelli dei moduli ricevono i testi nuovi subito dopo.
  await station.waitForTimeout(700);
}

async function installSongs(running: RunningApp, file: string): Promise<FrameLocator> {
  const { app, station } = running;
  await chooseFiles(app, file);
  await station.getByRole("button", { name: "Aggiungi plugin" }).click();
  const modules = station.getByRole("dialog", { name: "Plugin" });
  await modules.getByRole("tab", { name: "Installati" }).click();
  await modules.getByRole("button", { name: "Installa da file…" }).click();
  const guide = station.getByRole("dialog", { name: "Primi passi con «Canti»" });
  await guide.getByRole("button", { name: "Avanti" }).click();
  await guide.getByRole("button", { name: "Avanti" }).click();
  await guide.getByRole("button", { name: "Ho capito" }).click();
  await modules.getByRole("button", { name: "Chiudi" }).click();
  await station
    .getByRole("navigation", { name: "Plugin" })
    .getByRole("button", { name: "Canti", exact: true })
    .click();
  const side = station.frameLocator('[data-module-panel="cuelith.songs.songs"]');
  await expect(side.getByRole("button", { name: "+ Nuovo canto" })).toBeVisible();
  return side;
}

async function shoot(running: RunningApp, demo: Demo): Promise<void> {
  mkdirSync(demo.dir, { recursive: true });
  const { app, station } = running;
  // Fotografa nella lingua della serie, poi torna all'italiano con cui si guida.
  const shot = async (page: Page, name: string, other: Page = station) => {
    if (demo.lang !== "it") {
      await setLanguage(station, demo.lang);
      if (other !== station) await expect(other.locator("html")).toHaveAttribute("lang", demo.lang);
    }
    await page.screenshot({ path: path.join(demo.dir, `${name}.png`) });
    if (demo.lang !== "it") await setLanguage(station, "it");
  };
  if (demo.lang !== "it") await setLanguage(station, "it");
  await size(running, 1440, 900);

  await station.getByRole("button", { name: new RegExp(demo.newShow) }).click();
  await station.getByRole("menuitem", { name: "Rinomina…" }).click();
  const rename = station.getByRole("dialog", { name: "Rinomina lo show" });
  await rename.getByLabel("Nome").fill(demo.show);
  await rename.getByRole("button", { name: "Salva" }).click();
  await expect(rename).toBeHidden();

  // Uno show come quello di una serata: canzoni, un saluto, il programma.
  const side = await installSongs(running, songsPackage ?? "");
  await side.getByTestId("songs-import").setInputFiles(
    demo.songs.map((song) => ({
      name: song.name,
      mimeType: "text/plain",
      buffer: Buffer.from(song.text),
    })),
  );
  const row = (title: string) => side.getByRole("option").filter({ hasText: title });
  await expect(row(demo.songs[2]?.title ?? "")).toBeVisible();
  const actions = side.getByRole("toolbar", { name: "Azioni sui canti selezionati" });
  const entries = station.getByRole("list", { name: "Voci della scaletta" }).getByRole("listitem");
  const playlist = station.getByRole("tab", { name: "Scaletta", exact: true });
  const songsTab = station.getByRole("tab", { name: "Canti", exact: true });
  let count = 0;
  for (const { title } of demo.songs) {
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
  await songsTab.click();
  await station.waitForTimeout(500);
  await shot(station, "canti");
  await playlist.click();
  await createText(station, demo.welcome[0], demo.welcome[1]);
  await createText(station, demo.programme[0], demo.programme[1]);
  await expect(entries).toHaveCount(5);

  // Due uscite: la sala e il palco.
  await addOutput(station, demo.outputs.room, demo.looks.room);
  await addOutput(station, demo.outputs.stage, demo.looks.stage);
  const projector = await outputWindow(running, demo.outputs.room);
  const stage = await outputWindow(running, demo.outputs.stage);

  // Sfondi: uno per la prima canzone, uno predefinito per tutto il resto.
  const first = demo.songs[0]?.title ?? "";
  const backgrounds = station.getByRole("region", { name: "Sfondi" });
  const add = backgrounds.getByRole("button", { name: "Aggiungi un'immagine dal computer" });
  await entries.filter({ hasText: first }).click();
  await backgrounds.getByRole("radio", { name: /^Predefinito/ }).click();
  await chooseFiles(app, backdrop(demo.backdrops.night, "#0E1B3A", "#1D3F6E", "#3E7FC4"));
  await add.click();
  await expect(
    backgrounds.getByRole("button", { name: `${demo.backdrops.night}.svg` }),
  ).toBeVisible();
  await backgrounds.getByRole("radio", { name: "Tutto l'elemento" }).click();
  await chooseFiles(app, backdrop(demo.backdrops.dawn, "#3A1A2E", "#B4532A", "#F2B441"));
  await add.click();
  await expect(
    backgrounds.getByRole("button", { name: `${demo.backdrops.dawn}.svg` }),
  ).toHaveAttribute("aria-pressed", "true");
  await backgrounds.getByRole("combobox", { name: "Velo" }).selectOption({ label: "leggero" });

  // In onda la prima strofa, in anteprima il ritornello.
  await station.getByRole("button", { name: "Slide 1" }).dblclick();
  await station.getByRole("button", { name: "Slide 2" }).click();
  await expect(projector.locator("body")).toHaveAttribute("data-text", new RegExp(first));
  await expect(projector.locator("body")).toHaveAttribute("data-background", /^\/media\//);
  await station.locator("header").first().hover();
  // Gli avvisi a comparsa («messo in scaletta») non devono restare nella foto.
  const notices = station.getByRole("button", { name: "Chiudi l’avviso" });
  while ((await notices.count()) > 0) await notices.first().click();
  await station.waitForTimeout(600);
  await shot(station, "regia");
  await projector.screenshot({ path: path.join(demo.dir, "uscita-sala.png") });
  await stage.screenshot({ path: path.join(demo.dir, "uscita-palco.png") });

  // Disposizione Band: le sezioni della canzone come grossi pulsanti.
  await station.getByRole("button", { name: "Band", exact: true }).click();
  await station.waitForTimeout(400);
  await shot(station, "band");
  await station.getByRole("button", { name: "Presenta", exact: true }).click();

  // Moduli e risorse.
  await station.getByRole("button", { name: "Aggiungi plugin" }).click();
  const modules = station.getByRole("dialog", { name: "Plugin" });
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
    await phone.page.getByLabel("Nome di questa postazione").fill(demo.phone);
    await phone.page.getByRole("button", { name: "Abbina" }).click();
    await expect(phone.page.getByRole("region", { name: "Programma" })).toContainText(first);
    await shot(phone.page, "telecomando", phone.page);
  } finally {
    await phone.close();
  }
}

test("schermate per il sito", async ({ running }) => {
  test.skip(songsPackage === undefined, "pacchetto plugin-songs non costruito");
  test.setTimeout(300_000);
  await shoot(running, ITALIAN);
});

test("schermate per il sito, in inglese", async () => {
  test.skip(songsPackage === undefined, "pacchetto plugin-songs non costruito");
  test.skip(!hasEnglish, "lingua inglese non affiancata (plugin-locale-en)");
  test.setTimeout(400_000);
  // Avvio in inglese: i nomi che Cuelith crea da solo (show, look) nascono in inglese.
  const running = await launchApp({ env: { CUELITH_LANG: "en", CUELITH_LANGS: "it,en" } });
  try {
    await expect(running.station.locator("html")).toHaveAttribute("lang", "en");
    await shoot(running, ENGLISH);
  } finally {
    await running.close();
  }
});
