import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { chooseFiles, createText, screenshotsDir, test } from "./app.js";

/**
 * «Cerca e vai» (Ctrl+K) e i preferiti della colonna delle icone (decisione 0017):
 * comandi, impostazioni ed elementi della scaletta si raggiungono scrivendo; gli strumenti dei
 * plugin si cercano, si fissano nella colonna con la stella e restano raggiungibili anche se tolti.
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

const palette = (station: Page) => station.getByRole("dialog", { name: "Cerca e vai" });

async function open(station: Page): Promise<void> {
  await station.keyboard.press("Control+k");
  await expect(palette(station)).toBeVisible();
  await expect(palette(station).getByRole("combobox")).toBeFocused();
}

test("cerca e vai: comandi, impostazioni e scaletta, solo con la tastiera", async ({ running }) => {
  const { station } = running;
  await createText(station, "Salmo", ["Il Signore e' il mio pastore", "non manco di nulla"]);

  // Ctrl+K apre, Esc chiude, Ctrl+K di nuovo la riapre e la richiude.
  await open(station);
  await station.keyboard.press("Escape");
  await expect(palette(station)).toBeHidden();
  await open(station);
  await station.keyboard.press("Control+k");
  await expect(palette(station)).toBeHidden();

  // Un comando: «Solo sfondo» si accende, e si spegne con la stessa strada.
  const bare = station.getByRole("button", { name: "Solo sfondo" });
  await open(station);
  await station.keyboard.type("solo sf");
  await expect(palette(station).getByRole("option").first()).toContainText("Solo sfondo");
  await station.keyboard.press("Enter");
  await expect(palette(station)).toBeHidden();
  await expect(bare).toHaveAttribute("aria-pressed", "true");
  await open(station);
  await station.keyboard.type("solo sf");
  await expect(palette(station).getByRole("option").first()).toContainText("✓");
  await station.keyboard.press("Enter");
  await expect(bare).toHaveAttribute("aria-pressed", "false");

  // Un elemento della scaletta (senza accenti o maiuscole) va in anteprima, mai in onda.
  await open(station);
  await station.keyboard.type("SALM");
  await expect(palette(station).getByRole("option").first()).toContainText("Salmo");
  await station.keyboard.press("Enter");
  await expect(station.locator('[data-screen="cue"]')).toContainText(
    "Il Signore e' il mio pastore",
  );

  // Le impostazioni.
  await open(station);
  await station.keyboard.type("impostaz");
  await station.keyboard.press("Enter");
  await expect(station.getByRole("dialog", { name: "Impostazioni" })).toBeVisible();
  await station.keyboard.press("Escape");
  await expect(station.getByRole("dialog", { name: "Impostazioni" })).toBeHidden();

  // Frecce: la voce scelta cambia e Invio esegue proprio quella.
  await open(station);
  await station.keyboard.type("a");
  const options = palette(station).getByRole("option");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await station.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await station.keyboard.press("ArrowUp");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await station.keyboard.press("Escape");

  // Nessun risultato: lo dice.
  await open(station);
  await station.keyboard.type("zzzzqq");
  await expect(palette(station)).toContainText("Nessun risultato per «zzzzqq»");
});

test("cerca e vai: gli strumenti dei plugin si fissano nella colonna e si trovano sempre", async ({
  running,
}) => {
  test.skip(songsPackage === undefined, "serve il pacchetto Brani (pnpm build in plugin-songs)");
  const { app, station } = running;
  const guide = station.getByRole("dialog", { name: "Primi passi con «Brani»" });
  await station.getByRole("button", { name: "Aggiungi plugin" }).click();
  const window = station.getByRole("dialog", { name: "Plugin" });
  await window.getByRole("tab", { name: "Installati" }).click();
  await chooseFiles(app, songsPackage ?? "");
  await window.getByRole("button", { name: "Installa da file…" }).click();
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Avanti" }).click();
  await guide.getByRole("button", { name: "Avanti" }).click();
  await guide.getByRole("button", { name: "Ho capito" }).click();
  await window.getByRole("button", { name: "Chiudi" }).click();

  const dock = station.getByRole("navigation", { name: "Plugin" });
  const icon = dock.getByRole("button", { name: "Brani", exact: true });
  await expect(icon).toBeVisible();

  // «Tutti i plugin» apre l'elenco dei plugin; la stella toglie Brani dalla colonna.
  await dock.getByRole("button", { name: "Tutti i plugin" }).click();
  await expect(
    palette(station).getByRole("button", { name: "Plugin", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await station.screenshot({ path: path.join(screenshotsDir, "cerca-e-vai.png") });
  const star = palette(station).getByRole("button", {
    name: "Tieni Brani nella colonna delle icone",
  });
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await station.keyboard.press("Escape");
  await expect(icon).toHaveCount(0);

  // Tolto dalla colonna, si trova e si apre scrivendo.
  await open(station);
  await station.keyboard.type("bran");
  await expect(palette(station).getByRole("option").first()).toContainText("Brani");
  await station.keyboard.press("Enter");
  await expect(
    station.frameLocator('[data-module-panel="cuelith.songs.songs"]').getByRole("button", {
      name: "+ Nuovo brano",
    }),
    // Il pannello e' un riquadro isolato: sotto carico puo' metterci piu' del solito a caricarsi.
  ).toBeVisible({ timeout: 30_000 });

  // La scheda aperta dalla ricerca si puo' chiudere; Ctrl+Tab torna a quella usata prima.
  const brani = station.getByRole("tab", { name: "Brani", exact: true });
  const scaletta = station.getByRole("tab", { name: "Scaletta", exact: true });
  await expect(brani).toHaveAttribute("aria-selected", "true");
  await station.keyboard.press("Control+Tab");
  await expect(scaletta).toHaveAttribute("aria-selected", "true");
  await station.keyboard.press("Control+Tab");
  await expect(brani).toHaveAttribute("aria-selected", "true");
  await station.getByRole("button", { name: "Chiudi la scheda Brani" }).click();
  await expect(brani).toHaveCount(0);
  await expect(scaletta).toHaveAttribute("aria-selected", "true");

  // E con la stella torna nella colonna (la scelta resta anche dopo aver chiuso la finestra).
  await dock.getByRole("button", { name: "Tutti i plugin" }).click();
  await palette(station)
    .getByRole("button", { name: "Tieni Brani nella colonna delle icone" })
    .click();
  await station.keyboard.press("Escape");
  await expect(icon).toBeVisible();
});
