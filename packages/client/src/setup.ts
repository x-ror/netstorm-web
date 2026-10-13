import {
  CHUNK_SIZE,
  createSkirmish,
  H,
  islandChunks,
  W,
  type DefTable,
  type IslandSpec,
  type World,
} from '@netstorm/sim';
import { type Maps, type Mission } from './game-data.js';
import { type MatchOptions } from './menu.js';

export const ME = 1;
export const ENEMY = 2;
// Where the bases stand on a map that brings no islands: rectangles at fixed spots (invented).
const HOMES = {
  [ME]: { x: 70, y: 150 },
  [ENEMY]: { x: 150, y: 90 },
} as const;
// A lone geyser midway between the bases for maps without geysers.
const FALLBACK_X = 110;
const FALLBACK_Y = 120;
/** Half-size of the rectangular home islands made by createSkirmish, plus a gap of open sky. */
const HOME_REACH_X = 13;
const HOME_REACH_Y = 11;
const MAP_EDGE = 2;

/** Shape and size of the island the opponent gets: the Z of four chunks most maps give the player. */
const ENEMY_SHAPE = 7;
const SEED_BYTE = 0xff;
const GAP = 2; // chunks of sky between the islands of the two sides
const LAST_ORIGIN = 12; // a shape three chunks wide still fits on the map from here

/**
 * A place for the opponent's island: the nearest to the player's islands that leaves two chunks
 * of open sky between them and has no geyser in it. Invented: in the original's missions the enemy
 * comes as units laid on the map, which are not read yet.
 */
function enemyIsland(taken: [number, number][], geysers: [number, number][], seed: number) {
  let best: IslandSpec | null = null;
  let nearest = Infinity;

  for (let cy = 1; cy <= LAST_ORIGIN; cy++) {
    for (let cx = 1; cx <= LAST_ORIGIN; cx++) {
      const spec = { shape: ENEMY_SHAPE, cx, cy, seed: seed & SEED_BYTE };
      const chunks = islandChunks(spec);
      const clash = chunks.some(([x, y]) =>
        taken.some(([tx, ty]) => Math.abs(tx - x) <= GAP && Math.abs(ty - y) <= GAP)
        || geysers.some(([gx, gy]) =>
          Math.floor(gx / CHUNK_SIZE) === x && Math.floor(gy / CHUNK_SIZE) === y
        )
      );
      const far = Math.min(
        ...chunks.flatMap(([x, y]) => taken.map(([tx, ty]) => (tx - x) ** 2 + (ty - y) ** 2)),
      );

      if (!clash && far < nearest) {
        best = spec;
        nearest = far;
      }
    }
  }

  return best;
}

function inside([x, y]: [number, number]): boolean {
  return x >= MAP_EDGE && y >= MAP_EDGE && x < W - MAP_EDGE && y < H - MAP_EDGE;
}

export function createMatchWorld(
  defs: DefTable,
  maps: Maps,
  missions: Mission[],
  options: MatchOptions,
): World {
  const mission = missions.find((m) => m.id === options.mission);
  const map = maps[options.mission];
  const all = (map?.geysers ?? []).filter(inside);
  const mine: IslandSpec[] = (map?.islands ?? []).map(([shape, cx, cy, seed]) => ({
    shape,
    cx,
    cy,
    seed,
  }));
  const theirs = mine.length ? enemyIsland(mine.flatMap(islandChunks), all, options.seed) : null;
  // Without islands of the map both bases are rectangles at fixed spots, as before.
  const grown = theirs !== null;
  const geysers = grown
    ? all
    : all.filter(([x, y]) =>
      Object.values(HOMES).every((home) =>
        Math.abs(x - home.x) > HOME_REACH_X || Math.abs(y - home.y) > HOME_REACH_Y
      )
    );
  return createSkirmish(defs, options.seed, [
    {
      id: ME,
      name: 'Ви',
      theme: options.theme,
      ...HOMES[ME],
      storm: options.storm,
      islands: grown ? mine : undefined,
    },
    {
      id: ENEMY,
      name: mission?.enemy || 'Суперник',
      theme: options.enemyTheme,
      ...HOMES[ENEMY],
      storm: options.storm,
      islands: grown ? [theirs] : undefined,
    },
  ], geysers.length ? geysers : [[FALLBACK_X, FALLBACK_Y]], {
    bridges: options.bridges,
    slots: options.slots,
    unitRate: options.unitRate,
    killReward: options.killReward,
    geyserStock: options.geyserStock,
  });
}
