import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { consoleLogger, startEngine, type Engine } from "@cuelith-core/engine";
import { DEFAULT_ENGINE_PORT } from "@cuelith/protocol";
import { app, BrowserWindow, ipcMain, Menu, session, shell } from "electron";
import { electronDisplays } from "./displays.js";
import {
  chooseMediaFiles,
  chooseModuleFile,
  chooseShowFile,
  confirmUnsaved,
  saveTextFile,
} from "./files.js";
import { OutputWindows } from "./outputs.js";
import { resolveAppPaths, type AppPaths } from "./paths.js";
import { folderFetch } from "./test-registry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKGROUND = "#0B0C0E";

// Solo per sviluppo e test: profilo separato e porta scelta (0 = qualsiasi libera).
const userDataOverride = process.env["CUELITH_USER_DATA"];
if (userDataOverride !== undefined && userDataOverride !== "")
  app.setPath("userData", userDataOverride);
const portOverride = process.env["CUELITH_PORT"];
const autosaveOverride = process.env["CUELITH_AUTOSAVE_MS"];
const testRegistryDir = process.env["CUELITH_TEST_REGISTRY_DIR"];

app.enableSandbox();

let engine: Engine | undefined;
let station: BrowserWindow | undefined;
let outputs: OutputWindows | undefined;
/**
 * Finestre locali a cui si consegnano le credenziali: la postazione riceve
 * quelle di regia, le uscite quelle di sola lettura.
 */
const trusted = new Map<number, "station" | "output">();

function engineOrigin(): string {
  if (engine === undefined) throw new Error("motore non avviato");
  return `http://${engine.host}:${engine.port}`;
}

function appPaths(): AppPaths {
  return resolveAppPaths({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  });
}

async function launchEngine(): Promise<Engine> {
  const paths = appPaths();
  const options = {
    version: app.getVersion(),
    paths: { ...paths, data: app.getPath("userData") },
    ...(autosaveOverride === undefined ? {} : { autosaveIntervalMs: Number(autosaveOverride) }),
    ...(testRegistryDir === undefined ? {} : { fetch: folderFetch(testRegistryDir) }),
    displays: electronDisplays,
    logger: consoleLogger,
  };
  const wanted = portOverride === undefined ? DEFAULT_ENGINE_PORT : Number(portOverride);
  try {
    return await startEngine({ ...options, port: wanted });
  } catch (error) {
    // La porta e' occupata da un altro programma: la postazione locale funziona
    // su qualsiasi porta, quella fissa serve solo alle postazioni in rete.
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || wanted === 0) throw error;
    consoleLogger.warn(`porta ${wanted} occupata, uso una porta libera`);
    return startEngine({ ...options, port: 0 });
  }
}

/** Finestra con le preferenze sicure comuni, registrata col suo ruolo. */
function createWindow(
  role: "station" | "output",
  options: Electron.BrowserWindowConstructorOptions,
): BrowserWindow {
  const window = new BrowserWindow({
    ...options,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // Le uscite devono disegnare a 60 fps anche quando non hanno il fuoco.
      backgroundThrottling: role === "station",
    },
  });
  lockDown(window, role);
  return window;
}

function lockDown(window: BrowserWindow, role: "station" | "output"): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // La postazione nasce prima del motore (schermata di avvio): l'origine si
  // controlla al momento; finche' il motore non c'e' nessuna navigazione passa.
  window.webContents.on("will-navigate", (event, url) => {
    if (engine === undefined || new URL(url).origin !== engineOrigin()) event.preventDefault();
  });
  const id = window.webContents.id;
  trusted.set(id, role);
  window.on("closed", () => trusted.delete(id));
}

/** Icona della finestra e della barra delle applicazioni (originale 1024 px). */
const ICON = path.join(here, "..", "build", "icon.png");

/**
 * La postazione si apre subito con la schermata di avvio (logo), mentre parte
 * il motore; poi `showStation` carica l'interfaccia, che mostra la stessa
 * schermata finche' non e' collegata.
 */
function openStation(paths: AppPaths): BrowserWindow {
  const window = createWindow("station", {
    title: "Cuelith",
    icon: ICON,
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
  });
  window.once("ready-to-show", () => {
    window.show();
  });
  // La postazione e' il programma: chiuderla chiude Cuelith (dopo aver chiesto
  // se salvare le modifiche).
  window.on("close", (event) => {
    if (quitAllowed) return;
    event.preventDefault();
    void requestQuit();
  });
  window.on("closed", () => {
    station = undefined;
  });
  void window.loadFile(path.join(paths.client, "splash.html"));
  return window;
}

