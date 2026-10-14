<script lang="ts">
  import type { Planks } from '../hud-model.js';

  /** A piece drawn with the frames of the bridge it will be: cells cut out of the atlas. */
  let { piece }: { piece: Planks; } = $props();
</script>

<span class="planks" style:width="{piece.width}px" style:height="{piece.height}px">
  {#each piece.planks as plank, i (i)}
    <i
      style:left="{plank.left}px"
      style:top="{plank.top}px"
      style:width="{plank.width}px"
      style:height="{plank.height}px"
      style:background={plank.background}
    ></i>
  {/each}
</span>
