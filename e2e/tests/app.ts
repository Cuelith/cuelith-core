import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
export const desktopDir = path.resolve(here, "../../apps/desktop");
/** L'eseguibile di Electron installato con l'app desktop. */
const electronPath = createRequire(path.join(desktopDir, "package.json"))("electron") as string;
export const screenshotsDir = path.resolve(here, "../screenshots");

export interface RunningApp {
  readonly app: ElectronApplication;
  readonly station: Page;
  /** Messaggi di errore della console e richieste verso host esterni. */
  readonly problems: string[];
  /** Righe scritte dal processo principale (log del motore), per capire un errore. */
  readonly logs: string[];
  /** Cartella dati dell'app (profilo): riusabile per simulare un riavvio. */
  readonly userData: string;
  /** Chiusura normale; se ci sono modifiche non salvate risponde "Non salvare". */
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** Profilo da riusare (riavvio); se assente se ne crea uno nuovo. */
  readonly userData?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** Avvia Cuelith con un profilo nuovo e una porta libera, come al primo avvio. */
export async function launchApp(options: LaunchOptions = {}): Promise<RunningApp> {
  const userData = options.userData ?? (await mkdtemp(path.join(os.tmpdir(), "cuelith-e2e-")));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Farebbe partire Electron come semplice Node (lo impostano p.es. le estensioni di VS Code).
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") env[key] = value;
  }
  let app: ElectronApplication;
  try {
    // CUELITH_E2E_EXECUTABLE: prova l'app impacchettata (es. win-unpacked/Cuelith.exe).
    const packaged = process.env.CUELITH_E2E_EXECUTABLE;
    app = await electron.launch({
      executablePath: packaged ?? electronPath,
      args: packaged === undefined ? [desktopDir] : [],
      env: {
        ...env,
        ...options.env,
        CUELITH_USER_DATA: userData,
        CUELITH_PORT: "0",
        // L'app impacchettata nelle prove non controlla gli aggiornamenti su GitHub.
        CUELITH_UPDATES: "off",
        // Postazioni in rete: porta qualsiasi e nessun annuncio (prove in parallelo, CI).
        CUELITH_LAN_PORT: "0",
        CUELITH_ANNOUNCE: "off",
      },
    });
  } catch (error) {
    await rm(userData, { recursive: true, force: true });
    throw error;
  }
  const problems: string[] = [];
  const logs: string[] = [];
  const collect = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.trim() !== "") logs.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
    }
  };
  app.process().stdout?.on("data", collect);
  app.process().stderr?.on("data", collect);
  // Ogni finestra (postazione e uscite): errori in console e richieste verso l'esterno.
  const watched = new WeakSet<Page>();
  const watch = (page: Page) => {
    if (watched.has(page)) return;
    watched.add(page);
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pagina: ${error.message}`));
    page.on("request", (request) => {
      const url = new URL(request.url());
      // file: = la schermata di avvio, locale, mostrata mentre parte il motore.
      const local = ["data:", "blob:", "file:"].includes(url.protocol);
      if (url.hostname !== "127.0.0.1" && !local) {
        problems.push(`richiesta esterna: ${request.url()}`);
      }
    });
  };
  app.on("window", watch);
  // La prima finestra e' quella di avvio (pagina locale): la postazione e' la
  // finestra servita dal motore.
  const isStation = (page: Page) => page.url().startsWith("http://127.0.0.1");
  const station =
    app.windows().find(isStation) ??
    (await app.waitForEvent("window", { predicate: isStation, timeout: 30_000 }));
  // La postazione puo' essere nata prima dell'ascoltatore: la si segue comunque.
  watch(station);
  return {
    app,
    station,
    problems,
    logs,
    userData,
    close: async () => {
      // Se l'app e' gia' uscita (es. prova di arresto) non c'e' nulla da chiedere.
      await answerQuestions(app, "Non salvare").catch(() => undefined);
      await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

/** Ogni prova riceve la sua istanza di Cuelith, chiusa alla fine. */
export const test = base.extend<{ running: RunningApp }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright richiede la destrutturazione
  running: async ({}, use, testInfo) => {
    const running = await launchApp();
    try {
      await use(running);
    } finally {
      // Prova fallita: il log del motore va negli allegati (e nell'output con CUELITH_E2E_LOG=1).
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("log-motore.txt", { body: running.logs.join("\n") });
        if (process.env.CUELITH_E2E_LOG === "1") console.log(running.logs.slice(-80).join("\n"));
      }
      await running.close();
    }
  },
});

/** Crea un testo dalla scaletta e aspetta che l'editor si chiuda. */
export async function createText(station: Page, title: string, slides: string[]): Promise<void> {
  await station.getByRole("button", { name: "+ Testo" }).click();
  const editor = station.getByRole("dialog", { name: "Nuovo testo" });
  await editor.getByLabel("Titolo").fill(title);
  await editor.getByLabel("Testo").fill(slides.join("\n\n"));
  await editor.getByRole("button", { name: "Salva" }).click();
  await expect(editor).toBeHidden();
}

/**
 * Le finestre native (domande, Apri, Salva) non si possono cliccare dalle
 * prove: si sostituiscono nel processo principale con risposte decise qui.
 * Le domande ricevute si leggono con asked().
 */
export async function answerQuestions(app: ElectronApplication, button: string): Promise<void> {
  await app.evaluate(({ dialog }, label) => {
    const asked: string[] = [];
    (globalThis as unknown as { asked: string[] }).asked = asked;
    dialog.showMessageBox = (...args: unknown[]) => {
      const options = args[args.length - 1] as { message: string; buttons?: string[] };
      asked.push(options.message);
      const index = options.buttons?.indexOf(label) ?? -1;
      return Promise.resolve({ response: Math.max(0, index), checkboxChecked: false });
    };
  }, button);
}

export async function asked(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { asked?: string[] }).asked ?? []);
}

/** Le finestre Apri e Salva rispondono con questo percorso (o annullano se undefined). */
export async function chooseFiles(
  app: ElectronApplication,
  filePath: string | undefined,
): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showSaveDialog = () =>
      Promise.resolve(
        chosen === undefined
          ? { canceled: true, filePath: "" }
          : { canceled: false, filePath: chosen },
      );
    dialog.showOpenDialog = () =>
      Promise.resolve({
        canceled: chosen === undefined,
        filePaths: chosen === undefined ? [] : [chosen],
      });
  }, filePath);
}

/** Vero se la finestra propria del pannello (es. l'editor dei canti) e' visibile. */
export function panelWindowVisible(app: ElectronApplication, panelId: string): Promise<boolean> {
  return app.evaluate(
    ({ BrowserWindow }, id) =>
      BrowserWindow.getAllWindows().some(
        (w) => w.isVisible() && w.webContents.getURL().includes(`panelWindow=${id}`),
      ),
    panelId,
  );
}

/**
 * La finestra propria di un pannello: le finestre degli editor sono preparate
 * in anticipo (nascoste) e si mostrano alla richiesta.
 */
export async function shownPanelWindow(app: ElectronApplication, panelId: string): Promise<Page> {
  await expect.poll(() => panelWindowVisible(app, panelId), { timeout: 6000 }).toBe(true);
  const page = app.windows().find((w) => w.url().includes(`panelWindow=${panelId}`));
  if (page === undefined) throw new Error(`finestra del pannello ${panelId} mancante`);
  return page;
}

/** Aggiunge un'uscita in finestra (in prova c'e' un solo monitor) col look scelto. */
export async function addOutput(station: Page, name: string, look: string): Promise<void> {
  const bar = station.getByRole("group", { name: "Uscite" }).first();
  await bar.getByRole("button", { name: /Aggiungi uscita|Uscite…/ }).click();
  const dialog = station.getByRole("dialog", { name: "Uscite" });
  await dialog.getByRole("button", { name: "+ Aggiungi uscita" }).click();
  const form = dialog.getByRole("form", { name: "Aggiungi uscita" });
  await form.getByLabel("Nome").fill(name);
  await form.getByLabel("Finestra").check();
  await form.getByLabel("Look").selectOption({ label: look });
  await form.getByRole("button", { name: "Salva" }).click();
  await expect(dialog.getByRole("listitem").filter({ hasText: name })).toBeVisible();
  await dialog.getByRole("button", { name: "Chiudi" }).click();
  await expect(dialog).toBeHidden();
}

/** La finestra di un'uscita, trovata dall'id che la postazione mostra nella barra. */
export async function outputWindow(running: RunningApp, name: string): Promise<Page> {
  const id = await running.station
    .getByRole("group", { name, exact: true })
    .getAttribute("data-output");
  if (id === null) throw new Error(`uscita ${name} non trovata`);
  await expect
    .poll(() => running.app.windows().some((w) => w.url().includes(`output=${id}`)))
    .toBe(true);
  const window = running.app.windows().find((w) => w.url().includes(`output=${id}`));
  if (window === undefined) throw new Error(`finestra di ${name} non trovata`);
  await expect(window.locator("body")).toHaveAttribute("data-state", "ready");
  return window;
}

export interface BrowserStation {
  readonly page: Page;
  /** Errori in console e richieste verso host diversi dal motore. */
  readonly problems: string[];
  close(): Promise<void>;
}

/**
 * Apre un indirizzo come farebbe un altro dispositivo in rete (tablet,
 * telefono): un browser senza nulla di Cuelith (e2e/browser), con un
 * profilo suo.
 */
export async function launchBrowser(
  url: string,
  size: { width: number; height: number } = { width: 1280, height: 800 },
): Promise<BrowserStation> {
  const userData = await mkdtemp(path.join(os.tmpdir(), "cuelith-browser-"));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") env[key] = value;
  }
  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.resolve(here, "../browser")],
    env: {
      ...env,
      CUELITH_BROWSER_PROFILE: userData,
      CUELITH_BROWSER_URL: url,
      CUELITH_BROWSER_SIZE: `${String(size.width)}x${String(size.height)}`,
    },
  });
  const page = await app.firstWindow();
  const host = new URL(url).hostname;
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pagina: ${error.message}`));
  page.on("request", (request) => {
    const target = new URL(request.url());
    if (target.hostname !== host && !["data:", "blob:"].includes(target.protocol)) {
      problems.push(`richiesta esterna: ${request.url()}`);
    }
  });
  return {
    page,
    problems,
    close: async () => {
      await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}
