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
    // Un plugin a pagamento si installa solo con una licenza valida (decisione 0013).
    const paid = (await ctx.marketplace.pluginOf(params.id))?.access === "paid";
    if (paid && !ctx.licenses.allows(params.id)) {
      throw new RpcError(ErrorCode.Forbidden, "core.error.licenseRequired");
    }
    const version = await ctx.marketplace.find(params.id, params.version);
    const data = await ctx.marketplace.download(version);
    return ctx.modules.install(
      { data },
      "registry",
      { id: params.id, version: version.version },
      paid ? { licensed: true } : {},
    );
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

  /** Valori in uso delle impostazioni di un plugin (predefiniti e scelte dell'utente). */
  "pluginsettings.get": (ctx, _session, params) => {
    const found = ctx.modules.installed().find((p) => p.manifest.id === params.pluginId);
    if (found === undefined) throw new RpcError(ErrorCode.NotFound, "core.error.moduleNotFound");
    return { values: ctx.pluginSettings.effective(found.manifest) };
  },

  "pluginsettings.set": async (ctx, _session, params) => {
    const found = ctx.modules.installed().find((p) => p.manifest.id === params.pluginId);
    if (found === undefined) throw new RpcError(ErrorCode.NotFound, "core.error.moduleNotFound");
    const values = await ctx.pluginSettings.set(found.manifest, params.values);
    ctx.supervisor.notifySettings(params.pluginId, values);
    return {};
  },

  "plugin.uninstall": async (ctx, _session, params) => {
    await ctx.modules.uninstall(params.pluginId);
    return {};
  },

  /** Comando di un modulo, eseguito nel suo processo (risposta entro 5 secondi). */
  "plugin.command": async (ctx, session, params) => ({
    result: await ctx.supervisor.command(
      session.pluginId,
      params.pluginId,
      params.command,
      params.params ?? {},
    ),
  }),
};
