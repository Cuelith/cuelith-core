import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { chooseFiles, screenshotsDir, test } from "./app.js";

/**
 * Molti plugin con un pannello laterale: le schede della colonna di sinistra
 * non devono uscire dai margini. La riga resta una sola, alta uguale, e scorre;
 * un pulsante apre l'elenco completo e la scheda scelta si porta in vista.
 * I plugin sono copie del modello (repo affiancato plugin-template) con id diversi.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, "../../../plugin-template");
const built = existsSync(path.join(templateDir, "dist", "main.mjs"));
const COUNT = 7;

function copyOfTemplate(index: number): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), `cuelith-tabs-${String(index)}-`));
  for (const name of ["cuelith-plugin.json", "icon.svg", "locales", "dist"]) {
    cpSync(path.join(templateDir, name), path.join(dir, name), { recursive: true });
  }
  const id = `acme.tab${String(index)}`;
  for (const file of ["cuelith-plugin.json", "locales/it.json"]) {
    const full = path.join(dir, file);
    writeFileSync(
      full,
      readFileSync(full, "utf8")
        .replaceAll("cuelith.hello", id)
        .replace(/"name": "Ciao"/, `"name": "Plugin ${String(index)}"`)
        .replace(`"${id}.panel": "Ciao"`, `"${id}.panel": "Plugin ${String(index)}"`),
    );
  }
  return dir;
}

test("molte schede: una sola riga che scorre, con elenco completo", async ({ running }) => {
  test.skip(!built, "plugin-template non costruito (pnpm build nel repo affiancato)");
  test.setTimeout(240_000);
  const { app, station } = running;
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1100, 460);
  });

  const strip = station
    .getByRole("tablist")
    .filter({ has: station.getByRole("tab", { name: "Scaletta" }) });
  const before = await strip.boundingBox();
  expect(before).not.toBeNull();

  for (let i = 1; i <= COUNT; i++) {
    await chooseFiles(app, copyOfTemplate(i));
    await station.getByRole("button", { name: "Aggiungi plugin" }).click();
    const modules = station.getByRole("dialog", { name: "Plugin" });
    await modules.getByRole("tab", { name: "Installati" }).click();
    await modules.getByRole("button", { name: "Installa da cartella…" }).click();
    await expect(
      modules
        .getByRole("list", { name: "Installati" })
        .getByRole("listitem")
        .filter({ hasText: `Plugin ${String(i)}` }),
    ).toContainText("Attivo", { timeout: 30_000 });
    await modules.getByRole("button", { name: "Chiudi" }).click();
  }

  // Una riga sola, alta come prima, che non esce dalla colonna.
  const after = await strip.boundingBox();
  expect(after?.height).toBeCloseTo(before?.height ?? 0, 0);
  const overflow = await strip.evaluate((el) => ({
    scrollable: el.scrollWidth > el.clientWidth,
    parent: el.parentElement?.getBoundingClientRect().right ?? 0,
    right: el.getBoundingClientRect().right,
  }));
  expect(overflow.scrollable).toBe(true);
  expect(overflow.right).toBeLessThanOrEqual(overflow.parent + 1);
  await expect(station.getByRole("button", { name: "Schede successive" })).toBeEnabled();
  await expect(station.getByRole("button", { name: "Schede precedenti" })).toBeDisabled();
  await station.screenshot({ path: path.join(screenshotsDir, "tabs-many.png") });

  // L'elenco completo porta all'ultima scheda e la mostra interamente.
  await station.getByRole("button", { name: "Tutte le schede" }).click();
  await station.getByRole("menuitem", { name: `Plugin ${String(COUNT)}` }).click();
  const last = station.getByRole("tab", { name: `Plugin ${String(COUNT)}` });
  await expect(last).toHaveAttribute("aria-selected", "true");
  await expect(async () => {
    const box = await last.boundingBox();
    const bar = await strip.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? 0).toBeGreaterThanOrEqual((bar?.x ?? 0) - 1);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (bar?.x ?? 0) + (bar?.width ?? 0) + 1,
    );
  }).toPass({ timeout: 5000 });
  await expect(station.getByRole("button", { name: "Schede precedenti" })).toBeEnabled();
  await station.screenshot({ path: path.join(screenshotsDir, "tabs-last.png") });

  // La rotellina muove la riga di lato.
  const left = await strip.evaluate((el) => el.scrollLeft);
  await strip.hover();
  await station.mouse.wheel(0, -300);
  await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeLessThan(left);

  // Con molti plugin le icone della colonna a sinistra scorrono e il "+" resta raggiungibile:
  // si aggiungono altre icone finte (copie della prima) per riempire la colonna.
  await station.evaluate(() => {
    const nav = document.querySelector("nav[aria-label='Plugin']");
    const first = nav?.querySelector("button");
    for (let i = 0; i < 14; i++) first?.before(first.cloneNode(true));
  });
  const add = await station.getByRole("button", { name: "Aggiungi plugin" }).boundingBox();
  const viewHeight = await station.evaluate(() => window.innerHeight);
  expect((add?.y ?? 0) + (add?.height ?? 0)).toBeLessThanOrEqual(viewHeight + 1);

  // L'altezza della riga non e' mai cambiata, nemmeno con tutti i plugin.
  expect((await strip.boundingBox())?.height).toBeCloseTo(before?.height ?? 0, 0);
});
