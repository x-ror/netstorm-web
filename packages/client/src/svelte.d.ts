// A Svelte component, for the TypeScript that mounts it: unknown until ui/contracts.ts gives it its
// props and exports, since nothing here reads the types of the .svelte file itself.
declare module '*.svelte' {
  const component: unknown;
  export default component;
}
