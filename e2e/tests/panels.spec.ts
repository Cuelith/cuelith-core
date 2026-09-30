import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type FrameLocator, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { chooseFiles, screenshotsDir, test } from "./app.js";

/**
 * Pannello di prova scritto a mano col protocollo del ponte (come farebbe
 * @cuelith/panel). Prova anche cio' che NON deve riuscire: leggere la
 * postazione, andare in rete, usare comandi riservati.
 */
const PANEL_JS = `
const out = document.getElementById("out");
const show = (key, value) => {
  let p = out.querySelector('[data-k="' + key + '"]');
  if (!p) { p = document.createElement("p"); p.dataset.k = key; out.append(p); }
  p.textContent = key + ": " + value;
};
let isolated = "no";
try { void window.parent.document.title; } catch { isolated = "si"; }
show("isolato", isolated);
fetch("https://example.com").then(() => show("rete", "aperta"), () => show("rete", "bloccata"));
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "cuelith:connect" || !event.ports[0]) return;
  const port = event.ports[0];
  const pending = new Map();
  let next = 1;
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    port.postMessage({ type: "call", id, method, params });
  });
  port.onmessage = (message) => {
    const data = message.data;
    if (data.type === "init") {
      show("pannello", data.panelId);
      show("saluto", data.catalog["cuelith.greetings.hello"]);
      show("show", data.state.show.name);
      show("testi del nucleo", Object.keys(data.catalog).some((k) => k.startsWith("core.")) ? "visibili" : "nascosti");
      document.getElementById("create").onclick = async () => {
        const { id } = await call("item.create", { type: "core.text", title: "Dal modulo", slides: [{ fields: { text: { kind: "text", value: "Ciao dal modulo" } } }] });
        await call("playlist.add", { itemId: id });
        show("creato", "si");
      };
      document.getElementById("forbidden").onclick = () =>
        call("output.delete", { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }).then(
          () => show("uscita", "eliminata"),
          (error) => show("uscita", error.code + " " + error.message),
        );
      document.getElementById("notify").onclick = () => call("host.notify", { key: "cuelith.greetings.hello", params: {} });
      document.getElementById("close").onclick = () => call("host.close", {});
    } else if (data.type === "state") {
      show("show", data.state.show.name);
    } else if (data.type === "result" || data.type === "error") {
      const waiting = pending.get(data.id);
      pending.delete(data.id);
      if (!waiting) return;
      if (data.type === "result") waiting.resolve(data.result); else waiting.reject(data.error);
    }
  };
});
`;

