/**
 * A battlefield for a skirmish, made up from a seed: two home islands in opposite corners, as
 * many islands more as asked for, built by the original's island builder, and geysers on islets
 * of their own in the open sky between. Invented: the original ships maps, it does not make them.
 * The same seed and options always give the same map.
 */
import { growIslands, islandChunks, ISLAND_SHAPE_COUNT, type IslandSpec } from './terrain.js';
import type { MissionMap } from './mission.js';
import { H, W } from './state.js';
import type { Theme } from './defs.js';

export interface GeneratedSide {
  id: number;
  theme: Exclude<Theme, 'sun'>;
}

export interface GenerateOptions {
  /** Islands in all, the two homes included. */
  islands: number;
  geysers: number;
  sides: readonly [GeneratedSide, GeneratedSide];
}

/* oxlint-disable no-magic-numbers -- the layout of an invented map maker */
const CHUNK = 16;
/** Chunks the builder works in: 1 to 14. */
const FIRST_CHUNK = 1;
const LAST_CHUNK = 14;
/** The three-by-three shapes, the largest, for the homes. */
const HOME_SHAPES = [0, 1, 2];
const HOME_SPAN = 3;
/** Where the homes go: chunk ranges of the lower left and the upper right corner. */
const HOME_CORNERS: readonly (readonly [cx0: number, cx1: number, cy0: number, cy1: number])[] = [
  [1, 3, 8, 10],
  [9, 11, 1, 3],
];
const TEMPLE_W = 8;
const TEMPLE_H = 6;
/** Island cells kept clear around a Temple, so the Priest and the first units have room. */
const TEMPLE_MARGIN = 2;
/** Open sky kept between a geyser's islet and anything else, and between two geysers. */
const GEYSER_CLEARANCE = 4;
const GEYSER_SPACING = 10;
/** Cells from the map's edge the geysers keep. */
const EDGE = 20;
const TRIES = 400;
const GEYSER_TRIES = 1600;
const PRIEST = 'priest';
/* oxlint-enable no-magic-numbers */

const chunkKey = (cx: number, cy: number): number => cy * CHUNK + cx;

/** mulberry32, the same as World.rng's, on its own seed: the world's numbers are not touched. */
function random(state: { s: number; }): number {
  /* oxlint-disable no-magic-numbers -- mulberry32 */
  state.s = (state.s + 0x6d2b79f5) >>> 0;
  let t = state.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  /* oxlint-enable no-magic-numbers */
}

const between = (rng: { s: number; }, lo: number, hi: number): number =>
  lo + Math.floor(random(rng) * (hi - lo + 1));

