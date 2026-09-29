import { ErrorCode, RpcError } from "@cuelith/protocol";
import type { HandlerMap } from "../dispatch.js";

export const readHandlers: HandlerMap = {
  "state.subscribe": (ctx, session) => {
    // Node e' a thread singolo: istantanea e iscrizione avvengono insieme,
    // quindi la prima patch ricevuta sara' esattamente rev + 1.
    session.subscribed = true;
    return { rev: ctx.store.rev, state: ctx.store.snapshot() };
  },

  "display.list": (ctx) => ({ displays: ctx.displays.list() }),

  "locale.list": (ctx) => ({ langs: ctx.locales.available(), active: ctx.locales.active }),

  "locale.catalog": (ctx, _session, params) => {
    if (!ctx.locales.available().some((l) => l.lang === params.lang)) {
      throw new RpcError(ErrorCode.NotFound, "core.error.notFound");
    }
    return { catalog: ctx.locales.catalog(params.lang) };
  },

  "plugin.list": (ctx) => ({ plugins: ctx.modules.installed() }),
};