const PANEL_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="/ui/cuelith-ui.css"></head>
<body class="cl-root" style="padding:12px">
<div id="out"></div>
<button id="create">Crea testo</button>
<button id="forbidden">Elimina uscita</button>
<button id="notify">Avviso</button>
<button id="close">Chiudi pannello</button>
<script type="module" src="panel.js"></script>
</body></html>`;

function panelsPackage(): string {
  const manifest = {
    id: "cuelith.greetings",
    name: "Saluti",
    description: "Modulo di prova con due pannelli.",
    version: "1.0.0",
    publisher: "Cuelith",
    license: "Apache-2.0",
    repository: "https://github.com/Cuelith/plugin-greetings",
    family: "function",
    engines: { cuelith: "^0.1.0", protocol: "^1.4.0" },
    runtime: { type: "none" },
    ui: { entry: "ui/index.html" },
    permissions: [],
    dependencies: {},
    extends: [],
    provides: [],
    contributes: {
      panels: [
        { id: "list", title: "cuelith.greetings.panel.list", placement: "side" },
        { id: "editor", title: "cuelith.greetings.panel.editor", placement: "center" },
      ],
      locales: [{ lang: "it", file: "locales/it.json" }],
    },
  };
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "cuelith-panels-")), "saluti.cpkg");
  writeFileSync(
    file,
    zipSync({
      "cuelith-plugin.json": strToU8(JSON.stringify(manifest)),
      "locales/it.json": strToU8(
        JSON.stringify({
          "cuelith.greetings.hello": "Ciao dal modulo Saluti",
          "cuelith.greetings.panel.list": "Saluti",
          "cuelith.greetings.panel.editor": "Editor saluti",
        }),
      ),
      "ui/index.html": strToU8(PANEL_HTML),
      "ui/panel.js": strToU8(PANEL_JS),
    }),
  );
  return file;
}

async function installFromFile(
  station: Page,
  app: Parameters<typeof chooseFiles>[0],
): Promise<void> {
  await chooseFiles(app, panelsPackage());
  await station.getByRole("button", { name: "Aggiungi moduli" }).click();
  const window = station.getByRole("dialog", { name: "Moduli" });
  await window.getByRole("tab", { name: "Installati" }).click();
  await window.getByRole("button", { name: "Installa da file…" }).click();
  await expect(window.getByRole("list", { name: "Installati" })).toContainText("Saluti");
  await window.getByRole("button", { name: "Chiudi" }).click();
  await expect(window).toBeHidden();
}

const line = (frame: FrameLocator, key: string) => frame.locator(`[data-k="${key}"]`);

test("pannelli dei moduli: scheda laterale e pannello centrale isolati, con i soli comandi consentiti", async ({
  running,
}) => {
  const { app, station, problems } = running;
  await installFromFile(station, app);

  // Il dock mostra i pannelli del modulo; quello laterale e' una scheda della colonna sinistra.
  const dock = station.getByRole("navigation", { name: "Moduli" });
  await expect(dock.getByRole("button", { name: "Saluti", exact: true })).toBeVisible();
  await dock.getByRole("button", { name: "Saluti", exact: true }).click();
  await expect(station.getByRole("tab", { name: "Saluti", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const side = station.frameLocator('[data-module-panel="cuelith.greetings.list"]');
  await expect(line(side, "pannello")).toHaveText("pannello: list");
  await expect(line(side, "saluto")).toHaveText("saluto: Ciao dal modulo Saluti");
  await expect(line(side, "show")).toHaveText("show: Nuovo show");

  // Isolato: niente accesso alla postazione, niente rete, niente testi degli altri.
  await expect(line(side, "isolato")).toHaveText("isolato: si");
  await expect(line(side, "rete")).toHaveText("rete: bloccata");
  await expect(line(side, "testi del nucleo")).toHaveText("testi del nucleo: nascosti");

  // Comandi: creare un testo si' (ruolo dei moduli), eliminare un'uscita no.
  await side.getByRole("button", { name: "Crea testo" }).click();
  await expect(line(side, "creato")).toHaveText("creato: si");
  await side.getByRole("button", { name: "Elimina uscita" }).click();
  await expect(line(side, "uscita")).toHaveText("uscita: 4030 core.error.forbidden");
  await side.getByRole("button", { name: "Avviso" }).click();
  await expect(station.getByText("Ciao dal modulo Saluti")).toBeVisible();

  // Lo stato arriva man mano: rinominando lo show il pannello lo vede.
  await station.getByRole("button", { name: /Nuovo show/ }).click();
  await station.getByRole("menuitem", { name: "Rinomina…" }).click();
  const rename = station.getByRole("dialog", { name: "Rinomina lo show" });
  await rename.getByLabel("Nome").fill("Culto");
  await rename.getByRole("button", { name: "Salva" }).click();
  await expect(line(side, "show")).toHaveText("show: Culto");
  await station.screenshot({ path: path.join(screenshotsDir, "pannello-modulo-laterale.png") });

  // Pannello centrale: prende il posto delle Slide, il programma resta visibile.
  await dock.getByRole("button", { name: "Editor saluti" }).click();
  const center = station.frameLocator('[data-module-panel="cuelith.greetings.editor"]');
  await expect(line(center, "pannello")).toHaveText("pannello: editor");
  await expect(station.locator('[data-screen="live"]')).toBeVisible();
  await expect(station.getByRole("region", { name: "Slide" })).toHaveCount(0);
  await station.screenshot({ path: path.join(screenshotsDir, "pannello-modulo-centrale.png") });
  await center.getByRole("button", { name: "Chiudi pannello" }).click();
  await expect(station.getByRole("region", { name: "Slide" })).toBeVisible();
  expect(problems.filter((p) => !p.includes("example.com"))).toEqual([]);
});
