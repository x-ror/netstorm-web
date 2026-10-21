import type { Command, CommandError } from './commands.js';

type Payloads = {
  bridge: [number, number][];
  /** A cell of bridge cracked: worn down, or shaken by a blast beside it. */
  'bridge cracked': { x: number; y: number; };
  /** A cell of bridge fell away. */
  'bridge fell': { x: number; y: number; };
  build: { id: number; type: string; };
  produce: { workshop: number; type: string; };
  upgrade: { workshop: number; level: number; };
  destroyed: { id: number; type: string; };
  reward: { id: number; amount: number; };
  salvaged: { id: number; type: string; refund: number; };
  delivered: { transport: number; };
  spell: { transport: number; spell: string; };
  cast: { transport: number; spell: string; };
  captured: { priest: number; };
  chained: { priest: number; altar: number; };
  /** "Too Early! Priests may not be Sacrificed within the first few minutes": the carrier holds
   * its captive and stops. */
  'too early': { transport: number; };
  rune: { priest: number; runes: number; };
  released: { priest: number; };
  saved: { priest: number; owner: number; };
  /** `gift`: GIFT_STORM, GIFT_UPGRADE (the Altar stays) or the unit now known. */
  sacrifice: { victim: number; gift: string; };
  /** An Altar's Upgrade has played: it is of `level` now. */
  'altar upgrade': { altar: number; level: number; };
  /** A new geyser came up during the battle. */
  geyser: { id: number; };
  /** An Ice Cannon shot hit `hit` and threw a ricochet into `to`. */
  ricochet: { hit: number; to: number; };
  rejected: { cmd: Command['t']; err: CommandError; };
  victory: undefined;
  'priest up': undefined;
  'priest down': undefined;
};

export type Event = {
  [K in keyof Payloads]: {
    tick: number;
    what: K;
    who: number;
  } & (Payloads[K] extends undefined ? { data?: undefined; } : { data: Payloads[K]; });
}[keyof Payloads];

export type EventInput = {
  [K in keyof Payloads]: {
    what: K;
    who: number;
  } & (Payloads[K] extends undefined ? { data?: undefined; } : { data: Payloads[K]; });
}[keyof Payloads];
