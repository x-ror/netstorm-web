import type { Component } from 'svelte';
import type { DefTable } from '@netstorm/sim';
import type { Atlas } from '../assets.js';
import type { Mission } from '../game-data.js';
import type { HudActions, HudModel, LogLine, Page } from '../hud-model.js';
import type { MatchOptions } from '../options.js';

/**
 * What each component takes and what it lets its caller do. Nothing reads the types of a .svelte
 * file (svelte-check needs TypeScript 5 or 6, the project is on 7), so they are written down here
 * once: the components type their props with them, `mount` checks the props passed in, and
 * `contract` checks at mount that the component has every function it promises.
 */
export type HudProps = {
  atlas: Atlas;
  actions: HudActions;
};

export type HudExports = {
  /** Draw the panels anew from the world as it is now. */
  update(model: HudModel): void;
  /** Put lines on top of the log, the newest last in `lines`. */
  addLog(lines: LogLine[]): void;
  showPage(page: Page): void;
  hidePage(): void;
};

export type MenuProps = {
  /** The missions with the original's English texts, and with Ukrainian ones. */
  missions: Mission[];
  translated: Mission[];
  defs: DefTable;
  atlas: Atlas;
  initial: MatchOptions;
  onstart: (options: MatchOptions) => void;
};

/** A component as its contract says it is. */
export function typed<
  Props extends Record<string, unknown>,
  Exports extends Record<string, unknown>,
>(
  component: unknown,
): Component<Props, Exports> {
  return component as Component<Props, Exports>;
}

/** The exports of a mounted component, once each promised function is found on it. */
export function contract<Exports extends Record<string, unknown>>(
  name: string,
  instance: Exports,
  functions: readonly (keyof Exports & string)[],
): Exports {
  for (const fn of functions) {
    if (typeof instance[fn] !== 'function') {
      throw new TypeError(`${name}.svelte does not export ${fn}()`);
    }
  }

  return instance;
}
