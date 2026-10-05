import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyLicenseProof } from "@cuelith/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { LicenseService } from "../src/licenses/service.js";
import { silentLogger } from "../src/index.js";
import { bodyText, FakeNotary, FakeSecrets, NOTARY_URL } from "./license-helpers.js";

// Licenze dei plugin a pagamento (decisione 0013): custodia cifrata, permesso
// firmato dal Notaio, 30 giorni per rinnovare e 90 di tolleranza, mai in onda.

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 6, 10);
const PLUGIN = "acme.lyrics-pro";
const KEY = "38b1460a-5104-4067-a91d-77b872934d51";
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const services: LicenseService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.stop();
});

interface Rig {
  service: LicenseService;
  notary: FakeNotary;
  secrets: FakeSecrets;
  dir: string;
  changes: () => number;
  setNow(ms: number): void;
  onAir: { value: boolean };
  /** Un secondo servizio sulla stessa cartella e la stessa custodia (riavvio dell'app). */
  restart(): Promise<LicenseService>;
}

async function rig(
  options: { secrets?: FakeSecrets; keepNotary?: FakeNotary; dir?: string } = {},
): Promise<Rig> {
  const notary = options.keepNotary ?? new FakeNotary();
  const secrets = options.secrets ?? new FakeSecrets();
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "cuelith-licenses-"));
  let now = START;
  notary.clock = () => now;
  let changes = 0;
  const onAir = { value: false };
  const make = () => {
    const service = new LicenseService({
      dir,
      secrets,
      notaryUrl: NOTARY_URL,
      notaryKeys: { n1: notary.keys.publicKey },
      fetch: (input, init) => notary.fetch(input, init),
      logger: silentLogger,
      isOnAir: () => onAir.value,
      onChange: () => {
        changes += 1;
      },
      now: () => now,
      timings: { firstTickMs: 3_600_000, tickMs: 3_600_000, deferMs: 25 },
    });
    services.push(service);
    return service;
  };
  const service = make();
  await service.load();
  return {
    service,
    notary,
    secrets,
    dir,
    changes: () => changes,
    setNow: (ms) => {
      now = ms;
    },
    onAir,
    restart: async () => {
      const next = make();
      await next.load();
      return next;
    },
  };
}

const code = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return (error as { message: string }).message;
  }
  return "nessun errore";
};

