import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Decisione 0004: ID di installazione anonimo, generato su questo computer e
// mai inviato (prepara funzioni future, dichiarato nell'informativa e
// rigenerabile), e preferenze dell'app desktop.

const INSTALLATION_FILE = "installation.json";
const PREFERENCES_FILE = "preferences.json";

export interface Installation {
  readonly id: string;
  readonly createdAt: string;
}

export interface Preferences {
  /** Controllo automatico degli aggiornamenti (disattivabile). */
  readonly autoCheckUpdates: boolean;
  /** L'avvio guidato (decisione 0018) e' gia' stato visto o saltato su questo computer. */
  readonly welcomeSeen: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { autoCheckUpdates: true, welcomeSeen: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Scrittura atomica: un file a meta' non resta mai al posto di quello buono. */
async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
}

/** L'ID di questa installazione; lo crea al primo avvio (o se il file e' rovinato). */
export async function loadInstallation(dir: string): Promise<Installation> {
  const file = path.join(dir, INSTALLATION_FILE);
  const raw = (await readJson(file)) as Partial<Installation> | undefined;
  if (typeof raw?.id === "string" && UUID.test(raw.id) && typeof raw.createdAt === "string") {
    return { id: raw.id, createdAt: raw.createdAt };
  }
  return resetInstallation(dir);
}

/** Nuovo ID: il precedente non resta da nessuna parte. */
export async function resetInstallation(dir: string): Promise<Installation> {
  const installation = { id: randomUUID(), createdAt: new Date().toISOString() };
  await writeJson(path.join(dir, INSTALLATION_FILE), installation);
  return installation;
}

export async function loadPreferences(dir: string): Promise<Preferences> {
  const raw = (await readJson(path.join(dir, PREFERENCES_FILE))) as
    Partial<Preferences> | undefined;
  return {
    autoCheckUpdates:
      typeof raw?.autoCheckUpdates === "boolean"
        ? raw.autoCheckUpdates
        : DEFAULT_PREFERENCES.autoCheckUpdates,
    welcomeSeen:
      typeof raw?.welcomeSeen === "boolean" ? raw.welcomeSeen : DEFAULT_PREFERENCES.welcomeSeen,
  };
}

export async function savePreferences(dir: string, preferences: Preferences): Promise<void> {
  await writeJson(path.join(dir, PREFERENCES_FILE), preferences);
}
