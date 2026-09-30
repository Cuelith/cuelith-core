import { useEffect, useMemo } from "react";
import { useEngine, useT } from "../engine/react.js";
import { ModulePanelFrame } from "../panels/ModulePanelFrame.js";
import { ModulePanelsContext, useModuleUi } from "../station/modulePanels.js";
import { useCueShortcuts } from "../station/shortcuts.js";
import { StationProvider } from "../station/station.js";
import { Notices } from "./Notices.js";

/** Pannello e contesto chiesti dall'indirizzo della finestra (?panelWindow=...&context=...). */
export function panelWindowRequest(
  search: string,
): { panelId: string; context: unknown } | undefined {
  const query = new URLSearchParams(search);
  const panelId = query.get("panelWindow");
  if (panelId === null || panelId === "") return undefined;
  const raw = query.get("context");
  let context: unknown;
  try {
    context = raw === null ? undefined : JSON.parse(raw);
  } catch {
    context = undefined;
  }
  return { panelId, context };
}

/**
 * Finestra propria di un pannello di modulo (gli editor): la postazione
 * principale resta com'e', con la zona centrale dell'operatore. Anche qui
 * valgono i tasti della regia.
 */
export function PanelWindow({ panelId, context }: { panelId: string; context: unknown }) {
  return (
    <StationProvider>
      <PanelWindowBody panelId={panelId} context={context} />
    </StationProvider>
  );
}

function PanelWindowBody({ panelId, context }: { panelId: string; context: unknown }) {
  const t = useT();
  const { state } = useEngine();
  const { panels } = useModuleUi();
  useCueShortcuts();
  const modules = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  const panel = modules.get(panelId);
  const title = panel === undefined ? undefined : t(panel.title);

  useEffect(() => {
    document.title = title === undefined ? "Cuelith" : `${title} · Cuelith`;
  }, [title]);

  return (
    <ModulePanelsContext.Provider value={modules}>
      <div className="flex h-full flex-col">
        {state !== undefined && panel !== undefined && (
          <ModulePanelFrame
            panel={panel}
            context={context}
            onClose={() => {
              window.close();
            }}
          />
        )}
      </div>
      <Notices />
    </ModulePanelsContext.Provider>
  );
}
