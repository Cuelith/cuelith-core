import type { CSSProperties } from "react";
import { useT } from "../engine/react.js";
import type { Mode } from "../modes/core.js";
import { CORE_PANEL_COMPONENTS } from "../panels/core-panels.js";
import { EmptyState, Panel } from "../ui/Panel.js";

function UnavailablePanel({ panelId }: { panelId: string }) {
  const t = useT();
  return (
    <Panel label={panelId}>
      <EmptyState title={t("core.panel.unavailable")} />
    </Panel>
  );
}

/**
 * Disegna una modalita' dal suo layout dichiarativo: colonne, righe e aree
 * diventano una griglia CSS, ogni area mostra il suo pannello. Lo stesso
 * codice vale per Presenta e per ogni modalita' dei moduli.
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
      {Object.entries(layout.panels).map(([area, panelId]) => {
        const Component = CORE_PANEL_COMPONENTS[panelId];
        return (
          <div
            key={area}
            data-area={area}
            data-panel={panelId}
            className={`flex min-h-0 min-w-0 flex-col overflow-auto ${lastColumn.has(area) ? "" : "border-r border-line"}`}
            style={{ gridArea: area }}
          >
            {Component === undefined ? <UnavailablePanel panelId={panelId} /> : <Component />}
          </div>
        );
      })}
    </main>
  );
}
