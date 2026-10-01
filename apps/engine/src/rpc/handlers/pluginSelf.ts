import { ErrorCode, RpcError } from "@cuelith/protocol";
import type { EngineContext } from "../../context.js";
import type { HandlerMap } from "../dispatch.js";
import type { Session } from "../session.js";

/** Il modulo della sessione (solo i processi dei moduli ne hanno uno). */
function pluginOf(session: Session): string {
  if (session.pluginId === undefined)
    throw new RpcError(ErrorCode.Forbidden, "core.error.forbidden");
  return session.pluginId;
}

/** Lo spazio dati richiede il permesso "storage" approvato dall'utente (cap. 27). */
function storageOf(ctx: EngineContext, session: Session) {
  const id = pluginOf(session);
  if (ctx.modules.find(id)?.manifest.permissions.includes("storage") !== true) {
    throw new RpcError(ErrorCode.Forbidden, "core.error.permissionMissing", {
      params: { permission: "storage" },
    });
  }
  return ctx.supervisor.storage(id);
}

/** Metodi che solo il processo di un modulo puo' usare (ambito plugin.self). */
export const pluginSelfHandlers: HandlerMap = {
  "storage.get": async (ctx, session, params) => storageOf(ctx, session).get(params.key),

  "storage.set": async (ctx, session, params) => {
    await storageOf(ctx, session).set(params.key, params.value);
    return {};
  },

  "storage.delete": async (ctx, session, params) => {
    await storageOf(ctx, session).delete(params.key);
    return {};
  },

  "events.subscribe": (ctx, session, params) => {
    pluginOf(session);
    ctx.supervisor.subscribeEvents(session, params.names);
    return {};
  },
};
