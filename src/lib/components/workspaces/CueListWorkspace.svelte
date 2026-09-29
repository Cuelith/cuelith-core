<script lang="ts">
  import { dndzone } from "svelte-dnd-action";
  import CueTypeIcon from "$lib/components/CueTypeIcon.svelte";
  import { showStore } from "$lib/showStore.svelte";
  import type { Cue } from "$lib/types";

  let items = $state<Cue[]>([]);

  $effect(() => {
    items = showStore.show.cues;
  });

  let armedIndex = $derived(items.findIndex((c) => c.id === showStore.previewId));
  let nextLabel = $derived(
    armedIndex >= 0 ? `#${armedIndex + 1} ${items[armedIndex].title}` : "nessuno pronto"
  );

  function handleConsider(e: CustomEvent<{ items: Cue[] }>) {
    items = e.detail.items;
  }

  function handleFinalize(e: CustomEvent<{ items: Cue[] }>) {
    items = e.detail.items;
    showStore.reorder(items.map((c) => c.id));
  }
</script>

<div class="cuelist-workspace">
  {#if items.length === 0}
    <p class="empty">Nessun cue ancora. Aggiungine uno dalla barra sopra.</p>
  {:else}
    <div class="cue-list" use:dndzone={{ items }} onconsider={handleConsider} onfinalize={handleFinalize}>
      {#each items as cue, i (cue.id)}
        <button
          class="cue-row"
          class:armed={cue.id === showStore.previewId}
          class:is-live={cue.id === showStore.liveId}
          onclick={(e) => { showStore.selectPreview(cue.id); (e.currentTarget as HTMLElement).blur(); }}
        >
          <span class="num">{String(i + 1).padStart(2, "0")}</span>
          <CueTypeIcon kind={cue.kind} />
          <span class="title">{cue.title}</span>
          <span class="status-chip">
            {cue.id === showStore.liveId ? "In onda" : cue.id === showStore.previewId ? "Pronto" : ""}
          </span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="footer">
    <span class="hint">prossimo: {nextLabel}</span>
    <button
      class="big-go"
      onclick={() => showStore.commitAndAdvance()}
      disabled={armedIndex < 0}
    >
      GO
    </button>
    <button class="clear-btn" onclick={() => showStore.clearLive()}>Ferma diretta</button>
  </div>
</div>

<style>
  .cuelist-workspace {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .cue-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .cue-row {
    display: grid;
    grid-template-columns: 2.2rem 0.9rem 1fr auto;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem 0.9rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    border-left: 3px solid transparent;
    background: var(--panel-2);
    cursor: pointer;
    font-size: 0.92rem;
    text-align: left;
    color: var(--fg);
  }

  .num {
    font-family: var(--font-mono);
    color: var(--fg-faint);
    font-size: 0.85rem;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-chip {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.2rem 0.5rem;
    border-radius: 20px;
    min-width: 3.2rem;
    text-align: center;
  }

  .cue-row.armed {
    border-left-color: var(--accent);
    background: var(--accent-dim);
  }

  .cue-row.armed .status-chip {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .cue-row.is-live {
    border-left-color: var(--live);
    background: var(--live-dim);
  }

  .cue-row.is-live .status-chip {
    background: var(--live);
    color: #fff;
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding-top: 0.8rem;
    border-top: 1px solid var(--border);
  }

  .hint {
    color: var(--fg-faint);
    font-size: 0.8rem;
    font-family: var(--font-mono);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .big-go {
    background: var(--accent);
    color: var(--accent-ink);
    border: none;
    border-radius: 10px;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.4rem;
    letter-spacing: 0.06em;
    padding: 0.55rem 2.6rem;
    cursor: pointer;
  }

  .big-go:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .clear-btn {
    font-size: 0.75rem;
    background: transparent;
    border-color: var(--border);
    color: var(--fg-faint);
    flex: 1;
    text-align: right;
  }

  .empty {
    color: var(--fg-faint);
    font-size: 0.85rem;
  }
</style>
