// Preload delle finestre locali (postazione). Gira isolato e in sandbox:
// espone solo la richiesta delle credenziali locali, niente Node alla pagina.
import electron = require("electron");

electron.contextBridge.exposeInMainWorld("cuelithDesktop", {
  getLocalSession: (): Promise<unknown> => electron.ipcRenderer.invoke("cuelith:local-session"),
});
