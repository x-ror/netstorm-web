import type { Command, CommandError } from './commands.js';

type Payloads = {
  bridge: [number, number][];
  build: { id: number; type: string; };
  destroyed: { id: number; type: string; };
  delivered: { transport: number; };
  captured: { priest: number; };
  chained: { priest: number; altar: number; };
  rune: { priest: number; runes: number; };
  released: { priest: number; };
  sacrifice: { victim: number; };
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
