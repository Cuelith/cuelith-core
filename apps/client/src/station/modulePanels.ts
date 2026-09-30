import type { InstalledPlugin } from "@cuelith/protocol";
import { createContext, useEffect, useMemo, useState } from "react";
import { useConnection, useEngine } from "../engine/react.js";

/** Un pannello offerto da un modulo attivo. */
export interface ModulePanel {
  /** Id qualificato: "<id modulo>.<id pannello>". */
  readonly id: string;
  readonly pluginId: string;
  readonly pluginName: string;
  readonly panelId: string;
  /** Chiave di traduzione del titolo (del modulo). */
  readonly title: string;
  readonly placement: "side" | "center";
  /** Pagina del pannello servita dal motore (area isolata dei moduli). */
  readonly src: string;
  /** Icona del modulo (SVG del pacchetto), se la dichiara. */
  readonly icon: string | undefined;
}

/** Indirizzo dell'icona di un modulo installato, servita dal motore. */
export function pluginIconUrl(manifest: {
  id: string;
  version: string;
  icon?: string | undefined;
}): string | undefined {
  return manifest.icon === undefined
    ? undefined
    : `/plugins/${manifest.id}/${manifest.version}/${manifest.icon}`;
}

export function panelsOf(plugins: readonly InstalledPlugin[]): ModulePanel[] {
  return plugins.flatMap((plugin) => {
    const { manifest, status } = plugin;
    if (status.state !== "active" || manifest.ui === undefined) return [];
    const entry = manifest.ui.entry;
    return (manifest.contributes.panels ?? []).map((panel) => ({
      id: `${manifest.id}.${panel.id}`,
      pluginId: manifest.id,
      pluginName: manifest.name,
      panelId: panel.id,
      title: panel.title,
      placement: panel.placement ?? "side",
      src: `/plugins/${manifest.id}/${manifest.version}/${entry}?panel=${encodeURIComponent(panel.id)}`,
      icon: pluginIconUrl(manifest),
    }));
  });
}

/** Tipo di elemento di un modulo -> pannello che lo modifica (id qualificato). */
export function editorsOf(plugins: readonly InstalledPlugin[]): ReadonlyMap<string, string> {
  const editors = new Map<string, string>();
  for (const { manifest, status } of plugins) {
    if (status.state !== "active") continue;
    for (const type of manifest.contributes.itemTypes ?? []) {
      if (type.editor !== undefined)
        editors.set(`${manifest.id}.${type.id}`, `${manifest.id}.${type.editor}`);
    }
  }
  return editors;
}

/** Editor dei tipi di elemento dei moduli (forniti dalla postazione). */
export const ModuleEditorsContext = createContext<ReadonlyMap<string, string>>(new Map());

/** Pannelli dei moduli attivi, per id qualificato (forniti dalla vista della modalita'). */
export const ModulePanelsContext = createContext<ReadonlyMap<string, ModulePanel>>(new Map());

/** Pannelli dei moduli attivi, riletti quando i moduli cambiano. */
export function useModuleUi(): {
  readonly panels: readonly ModulePanel[];
  readonly editors: ReadonlyMap<string, string>;
} {
  const connection = useConnection();
  const plugins = useEngine().state?.live.plugins;
  const key = JSON.stringify(plugins);
  const [installed, setInstalled] = useState<readonly InstalledPlugin[]>([]);
  useEffect(() => {
    let cancelled = false;
    connection
      .call("plugin.list", {})
      .then(({ plugins: list }) => {
        if (!cancelled) setInstalled(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connection, key]);
  return useMemo(
    () => ({ panels: panelsOf(installed), editors: editorsOf(installed) }),
    [installed],
  );
}
