import { areaPanelIds, providerOf } from "@cuelith/protocol";
import { useId, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useT, type Translate } from "../engine/react.js";
import type { Mode } from "../modes/core.js";
import { CORE_PANEL_COMPONENTS } from "../panels/core-panels.js";
import { EmptyState, Panel, PanelChrome } from "../ui/Panel.js";

function UnavailablePanel({ panelId }: { panelId: string }) {
  const t = useT();
  return (
    <Panel label={panelId}>
      <EmptyState title={t("core.panel.unavailable")} />
    </Panel>
  );
}

function PanelView({ panelId }: { panelId: string }) {
  const Component = CORE_PANEL_COMPONENTS[panelId];
  return Component === undefined ? <UnavailablePanel panelId={panelId} /> : <Component />;
}

/** Nome di un pannello: "core.library" -> chiave core.panel.library (i moduli porteranno il loro). */
function panelTitle(t: Translate, panelId: string): string {
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
      <div
        role="tablist"
        onKeyDown={onKey}
        className="flex shrink-0 gap-4 border-b border-line px-3 pt-2.5"
      >
        {panelIds.map((panelId) => {
          const selected = panelId === active;
          return (
            <button
              key={panelId}
              id={`${baseId}-${panelId}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                choose(panelId);
              }}
              // Trascinando qualcosa sopra una scheda la si apre: cosi' un elemento
              // delle Librerie si porta nella Scaletta anche se stanno nella stessa area.
              onDragEnter={() => {
                if (!selected) choose(panelId);
              }}
              className={`-mb-px border-b-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                selected ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {panelTitle(t, panelId)}
            </button>
          );
        })}
      </div>
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
export function ModeView({ mode }: { mode: Mode }) {
  const { layout } = mode;
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
      {Object.entries(layout.panels).map(([area, panels]) => {
        const ids = areaPanelIds(panels);
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
              <TabbedArea storageKey={`cuelith.tabs.${mode.qualifiedId}.${area}`} panelIds={ids} />
            )}
          </div>
        );
      })}
    </main>
  );
}
