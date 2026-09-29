import { invoke } from "@tauri-apps/api/core";
import { showStore } from "$lib/showStore.svelte";

type BridgeRequest = {
  id: string;
  type: string;
  payload?: unknown;
};

type BridgeOptions = {
  /** Chiamato dopo che un'azione "add-cue" e' andata a buon fine. */
  onCueAdded?: () => void;
};

/**
 * Inoltra i messaggi postMessage in arrivo da UN iframe di plugin verso
 * `plugin_invoke`, e la risposta indietro. I permessi sono verificati lato
 * Rust (vedi core/plugins.rs), non qui: questo bridge fa solo da corriere.
 *
 * `plugin_invoke` modifica lo Show direttamente in Rust senza notificare il
 * frontend: dopo un "add-cue" riuscito, lo store va quindi aggiornato a
 * mano, altrimenti il nuovo cue esiste nel core ma non appare nell'editor
 * finche' qualcos'altro non forza un refresh (bug osservato: il cue
 * compariva solo dopo un'azione successiva, con l'operatore convinto che
 * l'aggiunta non avesse funzionato).
 */
export function attachPluginBridge(
  pluginId: string,
  iframe: HTMLIFrameElement,
  options: BridgeOptions = {}
) {
  function handleMessage(event: MessageEvent) {
    if (event.source !== iframe.contentWindow) return;
    const data = event.data as BridgeRequest;
    if (!data || typeof data.id !== "string" || typeof data.type !== "string") return;

    invoke("plugin_invoke", {
      pluginId,
      action: data.type,
      payload: data.payload ?? null,
    })
      .then(async (result) => {
        iframe.contentWindow?.postMessage({ id: data.id, ok: true, result }, "*");
        if (data.type === "add-cue") {
          await showStore.refresh();
          options.onCueAdded?.();
        }
      })
      .catch((error) => {
        iframe.contentWindow?.postMessage({ id: data.id, ok: false, error: String(error) }, "*");
      });
  }

  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
}
