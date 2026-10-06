import { describe, expect, it } from "vitest";
import { checkPlugin, formatReport, type Report } from "../src/index.js";
import { makeFolder, makePackage } from "./fixtures.js";

const CORE = "0.3.1";
const staticOnly = (target: string): Promise<Report> =>
  checkPlugin(target, { coreVersion: CORE, staticOnly: true });
const ids = (report: Report, level?: "error" | "warning"): string[] =>
  report.findings.filter((f) => level === undefined || f.level === level).map((f) => f.id);

describe("controlli statici", () => {
  it("un plugin corretto non ha ne' errori ne' avvisi", async () => {
    const report = await staticOnly(makeFolder());
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.pluginId).toBe("acme.fixture");
    expect(report.checks).toContain("secrets");
  });

  it("un manifest sbagliato e' un errore con la causa", async () => {
    const report = await staticOnly(makeFolder({ manifest: { version: "uno" } }));
    expect(ids(report, "error")).toEqual(["manifest"]);
    expect(report.ok).toBe(false);
  });

  it("un intervallo di versioni che esclude il nucleo e' un errore dedicato", async () => {
    const report = await staticOnly(
      makeFolder({ manifest: { engines: { cuelith: "^0.2.0", protocol: "^1.8.0" } } }),
    );
    expect(ids(report, "error")).toEqual(["compat-range"]);
    expect(report.findings[0]?.fix).toContain("0.3.1");
  });

  it("un file dichiarato e mancante, o TypeScript, e' un errore", async () => {
    const missing = await staticOnly(makeFolder({ files: { "main.mjs": null } }));
    expect(ids(missing, "error")).toContain("declared-files");
    const ts = await staticOnly(
      makeFolder({
        manifest: { runtime: { type: "node", entry: "main.ts" } },
        files: { "main.ts": "export {}" },
      }),
    );
    expect(ids(ts, "error")).toContain("declared-files");
    const icon = await staticOnly(makeFolder({ manifest: { icon: "icon.svg" } }));
    expect(ids(icon, "error")).toContain("declared-files");
  });

  it("trova chiavi private, token e file che non devono esserci", async () => {
    const report = await staticOnly(
      makeFolder({
        files: {
          "notary.txt": "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
          "config.json": JSON.stringify({ token: "ghp_" + "a".repeat(36) }),
          ".env": "A=1",
          "node_modules/x/index.js": "1",
          "chiave.pem": "x",
          "tool.exe": "MZ",
        },
      }),
    );
    expect(ids(report, "error")).toEqual(expect.arrayContaining(["secrets", "junk-files"]));
    expect(
      report.findings
        .filter((f) => f.id === "secrets")
        .map((f) => f.file)
        .sort(),
    ).toEqual(["config.json", "notary.txt"]);
    const junk = report.findings.filter((f) => f.id === "junk-files");
    expect(junk.find((f) => f.file === "tool.exe")?.level).toBe("warning");
    expect(junk.filter((f) => f.level === "error").length).toBe(3);
  });

  it("i pannelli con risorse esterne, script o eventi in linea sono bloccati dalla politica", async () => {
    const manifest = { ui: { entry: "ui/index.html" } };
    const bad = await staticOnly(
      makeFolder({
        manifest,
        files: {
          "ui/index.html":
            '<script src="https://cdn.example.com/a.js"></script><script>alert(1)</script><button onclick="x()">x</button>',
        },
      }),
    );
    const messages = bad.findings.filter((f) => f.id === "panel-assets").map((f) => f.message);
    expect(messages.some((m) => m.includes("cdn.example.com"))).toBe(true);
    expect(messages.some((m) => m.includes("inline <script>"))).toBe(true);
    expect(messages.some((m) => m.includes("event handlers"))).toBe(true);

    const css = await staticOnly(
      makeFolder({
        manifest,
        files: {
          "ui/index.html": '<link rel="stylesheet" href="app.css"><script src="app.js"></script>',
          "ui/app.css": "@import url(https://fonts.googleapis.com/x.css);",
          "ui/app.js": "",
        },
      }),
    );
    expect(css.findings.map((f) => f.file)).toEqual(["ui/app.css"]);

    const good = await staticOnly(
      makeFolder({
        manifest,
        files: {
          "ui/index.html":
            '<!doctype html><svg xmlns="http://www.w3.org/2000/svg"></svg><link rel="stylesheet" href="app.css"><script src="app.js"></script>',
          "ui/app.css": "a{color:red}",
          "ui/app.js": "",
        },
      }),
    );
    expect(good.findings).toEqual([]);
  });

  it("avvisa se il codice sembra usare permessi non dichiarati", async () => {
    const code =
      'import { exec } from "node:child_process"; import https from "node:https"; console.log(exec, https);';
    const report = await staticOnly(makeFolder({ files: { "main.mjs": code } }));
    expect(report.ok).toBe(true);
    expect(report.findings.filter((f) => f.id === "code-permissions").length).toBe(2);
    expect(ids(report)).toContain("stdout-protocol");
    const declared = await staticOnly(
      makeFolder({
        manifest: { permissions: ["process", "network"] },
        files: { "main.mjs": code },
      }),
    );
    expect(ids(declared)).not.toContain("code-permissions");
  });

  it("un plugin di soli dati con permessi, e addon nativi senza permesso", async () => {
    const data = await staticOnly(
      makeFolder({ manifest: { runtime: { type: "none" }, permissions: ["storage"] } }),
    );
    expect(ids(data, "warning")).toContain("runtime-permissions");
    const addon = await staticOnly(makeFolder({ files: { "bin/x.node": "x" } }));
    expect(ids(addon, "error")).toContain("runtime-permissions");
  });
});

