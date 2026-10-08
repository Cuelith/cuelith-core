import { readFile } from "node:fs/promises";
import { ErrorCode, RpcError, type PluginManifest } from "@cuelith/protocol";
import { writeFileAtomic } from "../show/files.js";

// Impostazioni dei plugin (protocollo 1.18): il manifest dichiara chiavi, tipi, limiti e scelte;
// l'utente cambia i valori da una finestra uguale per tutti, e il motore li conserva, li controlla
// e li consegna al plugin all'attivazione. Un valore salvato che non vale piu' (il plugin e' stato
// aggiornato e il tipo e' cambiato) si ignora: torna il predefinito, senza errori.

export type SettingValue = string | number | boolean;
export type SettingDef = NonNullable<PluginManifest["contributes"]["settings"]>[number];

const MAX_TEXT = 2000;

/** Il valore e' ammesso da questa definizione? */
export function acceptsSetting(def: SettingDef, value: unknown): value is SettingValue {
  if (typeof value !== def.type) return false;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return false;
    if (def.min !== undefined && value < def.min) return false;
    if (def.max !== undefined && value > def.max) return false;
  }
  if (typeof value === "string" && value.length > MAX_TEXT) return false;
  if (def.choices !== undefined) return def.choices.some((choice) => choice.value === value);
  return true;
}

type Stored = Record<string, Record<string, SettingValue>>;

/** Le scelte dell'utente, in un file della cartella dati (plugin-settings.json). */
export class PluginSettings {
  readonly #file: string;
  #stored: Stored = {};
  /** Le scritture una dopo l'altra: due cambi vicini non si pestano. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.#file, "utf8")) as unknown;
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
      const stored: Stored = {};
      for (const [id, values] of Object.entries(raw as Record<string, unknown>)) {
        if (values === null || typeof values !== "object" || Array.isArray(values)) continue;
        const clean: Record<string, SettingValue> = {};
        for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
            clean[key] = value;
        }
        stored[id] = clean;
      }
      this.#stored = stored;
    } catch {
      // Nessun file (prima volta) o file rovinato: si riparte dai valori predefiniti.
    }
  }

  /** Valori in uso: i predefiniti del manifest con sopra le scelte valide dell'utente. */
  effective(manifest: Pick<PluginManifest, "id" | "contributes">): Record<string, SettingValue> {
    const values: Record<string, SettingValue> = {};
    const mine = this.#stored[manifest.id] ?? {};
    for (const def of manifest.contributes.settings ?? []) {
      const chosen = mine[def.key];
      if (chosen !== undefined && acceptsSetting(def, chosen)) values[def.key] = chosen;
      else if (def.default !== undefined) values[def.key] = def.default;
    }
    return values;
  }

  /**
   * Cambia uno o piu' valori (`null` = toglie la scelta). Controlla tutto prima di scrivere:
   * se un valore non va, non cambia niente. Restituisce i valori in uso dopo il cambio.
   */
  async set(
    manifest: Pick<PluginManifest, "id" | "contributes">,
    changes: Readonly<Record<string, SettingValue | null>>,
  ): Promise<Record<string, SettingValue>> {
    const defs = new Map((manifest.contributes.settings ?? []).map((def) => [def.key, def]));
    for (const [key, value] of Object.entries(changes)) {
      const def = defs.get(key);
      if (def === undefined)
        throw new RpcError(ErrorCode.InvalidParameters, "core.error.settingUnknown");
      if (value !== null && !acceptsSetting(def, value)) {
        throw new RpcError(ErrorCode.InvalidParameters, "core.error.settingInvalid");
      }
    }
    const run = async (): Promise<void> => {
      const merged = new Map(Object.entries(this.#stored[manifest.id] ?? {}));
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) merged.delete(key);
        else merged.set(key, value);
      }
      const others = Object.entries(this.#stored).filter(([id]) => id !== manifest.id);
      const next: Stored = Object.fromEntries(
        merged.size === 0 ? others : [...others, [manifest.id, Object.fromEntries(merged)]],
      );
      await writeFileAtomic(this.#file, `${JSON.stringify(next, null, 2)}\n`);
      this.#stored = next;
    };
    const turn = this.#queue.then(run, run);
    this.#queue = turn.catch(() => undefined);
    await turn;
    return this.effective(manifest);
  }
}
