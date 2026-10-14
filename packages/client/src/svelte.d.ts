// Svelte components, for TypeScript files that mount them. Their props are typed by the modules
// that build them (hud-model.ts, options.ts); the compiler checks the markup.
declare module '*.svelte' {
  import type { Component } from 'svelte';

  const component: Component<Record<string, unknown>>;
  export default component;
}
