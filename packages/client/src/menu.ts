import { mount, unmount } from 'svelte';
import type { DefTable } from '@netstorm/sim';
import type { Atlas } from './assets.js';
import type { Mission } from './game-data.js';
import { loadOptions, saveOptions, type MatchOptions } from './options.js';
import { typed, type MenuProps } from './ui/contracts.js';
import Menu from './ui/Menu.svelte';

/** Show the skirmish setup and resolve with the chosen options when the player starts. */
export function showMenu(
  root: HTMLElement,
  texts: Record<'uk' | 'en', Mission[]>,
  defs: DefTable,
  atlas: Atlas,
): Promise<MatchOptions> {
  root.hidden = false;
  return new Promise((resolve) => {
    const menu = mount(typed<MenuProps, Record<string, never>>(Menu), {
      target: root,
      props: {
        missions: texts.en,
        translated: texts.uk,
        defs,
        atlas,
        initial: loadOptions(texts.en),
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
