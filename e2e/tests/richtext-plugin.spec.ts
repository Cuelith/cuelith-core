import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { chooseFiles, screenshotsDir, shownPanelWindow, test } from "./app.js";

/**
 * Formattazione come plugin annesso (decisione 0022, protocollo 1.22): l'editor di un plugin
 * (qui un plugin di prova con una casella di testo in una finestra propria) descrive il testo e
 * la selezione; il plugin Formattazione vero (repo affiancato plugin-richtext, costruito con
 * `pnpm build`) legge lo stato e chiede le modifiche; le parole formattate tornano all'editor.
 * Senza il pacchetto la prova si salta.
 */
const distDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../plugin-richtext/dist",
);
const richtextPackage = existsSync(distDir)
  ? readdirSync(distDir)
      .filter((name) => /^cuelith\.richtext-.+\.cpkg$/.test(name))
      .map((name) => path.join(distDir, name))
      .at(-1)
  : undefined;

const songsDistDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../plugin-songs/dist",
);
const songsPackage = existsSync(songsDistDir)
  ? readdirSync(songsDistDir)
      .filter((name) => /^cuelith\.songs-.+\.cpkg$/.test(name))
      .map((name) => path.join(songsDistDir, name))
      .at(-1)
  : undefined;

const HOST = "acme.editor";

/** Il pannello dell'editor di prova: parla col motore con i messaggi del ponte, senza librerie. */
const HOST_SCRIPT = `
const which = new URLSearchParams(location.search).get("panel");
let port;
let pluginId = "";
let nextId = 1;
let applied = 0;
let spans = [];
const call = (method, params) => port.postMessage({ type: "call", id: nextId++, method, params });
const out = document.getElementById("out");
const area = document.getElementById("area");
const show = () => { out.dataset.spans = JSON.stringify(spans); };
const mine = (state) => {
  const s = state.live.richText;
  return s && s.owner === pluginId && s.field === "f1" ? s : undefined;
};
const report = () => call("richtext.session", {
  owner: pluginId, field: "f1", text: area.value,
  ...(spans.length > 0 ? { spans } : {}),
  selection: { start: area.selectionStart, end: area.selectionEnd },
  font: "lora",
});
window.addEventListener("message", (event) => {
  if (event.data?.type !== "cuelith:connect" || !event.ports[0]) return;
  port = event.ports[0];
  port.onmessage = (message) => {
    const data = message.data;
    if (data.type === "init") {
      pluginId = data.pluginId;
      applied = mine(data.state)?.applied ?? 0;
      document.getElementById(which === "write" ? "write" : "launch").hidden = false;
      show();
    } else if (data.type === "state") {
      const session = mine(data.state);
      if (session && session.applied !== applied) {
        applied = session.applied;
        spans = session.spans ?? [];
        show();
      }
    }
  };
});
for (const type of ["select", "keyup", "mouseup", "focus", "input"]) area.addEventListener(type, () => port && report());
document.getElementById("open").addEventListener("click", () => call("host.openPanel", { panel: "write" }));
window.parent.postMessage({ type: "cuelith:ready" }, "*");
`;

