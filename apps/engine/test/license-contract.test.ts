import { existsSync, mkdtempSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LicenseService } from "../src/licenses/service.js";
import { silentLogger } from "../src/index.js";
import { FakeSecrets } from "./license-helpers.js";

// Il client delle licenze del motore contro il Notaio VERO del sito
// (cuelith-site/functions), con il fornitore (Lemon Squeezy) simulato. Se i due
// repo sono affiancati, formato dei messaggi, codici d'errore e firme devono
// coincidere: è la prova che l'integrazione funziona, non solo ciascun lato.

const SITE = new URL("../../../../cuelith-site/functions/", import.meta.url);
const present = existsSync(new URL("api/license/activate.js", SITE));

const NOTARY = "https://notary.test/api/license";
const CATALOG = "https://cuelith.github.io/cuelith-registry/index-2.json";
const LS = "https://api.lemonsqueezy.com/v1/licenses/";
const PLUGIN = "acme.lyrics-pro";
const KEY = "38b1460a-5104-4067-a91d-77b872934d51";
const STORE = 12345;
const PRODUCT = 67890;
const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 6, 10);

interface Handlers {
  activate(ctx: { request: Request; env: Record<string, string> }): Promise<Response>;
  refresh(ctx: { request: Request; env: Record<string, string> }): Promise<Response>;
  deactivate(ctx: { request: Request; env: Record<string, string> }): Promise<Response>;
}

/** Lemon Squeezy finto: posti, stato della chiave, chiavi di prova. */
class FakeSupplier {
  seats = new Map<string, string>(); // instance id -> instance name
  status = "active";
  limit: number | null = 3;
  storeId = STORE;
  productId = PRODUCT;
  down = false;
  #next = 1;

  // eslint-disable-next-line @typescript-eslint/require-await -- la firma asincrona la chiede il tipo di fetch
  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (this.down) return new Response("giù", { status: 503 });
    const params = Object.fromEntries(
      new URLSearchParams(init?.body instanceof URLSearchParams ? init.body : ""),
    );
    const licenseKey = {
      id: 1,
      status: this.status,
      key: params.license_key,
      activation_limit: this.limit,
      activation_usage: this.seats.size,
      test_mode: false,
    };
    const meta = { store_id: this.storeId, product_id: this.productId };
    const action = url.slice(LS.length);
    if (action === "activate") {
      if (this.limit !== null && this.seats.size >= this.limit) {
        return Response.json(
          { activated: false, error: "This license key has reached the activation limit." },
          { status: 400 },
        );
      }
      const id = `inst-${String(this.#next++).padStart(8, "0")}`;
      this.seats.set(id, params.instance_name ?? "");
      return Response.json({
        activated: true,
        error: null,
        license_key: licenseKey,
        instance: { id, name: params.instance_name },
        meta,
      });
    }
    if (action === "validate") {
      const name = this.seats.get(params.instance_id ?? "");
      if (name === undefined) return Response.json({ valid: false, error: "not found" });
      return Response.json({
        valid: this.status === "active",
        error: null,
        license_key: licenseKey,
        instance: { id: params.instance_id, name },
        meta,
      });
    }
    if (action === "deactivate") {
      this.seats.delete(params.instance_id ?? "");
      return Response.json({ deactivated: true, error: null, license_key: licenseKey, meta });
    }
    return new Response("", { status: 404 });
  };
}

const originalFetch = globalThis.fetch;
const services: LicenseService[] = [];
afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  for (const service of services.splice(0)) service.stop();
});

