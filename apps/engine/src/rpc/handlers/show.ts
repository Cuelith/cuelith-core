import type { HandlerMap } from "../dispatch.js";

export const showHandlers: HandlerMap = {
  "show.new": (ctx, _session, params) => ({ rev: ctx.shows.newShow(params.name) }),
  "show.open": async (ctx, _session, params) => ({ rev: await ctx.shows.open(params.path) }),
  "show.save": (ctx, _session, params) => ctx.shows.save(params.path),
  "show.rename": (ctx, _session, params) => ({ rev: ctx.shows.rename(params.name) }),
  "show.discardRecovery": async (ctx) => ({ rev: await ctx.shows.discardRecovery() }),
};
