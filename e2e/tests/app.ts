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
  close(): Promise<void>;
}

/** Avvia Cuelith con un profilo nuovo e una porta libera, come al primo avvio. */
export async function launchApp(): Promise<RunningApp> {
  const userData = await mkdtemp(path.join(os.tmpdir(), "cuelith-e2e-"));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Farebbe partire Electron come semplice Node (lo impostano p.es. le estensioni di VS Code).
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") env[key] = value;
  }
  let app: ElectronApplication;
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: [desktopDir],
      env: { ...env, CUELITH_USER_DATA: userData, CUELITH_PORT: "0" },
    });
  } catch (error) {
    await rm(userData, { recursive: true, force: true });
    throw error;
  }
  const problems: string[] = [];
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
      if (url.hostname !== "127.0.0.1" && url.protocol !== "data:" && url.protocol !== "blob:") {
        problems.push(`richiesta esterna: ${request.url()}`);
      }
    });
  };
  app.on("window", watch);
  const station = await app.firstWindow();
  // La postazione puo' essere nata prima dell'ascoltatore: la si segue comunque.
  watch(station);
  return {
    app,
    station,
    problems,
    close: async () => {
      await app.close();
      await rm(userData, { recursive: true, force: true });
    },
  };
}

/** Ogni prova riceve la sua istanza di Cuelith, chiusa alla fine. */
export const test = base.extend<{ running: RunningApp }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright richiede la destrutturazione
  running: async ({}, use) => {
    const running = await launchApp();
    try {
      await use(running);
    } finally {
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
