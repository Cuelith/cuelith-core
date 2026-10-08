import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import { addOutput, chooseFiles, createText, outputWindow, screenshotsDir, test } from "./app.js";

/**
 * Prova di resistenza («non deve mai andare in crash e restare reattivo»): tanti plugin che
 * consumano tutta la CPU e un po' di memoria, uno che si blocca del tutto, e alcuni normali con il
 * loro pannello, insieme, mentre un'uscita proietta. Il programma deve restare vivo, l'uscita
 * fluida, la postazione pronta (cambio scheda e ricerca) e il plugin bloccato deve essere fermato
 * dal controllo periodico. Solo Windows (la misura usa il sistema).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, "../../../plugin-template");
const built = existsSync(path.join(templateDir, "dist", "main.mjs"));
const BURNERS = os.cpus().length;
const LIGHT = 6;

const SOURCE = String.raw`
import { createInterface } from "node:readline";
const mode = process.env.CUELITH_FIXTURE_MODE ?? "burn";
const out = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const hold = [];
const start = () => {
  if (mode === "burn") {
    // Tutto il tempo del processore, ma a pezzetti: risponde ancora ai controlli del motore.
    hold.push(Buffer.alloc(100 * 1024 * 1024, 1));
    setInterval(() => { const end = Date.now() + 60; while (Date.now() < end) {} }, 64);
  } else {
    // Si blocca del tutto: non risponde piu' a niente.
    setTimeout(() => { for (;;) {} }, 1500);
  }
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === undefined || m.id === undefined) return;
  if (m.method === "plugin.activate") { out({ id: m.id, result: {} }); start(); return; }
  if (m.method === "plugin.ping") { out({ id: m.id, result: {} }); return; }
  if (m.method === "plugin.deactivate") { out({ id: m.id, result: {} }); setImmediate(() => process.exit(0)); return; }
});
`;

/** Un plugin di prova scritto a mano (nessun SDK): consuma tutto, oppure si blocca. */
function heavyPlugin(index: number, mode: "burn" | "spin"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), `cuelith-heavy-${String(index)}-`));
  const id = `acme.${mode}${String(index)}`;
  writeFileSync(
    path.join(dir, "cuelith-plugin.json"),
    JSON.stringify({
      id,
      name: `${mode === "burn" ? "Pesante" : "Bloccato"} ${String(index)}`,
      version: "1.0.0",
      publisher: "Cuelith",
      license: "Apache-2.0",
      repository: "https://github.com/Cuelith/plugin-fixture",
      family: "integration",
      engines: { cuelith: ">=0.1.0 <1.0.0", protocol: "^1.8.0" },
      runtime: { type: "node", entry: "main.mjs" },
      permissions: [],
      dependencies: {},
      extends: [],
      provides: [],
      contributes: {},
    }),
  );
  writeFileSync(path.join(dir, "main.mjs"), SOURCE.replace('?? "burn"', `?? "${mode}"`));
  return dir;
}

function lightPlugin(index: number): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), `cuelith-light-${String(index)}-`));
  for (const name of ["cuelith-plugin.json", "icon.svg", "locales", "dist"]) {
    cpSync(path.join(templateDir, name), path.join(dir, name), { recursive: true });
  }
  const id = `acme.light${String(index)}`;
  for (const file of ["cuelith-plugin.json", "locales/it.json"]) {
    const full = path.join(dir, file);
    writeFileSync(
      full,
      readFileSync(full, "utf8")
        .replaceAll("cuelith.hello", id)
        .replace(/"name": "Ciao"/, `"name": "Normale ${String(index)}"`)
        .replace(`"${id}.panel": "Ciao"`, `"${id}.panel": "Normale ${String(index)}"`),
    );
  }
  return dir;
}

/** Il processo principale e tutti i suoi discendenti ancora vivi. */
async function processCount(app: ElectronApplication): Promise<number> {
  const root = await app.evaluate(() => process.pid);
  const script = `
$all = Get-CimInstance Win32_Process
$set = @{}; $set[[int]${String(root)}] = $true
do { $added = $false
  foreach ($p in $all) { if (-not $set.ContainsKey([int]$p.ProcessId) -and $set.ContainsKey([int]$p.ParentProcessId)) { $set[[int]$p.ProcessId] = $true; $added = $true } }
} while ($added)
$set.Count`;
  return Number(
    execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim(),
  );
}

