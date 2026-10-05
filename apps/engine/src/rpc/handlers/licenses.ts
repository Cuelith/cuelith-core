import { ErrorCode, RpcError } from "@cuelith/protocol";
import type { EngineContext } from "../../context.js";
import type { HandlerMap } from "../dispatch.js";

/** Il plugin deve essere nel marketplace come «a pagamento»: altrimenti non c'è nulla da attivare. */
async function requirePaid(ctx: EngineContext, pluginId: string): Promise<void> {
  const plugin = await ctx.marketplace.pluginOf(pluginId);
  if (plugin?.access !== "paid") {
    throw new RpcError(ErrorCode.InvalidParameters, "core.error.licenseNotPaid");
  }
}

/** Licenze dei plugin a pagamento (decisione 0013): ambito «plugins», cioè la regia. */
export const licenseHandlers: HandlerMap = {
  "license.list": (ctx) => ({
    available: ctx.licenses.available(),
    licenses: ctx.licenses.list(ctx.modules.licensedIds()),
  }),

  "license.activate": async (ctx, _session, params) => {
    await requirePaid(ctx, params.pluginId);
    return ctx.licenses.activate(params.pluginId, params.licenseKey);
  },

  "license.refresh": (ctx, _session, params) => ctx.licenses.refresh(params.pluginId),

  "license.deactivate": async (ctx, _session, params) => {
    await ctx.licenses.deactivate(params.pluginId);
    return {};
  },
};
