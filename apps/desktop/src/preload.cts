// Preload delle finestre locali (postazione e uscite). Gira isolato e in
// sandbox: espone solo credenziali locali e scelta dei file, niente Node alla pagina.
import electron = require("electron");

electron.contextBridge.exposeInMainWorld("cuelithDesktop", {
  getLocalSession: (): Promise<unknown> => electron.ipcRenderer.invoke("cuelith:local-session"),
  chooseShowFile: (kind: unknown): Promise<unknown> =>
    electron.ipcRenderer.invoke("cuelith:choose-show-file", kind === "save" ? "save" : "open"),
  chooseModuleFile: (): Promise<unknown> =>
    electron.ipcRenderer.invoke("cuelith:choose-module-file"),
  openExternal: (url: unknown): Promise<unknown> =>
    electron.ipcRenderer.invoke("cuelith:open-external", typeof url === "string" ? url : ""),
  chooseMediaFiles: (kind: unknown): Promise<unknown> =>
    electron.ipcRenderer.invoke("cuelith:choose-media-files", kind === "image" ? "image" : "audio"),
});
