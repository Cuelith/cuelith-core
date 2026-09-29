<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { attachPluginBridge } from "$lib/plugin-bridge";
  import type { PluginInfo } from "$lib/types";

  let { plugin, onClose }: { plugin: PluginInfo; onClose: () => void } = $props();

  let iframeEl: HTMLIFrameElement | undefined = $state();
  let detach: (() => void) | undefined;

  let src = $derived(
    plugin.ui ? convertFileSrc(`${plugin.dir}/${plugin.ui.entry}`) : ""
  );

  onMount(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  });

  function handleLoad() {
    if (!iframeEl) return;
    detach?.();
    detach = attachPluginBridge(plugin.id, iframeEl, {
      // Torna alla scaletta poco dopo l'aggiunta, cosi' l'operatore trova
      // subito i controlli di preview/diretta invece di restare bloccato
      // nel pannello del plugin.
      onCueAdded: () => setTimeout(onClose, 700),
    });
  }

  onDestroy(() => {
    detach?.();
  });
</script>

<div class="backdrop" onclick={onClose} role="presentation"></div>
<div class="panel" role="dialog" aria-modal="true" aria-label={plugin.name}>
  <div class="panel-head">
    <div>
      <span class="eyebrow">Plugin "{plugin.name}"</span>
    </div>
    <button class="close-btn" onclick={onClose} aria-label="Chiudi">✕</button>
  </div>
  <iframe
    bind:this={iframeEl}
    {src}
    title={plugin.name}
    sandbox="allow-scripts"
    onload={handleLoad}
  ></iframe>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 20;
  }

  .panel {
    position: fixed;
    inset: 4vh 6vw;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 21;
    box-shadow: 0 30px 60px -20px rgba(0, 0, 0, 0.7);
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.8rem 1.1rem;
    border-bottom: 1px solid var(--border);
    background: var(--panel-2);
  }

  .eyebrow {
    font-family: var(--font-display);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-size: 0.78rem;
    color: var(--accent);
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--fg-dim);
    font-size: 1rem;
    padding: 0.2rem 0.5rem;
  }

  iframe {
    flex: 1;
    border: none;
    background: #0b0d12;
  }

  @media (max-width: 640px) {
    .panel {
      inset: 0;
      border-radius: 0;
    }
  }
</style>
