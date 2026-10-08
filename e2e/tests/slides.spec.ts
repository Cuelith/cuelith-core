import path from "node:path";
import { expect } from "@playwright/test";
import { createText, screenshotsDir, test } from "./app.js";

// Colonna centrale: miniature con dimensione a scelta, stato scritto (non solo colore) e conteggio.
test("slide: dimensione delle miniature, stato leggibile e conteggio", async ({ running }) => {
  const { station } = running;
  await createText(station, "Salmo", ["Primo versetto", "Secondo versetto", "Terzo versetto"]);
  await station.keyboard.press("Enter");

  const slides = station.getByRole("region", { name: "Slide" });
  await expect(slides).toContainText("3 slide");
  // La prima e' in onda, la seconda e' la prossima: lo dice a parole.
  const first = slides.getByRole("button", { name: "Slide 1" });
  await expect(first).toContainText("in onda");
  await expect(slides.getByRole("button", { name: "Slide 2" })).toContainText("prossima");
  await expect(slides.getByRole("button", { name: "Slide 3" })).not.toContainText("in onda");

  // S, M, L cambiano la larghezza delle miniature e la scelta resta.
  const width = async () => (await first.boundingBox())?.width ?? 0;
  const zoom = slides.getByRole("group", { name: "Dimensione delle miniature" });
  await zoom.getByRole("button", { name: "S", exact: true }).click();
  const small = await width();
  await zoom.getByRole("button", { name: "L", exact: true }).click();
  await expect.poll(width).toBeGreaterThan(small * 1.5);
  await expect(zoom.getByRole("button", { name: "L", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await station.screenshot({ path: path.join(screenshotsDir, "slide-grandi.png") });
});
