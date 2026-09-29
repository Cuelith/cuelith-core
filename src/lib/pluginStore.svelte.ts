import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { PluginInfo } from "./types";

function createPluginStore() {
  let plugins = $state<PluginInfo[]>([]);
  let error = $state("");

  async function refresh() {
    try {
      plugins = await invoke<PluginInfo[]>("list_plugins");
      error = "";
    } catch (e) {
      error = String(e);
    }
  }

  async function installFromFile() {
    const path = await open({
      multiple: false,
      filters: [{ name: "Plugin Cuelith", extensions: ["zip"] }],
    });
    if (typeof path !== "string") return;
    try {
      await invoke("install_plugin", { path });
      error = "";
      await refresh();
    } catch (e) {
      error = String(e);
    }
  }

  async function setEnabled(id: string, enabled: boolean) {
    await invoke("set_plugin_enabled", { id, enabled });
    await refresh();
  }

  async function uninstall(id: string) {
    await invoke("uninstall_plugin", { id });
    await refresh();
  }

  return {
    get plugins() {
      return plugins;
    },
    get error() {
      return error;
    },
    refresh,
    installFromFile,
    setEnabled,
    uninstall,
  };
}

export const pluginStore = createPluginStore();
