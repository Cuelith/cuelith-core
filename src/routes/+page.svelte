<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import Composer from "$lib/components/Composer.svelte";
  import SettingsDrawer from "$lib/components/SettingsDrawer.svelte";
  import OutputStage from "$lib/components/OutputStage.svelte";
  import DualScreenWorkspace from "$lib/components/workspaces/DualScreenWorkspace.svelte";
  import CueListWorkspace from "$lib/components/workspaces/CueListWorkspace.svelte";
  import GridWorkspace from "$lib/components/workspaces/GridWorkspace.svelte";
  import { showStore } from "$lib/showStore.svelte";

  const isOutputWindow = getCurrentWindow().label === "output";

  type Mode = "dual" | "list" | "grid";
  const MODES: { id: Mode; label: string }[] = [
    { id: "dual", label: "Doppio schermo" },
    { id: "list", label: "Lista" },
    { id: "grid", label: "Griglia" },
  ];
  const MODE_KEY = "cuelith:workspace-mode";

  let mode = $state<Mode>("dual");
  let settingsOpen = $state(false);

  onMount(async () => {
    if (isOutputWindow) return;
    try {
      const stored = localStorage.getItem(MODE_KEY);
      if (stored === "dual" || stored === "list" || stored === "grid") {
        mode = stored;
      }
    } catch {
      // localStorage non disponibile: resta sulla modalita' di default.
    }
    await showStore.refresh();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.code === "Escape") {
      if (settingsOpen) {
        settingsOpen = false;
        return;
      }
      e.preventDefault();
      showStore.clearLive();
      return;
    }

    if (settingsOpen) return;

    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
      return;
    }

    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      showStore.advanceOrArm();
    } else if (e.code === "ArrowRight" || e.code === "ArrowDown") {
      e.preventDefault();
      showStore.previewStep(1);
    } else if (e.code === "ArrowLeft" || e.code === "ArrowUp") {
      e.preventDefault();
      showStore.previewStep(-1);
    }
  }

  onMount(() => {
    if (isOutputWindow) return;
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  function setMode(next: Mode) {
    mode = next;
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // preferenza non salvabile, non blocca l'uso dell'app
    }
  }

  let fileName = $derived(
    showStore.currentPath
      ? (showStore.currentPath.split(/[\\/]/).pop() ?? showStore.currentPath)
      : "non salvato"
  );
</script>

{#if isOutputWindow}
  <OutputStage />
{:else}
  <div class="shell">
    <header>
      <div class="title-row">
        <h1>Cuelith</h1>
        <nav class="mode-switch" aria-label="Modalita' di lavoro">
          {#each MODES as m}
            <button class:active={mode === m.id} onclick={() => setMode(m.id)}>{m.label}</button>
          {/each}
        </nav>
        <div class="file-controls">
          <button onclick={() => showStore.newShow()}>Nuovo</button>
          <button onclick={() => showStore.openFile()}>Apri…</button>
          <button onclick={() => showStore.save()}>Salva</button>
          <button onclick={() => showStore.saveAs()}>Salva con nome…</button>
          <span class="file-name">{fileName}</span>
          <button class="gear" onclick={() => (settingsOpen = true)} aria-label="Impostazioni">⚙</button>
        </div>
      </div>
      <Composer />
      <p class="shortcuts-hint">
        <kbd>Spazio</kbd> manda in onda e arma il prossimo · <kbd>←</kbd> <kbd>→</kbd> naviga la preview · <kbd>Esc</kbd> ferma la diretta
      </p>
    </header>

    <main class="workspace">
      {#if mode === "dual"}
        <DualScreenWorkspace />
      {:else if mode === "list"}
        <CueListWorkspace />
      {:else}
        <GridWorkspace />
      {/if}
    </main>
  </div>

  <SettingsDrawer bind:open={settingsOpen} />
{/if}

<style>
  .shell {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.3rem;
  }

  header {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .title-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
  }

  h1 {
    font-size: 1.6rem;
    letter-spacing: 0.02em;
  }

  .mode-switch {
    display: flex;
    gap: 0.25rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.2rem;
  }

  .mode-switch button {
    background: transparent;
    border: none;
    color: var(--fg-dim);
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.8rem;
    letter-spacing: 0.03em;
    padding: 0.4rem 0.7rem;
    border-radius: 6px;
  }

  .mode-switch button.active {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .file-controls {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .file-controls button {
    font-size: 0.82rem;
    padding: 0.4rem 0.7rem;
  }

  .file-name {
    color: var(--fg-faint);
    font-size: 0.8rem;
    margin: 0 0.2rem;
  }

  .gear {
    font-size: 0.95rem;
    padding: 0.35rem 0.6rem;
  }

  .workspace {
    min-width: 0;
  }

  .shortcuts-hint {
    margin: 0;
    font-size: 0.76rem;
    color: var(--fg-faint);
  }

  .shortcuts-hint kbd {
    font-family: var(--font-mono);
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.05rem 0.3rem;
    font-size: 0.72rem;
  }

  @media (max-width: 640px) {
    .shell {
      padding: 1rem;
    }

    .file-controls {
      margin-left: 0;
    }
  }
</style>
