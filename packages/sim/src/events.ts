import type { Command, CommandError } from './commands.js';

type Payloads = {
  bridge: [number, number][];
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
  rune: { priest: number; runes: number; };
  released: { priest: number; };
  saved: { priest: number; owner: number; };
  sacrifice: { victim: number; };
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
