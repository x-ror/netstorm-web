<script lang="ts">
  import type { Atlas } from '../assets.js';
  import { iconOf } from '../hud-model.js';

  let { atlas, type, name, size }: { atlas: Atlas; type: string; name: string; size: number; } =
    $props();
  const icon = $derived(iconOf(atlas, type, size));
</script>

{#if icon}
  <span class="icon" style:--size="{size}px" aria-hidden="true">
    <i
      style:width="{icon.width}px"
      style:height="{icon.height}px"
      style:background={icon.background}
      style:transform="translate(-50%,-50%) scale({icon.scale})"
    ></i>
  </span>
{:else}
  <!-- A unit with no picture of its own (a Spell, a Thunder Spire): its initial. -->
  <span class="icon glyph" style:--size="{size}px" aria-hidden="true">{name.slice(0, 1)}</span>
{/if}
