import { useCallback, useEffect, useMemo, useState } from "react";
import { useEngine, useT } from "../engine/react.js";
import { ModulePanelFrame } from "../panels/ModulePanelFrame.js";
import { ModulePanelsContext, useModuleUi } from "../station/modulePanels.js";
import { useCueShortcuts } from "../station/shortcuts.js";
import { StationProvider } from "../station/station.js";
import { Notices } from "./Notices.js";

/**
 * Pannello e contesto chiesti dall'indirizzo della finestra
 * (?panelWindow=...&context=...). `warm` = finestra preparata in anticipo,
 * in attesa della prima richiesta.
 */
export function panelWindowRequest(
  search: string,
): { panelId: string; context: unknown; warm: boolean } | undefined {
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
  return { panelId, context, warm: query.get("warm") === "1" };
}

/**
 * Finestra propria di un pannello di modulo (gli editor): la postazione
 * principale resta com'e', con la zona centrale dell'operatore. Anche qui
 * valgono i tasti della regia.
 */
export function PanelWindow({
  panelId,
  context,
  warm,
}: {
  panelId: string;
  context: unknown;
  warm: boolean;
}) {
  return (
    <StationProvider>
      <PanelWindowBody panelId={panelId} context={context} warm={warm} />
    </StationProvider>
  );
}

let nextOpening = 1;

function PanelWindowBody({
  panelId,
  context,
  warm,
}: {
  panelId: string;
  context: unknown;
  warm: boolean;
}) {
  const t = useT();
  const { state } = useEngine();
  const { panels } = useModuleUi();
  useCueShortcuts();
  const modules = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  const panel = modules.get(panelId);
  const title = panel === undefined ? undefined : t(panel.title);
  // Richiesta in corso (contesto da passare al pannello); assente = editor in attesa.
  const [opening, setOpening] = useState<{ id: number; context: unknown } | undefined>(() =>
    warm ? undefined : { id: nextOpening++, context },
  );
  // Ogni editor finito lascia il posto a uno nuovo, caricato in anticipo e pulito.
  const [frameKey, setFrameKey] = useState(0);

  const reset = useCallback(() => {
    setOpening(undefined);
    setFrameKey((key) => key + 1);
  }, []);

  useEffect(() => {
    const desktop = window.cuelithDesktop;
    if (desktop === undefined) return;
    return desktop.onPanelEvents({
      open: (requested) => {
        setOpening((current) => {
          // Un editor gia' in uso per un altro elemento: si ricomincia pulito.
          if (current !== undefined) setFrameKey((key) => key + 1);
          return { id: nextOpening++, context: requested ?? undefined };
        });
      },
      closed: reset,
    });
  }, [reset]);

  useEffect(() => {
    document.title = title === undefined ? "Cuelith" : `${title} · Cuelith`;
  }, [title]);

  const close = useCallback(() => {
    const desktop = window.cuelithDesktop;
    if (desktop === undefined) {
      window.close();
      return;
    }
    desktop.hidePanelWindow();
    reset();
  }, [reset]);

  return (
    <ModulePanelsContext.Provider value={modules}>
      <div className="flex h-full flex-col">
        {state !== undefined && panel !== undefined && (
          <ModulePanelFrame
            key={frameKey}
            panel={panel}
            context={opening?.context}
            connect={opening !== undefined}
            onClose={close}
          />
        )}
      </div>
      <Notices />
    </ModulePanelsContext.Provider>
  );
}
