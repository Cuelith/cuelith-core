import path from "node:path";
import { expect } from "@playwright/test";
import { addOutput, chooseFiles, createText, outputWindow, test } from "./app.js";

/** Una GIF animata di due fotogrammi (rosso, blu), 200 ms l'uno, in ciclo. */
const animatedGif = path.resolve(import.meta.dirname, "../fixtures/animata.gif");

// Lo sfondo GIF deve muoversi anche sulle uscite, non solo nella postazione.
test("sfondo GIF animato: l'uscita cambia fotogramma nel tempo", async ({ running }) => {
  const { app, station } = running;
  await createText(station, "Luce", ["Vieni su di noi"]);
  await addOutput(station, "Proiettore", "Sala");
  const projector = await outputWindow(running, "Proiettore");
  await station.keyboard.press("Enter");
  await station
    .getByRole("region", { name: "Sfondi" })
    .getByRole("radio", { name: "Tutto l'elemento" })
    .click();
  await chooseFiles(app, animatedGif);
  await station
    .getByRole("region", { name: "Sfondi" })
    .getByRole("list", { name: "Immagini" })
    .getByRole("button", { name: "Aggiungi un'immagine dal computer" })
    .click();
  await expect(projector.locator("body")).toHaveAttribute("data-background", /\.gif$/);

  const seen = new Set<string>();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && seen.size < 2) {
    seen.add(
      (await projector.screenshot({ clip: { x: 0, y: 0, width: 8, height: 8 } })).toString(
        "base64",
      ),
    );
    await projector.waitForTimeout(120);
  }
  expect(seen.size).toBeGreaterThan(1);
});
