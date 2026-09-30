import {
  EngineMethods,
  ErrorCode,
  isEngineMethod,
  PANEL_CONNECT,
  PANEL_HOST_METHODS,
  PanelToHostSchema,
  pluginRole,
  roleAllows,
  type Catalog,
  type HostToPanel,
} from "@cuelith/protocol";
import { EngineCallError } from "@cuelith-core/engine-client";
import { useEffect, useRef } from "react";
import { useConnection, useEngine, useT } from "../engine/react.js";
import type { ModulePanel } from "../station/modulePanels.js";
import { useStation } from "../station/station.js";

/** Solo i testi del modulo: un pannello non vede quelli del nucleo o di altri moduli. */
function ownCatalog(catalog: Catalog, pluginId: string): Catalog {
  const prefix = `${pluginId}.`;
  return Object.fromEntries(Object.entries(catalog).filter(([key]) => key.startsWith(prefix)));
}

/**
 * Pannello di un modulo (cap. 11 e 24): iframe isolato (sandbox, senza rete
 * ne' accesso alla postazione) collegato con una porta privata. I comandi
 * arrivano al motore solo se il ruolo dei moduli li consente.
 */
export function ModulePanelFrame({ panel, onClose }: { panel: ModulePanel; onClose?: () => void }) {
  const connection = useConnection();
  const { state, catalog, lang } = useEngine();
  const { notify } = useStation();
  const frame = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | undefined>(undefined);
  const t = useT();
  const latest = useRef({ state, catalog, lang, notify, onClose });
  useEffect(() => {
    latest.current = { state, catalog, lang, notify, onClose };
  });

  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const role = pluginRole(panel.pluginId);

    const send = (message: HostToPanel) => {
      port.current?.postMessage(message);
    };

    const onCall = async (id: number, method: string, params: unknown) => {
      const fail = (code: number, message: string) => {
        send({ type: "error", id, error: { code, message } });
      };
      if (method === PANEL_HOST_METHODS.notify) {
        const { key, params: values } = (params ?? {}) as { key?: unknown; params?: unknown };
        // Solo testi del modulo: un pannello non puo' mostrare messaggi del nucleo.
        if (typeof key !== "string" || !key.startsWith(`${panel.pluginId}.`)) {
          fail(ErrorCode.InvalidParameters, "core.error.invalidParams");
          return;
        }
        latest.current.notify(key, (values ?? {}) as Record<string, string>, "info");
        send({ type: "result", id, result: {} });
        return;
      }
      if (method === PANEL_HOST_METHODS.close) {
        latest.current.onClose?.();
        send({ type: "result", id, result: {} });
        return;
      }
      if (!isEngineMethod(method)) {
        fail(ErrorCode.MethodNotFound, "core.error.methodNotFound");
        return;
      }
      if (!roleAllows(role, method, EngineMethods[method].scope)) {
        fail(ErrorCode.Forbidden, "core.error.forbidden");
        return;
      }
      try {
        const result = await connection.call(method, params as never);
        send({ type: "result", id, result });
      } catch (error) {
        if (error instanceof EngineCallError) {
          send({
            type: "error",
            id,
            error: { code: error.code, message: error.message, data: { params: error.params } },
          });
        } else fail(ErrorCode.InternalError, "core.error.internal");
      }
    };

    const onLoad = () => {
      port.current?.close();
      const channel = new MessageChannel();
      port.current = channel.port1;
      channel.port1.onmessage = (event: MessageEvent) => {
        const parsed = PanelToHostSchema.safeParse(event.data);
        if (!parsed.success) return;
        void onCall(parsed.data.id, parsed.data.method, parsed.data.params);
      };
      // L'iframe e' isolato (origine opaca): la porta si consegna con "*".
      element.contentWindow?.postMessage({ type: PANEL_CONNECT }, "*", [channel.port2]);
      const current = latest.current;
      if (current.state === undefined) return;
      send({
        type: "init",
        pluginId: panel.pluginId,
        panelId: panel.panelId,
        lang: current.lang,
        catalog: ownCatalog(current.catalog, panel.pluginId),
        state: current.state,
      });
    };

    element.addEventListener("load", onLoad);
    return () => {
      element.removeEventListener("load", onLoad);
      port.current?.close();
      port.current = undefined;
    };
  }, [connection, panel.pluginId, panel.panelId, panel.src]);

  // Stato e testi aggiornati arrivano al pannello man mano.
  useEffect(() => {
    if (state !== undefined)
      port.current?.postMessage({ type: "state", state } satisfies HostToPanel);
  }, [state]);
  useEffect(() => {
    port.current?.postMessage({
      type: "catalog",
      lang,
      catalog: ownCatalog(catalog, panel.pluginId),
    } satisfies HostToPanel);
  }, [catalog, lang, panel.pluginId]);

  return (
    <iframe
      ref={frame}
      src={panel.src}
      title={t(panel.title)}
      sandbox="allow-scripts"
      className="h-full min-h-0 w-full flex-1 border-0 bg-bg"
      data-module-panel={panel.id}
    />
  );
}
