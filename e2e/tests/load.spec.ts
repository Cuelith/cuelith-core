import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import { addOutput, chooseFiles, createText, outputWindow, screenshotsDir, test } from "./app.js";

/**
 * Prova di carico (decisione 0017): 12 plugin veri, ognuno con il suo processo e il suo pannello,
 * attivi insieme mentre un'uscita proietta. Misura memoria e CPU di tutto Cuelith (programma e
 * processi dei plugin), i fotogrammi dell'uscita, il tempo per cambiare scheda e per aprire la
 * ricerca. I numeri vanno in `e2e/screenshots/carico.json`. Solo Windows (la misura usa il sistema).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, "../../../plugin-template");
const built = existsSync(path.join(templateDir, "dist", "main.mjs"));
const COUNT = 12;

function copyOfTemplate(index: number): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), `cuelith-load-${String(index)}-`));
  for (const name of ["cuelith-plugin.json", "icon.svg", "locales", "dist"]) {
    cpSync(path.join(templateDir, name), path.join(dir, name), { recursive: true });
  }
  const id = `acme.load${String(index)}`;
  for (const file of ["cuelith-plugin.json", "locales/it.json"]) {
    const full = path.join(dir, file);
    writeFileSync(
      full,
      readFileSync(full, "utf8")
        .replaceAll("cuelith.hello", id)
        .replace(/"name": "Ciao"/, `"name": "Carico ${String(index)}"`)
        .replace(`"${id}.panel": "Ciao"`, `"${id}.panel": "Carico ${String(index)}"`),
    );
  }
  return dir;
}

interface Sample {
  processes: number;
  memoryMB: number;
  /** Memoria privata (quella che pesa davvero: senza le pagine condivise tra processi). */
  privateMB: number;
  /** Secondi di CPU consumati da tutti i processi dall'avvio. */
  cpuSeconds: number;
  /** Uno per processo: chi e', quanta memoria, quanta CPU dall'avvio. */
  parts: { pid: number; what: string; memoryMB: number; privateMB: number; cpuSeconds: number }[];
}

