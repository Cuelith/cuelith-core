<script lang="ts">
  import { dndzone } from "svelte-dnd-action";
  import CueRenderer from "$lib/components/CueRenderer.svelte";
  import CueTypeIcon from "$lib/components/CueTypeIcon.svelte";
  import { showStore } from "$lib/showStore.svelte";
  import type { Cue } from "$lib/types";

  let items = $state<Cue[]>([]);

  $effect(() => {
    items = showStore.show.cues;
  });

  let liveCue = $derived(showStore.show.cues.find((c) => c.id === showStore.liveId) ?? null);
  let previewCue = $derived(showStore.show.cues.find((c) => c.id === showStore.previewId) ?? null);

  function handleConsider(e: CustomEvent<{ items: Cue[] }>) {
    items = e.detail.items;
  }

  function handleFinalize(e: CustomEvent<{ items: Cue[] }>) {
    items = e.detail.items;
    showStore.reorder(items.map((c) => c.id));
  }
</script>

<div class="grid-workspace">
  {#if items.length === 0}
    <p class="empty">Nessun cue ancora. Aggiungine uno dalla barra sopra.</p>
  {:else}
    <div class="grid" use:dndzone={{ items }} onconsider={handleConsider} onfinalize={handleFinalize}>
      {#each items as cue (cue.id)}
        <button
          class="card"
          class:selected={cue.id === showStore.previewId}
          class:is-live={cue.id === showStore.liveId}
          onclick={(e) => { showStore.selectPreview(cue.id); (e.currentTarget as HTMLElement).blur(); }}
        >
          <div class="g-stage">
            <CueRenderer cue={cue} theme={showStore.theme} compact />
          </div>
          <div class="g-meta">
            <CueTypeIcon kind={cue.kind} />
            <span class="g-title">{cue.title}</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}

  <div class="live-bar">
    <div class="mini" class:filled={!!liveCue}>
      {#if liveCue}<CueRenderer cue={liveCue} theme={showStore.theme} compact />{/if}
    </div>
    <div class="info">
      <span class="k">In onda</span>
      <span class="v">{liveCue?.title ?? "niente"}</span>
    </div>
    <button class="go primary" onclick={() => showStore.goLive()} disabled={!previewCue}>
      Manda in onda
    </button>
  </div>
</div>

<style>
  .grid-workspace {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0.7rem;
  }

  .card {
    background: var(--panel-2);
    border: 1.5px solid var(--border);
    border-radius: 9px;
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    text-align: left;
    color: var(--fg);
  }

  .g-stage {
    aspect-ratio: 4 / 3;
    background: #000;
  }

  .g-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem 0.6rem;
    font-size: 0.78rem;
    color: var(--fg-dim);
  }

  .g-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card.selected {
    border-color: var(--accent);
  }

  .card.selected .g-meta {
    color: var(--accent);
  }

  .card.is-live {
    border-color: var(--live);
  }

  .card.is-live .g-meta {
    color: #ff8f87;
  }

  .live-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.6rem 0.8rem;
  }

  .mini {
    width: 56px;
    aspect-ratio: 16 / 9;
    border-radius: 5px;
    background: #000;
    border: 1px solid var(--border);
    flex: none;
    overflow: hidden;
  }

  .mini.filled {
    border-color: var(--live);
  }

  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .k {
    font-family: var(--font-display);
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #ff8f87;
  }

  .v {
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .go {
    flex: none;
  }

  .empty {
    color: var(--fg-faint);
    font-size: 0.85rem;
  }
</style>
