import type { InstalledPlugin, ResourceLevel } from "@cuelith/protocol";
import { useEffect, useRef } from "react";
import { useEngine, useT } from "../engine/react.js";
import { useStation } from "../station/station.js";
import { useResources } from "./Resources.js";

const RANK: Record<ResourceLevel, number> = { ok: 0, warning: 1, danger: 2 };

/**
 * Avvisa quando il computer si avvicina al limite (dopo aver acceso un plugin, per esempio) e
 * quando il freno della memoria ferma un plugin: chi proietta lo vede subito, senza dover aprire le
 * Impostazioni. Non disegna nulla: manda avvisi, e solo quando la situazione peggiora.
 */
export function ResourceWatch({ installed }: { installed: readonly InstalledPlugin[] }) {
  const t = useT();
  const { notify } = useStation();
  const { state } = useEngine();
  const report = useResources(5000);
  const level = report?.level;
  const reasons = report?.reasons.join("|") ?? "";
  const last = useRef<ResourceLevel | undefined>(undefined);

  useEffect(() => {
    if (level === undefined) return;
    const before = last.current;
    last.current = level;
    // Solo quando peggiora, e mai alla prima misura (si apre il programma gia' al limite: lo
    // dice l'indicatore in alto, senza un avviso a ogni avvio).
    if (before === undefined || RANK[level] <= RANK[before] || level === "ok") return;
    const why = reasons
      .split("|")
      .filter((key) => key !== "")
      .map((key) => t(key))
      .join(", ");
    notify(`core.resources.notice.${level}`, { reasons: why }, "info");
  }, [level, reasons, notify, t]);

  // Un plugin fermato dal freno della memoria, una volta sola.
  const told = useRef(new Set<string>());
  const plugins = state?.live.plugins;
  useEffect(() => {
    for (const plugin of plugins ?? []) {
      if (plugin.error !== "core.module.lowMemory" || told.current.has(plugin.id)) continue;
      told.current.add(plugin.id);
      const name = installed.find((p) => p.manifest.id === plugin.id)?.manifest.name ?? plugin.id;
      notify("core.resources.notice.stopped", { name }, "info");
    }
  }, [plugins, installed, notify]);
  return null;
}
