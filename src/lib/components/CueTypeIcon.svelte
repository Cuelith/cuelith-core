<script lang="ts">
  let { kind }: { kind: string } = $props();
</script>

{#if kind === "core.image"}
  <svg class="type-icon" viewBox="0 0 9 9" aria-hidden="true"><circle cx="4.5" cy="4.5" r="4.2" /></svg>
{:else}
  <svg class="type-icon" viewBox="0 0 9 9" aria-hidden="true"><rect width="9" height="9" rx="1.5" /></svg>
{/if}

<style>
  .type-icon {
    width: 0.55rem;
    height: 0.55rem;
    flex: none;
    fill: currentColor;
  }
</style>
