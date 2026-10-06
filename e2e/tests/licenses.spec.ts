import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { launchApp, screenshotsDir, test as base, type RunningApp } from "./app.js";

// Plugin a pagamento dal marketplace (decisione 0013), nell'app vera: acquisto
// (si apre il negozio nel browser), chiave di licenza, installazione, stato della
// licenza e disattivazione. Il Notaio è un server di prova su questo computer.

const ID = "acme.lyrics-pro";
const KEY = "38b1460a-5104-4067-a91d-77b872934d51";
const CHECKOUT = "https://acme.lemonsqueezy.com/checkout/buy/abc?aff=cuelith";
const DAY = 86_400;

function pluginPackage(): Uint8Array {
  return zipSync({
    "cuelith-plugin.json": strToU8(
      JSON.stringify({
        id: ID,
        name: "Lyrics Pro",
        description: "Plugin di prova a pagamento.",
        version: "1.0.0",
        publisher: "Acme Studio",
        license: "Proprietaria",
        repository: "https://github.com/acme/lyrics-pro",
        family: "function",
        engines: { cuelith: ">=0.1.0 <1.0.0", protocol: "^1.4.0" },
        runtime: { type: "none" },
        permissions: [],
        dependencies: {},
        extends: [],
        provides: [],
        contributes: {},
      }),
    ),
  });
}

/** Cartella che fa da marketplace: l'indice 2 con il plugin a pagamento e il suo pacchetto. */
function registryFolder(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cuelith-registry-"));
  const data = pluginPackage();
  writeFileSync(path.join(dir, `${ID}-1.0.0.cpkg`), data);
  writeFileSync(
    path.join(dir, "index-2.json"),
    JSON.stringify({
      schema: 2,
      generatedAt: "2026-10-06T10:00:00.000Z",
      plugins: [
        {
          id: ID,
          name: "Lyrics Pro",
          description: "Plugin di prova a pagamento.",
          publisher: "Acme Studio",
          license: "Proprietaria",
          repository: "https://github.com/acme/lyrics-pro",
          family: "function",
          verified: false,
          access: "paid",
          price: "9 €",
          checkoutUrl: CHECKOUT,
          licensing: { provider: "lemonsqueezy", storeId: 12345, productId: 67890 },
          versions: [
            {
              version: "1.0.0",
              engines: { cuelith: ">=0.1.0 <1.0.0", protocol: "^1.4.0" },
              url: `https://downloads.acme.example/${ID}-1.0.0.cpkg`,
              sha256: createHash("sha256").update(data).digest("hex"),
              size: data.byteLength,
              permissions: [],
              published: "2026-10-06T10:00:00.000Z",
            },
          ],
        },
      ],
    }),
  );
  return dir;
}

const b64u = (data: Uint8Array | string) => Buffer.from(data).toString("base64url");

