<script lang="ts">
  import { onMount } from "svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import { showStore } from "$lib/showStore.svelte";
  import { pluginStore } from "$lib/pluginStore.svelte";
  import PluginPanel from "$lib/components/PluginPanel.svelte";
  import type { PluginInfo } from "$lib/types";

  let newSlideText = $state("");
  let openPlugin = $state<PluginInfo | null>(null);

  let pluginButtons = $derived(
    pluginStore.plugins.filter((p) => p.enabled && p.kind === "panel" && p.composer_button)
  );

  onMount(() => {
    pluginStore.refresh();
  });

  async function addSlide() {
    const text = newSlideText.trim();
    if (!text) return;
    await showStore.addSlide(text);
    newSlideText = "";
  }

  async function addImage() {
    const path = await open({
      multiple: false,
      filters: [{ name: "Immagini", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
    });
    if (typeof path === "string") {
      await showStore.addImage(path);
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      addSlide();
    }
  }
</script>

<div class="composer">
  <textarea
    bind:value={newSlideText}
    onkeydown={onKeydown}
    placeholder="Scrivi il testo di una slide... (Ctrl+Invio per aggiungerla)"
    rows="1"
  ></textarea>
  <button onclick={addSlide} disabled={!newSlideText.trim()}>+ Slide</button>
  <button onclick={addImage}>+ Immagine</button>
  {#each pluginButtons as plugin (plugin.id)}
    <button class="plugin-btn" onclick={() => (openPlugin = plugin)}>
      + {plugin.composer_button?.label}
    </button>
  {/each}
</div>

{#if openPlugin}
  <PluginPanel plugin={openPlugin} onClose={() => (openPlugin = null)} />
{/if}

<style>
  .composer {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    flex-wrap: wrap;
  }

  textarea {
    flex: 1;
    min-width: 160px;
    resize: vertical;
    min-height: 2.4rem;
    padding: 0.55rem 0.7rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--panel-2);
  }

  textarea:focus {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .plugin-btn {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
