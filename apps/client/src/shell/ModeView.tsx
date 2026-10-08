import { areaPanelIds, providerOf } from "@cuelith/protocol";
import { CurrentModeContext } from "../station/currentMode.js";
import { usePins } from "../station/pins.js";
import { useScreensSwapped } from "../station/screenSwap.js";
import { usePluginSettings } from "../station/pluginSettings.js";
import {
  useContext,
  useEffect,
  useId,
  useRef,
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
function TabbedArea({
  storageKey,
  panelIds,
  closable,
  onCloseTab,
}: {
  storageKey: string;
  panelIds: readonly string[];
  /** Schede che si possono chiudere (aperte dalla ricerca, non fissate). */
  closable: ReadonlySet<string>;
  onCloseTab: (panelId: string) => void;
}) {
  const t = useT();
  const modules = useContext(ModulePanelsContext);
  const baseId = useId();
  const pluginSettings = usePluginSettings();
  const [saved, setSaved] = useState(() => readTab(storageKey));
  const active = saved !== undefined && panelIds.includes(saved) ? saved : (panelIds[0] ?? "");
  const activeModule = modules.get(active);

  const choose = (panelId: string) => {
    setSaved(panelId);
    try {
      localStorage.setItem(storageKey, panelId);
    } catch {
      // La scheda scelta vale comunque per questa sessione.
    }
  };

  // Le schede usate di recente, la piu' recente per prima: Ctrl+Tab torna alla precedente.
  const recent = useRef<string[]>([]);
  useEffect(() => {
    recent.current = [active, ...recent.current.filter((id) => id !== active)].slice(0, 20);
  }, [active]);
  const previous = () =>
    recent.current.find((id) => id !== active && panelIds.includes(id)) ?? panelIds[0];
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.key !== "Tab") return;
      if (document.querySelector("dialog[open]") !== null) return;
      event.preventDefault();
      // Ctrl+Tab: l'ultima scheda usata; Ctrl+Maiusc+Tab: la scheda seguente, in cerchio.
      const index = panelIds.indexOf(active);
      const next = event.shiftKey
        ? panelIds[(index + 1) % panelIds.length]
        : recent.current.find((id) => id !== active && panelIds.includes(id));
      if (next !== undefined && next !== active) choose(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  });
  const closeTab = (panelId: string) => {
    if (panelId === active) choose(previous() ?? "");
    onCloseTab(panelId);
  };

  // Una scheda chiesta prima che esista (un plugin non fissato, aperto dalla ricerca) si mostra
  // appena compare.
  const wanted = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = wanted.current;
    if (id === undefined || !panelIds.includes(id)) return;
    wanted.current = undefined;
    setSaved(id);
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      // Vale comunque per questa sessione.
    }
  }, [panelIds, storageKey]);

  // Il dock e la ricerca possono chiedere di mostrare la scheda di un modulo.
  useEffect(() => {
    const onShow = (event: Event) => {
      const panelId = (event as CustomEvent<string>).detail;
      if (!panelIds.includes(panelId)) {
        wanted.current = panelId;
        return;
      }
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
        closable={closable}
        onClose={closeTab}
        trailing={
          activeModule !== undefined && pluginSettings.has(activeModule.pluginId) ? (
            <button
              type="button"
              aria-label={t("core.pluginSettings.title", { name: activeModule.pluginName })}
              title={t("core.pluginSettings.title", { name: activeModule.pluginName })}
              onClick={() => {
                pluginSettings.open(activeModule.pluginId);
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:text-fg"
            >
              <svg
                viewBox="0 0 20 20"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <circle cx="10" cy="10" r="2.6" />
                <path
                  d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : undefined
        }
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
  const [swapped] = useScreensSwapped();
  // «Presenta»: con le dimensioni scambiate il Programma prende lo spazio dell'Anteprima e viceversa.
  const rows =
    swapped && mode.qualifiedId === "core.present"
      ? [layout.rows[1] ?? "auto", layout.rows[0] ?? "auto", ...layout.rows.slice(2)]
      : layout.rows;
  const modules = new Map(modulePanels.map((p) => [p.id, p]));
  const sideAll = modulePanels.filter((p) => p.placement === "side").map((p) => p.id);
  // Schede: i plugin fissati e quelli aperti da poco dalla ricerca (finche' dura la sessione).
  const pins = usePins(sideAll);
  const [opened, setOpened] = useState<readonly string[]>([]);
  const sideKey = sideAll.join("|");
  useEffect(() => {
    const onShow = (event: Event) => {
      const panelId = (event as CustomEvent<string>).detail;
      if (sideKey.split("|").includes(panelId)) {
        setOpened((list) => (list.includes(panelId) ? list : [...list, panelId]));
      }
    };
    window.addEventListener(SHOW_TAB_EVENT, onShow);
    return () => {
      window.removeEventListener(SHOW_TAB_EVENT, onShow);
    };
  }, [sideKey]);
  const side = sideAll.filter((id) => pins.isPinned(id) || opened.includes(id));
  const closable = new Set(opened.filter((id) => !pins.isPinned(id)));
  const entries = Object.entries(layout.panels).map(
    ([area, panels]) => [area, areaPanelIds(panels)] as const,
  );
  // I pannelli laterali dei moduli diventano schede dell'area della Scaletta.
  const sideArea = entries.find(([, ids]) => ids.includes("core.playlist"))?.[0];
  const style: CSSProperties = {
    gridTemplateColumns: layout.columns.join(" "),
    gridTemplateRows: rows.join(" "),
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
                    closable={closable}
                    onCloseTab={(panelId) => {
                      setOpened((list) => list.filter((id) => id !== panelId));
                    }}
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
