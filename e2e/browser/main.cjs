// Un browser qualunque per le prove delle postazioni in rete: Electron senza
// preload e senza nulla di Cuelith, che apre un indirizzo. Cosi' la pagina e'
// quella che vedrebbe un tablet o un telefono, senza scaricare un altro browser.
const { app, BrowserWindow } = require("electron");

const { CUELITH_BROWSER_URL, CUELITH_BROWSER_SIZE, CUELITH_BROWSER_PROFILE } = process.env;
const [width, height] = (CUELITH_BROWSER_SIZE || "1280x800").split("x").map(Number);
app.setPath("userData", CUELITH_BROWSER_PROFILE);
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width,
    height,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  void window.loadURL(CUELITH_BROWSER_URL);
});
app.on("window-all-closed", () => {
  app.quit();
});
