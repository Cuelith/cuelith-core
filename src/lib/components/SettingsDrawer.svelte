<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import ThemeEditor from "$lib/components/ThemeEditor.svelte";
  import { pluginStore } from "$lib/pluginStore.svelte";
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
    await pluginStore.refresh();
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
      <h3>Plugin</h3>
      {#if pluginStore.plugins.length === 0}
        <p class="hint">Nessun plugin installato.</p>
      {:else}
        <div class="plugin-list">
          {#each pluginStore.plugins as plugin (plugin.id)}
            <div class="plugin-row">
              <div class="plugin-meta">
                <span class="plugin-name">{plugin.name}</span>
                <span class="plugin-kind">{plugin.kind === "service" ? "⚙ Servizio" : "▤ Interfaccia"} · v{plugin.version}</span>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  checked={plugin.enabled}
                  onchange={(e) => pluginStore.setEnabled(plugin.id, (e.target as HTMLInputElement).checked)}
                />
                <span class="slider"></span>
              </label>
              <button class="remove-btn" onclick={() => pluginStore.uninstall(plugin.id)}>Rimuovi</button>
            </div>
          {/each}
        </div>
      {/if}
      <button class="secondary" onclick={() => pluginStore.installFromFile()}>Installa da file…</button>
      {#if pluginStore.error}<p class="error">{pluginStore.error}</p>{/if}
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

  .plugin-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }

  .plugin-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem 0.7rem;
  }

  .plugin-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .plugin-name {
    font-size: 0.88rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plugin-kind {
    font-size: 0.7rem;
    color: var(--fg-faint);
  }

  .remove-btn {
    font-size: 0.74rem;
    padding: 0.3rem 0.55rem;
    background: transparent;
    border-color: var(--border);
    color: var(--fg-faint);
  }

  .switch {
    position: relative;
    width: 34px;
    height: 19px;
    flex: none;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    inset: 0;
    background: var(--border);
    border-radius: 20px;
    cursor: pointer;
    transition: 0.15s;
  }

  .slider::before {
    content: "";
    position: absolute;
    width: 14px;
    height: 14px;
    left: 2.5px;
    top: 2.5px;
    background: var(--fg-faint);
    border-radius: 50%;
    transition: 0.15s;
  }

  .switch input:checked + .slider {
    background: var(--accent-dim);
  }

  .switch input:checked + .slider::before {
    transform: translateX(15px);
    background: var(--accent);
  }
</style>
