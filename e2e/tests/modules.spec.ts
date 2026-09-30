import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { launchApp, screenshotsDir, test as base, type RunningApp } from "./app.js";

const ID = "cuelith.greetings";

/** Un modulo di prova di soli dati, con una guida al primo uso di due passi. */
function greetingsPackage(version: string): Uint8Array {
  const manifest = {
    id: ID,
    name: "Saluti",
    description: "Modulo di prova con una guida al primo uso.",
    version,
    publisher: "Cuelith",
    license: "Apache-2.0",
    repository: "https://github.com/Cuelith/plugin-greetings",
    family: "function",
    engines: { cuelith: "^0.1.0", protocol: "^1.4.0" },
    runtime: { type: "none" },
    permissions: ["storage"],
    dependencies: {},
    extends: [],
    provides: [],
    contributes: { locales: [{ lang: "it", file: "locales/it.json" }] },
    onboarding: [
      { title: "cuelith.greetings.tour.1.title", body: "cuelith.greetings.tour.1.body" },
      { title: "cuelith.greetings.tour.2.title", body: "cuelith.greetings.tour.2.body" },
    ],
  };
  const catalog = {
    "cuelith.greetings.tour.1.title": "Benvenuto nei Saluti",
    "cuelith.greetings.tour.1.body": "Questo è il primo passo della guida.",
    "cuelith.greetings.tour.2.title": "Pronto",
    "cuelith.greetings.tour.2.body": "Ora sai tutto.",
  };
  return zipSync({
    "cuelith-plugin.json": strToU8(JSON.stringify(manifest)),
    "locales/it.json": strToU8(JSON.stringify(catalog)),
  });
}

/** Cartella che fa da marketplace: index.json e pacchetti. */
function registryFolder(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cuelith-registry-"));
  const data = greetingsPackage("1.0.0");
  const file = `${ID}-1.0.0.cpkg`;
  writeFileSync(path.join(dir, file), data);
  writeFileSync(
    path.join(dir, "index.json"),
    JSON.stringify({
      schema: 1,
      generatedAt: "2026-09-30T10:00:00.000Z",
      plugins: [
        {
          id: ID,
          name: "Saluti",
          description: "Modulo di prova con una guida al primo uso.",
          publisher: "Cuelith",
          license: "Apache-2.0",
          repository: "https://github.com/Cuelith/plugin-greetings",
          family: "function",
          verified: true,
          versions: [
            {
              version: "1.0.0",
              engines: { cuelith: "^0.1.0", protocol: "^1.4.0" },
              url: `https://github.com/Cuelith/plugin-greetings/releases/download/v1.0.0/${file}`,
              sha256: createHash("sha256").update(data).digest("hex"),
              size: data.byteLength,
              permissions: ["storage"],
              published: "2026-09-30T10:00:00.000Z",
            },
          ],
        },
      ],
    }),
  );
  return dir;
}

const test = base.extend<{ market: RunningApp }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright richiede la destrutturazione
  market: async ({}, use) => {
    const running = await launchApp({ env: { CUELITH_TEST_REGISTRY_DIR: registryFolder() } });
    try {
      await use(running);
    } finally {
      await running.close();
    }
  },
});

async function openModules(station: Page) {
  await station.getByRole("button", { name: "Aggiungi moduli" }).click();
  const window = station.getByRole("dialog", { name: "Moduli" });
  await expect(window).toBeVisible();
  return window;
}

test("marketplace: installa con i permessi, guida al primo uso, spegni e disinstalla", async ({
  market,
}) => {
  const { station, problems } = market;
  const window = await openModules(station);
  const card = window.getByRole("list", { name: "Marketplace" }).getByRole("listitem").filter({
    hasText: "Saluti",
  });
  await expect(card).toContainText("Verificato");
  await expect(card).toContainText("Cuelith · Funzione · 1.0.0");
  await station.screenshot({ path: path.join(screenshotsDir, "moduli-marketplace.png") });

  await card.getByRole("button", { name: "Installa" }).click();
  const confirm = station.getByRole("dialog", { name: "Installare «Saluti»?" });
  await expect(confirm).toContainText("salvare i propri dati su questo computer");
  await confirm.getByRole("button", { name: "Installa" }).click();

  // Subito dopo l'installazione: la guida, coi testi del modulo.
  const guide = station.getByRole("dialog", { name: "Primi passi con «Saluti»" });
  await expect(guide).toContainText("Benvenuto nei Saluti");
  await expect(guide).toContainText("Passo 1 di 2");
  await station.screenshot({ path: path.join(screenshotsDir, "moduli-guida.png") });
  await guide.getByRole("button", { name: "Avanti" }).click();
  await expect(guide).toContainText("Ora sai tutto.");
  await guide.getByRole("button", { name: "Ho capito" }).click();
  await expect(guide).toBeHidden();
  await expect(card).toContainText("Installato");

  // Installati: acceso, si spegne, si disinstalla.
  await window.getByRole("tab", { name: "Installati" }).click();
  const row = window.getByRole("list", { name: "Installati" }).getByRole("listitem").filter({
    hasText: "Saluti",
  });
  await expect(row).toContainText("Marketplace · Attivo");
  // L'interruttore cambia quando il motore conferma: si clicca e si attende.
  const toggle = row.getByRole("switch", { name: "Attiva Saluti" });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(row).toContainText("Disattivato");
  await station.screenshot({ path: path.join(screenshotsDir, "moduli-installati.png") });
  await row.getByRole("button", { name: "Disinstalla" }).click();
  const uninstall = station.getByRole("dialog", { name: "Disinstallare «Saluti»?" });
  await uninstall.getByRole("button", { name: "Disinstalla" }).click();
  await expect(row).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("senza marketplace raggiungibile lo dice, e l'italiano resta obbligatorio", async ({
  running,
}) => {
  const { station, problems } = running;
  // Qui il marketplace e' quello vero: l'indice potrebbe non esistere ancora.
  const window = await openModules(station);
  await expect(window.getByText(/Marketplace non raggiungibile|Elenco aggiornato/)).toBeVisible();
  await window.getByRole("tab", { name: "Installati" }).click();
  const italian = window.getByRole("list", { name: "Installati" }).getByRole("listitem").filter({
    hasText: "Italiano",
  });
  // Modulo passivo: lavora in background, niente icona nella colonna degli strumenti.
  await expect(italian).toContainText("Lingua · In background · 0.1.0 · Incluso · Attivo");
  await expect(italian.locator("img")).toHaveAttribute("src", /icon\.svg$/);
  await expect(italian.getByRole("switch", { name: "Attiva Italiano" })).toBeDisabled();
  await expect(italian.getByRole("button", { name: "Disinstalla" })).toHaveCount(0);
  expect(problems).toEqual([]);
});
