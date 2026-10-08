import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { chooseFiles, screenshotsDir, test } from "./app.js";

/**
 * Impostazioni dei plugin (decisione 0017, protocollo 1.18): il plugin le dichiara nel manifest
 * e il nucleo disegna una finestra uguale per tutti, le salva, le controlla e le ricorda.
 */
const ID = "cuelith.settingsdemo";

function demoPackage(): string {
  const key = (name: string) => `${ID}.${name}`;
  const manifest = {
    id: ID,
    name: "Prove impostazioni",
    description: "Plugin di prova con impostazioni di ogni tipo.",
    version: "1.0.0",
    publisher: "Cuelith",
    license: "Apache-2.0",
    repository: "https://github.com/Cuelith/plugin-settings-demo",
    family: "function",
    engines: { cuelith: ">=0.1.0 <1.0.0", protocol: "^1.18.0" },
    runtime: { type: "none" },
    permissions: [],
    dependencies: {},
    extends: [],
    provides: [],
    contributes: {
      locales: [{ lang: "it", file: "locales/it.json" }],
      settings: [
        {
          key: "greeting",
          title: key("s.greeting"),
          description: key("s.greeting.d"),
          type: "string",
          default: "Ciao",
        },
        { key: "size", title: key("s.size"), type: "number", default: 40, min: 10, max: 100 },
        { key: "on", title: key("s.on"), type: "boolean", default: true },
        {
          key: "mode",
          title: key("s.mode"),
          type: "string",
          default: "a",
          choices: [
            { value: "a", title: key("s.mode.a") },
            { value: "b", title: key("s.mode.b") },
          ],
        },
      ],
    },
  };
  const catalog = {
    [key("s.greeting")]: "Saluto",
    [key("s.greeting.d")]: "La frase che il plugin dice all'avvio.",
    [key("s.size")]: "Dimensione",
    [key("s.on")]: "Attivo",
    [key("s.mode")]: "Modo",
    [key("s.mode.a")]: "Morbido",
    [key("s.mode.b")]: "Deciso",
  };
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "cuelith-demo-")), `${ID}.cpkg`);
  writeFileSync(
    file,
    zipSync({
      "cuelith-plugin.json": strToU8(JSON.stringify(manifest)),
      "locales/it.json": strToU8(JSON.stringify(catalog)),
    }),
  );
  return file;
}

const dialog = (station: Page) =>
  station.getByRole("dialog", { name: "Impostazioni di Prove impostazioni" });

test("impostazioni dei plugin: finestra uguale per tutti, salvata da sola e ricordata", async ({
  running,
}) => {
  const { app, station } = running;
  await chooseFiles(app, demoPackage());
  await station.getByRole("button", { name: "Aggiungi plugin" }).click();
  const window = station.getByRole("dialog", { name: "Plugin" });
  await window.getByRole("tab", { name: "Installati" }).click();
  await window.getByRole("button", { name: "Installa da file…" }).click();
  const installed = window.getByRole("list", { name: "Installati" });
  const row = installed.getByRole("listitem").filter({ hasText: "Prove impostazioni" });
  await expect(row).toBeVisible();

  // Dalla finestra Plugin: il pulsante c'e' solo per chi ha impostazioni (l'italiano no).
  await expect(
    installed
      .getByRole("listitem")
      .filter({ hasText: "Italiano" })
      .getByRole("button", { name: "Impostazioni" }),
  ).toHaveCount(0);
  await row.getByRole("button", { name: "Impostazioni" }).click();
  const form = dialog(station);
  await expect(form).toBeVisible();

  // Valori predefiniti, testi nella lingua, descrizione sotto il campo.
  await expect(form.getByLabel("Saluto")).toHaveValue("Ciao");
  await expect(form.getByText("La frase che il plugin dice all'avvio.")).toBeVisible();
  await expect(form.getByLabel("Dimensione")).toHaveValue("40");
  await expect(form.getByRole("switch", { name: "Attivo" })).toBeChecked();
  await expect(form.getByLabel("Modo")).toHaveValue("a");
  await expect(form.getByRole("option", { name: "Deciso" })).toHaveCount(1);
  await expect(form.getByRole("button", { name: "Ripristina" })).toHaveCount(0);

  // Ogni modifica si salva da sola.
  await form.getByLabel("Saluto").fill("Salve a tutti");
  await expect(form.getByRole("status").filter({ hasText: "Salvato" })).toBeVisible();
  await form.getByLabel("Dimensione").fill("70");
  await form.getByRole("switch", { name: "Attivo" }).uncheck();
  await form.getByLabel("Modo").selectOption({ label: "Deciso" });
  await expect(form.getByRole("button", { name: "Ripristina" })).toHaveCount(4);

  // Un valore fuori dai limiti non si salva e lo dice; quello buono resta.
  await form.getByLabel("Dimensione").fill("500");
  await expect(form.getByRole("alert")).toContainText("Non è stato possibile salvare");
  await station.screenshot({ path: path.join(screenshotsDir, "impostazioni-plugin.png") });
  await form.getByRole("button", { name: "Chiudi" }).click();
  await expect(form).toBeHidden();
  await window.getByRole("button", { name: "Chiudi" }).click();

  // Riaperta dalla ricerca: i valori sono quelli scelti (e 500 non e' passato).
  await station.keyboard.press("Control+k");
  await station.keyboard.type("impostazioni prove");
  await expect(
    station.getByRole("dialog", { name: "Cerca e vai" }).getByRole("option").first(),
  ).toContainText("Impostazioni di Prove impostazioni");
  await station.keyboard.press("Enter");
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Saluto")).toHaveValue("Salve a tutti");
  await expect(form.getByLabel("Dimensione")).toHaveValue("70");
  await expect(form.getByRole("switch", { name: "Attivo" })).not.toBeChecked();
  await expect(form.getByLabel("Modo")).toHaveValue("b");

  // Ripristina: torna il valore predefinito e il pulsante sparisce.
  await form.getByRole("button", { name: "Ripristina" }).first().click();
  await expect(form.getByLabel("Saluto")).toHaveValue("Ciao");
  await expect(form.getByRole("button", { name: "Ripristina" })).toHaveCount(3);
});
