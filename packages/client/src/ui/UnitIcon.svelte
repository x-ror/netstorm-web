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
      style:transform="translate(-50%,-50%) scale({icon.scale})"
    >
      {#each icon.layers as layer, index (index)}
        <b
          style:left="{layer.left}px"
          style:top="{layer.top}px"
          style:width="{layer.width}px"
          style:height="{layer.height}px"
          style:background={layer.background}
        ></b>
      {/each}
    </i>
  </span>
{:else}
  <!-- A unit with no picture of its own (a Spell, a Thunder Spire): its initial. -->
  <span class="icon glyph" style:--size="{size}px" aria-hidden="true">{name.slice(0, 1)}</span>
{/if}
