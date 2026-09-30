import { ErrorCode, providerOf, RpcError, type StateDocument } from "@cuelith/protocol";
import type { ModuleRegistry } from "../modules/registry.js";

/** Tipi di elemento che il nucleo sa disegnare; gli altri arrivano dai moduli. */
export const CORE_ITEM_TYPES: readonly string[] = ["core.text"];

/**
 * Controlla che un tipo di elemento sia disponibile e, se viene da un modulo,
 * lo dichiara nello show (cap. 22: show.plugins): chi apre il file su un altro
 * computer sa quale modulo serve.
 */
export function declareItemType(draft: StateDocument, type: string, modules: ModuleRegistry): void {
  const declared = Object.keys(draft.show.plugins);
  const active = modules.active().map((m) => m.manifest.id);
  const provider = providerOf(type, [...new Set([...declared, ...active])]);
  if (provider === undefined || (provider === "core" && !CORE_ITEM_TYPES.includes(type))) {
    throw new RpcError(ErrorCode.InvalidParameters, "core.error.itemTypeUnknown");
  }
  if (provider === "core" || declared.includes(provider)) return;
  const module = modules.active().find((m) => m.manifest.id === provider);
  if (module === undefined) {
    throw new RpcError(ErrorCode.InvalidParameters, "core.error.itemTypeUnknown");
  }
  draft.show.plugins[provider] = `^${module.manifest.version}`;
}
