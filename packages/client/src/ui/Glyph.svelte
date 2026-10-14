<script lang="ts">
  /** Line icons of the top bar, drawn in the colour of their text. */
  let { name }: {
    name: 'storm' | 'energy' | 'clock' | 'pause' | 'play' | 'sound' | 'muted' | 'menu';
  } = $props();
</script>

<svg viewBox="0 0 16 16" aria-hidden="true">
  {#if name === 'storm'}
    <path d="M8 1 13 6 8 15 3 6Z" fill="currentColor" opacity=".35" />
    <path
      d="M8 1 13 6 8 15 3 6Z M3 6h10"
      fill="none"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linejoin="round"
    />
  {:else if name === 'energy'}
    <path d="M9 1 3 9h4l-1 6 6-8H8Z" fill="currentColor" />
  {:else if name === 'clock'}
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4" />
    <path
      d="M8 4.5V8l2.5 1.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
    />
  {:else if name === 'pause'}
    <rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor" />
    <rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor" />
  {:else if name === 'play'}
    <path d="M5 3v10l8-5Z" fill="currentColor" />
  {:else if name === 'sound' || name === 'muted'}
    <path d="M2 6h3l4-3v10L5 10H2Z" fill="currentColor" />
    {#if name === 'sound'}
      <path
        d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
      />
    {:else}
      <path d="m11 6 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    {/if}
  {:else}
    <path
      d="M3 4h10M3 8h10M3 12h10"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
    />
  {/if}
</svg>