async function setup() {
  const pair = generateKeyPairSync("ed25519");
  const env = {
    NOTARY_PRIVATE_KEY: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    NOTARY_KEY_ID: "n1",
  };
  const publicKey = pair.publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("base64url");
  const supplier = new FakeSupplier();
  // Ciò che il Notaio del sito vede della rete: il catalogo del registry e il fornitore.
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === CATALOG) {
      return Response.json({
        plugins: [
          {
            id: PLUGIN,
            access: "paid",
            licensing: { provider: "lemonsqueezy", storeId: STORE, productId: PRODUCT },
          },
        ],
      });
    }
    if (url.startsWith(LS)) return supplier.fetch(url, init);
    return new Response("", { status: 404 });
  };

  const [activate, refresh, deactivate] = await Promise.all(
    ["activate", "refresh", "deactivate"].map(
      async (name) =>
        (await import(new URL(`api/license/${name}.js`, SITE).href)) as {
          onRequestPost: Handlers["activate"];
        },
    ),
  );
  const toNotary: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const handler = { activate, refresh, deactivate }[
      url.slice(NOTARY.length + 1) as keyof Handlers
    ];
    if (handler === undefined) return new Response("", { status: 404 });
    const request = new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof init?.body === "string" ? init.body : "",
    });
    return handler.onRequestPost({ request, env });
  };

  // Il Notaio vero firma con l'ora del sistema: si porta anche quella al tempo del test (solo Date).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  let now = START;
  const dir = mkdtempSync(join(tmpdir(), "cuelith-contract-"));
  const secrets = new FakeSecrets();
  const make = (where = { dir, secrets }) => {
    const service = new LicenseService({
      dir: where.dir,
      secrets: where.secrets,
      notaryUrl: NOTARY,
      notaryKeys: { n1: publicKey },
      fetch: toNotary,
      logger: silentLogger,
      isOnAir: () => false,
      onChange: () => undefined,
      now: () => now,
      timings: { firstTickMs: 3_600_000, tickMs: 3_600_000, deferMs: 25 },
    });
    services.push(service);
    return service;
  };
  const service = make();
  await service.load();
  /** Un altro computer: caveau e chiavi proprie, stesso Notaio e stessa chiave di licenza. */
  const computer = async () => {
    const other = make({
      dir: mkdtempSync(join(tmpdir(), "cuelith-contract-")),
      secrets: new FakeSecrets(),
    });
    await other.load();
    return other;
  };
  return {
    service,
    supplier,
    computer,
    setNow: (ms: number) => {
      now = ms;
      vi.setSystemTime(ms);
    },
    restart: async () => {
      const next = make();
      await next.load();
      return next;
    },
  };
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as { message: string }).message;
  }
  return "nessun errore";
};

describe.skipIf(!present)("motore e Notaio del sito: lo stesso linguaggio", () => {
  it("attivazione, rinnovo al giorno 31, riavvio e disattivazione", async () => {
    const { service, supplier, setNow, restart } = await setup();
    const status = await service.activate(PLUGIN, KEY);
    expect(status.state).toBe("active");
    expect(supplier.seats.size).toBe(1);
    // Il fornitore vede un nome anonimo del computer, non nulla di personale.
    expect([...supplier.seats.values()][0]).toMatch(/^cuelith-[0-9a-f]{12}$/);

    setNow(START + 31 * DAY);
    expect(service.status(PLUGIN).state).toBe("renew");
    await service.tick();
    expect(service.status(PLUGIN).state).toBe("active");
    expect(service.status(PLUGIN).expires).toBe(new Date(START + 121 * DAY).toISOString());

    supplier.down = true;
    expect((await restart()).allows(PLUGIN)).toBe(true);
    supplier.down = false;

    await service.deactivate(PLUGIN);
    expect(supplier.seats.size).toBe(0);
    expect(service.allows(PLUGIN)).toBe(false);
  });

  it("i codici d'errore del Notaio vero arrivano tradotti, e non resta nulla", async () => {
    const { service, supplier } = await setup();
    supplier.productId = 999;
    expect(await code(service.activate(PLUGIN, KEY))).toBe("core.error.licenseWrongProduct");
    expect(supplier.seats.size).toBe(0);
    supplier.productId = PRODUCT;
    supplier.limit = null;
    expect(await code(service.activate(PLUGIN, KEY))).toBe("core.error.licenseBadLimit");
    expect(supplier.seats.size).toBe(0);
    supplier.limit = 0;
    expect(await code(service.activate(PLUGIN, KEY))).toBe("core.error.licenseLimit");
    supplier.limit = 3;
    supplier.down = true;
    expect(await code(service.activate(PLUGIN, KEY))).toBe("core.error.licenseUnavailable");
    supplier.down = false;
    expect(await code(service.activate("acme.altro", KEY))).toBe("core.error.licenseNotPaid");
    expect(service.status(PLUGIN).state).toBe("none");
  });

  it("un rimborso (chiave disattivata dal fornitore) revoca la licenza al rinnovo", async () => {
    const { service, supplier, setNow } = await setup();
    await service.activate(PLUGIN, KEY);
    supplier.status = "disabled";
    setNow(START + 31 * DAY);
    await service.tick();
    expect(service.status(PLUGIN).state).toBe("revoked");
    expect(service.allows(PLUGIN)).toBe(false);
  });

  it("tre computer sì, il quarto no: il limite lo fa rispettare il fornitore; liberando un posto il quarto entra", async () => {
    const { supplier, computer } = await setup();
    const machines = [await computer(), await computer(), await computer()];
    for (const machine of machines)
      expect((await machine.activate(PLUGIN, KEY)).state).toBe("active");
    expect(supplier.seats.size).toBe(3);
    const fourth = await computer();
    expect(await code(fourth.activate(PLUGIN, KEY))).toBe("core.error.licenseLimit");
    expect(fourth.allows(PLUGIN)).toBe(false);
    // Cambio di computer: dal vecchio si libera il posto e il nuovo entra.
    await machines[0]?.deactivate(PLUGIN);
    expect((await fourth.activate(PLUGIN, KEY)).state).toBe("active");
    expect(supplier.seats.size).toBe(3);
  });
});
