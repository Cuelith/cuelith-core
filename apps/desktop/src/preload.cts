// Preload delle finestre locali (postazione e uscite). Gira isolato e in
// sandbox: espone solo credenziali locali e scelta dei file, niente Node alla pagina.
import electron = require("electron");

electron.contextBridge.exposeInMainWorld("cuelithDesktop", {
  getLocalSession: (): Promise<unknown> => electron.ipcRenderer.invoke("cuelith:local-session"),
  chooseShowFile: (kind: unknown): Promise<unknown> =>
    electron.ipcRenderer.invoke("cuelith:choose-show-file", kind === "save" ? "save" : "open"),
  saveTextFile: (name: unknown, content: unknown): Promise<unknown> =>
    electron.ipcRenderer.invoke(
      "cuelith:save-text-file",
      typeof name === "string" ? name : "file.txt",
      typeof content === "string" ? content : "",
    ),
  chooseModuleFile: (kind: unknown): Promise<unknown> =>
    electron.ipcRenderer.invoke(
      "cuelith:choose-module-file",
      kind === "folder" ? "folder" : "file",
    ),
  openExternal: (url: unknown): Promise<unknown> =>
    electron.ipcRenderer.invoke("cuelith:open-external", typeof url === "string" ? url : ""),
  chooseMediaFiles: (kind: unknown): Promise<unknown> =>
    electron.ipcRenderer.invoke("cuelith:choose-media-files", kind === "image" ? "image" : "audio"),
  /** L'interfaccia e' pronta: la finestra di avvio lascia il posto alla postazione. */
  stationReady: (): void => {
    electron.ipcRenderer.send("cuelith:station-ready");
  },
  /** Finestra propria di un pannello di modulo (es. l'editor dei canti). */
  openPanelWindow: (path: unknown): Promise<unknown> =>
    electron.ipcRenderer.invoke("cuelith:open-panel-window", typeof path === "string" ? path : ""),
  /** Prepara nascoste le finestre degli editor dei moduli attivi (apertura istantanea). */
  preparePanelWindows: (paths: unknown): Promise<unknown> =>
    electron.ipcRenderer.invoke(
      "cuelith:prepare-panel-windows",
      Array.isArray(paths) ? paths.filter((p) => typeof p === "string") : [],
    ),
  /** Nasconde questa finestra di pannello (l'editor ha finito). */
  hidePanelWindow: (): void => {
    electron.ipcRenderer.send("cuelith:hide-panel-window");
  },
  /** Richieste per questa finestra di pannello: apri col contesto, oppure chiusa. */
  onPanelEvents: (handlers: {
    open: (context: unknown) => void;
    closed: () => void;
  }): (() => void) => {
    const open = (_event: unknown, context: unknown) => {
      handlers.open(context);
    };
    const closed = () => {
      handlers.closed();
    };
    electron.ipcRenderer.on("cuelith:panel-open", open);
    electron.ipcRenderer.on("cuelith:panel-closed", closed);
    return () => {
      electron.ipcRenderer.off("cuelith:panel-open", open);
      electron.ipcRenderer.off("cuelith:panel-closed", closed);
    };
  },
});
