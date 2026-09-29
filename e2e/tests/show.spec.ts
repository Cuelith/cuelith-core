import path from "node:path";
import { expect } from "@playwright/test";
import { screenshotsDir, test } from "./app.js";

const SONG = [
  "Luce del mattino, vieni su di noi\nriempi questo luogo",
  "Luce del mattino, resta con noi\nfino a sera",
  "Amen",
];

// Criterio del cap. 28: si crea un elemento di testo con piu' slide, lo si
// mette in scaletta, lo si manda in anteprima e in programma, con dissolvenza.
test("testo con piu' slide: scaletta, anteprima, programma con dissolvenza", async ({
  running,
}) => {
  const { station, problems } = running;
  const program = station.locator('[data-screen="live"]');
  const preview = station.locator('[data-screen="cue"]');
  const tiles = station.getByRole("list", { name: "Slide" }).getByRole("button");

  // 1. Nuovo testo dalla scaletta.
  await station.getByRole("button", { name: "+ Testo" }).click();
  const editor = station.getByRole("dialog", { name: "Nuovo testo" });
  await editor.getByLabel("Titolo").fill("Luce del mattino");
  await editor.getByLabel("Testo").fill(SONG.join("\n\n"));
  await expect(editor.getByTestId("slide-count")).toHaveText("3 slide");
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(editor).toBeHidden();

  // 2. E' in scaletta, scelto, con tre slide; la prima e' in anteprima.
  const entry = station.getByRole("list", { name: "Voci della scaletta" }).getByRole("listitem");
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("Luce del mattino");
  await expect(entry).toHaveAttribute("data-state", "preview");
  await expect(tiles).toHaveCount(3);
  await expect(tiles.nth(0)).toHaveAttribute("data-state", "preview");
  await expect(preview).toContainText("riempi questo luogo");
  await expect(program).toContainText("Niente in onda");

  // 3. Invio: in programma con la dissolvenza del look Sala (300 ms).
  await station.evaluate(() => {
    const seen: { name: string; duration: string }[] = [];
    (window as unknown as { animations: typeof seen }).animations = seen;
    document.addEventListener("animationstart", (event) => {
      const target = event.target as HTMLElement;
      seen.push({
        name: event.animationName,
        duration: getComputedStyle(target).animationDuration,
      });
    });
  });
  await station.keyboard.press("Enter");
  await expect(program).toContainText("riempi questo luogo");
  await expect(tiles.nth(0)).toHaveAttribute("data-state", "live");
  await expect(tiles.nth(1)).toHaveAttribute("data-state", "preview");
  await expect(preview).toContainText("fino a sera");
  await expect(program.locator("[data-transition-ms]")).toHaveAttribute(
    "data-transition-ms",
    "300",
  );
  // Gli eventi arrivano al fotogramma successivo: si attende che compaiano.
  const animations = () =>
    station.evaluate(
      () => (window as unknown as { animations: { name: string; duration: string }[] }).animations,
    );
  await expect.poll(animations).toContainEqual({ name: "cl-fade-in", duration: "0.3s" });
  await expect.poll(animations).toContainEqual({ name: "cl-fade-out", duration: "0.3s" });
  await expect(program.locator(".cl-fade-out")).toHaveCount(0);

  // 4. Avanti: seconda slide in onda, terza in anteprima.
  await station.keyboard.press("ArrowRight");
  await expect(program).toContainText("fino a sera");
  await expect(tiles.nth(1)).toHaveAttribute("data-state", "live");
  await expect(tiles.nth(2)).toHaveAttribute("data-state", "preview");
  await expect(station.getByText("Luce del mattino · 2 di 3")).toBeVisible();
  await expect(program.locator(".cl-fade-out")).toHaveCount(0);
  await station.screenshot({ path: path.join(screenshotsDir, "presenta-in-onda.png") });

  // 5. Indietro, poi Esc pulisce il programma senza perdere la posizione.
  await station.keyboard.press("ArrowLeft");
  await expect(program).toContainText("riempi questo luogo");
  await station.keyboard.press("Escape");
  await expect(program).toContainText("Niente in onda");
  await station.keyboard.press("Space");
  await expect(program).toContainText("fino a sera");

  // 6. Doppio clic su una miniatura: subito in onda.
  await tiles.nth(2).dblclick();
  await expect(program).toContainText("Amen");

  expect(problems).toEqual([]);
});

test("modificare il testo aggiorna slide, anteprima e programma", async ({ running }) => {
  const { station, problems } = running;
  const program = station.locator('[data-screen="live"]');
  const tiles = station.getByRole("list", { name: "Slide" }).getByRole("button");

  await station.getByRole("button", { name: "+ Testo" }).click();
  let editor = station.getByRole("dialog", { name: "Nuovo testo" });
  await editor.getByLabel("Titolo").fill("Avvisi");
  await editor.getByLabel("Testo").fill("Primo avviso\n\nSecondo avviso");
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(editor).toBeHidden();
  await station.keyboard.press("Enter");
  await expect(program).toContainText("Primo avviso");

  await station
    .getByRole("region", { name: "Slide" })
    .getByRole("button", { name: "Modifica" })
    .click();
  editor = station.getByRole("dialog", { name: "Modifica testo" });
  await expect(editor.getByLabel("Testo")).toHaveValue("Primo avviso\n\nSecondo avviso");
  await editor.getByLabel("Testo").fill("Primo avviso corretto\n\nSecondo avviso\n\nTerzo avviso");
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(editor).toBeHidden();

  await expect(tiles).toHaveCount(3);
  await expect(program).toContainText("Primo avviso corretto");
  expect(problems).toEqual([]);
});

test("la scaletta si riordina e rimuovere cio' che e' in onda non e' possibile", async ({
  running,
}) => {
  const { station, problems } = running;
  const create = async (title: string) => {
    await station.getByRole("button", { name: "+ Testo" }).click();
    const editor = station.getByRole("dialog", { name: "Nuovo testo" });
    await editor.getByLabel("Titolo").fill(title);
    await editor.getByLabel("Testo").fill(`${title} uno`);
    await editor.getByRole("button", { name: "Salva" }).click();
    await expect(editor).toBeHidden();
  };
  await create("Primo");
  await create("Secondo");
  const entries = station.getByRole("list", { name: "Voci della scaletta" }).getByRole("listitem");
  await expect(entries).toHaveText([/Primo/, /Secondo/]);

  await entries.nth(1).dragTo(entries.nth(0), { targetPosition: { x: 20, y: 4 } });
  await expect(entries).toHaveText([/Secondo/, /Primo/]);

  // "Secondo" e' in anteprima: Invio lo manda in onda, e non si puo' rimuovere.
  await station.keyboard.press("Enter");
  const live = entries.filter({ hasText: "Secondo" });
  await expect(live).toHaveAttribute("data-state", "live");
  await live.hover();
  await expect(live.getByRole("button", { name: "Rimuovi" })).toBeDisabled();

  await entries.filter({ hasText: "Primo" }).hover();
  await entries.filter({ hasText: "Primo" }).getByRole("button", { name: "Rimuovi" }).click();
  await expect(entries).toHaveCount(1);
  expect(problems).toEqual([]);
});
