import { existsSync } from "node:fs";
import { join } from "node:path";
import { networkAllowance, type PluginManifest } from "@cuelith/protocol";

/** Come avviare il processo di un modulo. */
export interface SpawnSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

/**
 * L'eseguibile che fa da Node per i moduli: dentro Electron e' Electron
 * stesso con ELECTRON_RUN_AS_NODE=1 (il "fuse" RunAsNode deve restare
 * acceso nei pacchetti), nelle prove il Node che le esegue.
 */
export interface NodeRuntime {
  readonly execPath: string;
  readonly env: Readonly<Record<string, string>>;
}

export const defaultNodeRuntime = (): NodeRuntime => ({
  execPath: process.execPath,
  env: { ELECTRON_RUN_AS_NODE: "1" },
});

/** Piattaforma nel formato del manifest (runtime.bin). */
export function nativePlatform(): string {
  const os = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
  return `${os}-${process.arch}`;
}

/** Memoria massima di un modulo Node: uno che perde memoria non ferma il computer. */
const MAX_HEAP_MB = 1024;

/** Variabili di sistema che servono per partire, e nient'altro dell'ambiente del motore. */
function systemEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["SystemRoot", "SYSTEMROOT", "windir", "TEMP", "TMP", "TMPDIR", "LANG"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export class SpawnError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(key);
    this.key = key;
  }
}

/**
 * Comando per avviare un modulo (cap. 21 e 27, decisione 0007).
 *
 * Moduli Node: modello dei permessi di Node. Il processo legge solo la
 * cartella del modulo e scrive solo nella sua cartella privata; processi
 * figli, worker e addon nativi sono bloccati salvo i permessi process e
 * addons; fs:read e fs:write aprono tutto il disco. La rete non e' coperta
 * dai permessi di Node 24: la chiude il controllo caricato prima del codice
 * del modulo (networkGuardSource), secondo i permessi network.
 *
 * Moduli nativi: programmi del sistema, non si possono chiudere in un
 * recinto. Per questo dichiarano il permesso "native", mostrato all'utente.
 */
export function spawnSpec(
  manifest: PluginManifest,
  moduleDir: string,
  dataDir: string,
  guardFile: string,
  runtime: NodeRuntime,
): SpawnSpec {
  const base = { ...systemEnv(), CUELITH_PLUGIN: "1" };
  if (manifest.runtime.type === "native") {
    const bin = manifest.runtime.bin[nativePlatform() as keyof typeof manifest.runtime.bin];
    if (bin === undefined) throw new SpawnError("core.module.platformUnsupported");
    const command = join(moduleDir, bin);
    if (!existsSync(command)) throw new SpawnError("core.module.entryMissing");
    const path = process.env.PATH;
    return {
      command,
      args: [],
      env: { ...base, ...(path === undefined ? {} : { PATH: path }), CUELITH_DATA_DIR: dataDir },
      cwd: moduleDir,
    };
  }
  if (manifest.runtime.type !== "node") throw new SpawnError("core.module.noRuntime");

  const entry = join(moduleDir, manifest.runtime.entry);
  if (!existsSync(entry)) throw new SpawnError("core.module.entryMissing");
  const permissions = manifest.permissions;
  const network = networkAllowance(permissions);
  const args = [
    "--permission",
    `--allow-fs-read=${moduleDir}`,
    `--allow-fs-read=${guardFile}`,
    `--allow-fs-read=${dataDir}`,
    `--allow-fs-write=${dataDir}`,
    ...(permissions.includes("fs:read") ? ["--allow-fs-read=*"] : []),
    ...(permissions.includes("fs:write") ? ["--allow-fs-write=*"] : []),
    ...(permissions.includes("process") ? ["--allow-child-process"] : []),
    ...(permissions.includes("addons") ? ["--allow-addons"] : []),
    `--max-old-space-size=${MAX_HEAP_MB}`,
    "--require",
    guardFile,
    entry,
  ];
  return {
    command: runtime.execPath,
    args,
    env: {
      ...base,
      ...runtime.env,
      CUELITH_NETWORK: network === "*" ? "*" : network.join(","),
    },
    cwd: moduleDir,
  };
}

/**
 * Controllo della rete per i moduli Node, caricato con --require prima del
 * loro codice. Sostituisce i punti da cui passa ogni connessione (socket TCP,
 * quindi anche http, https, fetch e WebSocket; server; UDP) con versioni che
 * controllano l'host, e li blocca: il modulo non puo' rimettere gli
 * originali, e col modello dei permessi non arriva ai binding interni
 * (process.binding e' negato).
 */
export const networkGuardSource = String.raw`"use strict";
const net = require("node:net");
const dgram = require("node:dgram");
const spec = process.env.CUELITH_NETWORK || "";
const any = spec === "*";
const hosts = any || spec === "" ? [] : spec.split(",");
const allowed = (host) =>
  any || (typeof host === "string" && hosts.some((h) => host === h || host.endsWith("." + h)));
const denied = (what) => {
  const error = new Error("Cuelith: rete non consentita (" + what + "): manca il permesso nel manifest");
  error.code = "ERR_ACCESS_DENIED";
  return error;
};
const lock = (target, name, value) =>
  Object.defineProperty(target, name, { value, writable: false, configurable: false, enumerable: false });

const connect = net.Socket.prototype.connect;
lock(net.Socket.prototype, "connect", function (...args) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];
  if (typeof options !== "object" || options === null) options = { port: args[0], host: args[1] };
  if (typeof options.path === "string") {
    if (!any) throw denied(options.path);
  } else {
    const host = options.host === undefined ? "localhost" : options.host;
    if (!allowed(host)) throw denied(host);
  }
  return connect.apply(this, args);
});
const listen = net.Server.prototype.listen;
lock(net.Server.prototype, "listen", function (...args) {
  if (!any) throw denied("server");
  return listen.apply(this, args);
});
const bind = dgram.Socket.prototype.bind;
lock(dgram.Socket.prototype, "bind", function (...args) {
  if (!any) throw denied("udp");
  return bind.apply(this, args);
});
const send = dgram.Socket.prototype.send;
lock(dgram.Socket.prototype, "send", function (...args) {
  if (!any) throw denied("udp");
  return send.apply(this, args);
});
`;
