import { mount, unmount } from 'svelte';
import type { Atlas } from './assets.js';
import type { Mission } from './game-data.js';
import { loadOptions, saveOptions, type MatchOptions } from './options.js';
import Menu from './ui/Menu.svelte';

/** Show the skirmish setup and resolve with the chosen options when the player starts. */
export function showMenu(
  root: HTMLElement,
  missions: Mission[],
  atlas: Atlas,
): Promise<MatchOptions> {
  root.hidden = false;
  return new Promise((resolve) => {
    const menu = mount(Menu, {
      target: root,
      props: {
        missions,
        atlas,
        initial: loadOptions(missions),
        onstart: (options: MatchOptions) => {
          saveOptions(options);
          void unmount(menu);
          root.hidden = true;
          resolve(options);
        },
      },
    });
  });
}