/** Notaio di prova: stesso linguaggio del vero (firma permessi legati al computer). */
async function startNotary() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keys = b64u(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  const seats = new Set<string>();
  const calls: string[] = [];
  const server = http.createServer((request, response) => {
    let text = "";
    request.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
    });
    request.on("end", () => {
      const action = (request.url ?? "").split("/").pop() ?? "";
      calls.push(action);
      const body = JSON.parse(text || "{}") as Record<string, string>;
      const send = (status: number, value: unknown) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (action === "deactivate") {
        seats.delete(body.instanceId ?? "");
        send(200, { ok: true });
        return;
      }
      if (action !== "activate" && action !== "refresh") {
        send(404, {});
        return;
      }
      if (body.licenseKey !== KEY) {
        send(403, { error: "invalidKey" });
        return;
      }
      const instance =
        action === "activate"
          ? `inst-${String(seats.size + 1).padStart(8, "0")}`
          : (body.instanceId ?? "");
      seats.add(instance);
      const iat = Math.floor(Date.now() / 1000);
      const payload = Buffer.from(
        JSON.stringify({
          v: 1,
          kid: "n1",
          plugin: body.pluginId,
          device: body.devicePublicKey,
          instance,
          iat,
          renewAfter: iat + 30 * DAY,
          exp: iat + 90 * DAY,
        }),
      ).toString("base64url");
      const signature = b64u(sign(null, Buffer.from(`cuelith-license-v1\n${payload}`), privateKey));
      send(200, { ok: true, token: `${payload}.${signature}`, instanceId: instance });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/api/license`,
    keys: JSON.stringify({ n1: keys }),
    seats,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

const test = base.extend<{
  shop: RunningApp & { notary: Awaited<ReturnType<typeof startNotary>> };
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright richiede la destrutturazione
  shop: async ({}, use) => {
    const notary = await startNotary();
    const running = await launchApp({
      env: {
        CUELITH_TEST_REGISTRY_DIR: registryFolder(),
        CUELITH_TEST_NOTARY_URL: notary.url,
        CUELITH_TEST_NOTARY_KEYS: notary.keys,
        CUELITH_TEST_SECRETS: "memory",
      },
    });
    try {
      await use({ ...running, notary });
    } finally {
      await running.close();
      await notary.close();
    }
  },
});

async function openModules(station: Page) {
  await station.getByRole("button", { name: "Aggiungi plugin" }).click();
  const window = station.getByRole("dialog", { name: "Plugin" });
  await expect(window).toBeVisible();
  return window;
}

test("plugin a pagamento: acquisto, chiave, installazione, stato e disattivazione", async ({
  shop,
}) => {
  const { station, problems, app, notary } = shop;
  // Il pulsante «Acquista» apre il browser del sistema: nella prova si intercetta l'indirizzo.
  await app.evaluate(({ shell }) => {
    (globalThis as { opened?: string[] }).opened = [];
    shell.openExternal = (url: string) => {
      (globalThis as { opened?: string[] }).opened?.push(url);
      return Promise.resolve();
    };
  });

  const window = await openModules(station);
  const card = window.getByRole("list", { name: "Marketplace" }).getByRole("listitem").filter({
    hasText: "Lyrics Pro",
  });
  await expect(card).toContainText("A pagamento · Prezzo: 9 €");
  await expect(card).toContainText("Prodotto da Acme");
  await expect(card).toContainText("Venduto da Lemon Squeezy");
  // Senza licenza non si può installare: c'è il campo per la chiave.
  await expect(card.getByRole("button", { name: "Installa" })).toBeDisabled();
  await expect(card.getByText("Serve una licenza per usarlo.")).toHaveCount(0);
  await station.screenshot({ path: path.join(screenshotsDir, "moduli-pagamento.png") });

  // Acquista: si apre il negozio dell'autore, e solo quello.
  await card.getByRole("button", { name: "Acquista" }).click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? []))
    .toEqual([CHECKOUT]);

  // Una chiave sbagliata: errore tradotto, nulla si attiva.
  const field = card.getByLabel("Chiave di licenza");
  await field.fill("00000000-0000-4000-8000-000000000000");
  await card.getByRole("button", { name: "Attiva" }).click();
  await expect(station.getByText("La chiave di licenza non è valida")).toBeVisible();
  await expect(card.getByRole("button", { name: "Installa" })).toBeDisabled();

  // La chiave giusta: licenza attiva, si può installare.
  await field.fill(KEY);
  await card.getByRole("button", { name: "Attiva" }).click();
  await expect(card).toContainText("Licenza attiva fino al");
  await expect(card.getByLabel("Chiave di licenza")).toHaveCount(0);
  expect(notary.seats.size).toBe(1);
  await card.getByRole("button", { name: "Installa" }).click();
  const confirm = station.getByRole("dialog", { name: "Installare «Lyrics Pro»?" });
  await confirm.getByRole("button", { name: "Installa" }).click();
  await expect(card).toContainText("Installato");

  // Installati: acceso, con lo stato della licenza.
  await window.getByRole("tab", { name: "Installati" }).click();
  const row = window.getByRole("list", { name: "Installati" }).getByRole("listitem").filter({
    hasText: "Lyrics Pro",
  });
  await expect(row).toContainText("Attivo");
  await expect(row).toContainText("Licenza attiva fino al");
  await station.screenshot({ path: path.join(screenshotsDir, "moduli-licenza.png") });

  // «Verifica ora» rinnova il permesso.
  await row.getByRole("button", { name: "Verifica ora" }).click();
  await expect.poll(() => notary.calls.includes("refresh")).toBe(true);

  // Disattiva questo computer: si libera il posto e il plugin si ferma.
  await row.getByRole("button", { name: "Disattiva questo computer" }).click();
  const ask = station.getByRole("dialog", { name: "Disattiva questo computer" });
  await ask.getByRole("button", { name: "Disattiva questo computer" }).click();
  await expect.poll(() => notary.seats.size).toBe(0);
  await expect(row).toContainText("Serve una licenza.");
  await expect(row).toContainText("Disattivato");
  expect(problems).toEqual([]);
});
