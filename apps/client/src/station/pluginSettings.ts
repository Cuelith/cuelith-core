import { createContext, useContext } from "react";

/**
 * Impostazioni dei plugin (decisione 0017): una finestra uguale per tutti, che si apre dalla
 * scheda del plugin, dalla finestra Plugin e dalla ricerca. Chi la apre non deve sapere altro
 * che l'id del plugin.
 */
export interface PluginSettingsAccess {
  /** Il plugin ha almeno un'impostazione? */
  readonly has: (pluginId: string) => boolean;
  readonly open: (pluginId: string) => void;
}

export const PluginSettingsContext = createContext<PluginSettingsAccess>({
  has: () => false,
  open: () => undefined,
});

export function usePluginSettings(): PluginSettingsAccess {
  return useContext(PluginSettingsContext);
}
