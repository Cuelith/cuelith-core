import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { consoleLogger, startEngine, type Engine } from "@cuelith-core/engine";
import { DEFAULT_ENGINE_PORT } from "@cuelith/protocol";
import { app, BrowserWindow, ipcMain, Menu, session } from "electron";
import { electronDisplays } from "./displays.js";
import { chooseMediaFiles, chooseShowFile, confirmUnsaved } from "./files.js";
import { OutputWindows } from "./outputs.js";
import { resolveAppPaths } from "./paths.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKGROUND = "#0B0C0E";

// Solo per sviluppo e test: profilo separato e porta scelta (0 = qualsiasi libera).
const userDataOverride = process.env["CUELITH_USER_DATA"];
if (userDataOverride !== undefined && userDataOverride !== "")
  app.setPath("userData", userDataOverride);
const portOverride = process.env["CUELITH_PORT"];
const autosaveOverride = process.env["CUELITH_AUTOSAVE_MS"];

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

async function launchEngine(): Promise<Engine> {
  const paths = resolveAppPaths({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  });
  const options = {
    version: app.getVersion(),
    paths: { ...paths, data: app.getPath("userData") },
    ...(autosaveOverride === undefined ? {} : { autosaveIntervalMs: Number(autosaveOverride) }),
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
  const origin = engineOrigin();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  const id = window.webContents.id;
  trusted.set(id, role);
  window.on("closed", () => trusted.delete(id));
}

function openStation(): BrowserWindow {
  const window = createWindow("station", {
    title: "Cuelith",
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
  void window.loadURL(`${engineOrigin()}/`);
  return window;
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

  station = openStation();
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