export function generateMap(seed: number, options: GenerateOptions): MissionMap {
  const rng = { s: (seed >>> 0) || 1 };
  const specs: IslandSpec[] = [];
  const taken = new Set<number>(); // chunks an island has, and the ring of chunks about it

  const claim = (spec: IslandSpec): boolean => {
    const chunks = islandChunks(spec);

    if (chunks.length === 0 || chunks.some(([cx, cy]) => taken.has(chunkKey(cx, cy)))) {
      return false;
    }

    for (const [cx, cy] of chunks) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          taken.add(chunkKey(cx + dx, cy + dy));
        }
      }
    }

    specs.push(spec);
    return true;
  };

  // The homes: one in each corner, a shape of nine chunks.
  for (const [cx0, cx1, cy0, cy1] of HOME_CORNERS) {
    const spec: IslandSpec = {
      shape: HOME_SHAPES[between(rng, 0, HOME_SHAPES.length - 1)]!,
      cx: between(rng, cx0, Math.min(cx1, LAST_CHUNK - HOME_SPAN + 1)),
      cy: between(rng, cy0, Math.min(cy1, LAST_CHUNK - HOME_SPAN + 1)),
      seed: between(rng, 0, 255), // oxlint-disable-line no-magic-numbers -- a seed byte
    };
    claim(spec);
  }

  // The islands between, wherever they fit with a chunk of sky about them.
  for (let tries = 0; specs.length < options.islands && tries < TRIES; tries++) {
    claim({
      shape: between(rng, 0, ISLAND_SHAPE_COUNT - 1),
      cx: between(rng, FIRST_CHUNK, LAST_CHUNK),
      cy: between(rng, FIRST_CHUNK, LAST_CHUNK),
      seed: between(rng, 0, 255), // oxlint-disable-line no-magic-numbers -- a seed byte
    });
  }

  const ground = growIslands(specs);
  const units: MissionMap['units'] = [];

  // A Temple on each home, as near the island's middle as its ground allows, the Priest below.
  for (const [home, side] of options.sides.entries()) {
    const spot = templeSpot(ground, home);

    if (spot) {
      const [x0, y0] = spot;
      // A unit of the map is saved by its bottom right cell.
      units.push([`${side.theme}vortex`, side.id, x0 + TEMPLE_W - 1, y0 + TEMPLE_H - 1, 0]);
      units.push([PRIEST, side.id, x0 + (TEMPLE_W >> 1), y0 + TEMPLE_H + 1, 0]);
    }
  }

  // Geysers in the open sky, clear of the islands and of each other.
  const geysers: [number, number][] = [];

  for (let tries = 0; geysers.length < options.geysers && tries < GEYSER_TRIES; tries++) {
    const x = between(rng, EDGE, W - 1 - EDGE);
    const y = between(rng, EDGE, H - 1 - EDGE);

    if (
      clearSky(ground, x, y, GEYSER_CLEARANCE)
      && geysers.every(([gx, gy]) => Math.max(Math.abs(gx - x), Math.abs(gy - y)) >= GEYSER_SPACING)
    ) {
      geysers.push([x, y]);
    }
  }

  return {
    islands: specs.map((s) => [s.shape, s.cx, s.cy, s.seed]),
    geysers,
    bridges: [],
    units,
  };
}

/** Whether every cell within `reach` of (x, y) is open sky. */
function clearSky(ground: Int16Array, x: number, y: number, reach: number): boolean {
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const cx = x + dx;
      const cy = y + dy;

      if (cx < 0 || cy < 0 || cx >= W || cy >= H || ground[cy * W + cx] !== -1) {
        return false;
      }
    }
  }

  return true;
}

/** The top left of a Temple's cells on the island, with a margin of its ground all about, the
 * nearest to the island's middle; null when the island has no room. */
function templeSpot(ground: Int16Array, island: number): [number, number] | null {
  let sumX = 0;
  let sumY = 0;
  let cells = 0;

  for (let i = 0; i < ground.length; i++) {
    if (ground[i] === island) {
      sumX += i % W;
      sumY += (i / W) | 0;
      cells++;
    }
  }

  if (cells === 0) {
    return null;
  }

  const midX = sumX / cells;
  const midY = sumY / cells;
  let best: [number, number] | null = null;
  let least = Infinity;

  for (let y0 = 0; y0 + TEMPLE_H <= H; y0++) {
    for (let x0 = 0; x0 + TEMPLE_W <= W; x0++) {
      const far = Math.abs(x0 + TEMPLE_W / 2 - midX) + Math.abs(y0 + TEMPLE_H / 2 - midY);

      if (far < least && onIsland(ground, island, x0, y0)) {
        best = [x0, y0];
        least = far;
      }
    }
  }

  return best;
}

function onIsland(ground: Int16Array, island: number, x0: number, y0: number): boolean {
  for (let y = y0 - TEMPLE_MARGIN; y < y0 + TEMPLE_H + TEMPLE_MARGIN; y++) {
    for (let x = x0 - TEMPLE_MARGIN; x < x0 + TEMPLE_W + TEMPLE_MARGIN; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || ground[y * W + x] !== island) {
        return false;
      }
    }
  }

  return true;
}
