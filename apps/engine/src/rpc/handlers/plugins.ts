import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { ErrorCode, PLUGIN_PACKAGE_EXTENSION, RpcError } from "@cuelith/protocol";
import type { HandlerMap } from "../dispatch.js";
import { requireLocal } from "./library.js";

export const pluginHandlers: HandlerMap = {
  "registry.list": async (ctx, _session, params) => {
    const list = await ctx.marketplace.list(params.refresh === true);
    return {
      plugins: list.plugins,
      source: list.source,
      ...(list.fetchedAt === undefined ? {} : { fetchedAt: list.fetchedAt }),
    };
  },

  "plugin.installFromRegistry": async (ctx, _session, params) => {
    const version = await ctx.marketplace.find(params.id, params.version);
    const data = await ctx.marketplace.download(version);
    return ctx.modules.install({ data }, "registry", { id: params.id, version: version.version });
  },

  /** Da un pacchetto .cpkg o da una cartella del computer del motore (sviluppo, prove). */
  "plugin.install": async (ctx, session, params) => {
    requireLocal(session);
    if (!isAbsolute(params.path)) {
      throw new RpcError(ErrorCode.InvalidParameters, "core.error.modulePathInvalid");
    }
    const info = await stat(params.path).catch(() => undefined);
    if (info === undefined) throw new RpcError(ErrorCode.NotFound, "core.error.modulePathInvalid");
    if (info.isDirectory()) return ctx.modules.install({ dir: params.path }, "local");
    if (!params.path.toLowerCase().endsWith(PLUGIN_PACKAGE_EXTENSION)) {
      throw new RpcError(ErrorCode.InvalidParameters, "core.error.modulePathInvalid");
    }
    return ctx.modules.install({ data: new Uint8Array(await readFile(params.path)) }, "local");
  },

  "plugin.enable": async (ctx, _session, params) => {
    await ctx.modules.setEnabled(params.pluginId, true);
    return {};
  },

  "plugin.disable": async (ctx, _session, params) => {
    await ctx.modules.setEnabled(params.pluginId, false);
    return {};
  },

  "plugin.uninstall": async (ctx, _session, params) => {
    await ctx.modules.uninstall(params.pluginId);
    return {};
  },
};