describe("attivazione", () => {
  it("attiva, custodisce tutto cifrato e dice a chi spetta cosa", async () => {
    const r = await rig();
    expect(r.service.available()).toBe(true);
    expect(r.service.status(PLUGIN).state).toBe("none");
    expect(r.service.allows(PLUGIN)).toBe(false);

    const status = await r.service.activate(PLUGIN, KEY);
    expect(status.state).toBe("active");
    expect(status.expires).toBe(new Date(START + 90 * DAY).toISOString());
    expect(status.renewAfter).toBe(new Date(START + 30 * DAY).toISOString());
    expect(r.service.allows(PLUGIN)).toBe(true);
    expect(r.changes()).toBe(1);

    // Al Notaio vanno solo chiave, plugin e chiave pubblica casuale del computer.
    const call = r.notary.calls[0];
    expect(call?.action).toBe("activate");
    expect(Object.keys(call?.body ?? {}).sort()).toEqual([
      "devicePublicKey",
      "licenseKey",
      "pluginId",
    ]);
    expect(call?.body.devicePublicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Sul disco c'è un solo file cifrato: né la chiave di licenza né quella del computer in chiaro.
    const raw = readFileSync(join(r.dir, "vault.bin"), "utf8");
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain(call?.body.devicePublicKey ?? "x");
    expect(Buffer.from(raw, "base64").toString("utf8")).not.toContain(KEY);
  });

  it("la chiave del computer è sempre la stessa e nasce a caso", async () => {
    const a = await rig();
    const b = await rig();
    await a.service.activate(PLUGIN, KEY);
    await a.service.activate("acme.altro", KEY);
    await b.service.activate(PLUGIN, KEY);
    const [first, second] = [
      a.notary.calls[0]?.body.devicePublicKey,
      a.notary.calls[1]?.body.devicePublicKey,
    ];
    expect(first).toBe(second);
    expect(b.notary.calls[0]?.body.devicePublicKey).not.toBe(first);
  });

  it("senza custodia del sistema non si attiva nulla e non si scrive nulla in chiaro", async () => {
    const secrets = new FakeSecrets();
    secrets.available = false;
    const r = await rig({ secrets });
    expect(r.service.available()).toBe(false);
    expect(await code(r.service.activate(PLUGIN, KEY))).toBe("core.error.licenseNoSecretStore");
    expect(r.notary.calls).toHaveLength(0);
    expect(secrets.encrypted).toBe(0);
  });

  it("gli errori del Notaio diventano messaggi tradotti, e non resta nulla", async () => {
    const cases: [() => void, string][] = [
      [() => r.notary.invalid.add(KEY), "core.error.licenseInvalidKey"],
      [
        () => {
          r.notary.invalid.clear();
          r.notary.limit = 0;
        },
        "core.error.licenseLimit",
      ],
      [
        () => {
          r.notary.limit = 3;
          r.notary.online = false;
        },
        "core.error.licenseUnreachable",
      ],
    ];
    const r = await rig();
    for (const [setUp, expected] of cases) {
      setUp();
      expect(await code(r.service.activate(PLUGIN, KEY))).toBe(expected);
      expect(r.service.status(PLUGIN).state).toBe("none");
      expect(r.service.allows(PLUGIN)).toBe(false);
    }
  });

  it("un permesso che non è del Notaio, o non è per questo plugin o computer, si scarta anche se il Notaio dice ok", async () => {
    const r = await rig();
    r.notary.forge = true;
    expect(await code(r.service.activate(PLUGIN, KEY))).toBe("core.error.licenseInvalidAnswer");
    expect(r.service.allows(PLUGIN)).toBe(false);
    r.notary.forge = false;
    // Un Notaio che risponde per un altro plugin.
    const original = r.notary.fetch;
    r.notary.fetch = async (input, init) => {
      const body = JSON.parse(bodyText(init) || "{}") as Record<string, string>;
      return original(input, {
        ...init,
        body: JSON.stringify({ ...body, pluginId: "acme.altro" }),
      });
    };
    const rogue = await rig({ keepNotary: r.notary });
    expect(await code(rogue.service.activate(PLUGIN, KEY))).toBe("core.error.licenseInvalidAnswer");
    expect(rogue.service.status(PLUGIN).state).toBe("none");
  });

  it("riattivare con un'altra chiave libera il posto vecchio", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    const firstSeat = [...r.notary.seats][0];
    await r.service.activate(PLUGIN, "ffffffff-0000-4000-8000-000000000000");
    expect(r.notary.calls.map((c) => c.action)).toEqual(["activate", "activate", "deactivate"]);
    expect(r.notary.seats.has(firstSeat ?? "")).toBe(false);
    expect(r.notary.seats.size).toBe(1);
  });
});

describe("persistenza", () => {
  it("dopo un riavvio la licenza vale anche senza internet", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    r.notary.online = false;
    const again = await r.restart();
    expect(again.status(PLUGIN).state).toBe("active");
    expect(again.allows(PLUGIN)).toBe(true);
  });

  it("un caveau che non si decifra (altro utente) o alterato riparte vuoto, senza cancellarlo", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    const other = await rig({ dir: r.dir, secrets: new FakeSecrets() });
    expect(other.service.status(PLUGIN).state).toBe("none");
    expect(other.service.allows(PLUGIN)).toBe(false);
    expect(readFileSync(join(r.dir, "vault.bin"), "utf8").length).toBeGreaterThan(40);

    const file = join(r.dir, "vault.bin");
    const bytes = Buffer.from(readFileSync(file, "utf8"), "base64");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    writeFileSync(file, bytes.toString("base64"));
    const tampered = await rig({ dir: r.dir, secrets: r.secrets });
    expect(tampered.service.allows(PLUGIN)).toBe(false);
  });

  it("un permesso rimpiazzato con quello di un altro computer o plugin non vale", async () => {
    const a = await rig();
    const b = await rig({ keepNotary: a.notary });
    await a.service.activate(PLUGIN, KEY);
    await b.service.activate(PLUGIN, KEY);
    // Il caveau di A con dentro il permesso di B: la chiave del computer non coincide.
    const intruder = await rig({ dir: a.dir, secrets: a.secrets, keepNotary: a.notary });
    expect(intruder.service.status(PLUGIN).state).toBe("active");
    expect(b.service.status(PLUGIN).state).toBe("active");
    expect(a.notary.calls.filter((c) => c.action === "activate")[0]?.body.devicePublicKey).not.toBe(
      a.notary.calls.filter((c) => c.action === "activate")[1]?.body.devicePublicKey,
    );
  });
});

