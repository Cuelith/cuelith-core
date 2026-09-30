import type { InstalledPlugin } from "@cuelith/protocol";
import { useEffect, useMemo, useState } from "react";
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
    }));
  });
}

/** Pannelli dei moduli attivi, riletti quando i moduli cambiano. */
export function useModulePanels(): readonly ModulePanel[] {
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
  return useMemo(() => panelsOf(installed), [installed]);
}
