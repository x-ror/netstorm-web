import { mount, unmount } from 'svelte';
import { type WorldView } from '@netstorm/sim';
import type { Atlas } from './assets.js';
import { hudModel, type HudActions, type LogLine } from './hud-model.js';
import type { UiState } from './ui-state.js';
import { contract, typed, type HudExports, type HudProps } from './ui/contracts.js';
import Hud from './ui/Hud.svelte';

export type { HudActions } from './hud-model.js';

/** The panels around the map: drawn by Hud.svelte from the world as `render` finds it. */
export function createHud(
  root: HTMLElement,
  world: WorldView,
  me: number,
  ui: UiState,
  actions: HudActions,
  atlas: Atlas,
) {
  const hud = contract('Hud',
    mount(typed<HudProps, HudExports>(Hud), { target: root, props: { atlas, actions } }), [
    'update',
    'addLog',
    'showPage',
    'hidePage',
    'openContext',
  ]);

  return {
    render(): void {
      hud.update(hudModel(world, me, ui, atlas));
    },
    /** Put lines of the battle log on top, the newest last in `lines`. */
    log(lines: LogLine[]): void {
      if (lines.length) {
        hud.addLog(lines);
      }
    },
    /** Show a page of the mission's script over the map, with its buttons; `actions.page` is
     * told which one is pressed. */
    showPage(title: string, text: string, buttons: readonly string[]): void {
      hud.showPage({ title, text, buttons });
    },
    hidePage(): void {
      hud.hidePage();
    },
    /** The menu of the selected unit, opened at a point on the screen. */
    context(x: number, y: number): void {
      hud.openContext(x, y);
    },
    dispose(): void {
      void unmount(hud);
      root.replaceChildren();
    },
  };
}