describe("pacchetto .cpkg", () => {
  const files = (): Record<string, string> => ({
    "cuelith-plugin.json": makeManifestText(),
    "main.mjs": "export {}",
    "mode.txt": "good",
  });

  it("un pacchetto corretto passa", async () => {
    expect(await staticOnly(makePackage(files()))).toMatchObject({ ok: true, findings: [] });
  });

  it("il nome del file diverso dalla convenzione e' un avviso", async () => {
    const report = await staticOnly(makePackage(files(), "qualcosa.cpkg"));
    expect(ids(report, "warning")).toEqual(["package-name"]);
    expect(report.ok).toBe(true);
  });

  it("il manifest dentro una sottocartella, un file che non e' uno zip e i percorsi pericolosi sono errori", async () => {
    const nested = await staticOnly(
      makePackage({
        "acme.fixture/cuelith-plugin.json": makeManifestText(),
        "acme.fixture/main.mjs": "1",
      }),
    );
    expect(ids(nested, "error")).toEqual(["package-readable"]);
    const traversal = await staticOnly(makePackage({ ...files(), "../evil.txt": "x" }));
    expect(ids(traversal, "error")).toEqual(["package-readable"]);
    const notZip = makePackage({});
    const { writeFileSync } = await import("node:fs");
    writeFileSync(notZip, "non e' uno zip");
    expect(ids(await staticOnly(notZip), "error")).toEqual(["package-readable"]);
  });
});

describe("prove con il motore vero", { timeout: 120_000 }, () => {
  const run = (options: Parameters<typeof makeFolder>[0]): Promise<Report> =>
    checkPlugin(makeFolder(options), { coreVersion: CORE, stableSeconds: 2 });

  it("un plugin corretto supera installazione, attivazione, stabilita', ripresa e arresto", async () => {
    const report = await run({});
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
    for (const check of [
      "install",
      "activation",
      "stability",
      "recovery",
      "clean-stop",
      "re-enable",
    ]) {
      expect(report.checks).toContain(check);
    }
    expect(formatReport(report)).toContain("PASSED");
  });

  it("un plugin che esce subito non si attiva", async () => {
    const report = await run({ mode: "crash-start" });
    expect(ids(report, "error")).toEqual(
      expect.arrayContaining([expect.stringMatching(/activation|stability/)]),
    );
    expect(report.ok).toBe(false);
  });

  it("un plugin che cade dopo un po' non e' stabile (o non si riattiva)", async () => {
    const report = await run({ mode: "crash-later" });
    expect(report.ok).toBe(false);
  });

  it("un plugin che non risponde all'attivazione e' un errore", async () => {
    const report = await run({ mode: "hang-activate" });
    expect(ids(report, "error")).toContain("activation");
  });

  it("un plugin di soli dati si installa senza processo", async () => {
    const report = await run({ manifest: { runtime: { type: "none" } } });
    expect(report.checks).toContain("install");
    expect(report.checks).not.toContain("stability");
  });

  it("non provare il runtime se gli errori statici sono gia' presenti", async () => {
    const report = await run({ files: { "x.pem": "k" } });
    expect(report.checks).not.toContain("install");
    expect(report.ok).toBe(false);
  });
});

function makeManifestText(): string {
  return JSON.stringify({
    id: "acme.fixture",
    name: "Fixture",
    version: "1.0.0",
    publisher: "Acme",
    license: "Apache-2.0",
    repository: "https://github.com/acme/plugin-fixture",
    family: "integration",
    engines: { cuelith: ">=0.3.0 <1.0.0", protocol: "^1.8.0" },
    runtime: { type: "node", entry: "main.mjs" },
    permissions: [],
    dependencies: {},
    extends: [],
    provides: [],
    contributes: {},
  });
}
