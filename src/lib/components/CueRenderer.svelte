<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import type { Cue, Theme } from "$lib/types";

  let {
    cue,
    theme,
    compact = false,
  }: { cue: Cue | null; theme: Theme; compact?: boolean } = $props();

  let backgroundStyle = $derived(
    theme.background_image
      ? `background-image: url('${convertFileSrc(theme.background_image)}'); background-size: cover; background-position: center;`
      : ""
  );

  // Nelle miniature il font_size letterale del tema (pensato per lo schermo
  // di proiezione) sarebbe illeggibile o straborderebbe: usiamo una taglia
  // fissa piccola invece di scalare proporzionalmente il canvas.
  let textStyle = $derived(
    compact
      ? `font-family: ${theme.font_family}; font-size: 0.55rem; color: ${theme.font_color}; text-align: ${theme.text_align};`
      : `font-family: ${theme.font_family}; font-size: ${theme.font_size}px; color: ${theme.font_color}; text-align: ${theme.text_align};`
  );
</script>

<div class="stage" style="background-color: {theme.background_color}; {backgroundStyle}">
  {#if cue?.kind === "core.slide"}
    <p class="slide-text" style={textStyle}>
      {(cue.payload.text as string | undefined) ?? ""}
    </p>
  {:else if cue?.kind === "core.image"}
    <img class="slide-image" src={convertFileSrc(cue.payload.path as string)} alt={cue.title} />
  {/if}
</div>

<style>
  .stage {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .slide-text {
    margin: 0;
    padding: 4%;
    white-space: pre-wrap;
    max-width: 92%;
    line-height: 1.25;
  }

  .slide-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
</style>
