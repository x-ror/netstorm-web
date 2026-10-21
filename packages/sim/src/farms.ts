/**
 * Edge Farms: the fields that grow on the rim of every island and refuse a bridge or a unit
 * (addRandom.cpp of netstorm.game 10.82, FUN_00402890). They are made again with the islands at
 * every load, never saved, and are the same every time: each island draws them from a seed of its
 * own. See docs/game-rules.md.
 */
import { syncRand } from './rng.js';
import { H, W } from './state.js';
import { islandChunks, shapeCells, type IslandSpec } from './terrain.js';

/* oxlint-disable no-magic-numbers -- the constants of FUN_00402890 */
const CHUNK = 16;
/** Seeds tried for each island, and the box filled about a seed that took. */
const TRIES = 30000;
const REACH = 1;
/** Farms a chunk of the island in the campaign: the "old code" kept for single player (`?`). */
const CAMPAIGN_PER_CHUNK = 20;
/** Multiplayer: per chunk `trunc((Sx + Sy + 10) × C / 25)`, S = Map Size − 2 (3 for Large). */
const MAP_PAD = 6;
const PAD_BASE = 10;
const COVERAGE_PART = 25;
/** The seed of an island's farms: its Rand Seed times this. */
const SEED_STEP = 0x4d;
/* oxlint-enable no-magic-numbers */

const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/**
 * The cells of Edge Farm on the islands `ground` holds (island index per cell, -1 for sky).
 * `coverage` is the multiplayer battle's island coverage, per cent; left out, the campaign's count.
 */
export function growFarms(
  ground: Int16Array,
  specs: readonly IslandSpec[],
  coverage?: number,
): Set<number> {
  const farms = new Set<number>();
  const isle = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && ground[y * W + x]! >= 0 && !farms.has(y * W + x);
  // A rim cell: island with some sky about it, as the rim frames of isle.type are.
  const rim = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx < 0 || ny < 0 || nx >= W || ny >= H || ground[ny * W + nx]! < 0) {
          return true;
        }
      }
    }

    return false;
  };

  for (const [id, spec] of specs.entries()) {
    const chunks = islandChunks(spec);

    if (!chunks.length) {
      continue;
    }

    const per = coverage === undefined
      ? CAMPAIGN_PER_CHUNK
      : Math.trunc(((MAP_PAD + PAD_BASE) * coverage) / COVERAGE_PART);
    const target = shapeCells(spec.shape).length * per;
    const xs = chunks.map(([cx]) => cx);
    const ys = chunks.map(([, cy]) => cy);
    const x0 = Math.min(...xs) * CHUNK;
    const y0 = Math.min(...ys) * CHUNK;
    const x1 = (Math.max(...xs) + 1) * CHUNK;
    const y1 = (Math.max(...ys) + 1) * CHUNK;
    const rng = { s: (spec.seed * SEED_STEP) >>> 0 };
    let made = 0;

    // FUN_00401b20 for one cell: of this island, a rim frame, no farm yet, and no inside corner
    // made of it (FUN_00401960: a diagonal off the island between two sides on it).
    const takes = (x: number, y: number) => {
      if (
        x < 0 || y < 0 || x >= W || y >= H || ground[y * W + x] !== id || farms.has(y * W + x)
        || !rim(x, y)
      ) {
        return false;
      }

      return DIAGONALS.every(([dx, dy]) =>
        isle(x + dx, y + dy) || !isle(x + dx, y) || !isle(x, y + dy)
      );
    };

    // A seed that takes fills the box about it, up to `room` farms: "group edge farms together in
    // clusters". The farms it made.
    const box = (x: number, y: number, room: number) => {
      let n = 0;

      for (let dy = -REACH; dy <= REACH; dy++) {
        for (let dx = -REACH; dx <= REACH; dx++) {
          if (n < room && takes(x + dx, y + dy)) {
            farms.add((y + dy) * W + x + dx);
            n++;
          }
        }
      }

      return n;
    };

    for (let i = 0; i < TRIES && made < target; i++) {
      const x = x0 + syncRand(rng, x1 - x0);
      const y = y0 + syncRand(rng, y1 - y0);

      if (takes(x, y)) {
        made += box(x, y, target - made);
      }
    }
  }

  return farms;
}