const HOST_PAGE = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>Editor</title></head>
<body>
<div id="launch" hidden><button id="open" type="button">Apri l'editor</button></div>
<div id="write" hidden><textarea id="area" rows="4" cols="40" aria-label="Testo"></textarea><p id="out"></p></div>
<script type="module" src="./host.js"></script>
</body></html>`;

function hostPackage(): string {
  const manifest = {
    id: HOST,
    name: "Editor di prova",
    description: "Plugin di prova con una casella di testo che accetta parole formattate.",
    version: "1.0.0",
    publisher: "Cuelith",
    license: "Apache-2.0",
    repository: "https://github.com/Cuelith/plugin-editor-prova",
    family: "function",
    engines: { cuelith: ">=0.1.0 <1.0.0", protocol: "^1.23.0" },
    runtime: { type: "none" },
    ui: { entry: "ui/index.html" },
    permissions: [],
    dependencies: {},
    extends: [],
    provides: [],
    contributes: {
      panels: [
        { id: "launcher", title: `${HOST}.launcher`, placement: "side" },
        { id: "write", title: `${HOST}.write`, placement: "center" },
      ],
      locales: [{ lang: "it", file: "locales/it.json" }],
    },
  };
  const catalog = { [`${HOST}.launcher`]: "Editor di prova", [`${HOST}.write`]: "Scrittura" };
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "cuelith-host-")), `${HOST}.cpkg`);
  writeFileSync(
    file,
    zipSync({
      "cuelith-plugin.json": strToU8(JSON.stringify(manifest)),
      "locales/it.json": strToU8(JSON.stringify(catalog)),
      "ui/index.html": strToU8(HOST_PAGE),
      "ui/host.js": strToU8(HOST_SCRIPT),
    }),
  );
  return file;
}

/** Le parole formattate che l'editor di prova ha adottato, lette dalla pagina. */
const adopted = (out: Locator) => async (): Promise<unknown> =>
  JSON.parse((await out.getAttribute("data-spans")) ?? "null");

async function install(station: Page, app: ElectronApplication, file: string): Promise<void> {
  await chooseFiles(app, file);
  await station.getByRole("button", { name: "Aggiungi plugin" }).click();
  const window = station.getByRole("dialog", { name: "Plugin" });
  await window.getByRole("tab", { name: "Installati" }).click();
  await window.getByRole("button", { name: "Installa da file…" }).click();
  await window.getByRole("button", { name: "Chiudi" }).click();
  await expect(window).toBeHidden();
}

test("formattazione come plugin annesso: dall'editor di un plugin alle parole formattate", async ({
  running,
}) => {
  test.skip(richtextPackage === undefined, "pacchetto plugin-richtext non costruito");
  test.setTimeout(180_000);
  const { app, station, problems } = running;
  await install(station, app, hostPackage());
  await install(station, app, richtextPackage ?? "");
  const dock = station.getByRole("navigation", { name: "Plugin" });

  // L'editor di prova si apre in una finestra propria (come l'editor dei brani).
  await dock.getByRole("button", { name: "Editor di prova", exact: true }).click();
  const launcher = station.frameLocator(`[data-module-panel="${HOST}.launcher"]`);
  await launcher.getByRole("button", { name: "Apri l'editor" }).click();
  const editorWindow = await shownPanelWindow(app, `${HOST}.write`);
  const editor = editorWindow.frameLocator(`[data-module-panel="${HOST}.write"]`);
  const area = editor.getByRole("textbox", { name: "Testo" });
  await area.fill("Il Signore e' il mio pastore");

  // La barra del plugin Formattazione sta in cima alla finestra dell'editor (non va cercata altrove):
  // appare quando l'editor ha un testo; senza selezione e' spenta.
  const format = editorWindow.frameLocator('[data-module-panel="cuelith.richtext.format"]');
  await expect(format.getByRole("button", { name: "Grassetto" })).toBeDisabled();
  await editorWindow.screenshot({ path: path.join(screenshotsDir, "formattazione-editor.png") });

  // Seleziono "Signore" nell'editor: il plugin Formattazione se ne accorge.
  await area.click();
  await editorWindow.keyboard.press("Control+Home");
  for (let i = 0; i < 3; i += 1) await editorWindow.keyboard.press("ArrowRight");
  for (let i = 0; i < 7; i += 1) await editorWindow.keyboard.press("Shift+ArrowRight");
  await expect(format.getByText("7 caratteri selezionati.")).toBeVisible();
  await expect(format.getByRole("button", { name: "Grassetto" })).toBeEnabled();

  // Grassetto: le parole formattate tornano all'editor (che le adotta); il testo non cambia.
  const out = editor.locator("#out");
  await format.getByRole("button", { name: "Grassetto" }).click();
  await expect.poll(adopted(out)).toEqual([{ start: 3, end: 10, bold: true }]);
  await expect(format.getByRole("button", { name: "Grassetto" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(area).toHaveValue("Il Signore e' il mio pastore");

  // Dimensione 150% sullo stesso tratto: si aggiunge alla formattazione che c'e'.
  await format.getByLabel("Dimensione").selectOption("1.5");
  await expect.poll(adopted(out)).toEqual([{ start: 3, end: 10, size: 1.5, bold: true }]);

  // Il Lora ha il corsivo vero.
  await expect(format.getByRole("button", { name: "Corsivo" })).toBeEnabled();

  // Togli formattazione: via tutto.
  await format.getByRole("button", { name: "Togli formattazione" }).click();
  await expect.poll(adopted(out)).toEqual([]);
  await editorWindow.screenshot({
    path: path.join(screenshotsDir, "formattazione-editor-uso.png"),
  });
  expect(problems).toEqual([]);
});

test("Brani con la formattazione: le parole formattate dal plugin annesso arrivano alla slide proiettata", async ({
  running,
}) => {
  test.skip(
    richtextPackage === undefined || songsPackage === undefined,
    "pacchetti plugin-richtext e plugin-songs non costruiti",
  );
  test.setTimeout(180_000);
  const { app, station, problems } = running;
  await install(station, app, songsPackage ?? "");
  await install(station, app, richtextPackage ?? "");
  const dock = station.getByRole("navigation", { name: "Plugin" });
  await dock.getByRole("button", { name: "Brani", exact: true }).click();
  const side = station.frameLocator('[data-module-panel="cuelith.songs.songs"]');
  await side.getByRole("button", { name: "+ Nuovo brano" }).click();
  const page = await shownPanelWindow(app, "cuelith.songs.editor");
  const editor = page.frameLocator('[data-module-panel="cuelith.songs.editor"]');
  await editor.getByLabel("Titolo").fill("Santo");
  await editor.getByRole("button", { name: "Autore sconosciuto" }).click();
  const text = editor.getByLabel("Testo della sezione V1");
  await text.fill(["[G]Santo, [D]santo", "[---]", "santo il Signore"].join("\n"));

  // Seleziono "santo" (dopo "Santo, ", e dopo gli accordi): "[G]Santo, [D]santo" -> da 13 a 18.
  const format = page.frameLocator('[data-module-panel="cuelith.richtext.format"]');
  await text.click();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 13; i += 1) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("Shift+ArrowRight");
  await expect(format.getByText("5 caratteri selezionati.")).toBeVisible();
  await format.getByLabel("Dimensione").selectOption("2");
  await format.getByRole("button", { name: "Grassetto" }).click();

  // L'anteprima dell'editor («Cosa vede il pubblico») mostra la parola grande, senza accordi.
  const preview = editor.getByRole("region", { name: "Cosa vede il pubblico" });
  await expect(preview.getByRole("listitem").first()).toHaveText("V1Santo, santo");
  await expect(preview.locator("span[style*='font-size: 200%']")).toHaveText("santo");
  await page.screenshot({ path: path.join(screenshotsDir, "brani-formattazione.png") });

  // Salva e metti in scaletta: sulla slide proiettata la parola resta grande e in grassetto.
  await editor.getByRole("button", { name: "Salva e metti in scaletta" }).click();
  await expect(page.getByText("«Santo» salvato e messo in scaletta.")).toBeVisible({
    timeout: 8000,
  });
  await station.getByRole("tab", { name: "Scaletta" }).click();
  await station.getByRole("button", { name: /Santo/ }).first().click();
  await station.screenshot({
    path: path.join(screenshotsDir, "brani-formattazione-postazione.png"),
  });
  const preview2 = station.getByRole("region", { name: "Anteprima" });
  await expect(preview2.locator("span[style*='font-size: 200%']")).toHaveText("santo");
  await expect(preview2.locator("span[style*='font-weight']")).toHaveText("santo");
  // In onda: il testo senza accordi e, sull'uscita, la parola grande.
  await station.keyboard.press("Enter");
  const program = station.getByRole("region", { name: "Programma" });
  await expect(program.locator("span[style*='font-size: 200%']")).toHaveText("santo");
  expect(problems).toEqual([]);
});
