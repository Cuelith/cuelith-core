import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { createText, launchBrowser, screenshotsDir, test, type BrowserStation } from "./app.js";

/** Impostazioni → Rete e postazioni sulla postazione del motore. */
async function openNetwork(station: Page): Promise<Locator> {
  await station.getByRole("button", { name: /^Impostazioni/ }).click();
  const settings = station.getByRole("dialog", { name: "Impostazioni" });
  await settings.getByRole("button", { name: "Rete e postazioni" }).click();
  return settings;
}

/** Chiede un codice per quel ruolo e lo legge dallo schermo del motore. */
async function pairingCode(settings: Locator, role: string): Promise<string> {
  await settings.getByRole("combobox", { name: "Ruolo" }).selectOption({ label: role });
  await settings.getByRole("button", { name: "Mostra codice" }).click();
  const code = await settings.getByTestId("pairing-code").textContent();
  expect(code).toMatch(/^\d{6}$/);
  return code ?? "";
}

async function pair(browser: BrowserStation, code: string, name: string): Promise<void> {
  const { page } = browser;
  await expect(page.getByRole("heading", { name: "Abbina questa postazione" })).toBeVisible();
  await page.getByLabel("Codice di abbinamento").fill(code);
  await page.getByLabel("Nome di questa postazione").fill(name);
  await page.getByRole("button", { name: "Abbina" }).click();
}

const program = (page: Page) => page.locator('[data-screen="live"]');

// Criterio 6 del cap. 28: una seconda postazione da browser in rete locale si
// abbina con codice e comanda il motore; lo stato resta sincronizzato.
test("postazioni in rete: abbinamento con codice, regia sincronizzata, telecomando, revoca", async ({
  running,
}) => {
  test.setTimeout(180_000);
  const { station, problems } = running;
  await createText(station, "Luce del mattino", ["Vieni su di noi", "Resta con noi", "Amen"]);

  // Di base il motore non ascolta in rete: lo decide chi sta al computer del motore.
  const settings = await openNetwork(station);
  const enable = settings.getByRole("switch", { name: "Consenti altre postazioni in rete locale" });
  await expect(enable).not.toBeChecked();
  await enable.click();
  await expect(enable).toBeChecked();
  const url = (await settings.getByTestId("network-url").textContent()) ?? "";
  expect(url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/$/);
  await expect(settings.getByRole("img", { name: "Codice QR dell'indirizzo" })).toBeVisible();

  const browsers: BrowserStation[] = [];
  try {
    // Un tablet: codice sbagliato, poi quello giusto col ruolo Operatore.
    const code = await pairingCode(settings, "Operatore");
    await station.screenshot({ path: path.join(screenshotsDir, "rete-codice.png") });
    const tablet = await launchBrowser(url);
    browsers.push(tablet);
    await pair(tablet, code === "000000" ? "000001" : "000000", "Tablet del palco");
    await expect(tablet.page.getByRole("alert")).toHaveText(
      "Codice sbagliato. Controlla e riprova.",
    );
    await tablet.page.screenshot({ path: path.join(screenshotsDir, "rete-abbinamento.png") });
    await pair(tablet, code, "Tablet del palco");
    await expect(tablet.page.getByRole("list", { name: "Voci della scaletta" })).toContainText(
      "Luce del mattino",
    );
    // Sul motore: il tablet compare tra le postazioni abbinate, collegato.
    const stations = settings.getByRole("list", { name: "Postazioni abbinate" });
    await expect(stations).toContainText("Tablet del palco");
    await expect(stations).toContainText("Operatore · collegata");
    // L'operatore non vede quello che non puo' usare.
    await expect(tablet.page.getByRole("button", { name: "Aggiungi plugin" })).toHaveCount(0);

    // Regia dal tablet: Invio manda in onda, e la postazione del motore lo vede.
    await settings.getByRole("button", { name: "Chiudi" }).last().click();
    await tablet.page.locator("body").click({ position: { x: 700, y: 600 } });
    await tablet.page.keyboard.press("Enter");
    await expect(program(tablet.page)).toContainText("Vieni su di noi");
    await expect(program(station)).toContainText("Vieni su di noi");
    // E il contrario: avanti dal motore, il tablet segue.
    await station.locator("body").click({ position: { x: 700, y: 600 } });
    await station.keyboard.press("ArrowRight");
    await expect(program(tablet.page)).toContainText("Resta con noi");
    await tablet.page.screenshot({ path: path.join(screenshotsDir, "rete-tablet.png") });

    // Un telefono col ruolo Telecomando: schermata sua, solo avanti e indietro.
    const again = await openNetwork(station);
    const remoteCode = await pairingCode(again, "Telecomando");
    const phone = await launchBrowser(url, { width: 400, height: 780 });
    browsers.push(phone);
    await pair(phone, remoteCode, "Telefono del pastore");
    const onAir = phone.page.getByRole("region", { name: "Programma" });
    await expect(onAir).toContainText("Resta con noi");
    // Il codice vale una volta: usato, sparisce dallo schermo del motore.
    await expect(again.getByTestId("pairing-code")).toHaveCount(0);
    await expect(phone.page.getByRole("region", { name: "Prossima" })).toContainText("Amen");
    await phone.page.getByRole("button", { name: "Avanti →" }).click();
    await expect(onAir).toContainText("Amen");
    await expect(program(station)).toContainText("Amen");
    await phone.page.getByRole("button", { name: "← Indietro" }).click();
    await expect(program(tablet.page)).toContainText("Resta con noi");
    // Niente scorrimento orizzontale sul telefono.
    expect(
      await phone.page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await phone.page.screenshot({ path: path.join(screenshotsDir, "rete-telecomando.png") });

    // Revoca del tablet: torna alla schermata di abbinamento, il telefono resta.
    const list = again.getByRole("list", { name: "Postazioni abbinate" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await again.getByRole("button", { name: "Revoca Tablet del palco" }).click();
    await again.getByRole("button", { name: "Revoca davvero" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(again.getByTestId("pairing-code")).toHaveCount(0);
    await expect(
      tablet.page.getByRole("heading", { name: "Abbina questa postazione" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(onAir).toContainText("Resta con noi");
    await station.screenshot({ path: path.join(screenshotsDir, "rete-postazioni.png") });

    // Rete spenta: anche il telefono viene scollegato.
    await again.getByRole("switch", { name: "Consenti altre postazioni in rete locale" }).click();
    await expect(again.getByTestId("network-url")).toHaveCount(0);
    await expect(phone.page.getByText("Collegamento al motore perso")).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    for (const browser of browsers) await browser.close();
  }
  expect(problems).toEqual([]);
});
