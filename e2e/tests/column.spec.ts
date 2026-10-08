import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { addOutput, createText, outputWindow, screenshotsDir, test } from "./app.js";

/** Misure (altezza visibile e altezza del contenuto) di un riquadro della colonna di destra. */
const heights = (page: Page, name: string): Promise<{ client: number; scroll: number }> =>
  page.getByRole("region", { name }).evaluate((element) => ({
    client: element.clientHeight,
    scroll: element.scrollHeight,
  }));

// Colonna di destra di «Presenta» (decisione 0016): niente scorrimento verticale, anteprima
// grande, righe di sfondi e stili che scorrono solo di lato, «Solo sfondo» sulle uscite.
test("colonna di destra: senza scorrimento verticale; anteprima grande; solo sfondo", async ({
  running,
}) => {
  const { station } = running;
  await createText(station, "Salmo", ["Il Signore e' il mio pastore", "non manco di nulla"]);
  await addOutput(station, "Proiettore", "Sala");
  const projector = await outputWindow(running, "Proiettore");
  await station.keyboard.press("Enter");
  await expect(projector.locator("body")).toHaveAttribute(
    "data-text",
    "Il Signore e' il mio pastore",
  );

  await station.waitForTimeout(600);
  await station.screenshot({ path: path.join(screenshotsDir, "colonna-destra.png") });

  // Nessuna delle parti della colonna scorre in verticale.
  for (const name of ["Sfondi", "Stili del testo"]) {
    const { client, scroll } = await heights(station, name);
    expect(scroll, name).toBeLessThanOrEqual(client + 1);
  }
  for (const row of [
    station.getByRole("list", { name: "Immagini" }),
    station.getByRole("group", { name: "Stili del testo" }),
  ]) {
    const box = await row.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight + 1);
  }

  // L'anteprima e' piu' grande del programma, e nessuno dei due esce dalla colonna.
  const program = await station.locator('[data-screen="live"]').boundingBox();
  const preview = await station.locator('[data-screen="cue"]').boundingBox();
  expect(program).not.toBeNull();
  expect(preview).not.toBeNull();
  expect(preview?.height ?? 0).toBeGreaterThanOrEqual((program?.height ?? 0) - 1);
  const innerHeight = await station.evaluate(() => window.innerHeight);
  expect((preview?.y ?? 0) + (preview?.height ?? 0)).toBeLessThanOrEqual(innerHeight + 1);

  // Scambio delle dimensioni: il programma diventa il riquadro grande, e la scelta resta.
  const swap = station.getByRole("button", {
    name: "Scambia le dimensioni di programma e anteprima",
  });
  const screenHeights = async () => ({
    live: (await station.locator('[data-screen="live"]').boundingBox())?.height ?? 0,
    cue: (await station.locator('[data-screen="cue"]').boundingBox())?.height ?? 0,
  });
  const before = await screenHeights();
  expect(before.cue).toBeGreaterThan(before.live);
  await swap.click();
  await expect(swap).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => {
      const now = await screenHeights();
      return now.live > now.cue;
    })
    .toBe(true);
  await swap.click();
  await expect
    .poll(async () => {
      const now = await screenHeights();
      return now.cue > now.live;
    })
    .toBe(true);

  // «Solo sfondo»: l'uscita perde il testo, il programma lo specchia, l'anteprima no.
  const bare = station.getByRole("button", { name: "Solo sfondo" });
  await bare.click();
  await expect(bare).toHaveAttribute("aria-pressed", "true");
  await expect(projector.locator("body")).toHaveAttribute("data-text", "");
  await expect(
    station.locator('[data-screen="live"]').getByText("Il Signore e' il mio pastore"),
  ).toHaveCount(0);
  await expect(
    station.locator('[data-screen="cue"]').getByText("non manco di nulla"),
  ).toBeVisible();
  // Resta acceso cambiando slide...
  await station.keyboard.press("Enter");
  await expect(projector.locator("body")).toHaveAttribute("data-text", "");
  // ...e con un altro clic il testo torna.
  await bare.click();
  await expect(bare).toHaveAttribute("aria-pressed", "false");
  await expect(projector.locator("body")).toHaveAttribute("data-text", "non manco di nulla");
});