describe("30 giorni per rinnovare, 90 di tolleranza", () => {
  it("la cronologia: valida, da rinnovare, scaduta", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    r.notary.online = false;
    r.setNow(START + 29 * DAY);
    expect(r.service.status(PLUGIN).state).toBe("active");
    r.setNow(START + 31 * DAY);
    expect(r.service.status(PLUGIN).state).toBe("renew");
    // Da rinnovare ma il plugin continua a funzionare.
    await r.service.tick();
    expect(r.service.allows(PLUGIN)).toBe(true);
    r.setNow(START + 89 * DAY);
    await r.service.tick();
    expect(r.service.status(PLUGIN).state).toBe("renew");
    expect(r.service.allows(PLUGIN)).toBe(true);
    r.setNow(START + 91 * DAY);
    expect(r.service.status(PLUGIN).state).toBe("expired");
    await r.service.tick();
    expect(r.service.allows(PLUGIN)).toBe(false);
    expect(r.service.reason(PLUGIN)).toBe("core.license.expired");
  });

  it("dal trentesimo giorno rinnova da sola, e ricomincia il conto", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    r.setNow(START + 29 * DAY);
    await r.service.tick();
    expect(r.notary.calls.map((c) => c.action)).toEqual(["activate"]);
    r.setNow(START + 31 * DAY);
    await r.service.tick();
    expect(r.notary.calls.map((c) => c.action)).toEqual(["activate", "refresh"]);
    expect(r.notary.calls[1]?.body.instanceId).toBe([...r.notary.seats][0]);
    expect(r.service.status(PLUGIN).state).toBe("active");
    expect(r.service.status(PLUGIN).expires).toBe(new Date(START + 121 * DAY).toISOString());
    // Un riavvio il giorno 100: vale ancora (rinnovato il giorno 31, scade il 121).
    r.notary.online = false;
    r.setNow(START + 100 * DAY);
    const again = await r.restart();
    expect(again.allows(PLUGIN)).toBe(true);
  });

  it("senza internet riprova a ogni giro e non toglie nulla finché non scade", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    r.notary.online = false;
    r.setNow(START + 40 * DAY);
    await r.service.tick();
    await r.service.tick();
    expect(r.notary.calls.filter((c) => c.action === "refresh")).toHaveLength(0);
    expect(r.service.allows(PLUGIN)).toBe(true);
    r.notary.online = true;
    await r.service.tick();
    expect(r.service.status(PLUGIN).state).toBe("active");
  });
});

describe("rimborso e revoca", () => {
  it("il Notaio dice «revocata»: la licenza si spegne, il caveau la ricorda, il riavvio la rispetta", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    r.notary.revoked.add(KEY);
    r.setNow(START + 31 * DAY);
    await r.service.tick();
    expect(r.service.status(PLUGIN).state).toBe("revoked");
    expect(r.service.allows(PLUGIN)).toBe(false);
    expect(r.service.reason(PLUGIN)).toBe("core.license.revoked");
    // Non si riprova all'infinito.
    const refreshes = r.notary.calls.filter((c) => c.action === "refresh").length;
    await r.service.tick();
    expect(r.notary.calls.filter((c) => c.action === "refresh")).toHaveLength(refreshes);
    const again = await r.restart();
    expect(again.status(PLUGIN).state).toBe("revoked");
    expect(again.allows(PLUGIN)).toBe(false);
  });

  it("in onda nulla si spegne: la revoca aspetta la fine della diretta", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    r.notary.revoked.add(KEY);
    r.setNow(START + 31 * DAY);
    r.onAir.value = true;
    await r.service.tick();
    // Il fornitore ha revocato, ma si è in onda: il plugin resta ammesso.
    expect(r.service.status(PLUGIN).state).toBe("revoked");
    expect(r.service.allows(PLUGIN)).toBe(true);
    await sleep(80);
    expect(r.service.allows(PLUGIN)).toBe(true);
    // Finita la diretta, al primo giro (qui ogni 25 ms) si applica.
    const before = r.changes();
    r.onAir.value = false;
    await sleep(80);
    expect(r.service.allows(PLUGIN)).toBe(false);
    expect(r.changes()).toBeGreaterThan(before);
  });

  it("in onda neanche la scadenza dei 90 giorni ferma un plugin che sta lavorando", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    r.notary.online = false;
    r.onAir.value = true;
    r.setNow(START + 100 * DAY);
    await r.service.tick();
    expect(r.service.status(PLUGIN).state).toBe("expired");
    expect(r.service.allows(PLUGIN)).toBe(true);
    r.onAir.value = false;
    await sleep(80);
    expect(r.service.allows(PLUGIN)).toBe(false);
  });

  it("concedere non aspetta: una licenza nuova vale subito, anche in onda", async () => {
    const r = await rig();
    r.onAir.value = true;
    await r.service.activate(PLUGIN, KEY);
    expect(r.service.allows(PLUGIN)).toBe(true);
  });

  it("un guasto del Notaio (500, risposta strana) non è una revoca", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    r.setNow(START + 40 * DAY);
    const original = r.notary.fetch;
    for (const reply of [
      () => new Response("giù", { status: 503 }),
      () => Response.json({ error: "qualcosa-di-nuovo" }, { status: 403 }),
      () => new Response("<html>captive portal</html>", { status: 200 }),
    ]) {
      r.notary.fetch = () => Promise.resolve(reply());
      await r.service.tick();
      expect(r.service.status(PLUGIN).state).toBe("renew");
      expect(r.service.allows(PLUGIN)).toBe(true);
    }
    r.notary.fetch = original;
  });

  it("«aggiorna ora» a mano: un rifiuto definitivo revoca, un guasto torna all'utente", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    r.notary.online = false;
    expect(await code(r.service.refresh(PLUGIN))).toBe("core.error.licenseUnreachable");
    expect(r.service.status(PLUGIN).state).toBe("active");
    r.notary.online = true;
    r.notary.revoked.add(KEY);
    expect(await code(r.service.refresh(PLUGIN))).toBe("core.error.licenseRevoked");
    expect(r.service.status(PLUGIN).state).toBe("revoked");
    expect(await code(r.service.refresh("acme.sconosciuto"))).toBe("core.error.licenseNone");
  });
});

