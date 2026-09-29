import {
  BUILTIN_ROLES,
  ErrorCode,
  isProtocolCompatible,
  PROTOCOL_VERSION,
  RpcError,
  type ClientInfo,
} from "@cuelith/protocol";
import type { HandlerMap } from "../dispatch.js";

export const sessionHandlers: HandlerMap = {
  "session.hello": (ctx, session, params) => {
    if (!isProtocolCompatible(params.protocol)) {
      throw new RpcError(ErrorCode.ProtocolIncompatible, "core.error.protocolIncompatible", {
        params: { engine: PROTOCOL_VERSION },
      });
    }
    if (session.state === "new") session.state = "hello";
    session.name = params.client.name;
    session.kind = params.client.kind;
    return { protocol: PROTOCOL_VERSION, engine: { version: ctx.version }, sessionId: session.id };
  },

  "session.auth": (ctx, session, params) => {
    const grant = ctx.tokens.resolve(params.token);
    if (grant === undefined) throw new RpcError(ErrorCode.NotPaired, "core.error.notPaired");
    if (session.state === "authed")
      throw new RpcError(ErrorCode.InvalidRequest, "core.error.alreadyAuthed");

    session.role = BUILTIN_ROLES[grant.role];
    session.kind = grant.kind;
    session.local = grant.local;
    session.connectedAt = new Date().toISOString();
    session.state = "authed";

    const info: ClientInfo = {
      id: session.id,
      name: session.name,
      kind: session.kind,
      role: session.role.id,
      local: session.local,
      connectedAt: session.connectedAt,
    };
    ctx.store.update((draft) => {
      draft.live.clients.push(info);
    });
    return { clientId: session.id, role: session.role.id };
  },
};
