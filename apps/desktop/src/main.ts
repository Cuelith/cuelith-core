import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { consoleLogger, startEngine, type Engine } from "@cuelith-core/engine";
import { DEFAULT_ENGINE_PORT, isOnAir } from "@cuelith/protocol";
import { app, BrowserWindow, ipcMain, Menu, session, shell } from "electron";
import electronUpdater from "electron-updater";
import { electronDisplays } from "./displays.js";
import {
  chooseMediaFiles,
  chooseModuleFile,
  chooseShowFile,
  confirmUnsaved,
  saveTextFile,
} from "./files.js";
import {
  loadInstallation,
  loadPreferences,
  resetInstallation,
  savePreferences,
  type Installation,
  type Preferences,
} from "./installation.js";
import { electronMetrics } from "./metrics.js";
import { OutputWindows } from "./outputs.js";
import { resolveAppPaths, type AppPaths } from "./paths.js";
import { folderFetch } from "./test-registry.js";
import { Updates, type Updater } from "./updates.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKGROUND = "#0B0C0E";

// Solo per sviluppo e test: profilo separato e porta scelta (0 = qualsiasi libera).
const userDataOverride = process.env["CUELITH_USER_DATA"];
if (userDataOverride !== undefined && userDataOverride !== "")
  app.setPath("userData", userDataOverride);
const portOverride = process.env["CUELITH_PORT"];
const autosaveOverride = process.env["CUELITH_AUTOSAVE_MS"];
const testRegistryDir = process.env["CUELITH_TEST_REGISTRY_DIR"];
// Prove sull'app impacchettata: niente controlli verso GitHub.
const updatesOff = process.env["CUELITH_UPDATES"] === "off";
// Prove delle postazioni in rete: porta qualsiasi e nessun annuncio in rete.
const lanPortOverride = process.env["CUELITH_LAN_PORT"];
const announceOff = process.env["CUELITH_ANNOUNCE"] === "off";

app.enableSandbox();

let engine: Engine | undefined;
let station: BrowserWindow | undefined;
let outputs: OutputWindows | undefined;
let updates: Updates | undefined;
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
    ...(lanPortOverride === undefined ? {} : { lanPort: Number(lanPortOverride) }),
    ...(announceOff ? { announce: false } : {}),
    metrics: electronMetrics({
      stationPid: () =>
        station === undefined || station.isDestroyed()
          ? undefined
          : station.webContents.getOSProcessId(),
      outputs: () => outputs?.processes() ?? [],
      frameCounters: () => outputs?.frameCounters() ?? Promise.resolve([]),
    }),
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
  // L'origine si controlla al momento: senza motore nessuna navigazione passa.
  window.webContents.on("will-navigate", (event, url) => {
    if (engine === undefined || new URL(url).origin !== engineOrigin()) event.preventDefault();
  });
  const id = window.webContents.id;
  trusted.set(id, role);
  window.on("closed", () => trusted.delete(id));
}

/** Icona della finestra e della barra delle applicazioni (originale 1024 px). */
const ICON = app.isPackaged
  ? path.join(app.getAppPath(), "build", "icon.png")
  : path.join(here, "..", "build", "icon.png");

/** Dimensioni della finestra di avvio (proporzioni del logo con un po' d'aria). */
const SPLASH = { width: 600, height: 340 };
/** Se l'interfaccia non si dichiara pronta, la postazione si mostra comunque. */
const STATION_READY_TIMEOUT_MS = 20_000;

let splash: BrowserWindow | undefined;

/**
 * Finestra di avvio: piccola, senza bordi, al centro dello schermo, col logo.
 * Compare subito, mentre partono motore e interfaccia; sparisce quando la
 * postazione e' pronta. Solo una pagina locale fissa: niente preload, niente
 * navigazione, nessuna credenziale.
 */
