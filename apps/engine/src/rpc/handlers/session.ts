import {
  BUILTIN_ROLES,
  ErrorCode,
  isProtocolCompatible,
  PROTOCOL_VERSION,
  RpcError,
  type BuiltinRoleId,
  type ClientInfo,
} from "@cuelith/protocol";
import { lanInterfaces } from "../../network.js";
import { requireLocal } from "./library.js";
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
    session.pairedId = grant.pairedId;
    if (grant.pairedId !== undefined) ctx.tokens.seen(grant.pairedId);
    session.connectedAt = new Date().toISOString();
    session.state = "authed";

    const info: ClientInfo = {
      id: session.id,
      name: session.name,
      kind: session.kind,
      role: session.role.id,
      local: session.local,
      connectedAt: session.connectedAt,
      ...(session.pairedId === undefined ? {} : { pairedId: session.pairedId }),
    };
    ctx.store.update((draft) => {
      draft.live.clients.push(info);
    });
    return { clientId: session.id, role: session.role.id };
  },

  // ---- postazioni in rete (passo 8, cap. 23 e 27) ----

  /** La postazione nuova presenta il codice mostrato sul motore e riceve il suo token. */
  "session.pair": async (ctx, session, params) => {
    if (session.state === "authed")
      throw new RpcError(ErrorCode.InvalidRequest, "core.error.alreadyAuthed");
    const { token, station } = await ctx.tokens.redeem(params.code, params.name);
    return { token, clientId: station.id, role: station.role };
  },

  // Abbinare, revocare e aprire la rete si fa solo dal computer del motore.
  "pairing.start": (ctx, session, params) => {
    requireLocal(session);
    if (!Object.hasOwn(BUILTIN_ROLES, params.role)) {
      throw new RpcError(ErrorCode.InvalidParameters, "core.error.invalidParams");
    }
    return ctx.tokens.startPairing(params.role as BuiltinRoleId);
  },

  "pairing.cancel": (ctx, session) => {
    requireLocal(session);
    ctx.tokens.cancelPairing();
    return {};
  },

  "pairing.list": (ctx, session) => {
    requireLocal(session);
    return { stations: ctx.tokens.paired() };
  },

  "session.revoke": async (ctx, session, params) => {
    requireLocal(session);
    if (!(await ctx.tokens.revoke(params.clientId))) {
      throw new RpcError(ErrorCode.NotFound, "core.error.stationNotFound");
    }
    // Scollegata subito: il suo token non vale piu'.
    for (const other of ctx.sessions) {
      if (other.pairedId === params.clientId) other.close(4010, "revoked");
    }
    return {};
  },

  "network.interfaces": (_ctx, session) => {
    requireLocal(session);
    return { interfaces: lanInterfaces() };
  },

  "network.set": async (ctx, session, params) => {
    requireLocal(session);
    if (
      params.address !== undefined &&
      !lanInterfaces().some((i) => i.address === params.address)
    ) {
      throw new RpcError(ErrorCode.InvalidParameters, "core.network.addressMissing");
    }
    await ctx.network.set(params.enabled, params.address);
    return {};
  },
};
