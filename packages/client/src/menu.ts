import { mount, unmount } from 'svelte';
import type { DefTable } from '@netstorm/sim';
import type { Atlas } from './assets.js';
import type { Chapter, Mission } from './game-data.js';
import { doneMissions } from './campaign.js';
import { loadOptions, saveOptions, type MatchOptions } from './options.js';
import { typed, type MenuProps } from './ui/contracts.js';
import Menu from './ui/Menu.svelte';
import { setLocale } from './paraglide/runtime.js';

/** Show the skirmish setup and resolve with the chosen options when the player starts. */
export function showMenu(
  root: HTMLElement,
  texts: Record<'uk' | 'en', Mission[]>,
  campaign: Record<'uk' | 'en', Chapter[]>,
  defs: DefTable,
  atlas: Atlas,
): Promise<MatchOptions> {
  root.hidden = false;
  const initial = loadOptions(texts.en);
  // The interface speaks the language last chosen, as the missions' texts do.
  setLocale(initial.lang, { reload: false });
  return new Promise((resolve) => {
    const menu = mount(typed<MenuProps, Record<string, never>>(Menu), {
      target: root,
      props: {
        missions: texts.en,
        translated: texts.uk,
        campaign,
        done: doneMissions(),
        defs,
        atlas,
        initial,
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