/** Tutto Cuelith: il processo principale e i suoi discendenti (uscite, postazione, plugin). */
async function sample(app: ElectronApplication): Promise<Sample> {
  const root = await app.evaluate(() => process.pid);
  const script = `
$all = Get-CimInstance Win32_Process
$set = @{}; $set[[int]${String(root)}] = $true
do { $added = $false
  foreach ($p in $all) { if (-not $set.ContainsKey([int]$p.ProcessId) -and $set.ContainsKey([int]$p.ParentProcessId)) { $set[[int]$p.ProcessId] = $true; $added = $true } }
} while ($added)
$n = 0; $mem = 0; $cpu = 0; $priv = 0
foreach ($p in $all) { if ($set.ContainsKey([int]$p.ProcessId)) {
  $n++; $mem += [double]$p.WorkingSetSize; $priv += [double]$p.PrivatePageCount; $cpu += [double]$p.KernelModeTime + [double]$p.UserModeTime
  $line = [string]$p.CommandLine; if ($line.Length -gt 200) { $line = $line.Substring(0, 200) }
  "PART|$($p.ProcessId)|$([double]$p.WorkingSetSize)|$([double]$p.PrivatePageCount)|$([double]$p.KernelModeTime + [double]$p.UserModeTime)|$line"
} }
"TOTAL $n $mem $cpu $priv"`;
  const out = execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  const lines = out.split(/\r?\n/).map((line) => line.trim());
  const [n, mem, cpu, priv] = (lines.find((line) => line.startsWith("TOTAL")) ?? "TOTAL 0 0 0")
    .split(/\s+/)
    .slice(1)
    .map(Number);
  const parts = lines
    .filter((line) => line.startsWith("PART|"))
    .map((line) => {
      const [, pid, memory, privateBytes, time, ...what] = line.split("|");
      const text = what.join("|");
      const kind = /--type=([a-z-]+)/.exec(text)?.[1];
      const plugin = /acme\.load\d+/.exec(text)?.[0];
      return {
        pid: Number(pid),
        // Senza --type= e' un processo Node: il principale (il primo) o un plugin.
        what: Number(pid) === root ? "principale" : (plugin ?? kind ?? "plugin"),
        memoryMB: Math.round(Number(memory) / 1_048_576),
        privateMB: Math.round(Number(privateBytes) / 1_048_576),
        cpuSeconds: Number(time) / 10_000_000,
      };
    });
  return {
    processes: n ?? 0,
    memoryMB: Math.round((mem ?? 0) / 1_048_576),
    privateMB: Math.round((priv ?? 0) / 1_048_576),
    cpuSeconds: (cpu ?? 0) / 10_000_000,
    parts,
  };
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

test("carico: 12 plugin attivi insieme, uscita fluida, cambio scheda e ricerca veloci", async ({
  running,
}) => {
  test.skip(!built, "plugin-template non costruito (pnpm build nel repo affiancato)");
  test.skip(process.platform !== "win32", "la misura usa gli strumenti di Windows");
  test.setTimeout(420_000);
  const { app, station, problems } = running;

  // Un'uscita in onda: e' quella che non deve mai perdere un fotogramma.
  await createText(station, "Luce del mattino", ["Vieni su di noi", "Resta con noi"]);
  await addOutput(station, "Proiettore", "Sala");
  const projector = await outputWindow(running, "Proiettore");
  await station.keyboard.press("Enter");
  await expect(projector.locator("body")).toHaveAttribute("data-text", "Vieni su di noi");
  await startFrameWatch(projector);
  await projector.waitForTimeout(2000);
  const idleFrames = await frameWatch(projector);
  const baseline = await sample(app);

  // Si installano i 12 plugin, uno dopo l'altro, mentre l'uscita proietta.
  for (let i = 1; i <= COUNT; i++) {
    await chooseFiles(app, copyOfTemplate(i));
    await station.getByRole("button", { name: "Aggiungi plugin" }).click();
    const modules = station.getByRole("dialog", { name: "Plugin" });
    await modules.getByRole("tab", { name: "Installati" }).click();
    const row = modules
      .getByRole("list", { name: "Installati" })
      .getByRole("listitem")
      .filter({ hasText: `Carico ${String(i)}` });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await modules.getByRole("button", { name: "Installa da cartella…" }).click();
      if (
        await row
          .first()
          .waitFor({ timeout: 20_000 })
          .then(
            () => true,
            () => false,
          )
      )
        break;
      await chooseFiles(app, copyOfTemplate(i));
    }
    await expect(row).toContainText("Attivo", { timeout: 60_000 });
    await modules.getByRole("button", { name: "Chiudi" }).click();
  }
  const installing = await frameWatch(projector);

  // Si apre uno dopo l'altro il pannello di ciascuno: tempo per cambiare scheda.
  const switches: number[] = [];
  for (let i = 1; i <= COUNT; i++) {
    const started = Date.now();
    await station.getByRole("tab", { name: `Carico ${String(i)}`, exact: true }).click();
    await station
      .locator(`[data-module-panel="acme.load${String(i)}.hello"]`)
      .waitFor({ state: "attached", timeout: 20_000 });
    switches.push(Date.now() - started);
  }
  const switching = await frameWatch(projector);

  // La ricerca con tutti i plugin attivi: tempo per aprirla e per trovare uno.
  const searchStarted = Date.now();
  await station.keyboard.press("Control+k");
  const palette = station.getByRole("dialog", { name: "Cerca e vai" });
  await expect(palette).toBeVisible();
  const opened = Date.now() - searchStarted;
  const typingStarted = Date.now();
  await station.keyboard.type("carico 9");
  await expect(palette.getByRole("option").first()).toContainText("Carico 9");
  const found = Date.now() - typingStarted;
  await station.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  // A riposo, con tutto aperto: quanto consuma.
  await projector.waitForTimeout(1000);
  await frameWatch(projector);
  const before = await sample(app);
  await projector.waitForTimeout(8000);
  const after = await sample(app);
  const resting = await frameWatch(projector);
  const cpuPercent = Math.round(((after.cpuSeconds - before.cpuSeconds) / 8) * 100);
  // Chi consuma cosa a riposo: per processo, memoria e CPU (in % di un core) nei 8 secondi.
  const byProcess = after.parts
    .map((part) => ({
      what: part.what,
      pid: part.pid,
      memoryMB: part.memoryMB,
      privateMB: part.privateMB,
      cpuPercent: Math.round(
        ((part.cpuSeconds - (before.parts.find((p) => p.pid === part.pid)?.cpuSeconds ?? 0)) / 8) *
          100,
      ),
    }))
    .sort((a, b) => b.privateMB - a.privateMB);
  // I plugin da soli (un processo ciascuno): quanto pesano e quanta CPU usano insieme.
  const plugins = byProcess.filter((part) => part.what === "plugin");
  const pluginPrivateMB = plugins.reduce((sum, part) => sum + part.privateMB, 0);
  const pluginCpuPercent = plugins.reduce((sum, part) => sum + part.cpuPercent, 0);

  const report = {
    plugins: COUNT,
    baseline: {
      processes: baseline.processes,
      memoryMB: baseline.memoryMB,
      privateMB: baseline.privateMB,
    },
    withPlugins: {
      processes: after.processes,
      memoryMB: after.memoryMB,
      privateMB: after.privateMB,
    },
    byProcess,
    perPluginPrivateMB: Math.round(pluginPrivateMB / Math.max(1, plugins.length)),
    allPluginsPrivateMB: pluginPrivateMB,
    allPluginsCpuPercent: pluginCpuPercent,
    restingCpuPercentOfOneCore: cpuPercent,
    tabSwitchMs: { median: median(switches), max: Math.max(...switches) },
    searchOpenMs: opened,
    searchFindMs: found,
    outputFrames: {
      idle: idleFrames,
      installing,
      switching,
      resting,
    },
  };
  writeFileSync(path.join(screenshotsDir, "carico.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log("CARICO", JSON.stringify(report));
  await station.screenshot({ path: path.join(screenshotsDir, "carico-12-plugin.png") });

  // Soglie larghe: servono a vedere un peggioramento vero, non a fare i conti al millisecondo.
  // Cambiando scheda e a riposo l'uscita resta fluida; installando un plugin puo' avere una pausa
  // fino a ~150 ms (limite noto, scritto nella decisione 0017): qui un margine esplicito, non un caso.
  const strict = Math.max(100, idleFrames.max * 2 + 50);
  for (const phase of [switching, resting]) {
    expect(phase.max).toBeLessThanOrEqual(strict);
    expect(phase.count).toBeGreaterThan(0);
  }
  expect(installing.max).toBeLessThanOrEqual(300);
  expect(installing.count).toBeGreaterThan(0);
  expect(report.tabSwitchMs.median).toBeLessThan(1500);
  expect(opened).toBeLessThan(800);
  expect(found).toBeLessThan(1500);
  // I plugin fermi non consumano: tutti e dodici insieme sotto il 5% di un core, e meno di 100 MB privati l'uno.
  expect(plugins).toHaveLength(COUNT);
  expect(pluginCpuPercent).toBeLessThan(5);
  expect(report.perPluginPrivateMB).toBeLessThan(100);
  expect(after.memoryMB).toBeLessThan(4096);
  expect(problems).toEqual([]);
});
