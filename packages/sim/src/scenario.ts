/** Scenario builders. Island shapes are not yet decoded from .fort, so skirmish islands are rectangles;
 *  geyser positions can be taken from data/forts.json (decoded by tools/unfort.py). */
import { World } from './world.js';
import { CHUNK_SIZE, growIslands, islandChunks, type IslandSpec } from './terrain.js';
import type { Theme, DefTable } from './defs.js';
import {
  BRIDGE_SETS,
  BRIDGE_SLOTS,
  DEFAULT_KILL_REWARD,
  DEFAULT_UNIT_RATE,
  GEYSER_STOCK,
  GEYSER_STOCKS,
  H,
  HAND_SIZE,
  KILL_REWARDS,
  Terrain,
  UNIT_RATES,
  W,
  type BridgeSet,
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
  /** Islands grown by the original's builder. The first is the home island; `x` and `y` are
   * then not used, and the starting units stand wherever there is room by the Temple. */
  islands?: IslandSpec[];
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

export function createSkirmish(
  defs: DefTable,
  seed: number,
  players: SkirmishPlayer[],
  geysers: [number, number][],
  options: SkirmishOptions = {},
): World {
  const w = new World(defs, seed);
  w.bridgeSet = Math.max(0, BRIDGE_SETS.indexOf(options.bridges ?? 'standard'));
  w.bridgeSlots = pick(BRIDGE_SLOTS, options.slots, HAND_SIZE);
  w.unitRate = pick(UNIT_RATES, options.unitRate, DEFAULT_UNIT_RATE);
  w.killReward = pick(KILL_REWARDS, options.killReward, DEFAULT_KILL_REWARD);
  w.geyserStock = pick(GEYSER_STOCKS, options.geyserStock, GEYSER_STOCK);

  for (const p of players) {
    if (p.theme === 'sun') {
      throw new Error('a player must follow Wind, Rain or Thunder (Sun has no temple)');
    }
  }

  growGround(w, players);

  for (const p of players) {
    const themeTech = [
      `${p.theme}battery`,
      `${p.theme}walker`,
      `${p.theme}cannon`,
      `${p.theme}archer`,
      `${p.theme}blocker`,
      `${p.theme}fence`,
      `${p.theme}aviary`,
      `${p.theme}balloon`,
    ].filter((t) => defs.has(t));
    w.addPlayer(p.id, p.name, p.theme, p.storm ?? DEFAULT_STORM,
      p.tech ?? [...BASE_TECH, ...themeTech]);

    if (p.islands?.length) {
      settle(w, p, p.islands[0]!, geysers);
      continue;
    }

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

/** Lay the ground of every island the players bring. */
function growGround(w: World, players: SkirmishPlayer[]): void {
  const specs: IslandSpec[] = [];
  const owners: number[] = [];

  for (const p of players) {
    for (const spec of p.islands ?? []) {
      specs.push(spec);
      owners.push(p.id);
    }
  }

  if (!specs.length) {
    return;
  }

  for (const [i, island] of growIslands(specs).entries()) {
    if (island >= 0) {
      w.terrain[i] = Terrain.Island;
      w.owner[i] = owners[island]!;
    }
  }

  w.invalidateTerrain();
}

/** How near a geyser a starting unit may not stand: its islet and a cell around it. */
const GEYSER_CLEARANCE = 2;

/**
 * Put the starting units of a player on a grown island. Where they stand in the original is not
 * known and does not matter: the Temple takes the square the builder leaves for it in the
 * island's second chunk, the rest whatever free ground is nearest to the Temple.
 */
function settle(w: World, p: SkirmishPlayer, home: IslandSpec, geysers: [number, number][]): void {
  const chunks = islandChunks(home);
  const [cx, cy] = chunks[1] ?? chunks[0] ?? [0, 0];
  const half = CHUNK_SIZE / 2;
  let nearX = cx * CHUNK_SIZE + half;
  let nearY = cy * CHUNK_SIZE + half;
  const free = (x: number, y: number) =>
    w.inside(x, y) && w.terrain[w.at(x, y)] === Terrain.Island && w.owner[w.at(x, y)] === p.id
    && !w.occupant[w.at(x, y)]
    && !geysers.some(([gx, gy]) =>
      Math.abs(gx - x) <= GEYSER_CLEARANCE && Math.abs(gy - y) <= GEYSER_CLEARANCE
    );

  /** The spot nearest to the Temple where a footprint fits on free ground of the player. */
  const site = (fx: number, fy: number): [number, number] => {
    let best: [number, number] | null = null;
    let nearest = Infinity;

    for (let y = 0; y + fy <= H; y++) {
      for (let x = 0; x + fx <= W; x++) {
        const far = (x + x + fx - nearX - nearX) ** 2 + (y + y + fy - nearY - nearY) ** 2;

        if (far >= nearest) {
          continue;
        }

        let fits = true;

        for (let dy = 0; dy < fy && fits; dy++) {
          for (let dx = 0; dx < fx && fits; dx++) {
            fits = free(x + dx, y + dy);
          }
        }

        if (fits) {
          best = [x, y];
          nearest = far;
        }
      }
    }

    if (!best) {
      throw new Error(`No room on the island of player ${p.id}`);
    }

    return best;
  };

  const raise = (type: string) => {
    const def = w.def(type);
    const [x, y] = site(def.footX, def.footY);
    return w.spawnBuilding(type, p.id, x, y);
  };

  const temple = raise(`${p.theme}vortex`);
  nearX = temple.x + temple.fx / 2;
  nearY = temple.y + temple.fy / 2;
  raise('altar');
  raise(`${p.theme}factory`);
  w.addPriest(p.id, ...site(1, 1));
  w.spawnTransport(startingTransport(p.theme), p.id, ...site(1, 1));
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
