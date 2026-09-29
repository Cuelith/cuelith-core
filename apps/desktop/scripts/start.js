// Avvia l'app in sviluppo. Toglie ELECTRON_RUN_AS_NODE, che alcuni ambienti
// (per esempio i processi lanciati dalle estensioni di VS Code) impostano e
// che farebbe partire Electron come semplice Node.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
/** @type {string} */
const electron = require("electron");
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [appDir, ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("close", (code, signal) => {
  process.exit(code ?? (signal === null ? 0 : 1));
});
