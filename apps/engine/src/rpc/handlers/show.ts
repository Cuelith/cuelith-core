import type { HandlerMap } from "../dispatch.js";
import { requireLocal } from "./library.js";

export const showHandlers: HandlerMap = {
  "show.new": (ctx, _session, params) => ({ rev: ctx.shows.newShow(params.name) }),
  // Apri e Salva con un percorso toccano file del computer del motore: solo in locale.
  "show.open": async (ctx, session, params) => {
    requireLocal(session);
    return { rev: await ctx.shows.open(params.path) };
  },
  "show.save": (ctx, session, params) => {
    if (params.path !== undefined) requireLocal(session);
    return ctx.shows.save(params.path);
  },
  "show.rename": (ctx, _session, params) => ({ rev: ctx.shows.rename(params.name) }),
  "show.discardRecovery": async (ctx) => ({ rev: await ctx.shows.discardRecovery() }),
};
