<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { fade } from "svelte/transition";
  import CueRenderer from "./CueRenderer.svelte";
  import type { LivePayload } from "$lib/types";
  import { DEFAULT_THEME } from "$lib/types";

  let payload = $state<LivePayload | null>(null);

  onMount(() => {
    const unlisten = listen<LivePayload>("live-changed", (event) => {
      payload = event.payload;
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  });
</script>

<div class="output-root">
  {#key payload?.cue?.id ?? "empty"}
    <div class="layer" transition:fade={{ duration: 250 }}>
      <CueRenderer cue={payload?.cue ?? null} theme={payload?.theme ?? DEFAULT_THEME} />
    </div>
  {/key}
</div>

<style>
  .output-root {
    position: relative;
    width: 100vw;
    height: 100vh;
    background: #000;
    overflow: hidden;
  }

  .layer {
    position: absolute;
    inset: 0;
  }
</style>