async function startFrameWatch(output: Page): Promise<void> {
  await output.evaluate(() => {
    const w = window as unknown as { frameWatch?: { max: number; count: number; last: number } };
    w.frameWatch = { max: 0, count: 0, last: performance.now() };
    const loop = (t: number) => {
      const watch = w.frameWatch;
      if (watch === undefined) return;
      watch.max = Math.max(watch.max, t - watch.last);
      watch.last = t;
      watch.count++;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

async function frameWatch(output: Page): Promise<{ max: number; count: number }> {
  return output.evaluate(() => {
    const w = window as unknown as { frameWatch: { max: number; count: number; last: number } };
    const result = { max: w.frameWatch.max, count: w.frameWatch.count };
    w.frameWatch.max = 0;
    w.frameWatch.count = 0;
    return result;
  });
}

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

test("resistenza: plugin che consumano tutto e uno bloccato, il programma resta vivo e pronto", async ({
  running,
}) => {
  test.skip(!built, "plugin-template non costruito (pnpm build nel repo affiancato)");
  test.skip(process.platform !== "win32", "la misura usa gli strumenti di Windows");
  test.setTimeout(600_000);
  const { app, station, problems } = running;
  mkdirSync(screenshotsDir, { recursive: true });

  await createText(station, "Luce del mattino", ["Vieni su di noi", "Resta con noi"]);
  await addOutput(station, "Proiettore", "Sala");
  const projector = await outputWindow(running, "Proiettore");
  await station.keyboard.press("Enter");
  await expect(projector.locator("body")).toHaveAttribute("data-text", "Vieni su di noi");
  await startFrameWatch(projector);
  await projector.waitForTimeout(2000);
  const idle = await frameWatch(projector);

  // Si installano: prima i normali (con pannello), poi quelli che consumano tutto, infine il bloccato.
  const plan: { dir: string; name: string }[] = [
    ...Array.from({ length: LIGHT }, (_, i) => ({
      dir: lightPlugin(i + 1),
      name: `Normale ${String(i + 1)}`,
    })),
    ...Array.from({ length: BURNERS }, (_, i) => ({
      dir: heavyPlugin(i + 1, "burn"),
      name: `Pesante ${String(i + 1)}`,
    })),
    { dir: heavyPlugin(1, "spin"), name: "Bloccato 1" },
  ];
  for (const { dir, name } of plan) {
    await chooseFiles(app, dir);
    await station.getByRole("button", { name: "Aggiungi plugin" }).click();
    const modules = station.getByRole("dialog", { name: "Plugin" });
    await modules.getByRole("tab", { name: "Installati" }).click();
    const row = modules
      .getByRole("list", { name: "Installati" })
      .getByRole("listitem")
      .filter({ hasText: new RegExp(`${name}(?!\\d)`) });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await modules.getByRole("button", { name: "Installa da cartella…" }).click();
      if (
        await row
          .first()
          .waitFor({ timeout: 25_000 })
          .then(
            () => true,
            () => false,
          )
      )
        break;
      await chooseFiles(app, dir);
    }
    await expect(row).toContainText(/Attivo|Fermo per errore|In avvio/, { timeout: 90_000 });
    await modules.getByRole("button", { name: "Chiudi" }).click();
  }
  const installing = await frameWatch(projector);

  // Con tutto acceso e il processore al massimo: la postazione deve restare pronta.
  const switches: number[] = [];
  for (let i = 1; i <= LIGHT; i++) {
    const started = Date.now();
    await station.getByRole("tab", { name: `Normale ${String(i)}`, exact: true }).click();
    await station
      .locator(`[data-module-panel="acme.light${String(i)}.hello"]`)
      .waitFor({ state: "attached", timeout: 30_000 });
    switches.push(Date.now() - started);
  }
  const palette = station.getByRole("dialog", { name: "Cerca e vai" });
  const opened: number[] = [];
  for (let round = 0; round < 3; round++) {
    const started = Date.now();
    await station.keyboard.press("Control+k");
    await expect(palette).toBeVisible();
    opened.push(Date.now() - started);
    await station.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  }
  // La regia lavora: avanti e indietro, e l'uscita segue.
  const next = Date.now();
  await station.getByRole("button", { name: /Avanti/ }).click();
  await expect(projector.locator("body")).toHaveAttribute("data-text", "Resta con noi", {
    timeout: 10_000,
  });
  const cue = Date.now() - next;
  const underLoad = await frameWatch(projector);

  // Il plugin bloccato viene fermato dal controllo periodico e il resto non ne risente.
  const modules = await (async () => {
    await station.getByRole("button", { name: "Aggiungi plugin" }).click();
    const dialog = station.getByRole("dialog", { name: "Plugin" });
    await dialog.getByRole("tab", { name: "Installati" }).click();
    return dialog;
  })();
  const stuck = modules
    .getByRole("list", { name: "Installati" })
    .getByRole("listitem")
    .filter({ hasText: /Bloccato 1(?!\d)/ });
  await expect(stuck).toContainText(/non rispondeva|Fermo per errore|fermato più volte/, {
    timeout: 120_000,
  });
  await station.screenshot({ path: path.join(screenshotsDir, "resistenza.png") });
  await modules.getByRole("button", { name: "Chiudi" }).click();
  const afterStuck = await frameWatch(projector);

  const processes = await processCount(app);
  const report = {
    burners: BURNERS,
    light: LIGHT,
    processes,
    tabSwitchMs: { median: median(switches), max: Math.max(...switches) },
    searchOpenMs: { median: median(opened), max: Math.max(...opened) },
    cueToOutputMs: cue,
    outputFrames: { idle, installing, underLoad, afterStuck },
  };
  writeFileSync(
    path.join(screenshotsDir, "resistenza.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log("RESISTENZA", JSON.stringify(report));

  // Il programma e' vivo, l'uscita ha sempre disegnato e la postazione e' stata pronta.
  expect(processes).toBeGreaterThan(BURNERS);
  for (const phase of [underLoad, afterStuck]) {
    expect(phase.count).toBeGreaterThan(0);
    expect(phase.max).toBeLessThanOrEqual(Math.max(250, idle.max * 3 + 100));
  }
  expect(installing.count).toBeGreaterThan(0);
  expect(report.tabSwitchMs.median).toBeLessThan(2500);
  expect(report.searchOpenMs.max).toBeLessThan(1500);
  expect(cue).toBeLessThan(2500);
  await expect(projector.locator("body")).toHaveAttribute("data-blackout", "false");
  expect(problems).toEqual([]);
});
