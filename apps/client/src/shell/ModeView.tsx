import { areaPanelIds, providerOf } from "@cuelith/protocol";
import { CurrentModeContext } from "../station/currentMode.js";
import {
  useContext,
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useT, type Translate } from "../engine/react.js";
import type { Mode } from "../modes/core.js";
import { CORE_PANEL_COMPONENTS } from "../panels/core-panels.js";
import { ModulePanelFrame } from "../panels/ModulePanelFrame.js";
import { ModulePanelsContext, type ModulePanel } from "../station/modulePanels.js";
import { SHOW_TAB_EVENT } from "../station/tabs.js";
import { TabStrip } from "./TabStrip.js";
import { EmptyState, Panel, PanelChrome } from "../ui/Panel.js";

function UnavailablePanel({ panelId }: { panelId: string }) {
  const t = useT();
  return (
    <Panel label={panelId}>
      <EmptyState title={t("core.panel.unavailable")} />
    </Panel>
  );
}

/** Pannelli dei moduli attivi, per id qualificato. */

function PanelView({ panelId }: { panelId: string }) {
  const modules = useContext(ModulePanelsContext);
  const modulePanel = modules.get(panelId);
  if (modulePanel !== undefined) return <ModulePanelFrame panel={modulePanel} />;
  const Component = CORE_PANEL_COMPONENTS[panelId];
  return Component === undefined ? <UnavailablePanel panelId={panelId} /> : <Component />;
}

/** Nome di un pannello: del nucleo (core.panel.*) o il titolo dichiarato dal modulo. */
function panelTitle(
  t: Translate,
  panelId: string,
  modules: ReadonlyMap<string, ModulePanel>,
): string {
  const modulePanel = modules.get(panelId);
  if (modulePanel !== undefined) return t(modulePanel.title);
  if (providerOf(panelId, []) === "core") return t(`core.panel.${panelId.slice("core.".length)}`);
  return panelId;
}

function readTab(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Piu' pannelli nella stessa area, come schede (cap. 16: "schede dentro le sezioni"). */
function TabbedArea({ storageKey, panelIds }: { storageKey: string; panelIds: readonly string[] }) {
  const t = useT();
  const modules = useContext(ModulePanelsContext);
  const baseId = useId();
  const [saved, setSaved] = useState(() => readTab(storageKey));
  const active = saved !== undefined && panelIds.includes(saved) ? saved : (panelIds[0] ?? "");

  const choose = (panelId: string) => {
    setSaved(panelId);
    try {
      localStorage.setItem(storageKey, panelId);
    } catch {
      // La scheda scelta vale comunque per questa sessione.
    }
  };

  // Il dock puo' chiedere di mostrare la scheda di un modulo.
  useEffect(() => {
    const onShow = (event: Event) => {
      const panelId = (event as CustomEvent<string>).detail;
      if (!panelIds.includes(panelId)) return;
      setSaved(panelId);
      try {
        localStorage.setItem(storageKey, panelId);
      } catch {
        // Vale comunque per questa sessione.
      }
    };
    window.addEventListener(SHOW_TAB_EVENT, onShow);
    return () => {
      window.removeEventListener(SHOW_TAB_EVENT, onShow);
    };
  }, [panelIds, storageKey]);

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    event.stopPropagation();
    const index = panelIds.indexOf(active);
    const next =
      panelIds[(index + (event.key === "ArrowRight" ? 1 : -1) + panelIds.length) % panelIds.length];
    if (next !== undefined) {
      choose(next);
      document.getElementById(`${baseId}-${next}`)?.focus();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TabStrip
        panelIds={panelIds}
        active={active}
        baseId={baseId}
        title={(panelId) => panelTitle(t, panelId, modules)}
        onChoose={choose}
        onKeyDown={onKey}
      />
      <div
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-${active}`}
        data-panel={active}
        className="flex min-h-0 flex-1 flex-col overflow-auto"
      >
        <PanelChrome.Provider value={{ labelHidden: true }}>
          <PanelView panelId={active} />
        </PanelChrome.Provider>
      </div>
    </div>
  );
}

/**
 * Disegna una modalita' dal suo layout dichiarativo: colonne, righe e aree
 * diventano una griglia CSS, ogni area mostra il suo pannello (o piu'
 * pannelli a schede). Lo stesso codice vale per Presenta e per i moduli.
 */
export function ModeView({
  mode,
  modulePanels,
}: {
  mode: Mode;
  modulePanels: readonly ModulePanel[];
}) {
  const { layout } = mode;
  const modules = new Map(modulePanels.map((p) => [p.id, p]));
  const side = modulePanels.filter((p) => p.placement === "side").map((p) => p.id);
  const entries = Object.entries(layout.panels).map(
    ([area, panels]) => [area, areaPanelIds(panels)] as const,
  );
  // I pannelli laterali dei moduli diventano schede dell'area della Scaletta.
  const sideArea = entries.find(([, ids]) => ids.includes("core.playlist"))?.[0];
  const style: CSSProperties = {
    gridTemplateColumns: layout.columns.join(" "),
    gridTemplateRows: layout.rows.join(" "),
    gridTemplateAreas: layout.areas.map((row) => `"${row.join(" ")}"`).join(" "),
  };
  const lastColumn = new Set(layout.areas.map((row) => row[row.length - 1]));

  return (
    <main
      className="grid min-h-0 min-w-0 overflow-hidden"
      style={style}
      data-mode={mode.qualifiedId}
    >
      <CurrentModeContext.Provider value={mode.qualifiedId}>
        <ModulePanelsContext.Provider value={modules}>
          {entries.map(([area, coreIds]) => {
            const ids = area === sideArea ? [...coreIds, ...side] : coreIds;
            const single = ids.length === 1 ? ids[0] : undefined;
            return (
              <div
                key={area}
                data-area={area}
                data-panel={single}
                className={`flex min-h-0 min-w-0 flex-col ${single === undefined ? "" : "overflow-auto"} ${lastColumn.has(area) ? "" : "border-r border-line"}`}
                style={{ gridArea: area }}
              >
                {single !== undefined ? (
                  <PanelView panelId={single} />
                ) : (
                  <TabbedArea
                    storageKey={`cuelith.tabs.${mode.qualifiedId}.${area}`}
                    panelIds={ids}
                  />
                )}
              </div>
            );
          })}
        </ModulePanelsContext.Provider>
      </CurrentModeContext.Provider>
    </main>
  );
}
