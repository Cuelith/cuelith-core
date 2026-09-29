<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import ThemeEditor from "$lib/components/ThemeEditor.svelte";
  import type { MonitorInfo } from "$lib/types";

  let { open = $bindable(false) }: { open: boolean } = $props();

  let monitors = $state<MonitorInfo[]>([]);
  let error = $state("");

  onMount(async () => {
    try {
      monitors = await invoke<MonitorInfo[]>("list_monitors");
    } catch (e) {
      error = String(e);
    }
  });

  async function openOutput(index: number) {
    error = "";
    try {
      await invoke("open_output_window", { monitorIndex: index });
    } catch (e) {
      error = String(e);
    }
  }

  async function closeOutput() {
    try {
      await invoke("close_output_window");
    } catch (e) {
      error = String(e);
    }
  }
</script>

{#if open}
  <div class="backdrop" onclick={() => (open = false)} role="presentation"></div>
  <aside class="drawer">
    <div class="drawer-head">
      <h2>Impostazioni</h2>
      <button class="close-btn" onclick={() => (open = false)} aria-label="Chiudi">✕</button>
    </div>

    <section>
      <h3>Output</h3>
      {#if monitors.length === 0}
        <p class="hint">Nessun monitor rilevato.</p>
      {:else}
        <div class="monitor-list">
          {#each monitors as monitor, index}
            <button onclick={() => openOutput(index)}>Output su {monitor.name}</button>
          {/each}
        </div>
      {/if}
      <button class="secondary" onclick={closeOutput}>Chiudi output</button>
      {#if error}<p class="error">{error}</p>{/if}
    </section>

    <section>
      <ThemeEditor />
    </section>
  </aside>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10;
  }

  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(340px, 90vw);
    background: var(--panel);
    border-left: 1px solid var(--border);
    padding: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    overflow-y: auto;
    z-index: 11;
  }

  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--fg-dim);
    font-size: 1rem;
    padding: 0.2rem 0.5rem;
  }

  h3 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-dim);
    margin-bottom: 0.6rem;
  }

  .monitor-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }

  .secondary {
    background: transparent;
  }

  .hint {
    color: var(--fg-faint);
    font-size: 0.85rem;
  }

  .error {
    color: var(--live);
    font-size: 0.85rem;
  }
</style>
