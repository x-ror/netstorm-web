/** A skirmish on rectangular islands, for tests and for maps that bring no islands. Missions are
 * built from the original's maps in mission.ts. */
import { World } from './world.js';
import type { Theme, DefTable } from './defs.js';
import {
  BRIDGE_SETS,
  BRIDGE_SLOTS,
  DEFAULT_KILL_REWARD,
  DEFAULT_UNIT_RATE,
  GEYSER_STOCK,
  GEYSER_STOCKS,
  HAND_SIZE,
  KILL_REWARDS,
  UNIT_RATES,
  type BridgeSet,
  DEVASTATION,
  OUTPOST,
} from './state.js';

/** The battle options of a skirmish; what is left out, or is not a value of the option, takes the
 * campaign's value. */
export interface SkirmishOptions {
  bridges?: BridgeSet;
  slots?: number;
  /** Seconds, one of UNIT_RATES. */
  unitRate?: number;
  /** Per cent, one of KILL_REWARDS. */
  killReward?: number;
  /** Storm Power, one of GEYSER_STOCKS. */
  geyserStock?: number;
  /** `allowAnyCapture` of a mission: friendly Priests may be carried off to safety. */
  anyCapture?: boolean;
}

function pick(values: readonly number[], value: number | undefined, fallback: number): number {
  return values.find((allowed) => allowed === value) ?? fallback;
}

export interface SkirmishPlayer {
  id: number;
  name: string;
  theme: Theme;
  x: number;
  y: number;
  storm?: number;
  tech?: string[];
}

const DEFAULT_STORM = 2000; // starting Storm Power

const BASE_TECH = [
  'sunwalker',
  'suncannon',
  'sunarcher',
  'sunblocker',
  'sunbattery',
  'sunballoon',
  'sunaviary',
  'sunfence',
];

/** Set the battle options of a world. */
export function applyOptions(w: World, options: SkirmishOptions): void {
  w.bridgeSet = Math.max(0, BRIDGE_SETS.indexOf(options.bridges ?? 'standard'));
  w.bridgeSlots = pick(BRIDGE_SLOTS, options.slots, HAND_SIZE);
  w.unitRate = pick(UNIT_RATES, options.unitRate, DEFAULT_UNIT_RATE);
  w.killReward = pick(KILL_REWARDS, options.killReward, DEFAULT_KILL_REWARD);
  w.geyserStock = pick(GEYSER_STOCKS, options.geyserStock, GEYSER_STOCK);
  w.anyCapture = options.anyCapture ?? false;
}

/** What a player of a Fury knows at the start: the Sun units and those of his own Fury. */
export function skirmishTech(defs: DefTable, theme: Theme): string[] {
  const themeTech = [
    `${theme}battery`,
    `${theme}walker`,
    `${theme}cannon`,
    `${theme}archer`,
    `${theme}blocker`,
    `${theme}fence`,
    `${theme}aviary`,
    `${theme}balloon`,
  ].filter((t) => defs.has(t));
  return [...BASE_TECH, ...themeTech];
}

export function createSkirmish(
  defs: DefTable,
  seed: number,
  players: SkirmishPlayer[],
  geysers: [number, number][],
  options: SkirmishOptions = {},
): World {
  const w = new World(defs, seed);
  applyOptions(w, options);

  for (const p of players) {
    if (p.theme === 'sun') {
      throw new Error('a player must follow Wind, Rain or Thunder (Sun has no temple)');
    }
  }

  for (const p of players) {
    w.addPlayer(p.id, p.name, p.theme, p.storm ?? DEFAULT_STORM,
      p.tech ?? [...skirmishTech(defs, p.theme), OUTPOST, DEVASTATION]);

    // oxlint-disable no-magic-numbers -- starting base layout, offsets from the player origin
    w.addIsland(p.x - 10, p.y - 8, 21, 17, p.id);
    w.spawnBuilding(`${p.theme}vortex`, p.id, p.x - 4, p.y - 3); // temple
    w.spawnBuilding('altar', p.id, p.x + 2, p.y - 7);
    w.spawnBuilding(`${p.theme}factory`, p.id, p.x - 10, p.y + 1); // workshop
    w.addPriest(p.id, p.x, p.y + 6);
    const transportType = startingTransport(p.theme);
    w.spawnTransport(transportType, p.id, p.x + 1, p.y + 6);
    // oxlint-enable no-magic-numbers
  }

  for (const [x, y] of geysers) {
    w.addGeyser(x, y);
  }

  return w;
}

function startingTransport(theme: Theme): string {
  if (theme === 'thunder') {
    return 'bulf';
  }

  if (theme === 'sun') {
    return 'sunwalker';
  }

  return `${theme}walker`;
}
