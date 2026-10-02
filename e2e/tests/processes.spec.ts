import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import { addOutput, chooseFiles, createText, outputWindow, screenshotsDir, test } from "./app.js";

/**
 * Il modulo d'esempio hello-panel (repo affiancato plugin-template, costruito
 * con `pnpm build`): si installa dalla sua cartella, come fa chi sviluppa.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, "../../../plugin-template");
const built = existsSync(path.join(templateDir, "dist", "main.mjs"));

/** Pid del processo del modulo: un figlio del processo principale di Electron. */
async function modulePid(app: ElectronApplication, match: string): Promise<number | undefined> {
  const parent = await app.evaluate(() => process.pid);
  const lines =
    process.platform === "win32"
      ? execFileSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `Get-CimInstance Win32_Process -Filter "ParentProcessId=${String(parent)}" | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`,
          ],
          { encoding: "utf8" },
        )
      : execFileSync("ps", ["-o", "pid=,args=", "--ppid", String(parent)], { encoding: "utf8" });
  const line = lines
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.includes(match));
  return line === undefined ? undefined : Number(line.split(" ")[0]);
}

/** Registra i fotogrammi dell'uscita: pausa massima tra due fotogrammi e conteggio. */
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

const painted = (output: Page) =>
  output.evaluate(
    () =>
      (window as unknown as { cuelithOutput?: { stats: { frames: number } } }).cuelithOutput?.stats
        .frames ?? 0,
  );

// Criteri 7 e 8 del cap. 28: il modulo d'esempio si installa da cartella,
// aggiunge un pannello e un comando, si spegne e si riaccende senza fermare le
// uscite; il suo processo viene terminato durante la proiezione e l'uscita non
// perde fotogrammi.
test("hello-panel: processo separato, comando, riavvio dopo un crash, le uscite non cadono", async ({
  running,
}) => {
  test.skip(!built, "plugin-template non costruito (pnpm build nel repo affiancato)");
  test.setTimeout(120_000);
  const { app, station, problems } = running;

  // In onda una slide su un'uscita.
  await createText(station, "Luce del mattino", ["Vieni su di noi", "Resta con noi"]);
  await addOutput(station, "Proiettore", "Sala");
  const projector = await outputWindow(running, "Proiettore");
  await station.keyboard.press("Enter");
  const body = projector.locator("body");
  await expect(body).toHaveAttribute("data-text", "Vieni su di noi");

  // Rete accesa: lo stato ha un campo in piu' (live.network). I pannelli dei
  // moduli devono partire lo stesso, anche se costruiti con un protocollo piu'
  // vecchio: non controllano lo stato in modo rigido (compatibilita' in avanti).
  await station.getByRole("button", { name: /^Impostazioni/ }).click();
  const settings = station.getByRole("dialog", { name: "Impostazioni" });
  await settings.getByRole("button", { name: "Rete e postazioni" }).click();
  await settings.getByRole("switch", { name: "Consenti altre postazioni in rete locale" }).click();
  await expect(settings.getByTestId("network-url")).toBeVisible();
  await settings.getByRole("button", { name: "Chiudi" }).last().click();

  // Installazione dalla cartella del modulo.
  await chooseFiles(app, templateDir);
  await station.getByRole("button", { name: "Aggiungi moduli" }).click();
  const modules = station.getByRole("dialog", { name: "Moduli" });
  await modules.getByRole("tab", { name: "Installati" }).click();
  await modules.getByRole("button", { name: "Installa da cartella…" }).click();
  const row = modules
    .getByRole("list", { name: "Installati" })
    .getByRole("listitem")
    .filter({ hasText: "Ciao" });
  await expect(row).toContainText("Attivo");
  await modules.getByRole("button", { name: "Chiudi" }).click();

  // Il pannello chiama il comando, eseguito nel processo del modulo.
  const dock = station.getByRole("navigation", { name: "Moduli" });
  await dock.getByRole("button", { name: "Ciao", exact: true }).click();
  const panel = station.frameLocator('[data-module-panel="cuelith.hello.hello"]');
  const status = panel.getByRole("status");
  const greet = async (name: string, count: number) => {
    await expect(async () => {
      await panel.getByLabel("Nome").fill(name);
      await panel.getByRole("button", { name: "Saluta" }).click();
      await expect(status).toHaveText(`Saluti inviati: ${String(count)}`, { timeout: 2000 });
    }).toPass({ timeout: 20_000 });
  };
  // Il pannello riceve i suoi testi quando la postazione lo collega: su un
  // computer carico puo' volerci qualche secondo.
  await expect(panel.getByRole("button", { name: "Saluta" })).toBeVisible({ timeout: 30_000 });
  await greet("Anna", 1);
  await station.getByRole("tab", { name: "Scaletta", exact: true }).click();
  await expect(station.getByRole("list", { name: "Voci della scaletta" })).toContainText(
    "Saluto a Anna",
  );
  await dock.getByRole("button", { name: "Ciao", exact: true }).click();
  const pid = await modulePid(app, "cuelith.hello");
  expect(pid).toBeDefined();

  // Il processo del modulo viene ucciso mentre l'uscita proietta.
  await startFrameWatch(projector);
  await projector.waitForTimeout(1500);
  const before = await frameWatch(projector);
  const paintedBefore = await painted(projector);
  process.kill(pid ?? 0, "SIGKILL");
  await projector.waitForTimeout(2500);
  const during = await frameWatch(projector);
  // L'uscita ha continuato a disegnare, senza pause oltre il normale.
  expect(during.count).toBeGreaterThan(before.count * 0.8);
  expect(during.max).toBeLessThanOrEqual(Math.max(150, before.max * 2 + 50));
  expect(await painted(projector)).toBeGreaterThan(paintedBefore);
  await expect(body).toHaveAttribute("data-text", "Vieni su di noi");
  await expect(body).toHaveAttribute("data-blackout", "false");

  // Il motore lo ha riavviato: nuovo processo, stesso spazio dati.
  await expect.poll(() => modulePid(app, "cuelith.hello"), { timeout: 15_000 }).not.toBe(pid);
  await greet("Bruno", 2);

  // Spento e riacceso a caldo: le uscite non si fermano.
  await startFrameWatch(projector);
  await station.getByRole("button", { name: "Aggiungi moduli" }).click();
  await modules.getByRole("tab", { name: "Installati" }).click();
  const toggle = row.getByRole("switch", { name: "Attiva Ciao" });
  // L'interruttore cambia quando il motore conferma: si clicca e si attende.
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(row).toContainText("Disattivato");
  await expect(dock.getByRole("button", { name: "Ciao", exact: true })).toHaveCount(0);
  await expect.poll(() => modulePid(app, "cuelith.hello"), { timeout: 10_000 }).toBeUndefined();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(row).toContainText("Attivo");
  await modules.getByRole("button", { name: "Chiudi" }).click();
  const toggled = await frameWatch(projector);
  expect(toggled.max).toBeLessThanOrEqual(Math.max(150, before.max * 2 + 50));
  await expect(body).toHaveAttribute("data-text", "Vieni su di noi");
  await dock.getByRole("button", { name: "Ciao", exact: true }).click();
  await greet("Carla", 3);

  await station.screenshot({ path: path.join(screenshotsDir, "modulo-processo.png") });
  expect(problems).toEqual([]);
});