function openSplash(paths: AppPaths): BrowserWindow {
  const window = new BrowserWindow({
    ...SPLASH,
    title: "Cuelith",
    icon: ICON,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    show: false,
    backgroundColor: BACKGROUND,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  window.once("ready-to-show", () => {
    window.show();
  });
  window.on("closed", () => {
    splash = undefined;
    // Chiusa a mano prima che la postazione esista: si esce.
    if (station === undefined) app.quit();
  });
  void window.loadFile(path.join(paths.client, "splash.html"));
  return window;
}

/**
 * Finestre proprie dei pannelli dei moduli (gli editor), una per pannello.
 * Si preparano nascoste all'avvio (gia' collegate, col modulo caricato) e
 * chiudendole si nascondono: cosi' aprire un editor e' istantaneo.
 */
const panelWindows = new Map<string, BrowserWindow>();

/** Indirizzo di una finestra di pannello: della postazione, col pannello indicato. */
function panelUrl(path: string): { url: URL; panelId: string } {
  const url = new URL(path, engineOrigin());
  const panelId = url.searchParams.get("panelWindow");
  if (url.origin !== engineOrigin() || url.pathname !== "/" || panelId === null) {
    throw new Error("finestra non consentita");
  }
  return { url, panelId };
}

function createPanelWindow(panelId: string, url: URL): BrowserWindow {
  const window = createWindow("station", {
    title: "Cuelith",
    icon: ICON,
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
  });
  // Chiusa dall'operatore: si nasconde e prepara un editor pulito per la
  // prossima volta. Si chiude davvero solo quando esce Cuelith.
  window.on("close", (event) => {
    if (quitAllowed) return;
    event.preventDefault();
    window.hide();
    window.webContents.send("cuelith:panel-closed");
  });
  window.on("closed", () => {
    if (panelWindows.get(panelId) === window) panelWindows.delete(panelId);
  });
  panelWindows.set(panelId, window);
  void window.loadURL(url.href);
  return window;
}

/** Mostra la finestra di un pannello col contesto chiesto (es. il canto da modificare). */
function openPanelWindow(path: string): void {
  const { url, panelId } = panelUrl(path);
  const existing = panelWindows.get(panelId);
  if (existing !== undefined && !existing.isDestroyed()) {
    if (existing.webContents.isLoading()) {
      // Ancora in preparazione (appena avviato): si carica direttamente con la richiesta.
      void existing.loadURL(url.href);
      existing.show();
      existing.focus();
      return;
    }
    const raw = url.searchParams.get("context");
    let context: unknown;
    try {
      context = raw === null ? undefined : JSON.parse(raw);
    } catch {
      context = undefined;
    }
    existing.webContents.send("cuelith:panel-open", context ?? null);
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return;
  }
  const window = createPanelWindow(panelId, url);
  window.once("ready-to-show", () => {
    window.show();
  });
}

/**
 * Prepara (nascoste) le finestre degli editor dei moduli attivi e toglie
 * quelle dei moduli non piu' attivi.
 */
function preparePanelWindows(paths: readonly string[]): void {
  const wanted = new Map(paths.map((path) => [panelUrl(path).panelId, panelUrl(path).url]));
  for (const [panelId, window] of panelWindows) {
    if (!wanted.has(panelId) && !window.isDestroyed()) window.destroy();
  }
  for (const [panelId, url] of wanted) {
    const existing = panelWindows.get(panelId);
    if (existing === undefined || existing.isDestroyed()) createPanelWindow(panelId, url);
  }
}

/** Vero se la finestra di avvio e' stata chiusa prima che nascesse la postazione. */
function startupCancelled(): boolean {
  return splash === undefined && station === undefined;
}

/** La postazione pronta prende il posto della finestra di avvio. */
function revealStation(): void {
  if (station !== undefined && !station.isDestroyed() && !station.isVisible()) station.show();
  splash?.destroy();
}

/**
 * La postazione nasce nascosta dopo l'avvio del motore e si mostra quando
 * l'interfaccia e' collegata e disegnata (`stationReady`), al posto della
 * finestra di avvio.
 */
function openStation(): BrowserWindow {
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
  const fallback = setTimeout(revealStation, STATION_READY_TIMEOUT_MS);
  window.on("show", () => {
    clearTimeout(fallback);
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

  splash = openSplash(appPaths());
  engine = await launchEngine();

  ipcMain.handle("cuelith:open-panel-window", (event, path: unknown) => {
    if (trusted.get(event.sender.id) !== "station" || typeof path !== "string") {
      throw new Error("richiesta non autorizzata");
    }
    if (path.length > 4 * 1024 * 1024) throw new Error("contesto troppo grande");
    openPanelWindow(path);
  });

  ipcMain.handle("cuelith:prepare-panel-windows", (event, paths: unknown) => {
    if (
      trusted.get(event.sender.id) !== "station" ||
      !Array.isArray(paths) ||
      paths.length > 50 ||
      !paths.every((p): p is string => typeof p === "string" && p.length < 2048)
    ) {
      throw new Error("richiesta non autorizzata");
    }
    preparePanelWindows(paths);
  });

  // L'editor ha finito (Chiudi nel pannello): la sua finestra si nasconde.
  ipcMain.on("cuelith:hide-panel-window", (event) => {
    if (trusted.get(event.sender.id) !== "station") return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window !== null && [...panelWindows.values()].includes(window)) window.hide();
  });

  ipcMain.on("cuelith:station-ready", (event) => {
    if (trusted.get(event.sender.id) === "station") revealStation();
  });
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

  ipcMain.handle("cuelith:choose-module-file", async (event, kind: unknown) => {
    const role = trusted.get(event.sender.id);
    if (role !== "station" || station === undefined || engine === undefined) {
      throw new Error("richiesta non autorizzata");
    }
    return chooseModuleFile(station, engine, kind === "folder" ? "folder" : "file");
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

  registerAppInfo(engine);

  // Finestra di avvio chiusa a mano mentre partiva il motore: Cuelith sta uscendo.
  if (startupCancelled()) return;
  station = openStation();
  outputs = new OutputWindows({
    engine,
    origin: engineOrigin(),
    logger: consoleLogger,
    createWindow: (options) => createWindow("output", options),
  });
  outputs.start();
}

/**
 * Versione, licenza, ID di installazione e aggiornamenti (decisione 0004).
 * Gli aggiornamenti si scaricano da soli ma si installano solo su richiesta
 * dell'operatore, mai in onda, dopo aver chiesto se salvare.
 */
function registerAppInfo(running: Engine): void {
  const dir = app.getPath("userData");
  let installation: Installation | undefined;
  let preferences: Preferences | undefined;
  const ready = Promise.all([loadInstallation(dir), loadPreferences(dir)]).then(([i, p]) => {
    installation = i;
    preferences = p;
    const updater =
      app.isPackaged && !updatesOff
        ? (electronUpdater.autoUpdater as unknown as Updater)
        : undefined;
    updates = new Updates({
      updater,
      autoCheck: p.autoCheckUpdates,
      onChange: (state) => {
        station?.webContents.send("cuelith:update-state", state);
      },
      log: (message, error) => {
        consoleLogger.warn(message, error);
      },
    });
    updates.start();
  });
  const fromStation = (event: Electron.IpcMainInvokeEvent) => {
    if (trusted.get(event.sender.id) !== "station") throw new Error("richiesta non autorizzata");
  };

  ipcMain.handle("cuelith:app-info", async (event) => {
    fromStation(event);
    await ready;
    return {
      version: app.getVersion(),
      installationId: installation?.id,
      autoCheckUpdates: preferences?.autoCheckUpdates ?? true,
      update: updates?.state ?? { status: "unsupported" },
    };
  });

  ipcMain.handle("cuelith:set-auto-check", async (event, on: unknown) => {
    fromStation(event);
    await ready;
    preferences = { autoCheckUpdates: on === true };
    await savePreferences(dir, preferences);
    updates?.setAutoCheck(preferences.autoCheckUpdates);
  });

  ipcMain.handle("cuelith:reset-installation-id", async (event) => {
    fromStation(event);
    await ready;
    installation = await resetInstallation(dir);
    return installation.id;
  });

  ipcMain.handle("cuelith:update-check", async (event) => {
    fromStation(event);
    await ready;
    await updates?.check();
  });

  ipcMain.handle("cuelith:update-install", async (event) => {
    fromStation(event);
    await ready;
    if (updates?.state.status !== "ready") return "notReady";
    if (running.context.store.read(isOnAir)) return "onAir";
    if (station !== undefined && !(await confirmUnsaved(station, running))) return "cancelled";
    // Come una chiusura normale, poi l'installatore e il riavvio.
    quitAllowed = true;
    outputs?.stop();
    outputs = undefined;
    updates.stop();
    if (engine !== undefined) {
      const stopping = engine;
      engine = undefined;
      await stopping.stop().catch((error: unknown) => {
        consoleLogger.error("arresto del motore non riuscito", error);
      });
    }
    updates.install();
    return "installing";
  });
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