describe("disattivazione", () => {
  it("libera il posto, dimentica la chiave e toglie il plugin", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    expect(r.notary.seats.size).toBe(1);
    await r.service.deactivate(PLUGIN);
    expect(r.notary.seats.size).toBe(0);
    expect(r.service.status(PLUGIN).state).toBe("none");
    expect(r.service.allows(PLUGIN)).toBe(false);
    expect((await r.restart()).status(PLUGIN).state).toBe("none");
  });

  it("una chiave che il fornitore non riconosce più si dimentica comunque; un guasto no", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    r.notary.online = false;
    expect(await code(r.service.deactivate(PLUGIN))).toBe("core.error.licenseUnreachable");
    expect(r.service.status(PLUGIN).state).toBe("active");
    r.notary.online = true;
    r.notary.invalid.add(KEY);
    await r.service.deactivate(PLUGIN);
    expect(r.service.status(PLUGIN).state).toBe("none");
  });

  it("in onda un plugin attivo non si ferma neanche se l'utente disattiva", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    r.onAir.value = true;
    await r.service.deactivate(PLUGIN);
    expect(r.service.allows(PLUGIN)).toBe(true);
    r.onAir.value = false;
    await sleep(80);
    expect(r.service.allows(PLUGIN)).toBe(false);
  });
});

describe("prova per il plugin (license.prove)", () => {
  it("permesso e firma del computer sulla sfida, che il plugin verifica da solo", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    const nonce = "n".repeat(32);
    const proof = r.service.prove(PLUGIN, nonce);
    const payload = await verifyLicenseProof(proof, {
      keys: { n1: r.notary.keys.publicKey },
      pluginId: PLUGIN,
      nonce,
      now: START,
    });
    expect(payload?.plugin).toBe(PLUGIN);
    // Una sfida diversa, un altro plugin, o la chiave del Notaio sbagliata: no.
    expect(
      await verifyLicenseProof(proof, {
        keys: { n1: r.notary.keys.publicKey },
        pluginId: PLUGIN,
        nonce: "x".repeat(32),
        now: START,
      }),
    ).toBeUndefined();
    expect(
      await verifyLicenseProof(proof, {
        keys: { n1: r.notary.keys.publicKey },
        pluginId: "acme.altro",
        nonce,
        now: START,
      }),
    ).toBeUndefined();
    expect(
      await verifyLicenseProof(proof, { pluginId: PLUGIN, nonce, now: START }),
    ).toBeUndefined();
  });

  it("senza licenza valida non c'è prova", async () => {
    const r = await rig();
    expect(() => r.service.prove(PLUGIN, "n".repeat(32))).toThrow("core.error.licenseRequired");
    await r.service.activate(PLUGIN, KEY);
    r.setNow(START + 100 * DAY);
    expect(() => r.service.prove(PLUGIN, "n".repeat(32))).toThrow("core.error.licenseRequired");
  });
});

describe("elenco", () => {
  it("comprende i plugin che chiedono una licenza anche se non ne hanno una", async () => {
    const r = await rig();
    await r.service.activate(PLUGIN, KEY);
    const list = r.service.list(["acme.altro", PLUGIN]);
    expect(list.map((s) => `${s.pluginId}:${s.state}`)).toEqual(
      [`${PLUGIN}:active`, "acme.altro:none"].sort(),
    );
    // Mai la chiave di licenza nelle risposte.
    expect(JSON.stringify(list)).not.toContain(KEY);
  });
});
