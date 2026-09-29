<script lang="ts">
  import { showStore } from "$lib/showStore.svelte";
  import type { Theme } from "$lib/types";

  function update(partial: Partial<Theme>) {
    showStore.updateTheme({ ...showStore.theme, ...partial });
  }
</script>

<section class="theme-editor">
  <h3>Tema</h3>

  <label>
    Sfondo
    <input
      type="color"
      value={showStore.theme.background_color}
      oninput={(e) => update({ background_color: (e.target as HTMLInputElement).value })}
    />
  </label>

  <label>
    Colore testo
    <input
      type="color"
      value={showStore.theme.font_color}
      oninput={(e) => update({ font_color: (e.target as HTMLInputElement).value })}
    />
  </label>

  <label>
    Dimensione testo
    <input
      type="range"
      min="24"
      max="160"
      value={showStore.theme.font_size}
      oninput={(e) => update({ font_size: Number((e.target as HTMLInputElement).value) })}
    />
    <span class="value">{showStore.theme.font_size}px</span>
  </label>

  <label>
    Allineamento
    <select
      value={showStore.theme.text_align}
      onchange={(e) => update({ text_align: (e.target as HTMLSelectElement).value as Theme["text_align"] })}
    >
      <option value="left">Sinistra</option>
      <option value="center">Centro</option>
      <option value="right">Destra</option>
    </select>
  </label>
</section>

<style>
  .theme-editor {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
  }

  h3 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-dim);
  }

  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.9rem;
  }

  .value {
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }
</style>
