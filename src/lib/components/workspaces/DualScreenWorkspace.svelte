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

  let previewCue = $derived(showStore.show.cues.find((c) => c.id === showStore.previewId) ?? null);
  let liveCue = $derived(showStore.show.cues.find((c) => c.id === showStore.liveId) ?? null);

  function handleConsider(e: CustomEvent<{ items: Cue[] }>) {
    items = e.detail.items;
  }

  function handleFinalize(e: CustomEvent<{ items: Cue[] }>) {
    items = e.detail.items;
    showStore.reorder(items.map((c) => c.id));
  }
</script>

<div class="dual">
  <div class="panes">
    <div class="pane preview">
      <div class="pane-label"><span class="dot"></span>Preview</div>
      <div class="stage-wrap">
        <CueRenderer cue={previewCue} theme={showStore.theme} />
      </div>
    </div>

    <div class="go-col">
      <button class="go-btn" onclick={() => showStore.goLive()} disabled={!previewCue}>
        Manda<br />in onda
      </button>
      <button class="clear-btn" onclick={() => showStore.clearLive()}>Ferma</button>
    </div>

    <div class="pane live" class:is-live={!!liveCue}>
      <div class="pane-label"><span class="dot"></span>In onda</div>
      <div class="stage-wrap">
        <CueRenderer cue={liveCue} theme={showStore.theme} />
      </div>
    </div>
  </div>

  {#if items.length === 0}
    <p class="empty">Nessun cue ancora. Aggiungine uno dalla barra sopra.</p>
  {:else}
    <div class="filmstrip" use:dndzone={{ items }} onconsider={handleConsider} onfinalize={handleFinalize}>
      {#each items as cue (cue.id)}
        <button
          class="thumb"
          class:is-preview={cue.id === showStore.previewId}
          class:is-live={cue.id === showStore.liveId}
          onclick={(e) => { showStore.selectPreview(cue.id); (e.currentTarget as HTMLElement).blur(); }}
        >
          <div class="t-stage">
            <CueRenderer cue={cue} theme={showStore.theme} compact />
          </div>
          <div class="t-label">
            <CueTypeIcon kind={cue.kind} />
            <span class="t-title">{cue.title}</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dual {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .panes {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 0.9rem;
    align-items: stretch;
  }

  .pane {
    border-radius: 9px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: #000;
    min-width: 0;
  }

  .pane-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-display);
    font-weight: 600;
    letter-spacing: 0.08em;
    font-size: 0.75rem;
    text-transform: uppercase;
    padding: 0.45rem 0.7rem;
    background: var(--panel-2);
    color: var(--fg-dim);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }

  .pane.live.is-live {
    border-color: var(--live);
  }

  .pane.live.is-live .pane-label {
    background: var(--live-dim);
    color: #ff8f87;
  }

  .stage-wrap {
    aspect-ratio: 16 / 9;
  }

  .go-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .go-btn {
    background: var(--accent);
    color: var(--accent-ink);
    border: none;
    border-radius: 8px;
    font-family: var(--font-display);
    font-weight: 700;
    letter-spacing: 0.03em;
    font-size: 0.95rem;
    line-height: 1.15;
    padding: 0.9rem 1.1rem;
    cursor: pointer;
  }

  .go-btn:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .clear-btn {
    font-size: 0.72rem;
    background: transparent;
    border-color: var(--border);
    color: var(--fg-faint);
    padding: 0.3rem 0.6rem;
  }

  .filmstrip {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    padding-bottom: 4px;
    min-height: 4.5rem;
  }

  .thumb {
    flex: 0 0 auto;
    width: 120px;
    border-radius: 7px;
    border: 1.5px solid var(--border);
    background: var(--panel-2);
    color: var(--fg-dim);
    cursor: pointer;
    padding: 0;
    overflow: hidden;
    text-align: left;
  }

  .t-stage {
    aspect-ratio: 16 / 9;
    background: #000;
  }

  .t-label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.4rem;
    font-size: 0.68rem;
  }

  .t-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thumb.is-preview {
    border-color: var(--accent);
  }

  .thumb.is-preview .t-label {
    color: var(--accent);
  }

  .thumb.is-live {
    border-color: var(--live);
  }

  .thumb.is-live .t-label {
    color: #ff8f87;
  }

  .empty {
    color: var(--fg-faint);
    font-size: 0.85rem;
  }

  @media (max-width: 640px) {
    .panes {
      grid-template-columns: 1fr;
    }

    .go-col {
      flex-direction: row;
    }
  }
</style>