function showStation(window: BrowserWindow): void {
  void window.loadURL(`${engineOrigin()}/`);
}

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    if (station === undefined) return;
    if (station.isMinimized()) station.restore();
    station.focus();
  });

  await app.whenReady();
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });

  const window = openStation(appPaths());
  station = window;
  engine = await launchEngine();
  const tokens = engine.tokens;

  ipcMain.handle("cuelith:local-session", (event) => {
    const frameUrl = event.senderFrame?.url ?? "";
    const role = trusted.get(event.sender.id);
    if (role === undefined || !frameUrl.startsWith(`${engineOrigin()}/`)) {
      throw new Error("richiesta non autorizzata");
    }
    return { name: os.hostname(), token: role === "station" ? tokens.station : tokens.renderer };
  });

  ipcMain.handle("cuelith:choose-show-file", async (event, kind: unknown) => {
    const role = trusted.get(event.sender.id);
    if (role !== "station" || station === undefined || engine === undefined) {
      throw new Error("richiesta non autorizzata");
    }
    return chooseShowFile(station, engine, kind === "save" ? "save" : "open");
  });

  ipcMain.handle("cuelith:choose-media-files", async (event, kind: unknown) => {
    const role = trusted.get(event.sender.id);
    if (role !== "station" || station === undefined || engine === undefined) {
      throw new Error("richiesta non autorizzata");
    }
    return chooseMediaFiles(station, engine, kind === "image" ? "image" : "audio");
  });

  ipcMain.handle("cuelith:save-text-file", async (event, name: unknown, content: unknown) => {
    const role = trusted.get(event.sender.id);
    if (role !== "station" || station === undefined || engine === undefined) {
      throw new Error("richiesta non autorizzata");
    }
    if (typeof name !== "string" || typeof content !== "string") throw new Error("dati non validi");
    await saveTextFile(station, engine, name, content);
  });

  ipcMain.handle("cuelith:choose-module-file", async (event) => {
    const role = trusted.get(event.sender.id);
    if (role !== "station" || station === undefined || engine === undefined) {
      throw new Error("richiesta non autorizzata");
    }
    return chooseModuleFile(station, engine);
  });

  // Documentazione dei moduli nel browser del sistema: solo indirizzi https.
  ipcMain.handle("cuelith:open-external", async (event, url: unknown) => {
    if (trusted.get(event.sender.id) !== "station" || typeof url !== "string") {
      throw new Error("richiesta non autorizzata");
    }
    const parsed = URL.canParse(url) ? new URL(url) : undefined;
    if (parsed?.protocol !== "https:") throw new Error("indirizzo non consentito");
    await shell.openExternal(parsed.href);
  });

  // Chiusa durante l'avvio: Cuelith sta gia' uscendo.
  if (!window.isDestroyed()) showStation(window);
  outputs = new OutputWindows({
    engine,
    origin: engineOrigin(),
    logger: consoleLogger,
    createWindow: (options) => createWindow("output", options),
  });
  outputs.start();
}

/** Vero quando la chiusura e' confermata: da li' nessuna finestra la blocca. */
let quitAllowed = false;
let quitRequested = false;

/**
 * Chiusura di Cuelith da qualsiasi parte (finestra, menu, sistema): prima si
 * chiede se salvare; poi si distruggono le uscite, che non si chiudono a mano
 * (closable: false) e altrimenti bloccherebbero la chiusura.
 */
async function requestQuit(): Promise<void> {
  if (quitRequested) return;
  quitRequested = true;
  try {
    const proceed =
      station === undefined || engine === undefined ? true : await confirmUnsaved(station, engine);
    if (!proceed) return;
    quitAllowed = true;
    outputs?.stop();
    outputs = undefined;
    app.quit();
  } finally {
    quitRequested = false;
  }
}

app.on("before-quit", (event) => {
  if (quitAllowed) return;
  event.preventDefault();
  void requestQuit();
});

let stopping = false;
app.on("will-quit", (event) => {
  if (engine === undefined || stopping) return;
  stopping = true;
  event.preventDefault();
  const running = engine;
  engine = undefined;
  running
    .stop()
    .catch((error: unknown) => {
      consoleLogger.error("arresto del motore non riuscito", error);
    })
    .finally(() => {
      app.quit();
    });
});

main().catch((error: unknown) => {
  consoleLogger.error("avvio non riuscito", error);
  app.exit(1);
});
