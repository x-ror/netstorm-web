import { H, W } from './state.js';

/**
 * The island builder of the original (ChunkMap.cpp, islandbuilder.cpp and terrainBuilder.cpp of
 * netstorm.game 10.82). The map is 16×16 chunks of 16×16 cells. An island takes the chunks of one
 * of 21 shapes, and the ground in them is grown from a seed, so the same description always gives
 * the same island. See "Острови: як їх будує гра" in docs/game-rules.md.
 */
export interface IslandSpec {
  /** Index of the shape whose cells are the island's chunks, see ISLAND_SHAPES. */
  shape: number;
  /** Chunk the top-left corner of the shape is laid on. */
  cx: number;
  cy: number;
  /** The seed byte of the island's description. */
  seed: number;
}

/* oxlint-disable no-magic-numbers -- the constants of the original's generator */
const CHUNK = 16;
const CHUNKS = 16;
const NONE = 127;
// The builder works inside chunks 1..14, and on the cells 16..240 both ends included.
const FIRST_CHUNK = 1;
const END_CHUNK = 15;
const MIN_CELL = FIRST_CHUNK * CHUNK;
const MAX_CELL = END_CHUNK * CHUNK;
const NORTH = 1;
const EAST = 2;
const SOUTH = 4;
const WEST = 8;
// The eight neighbours clockwise from the north; odd ones are diagonal.
const AROUND: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/**
 * The island shapes of the original, in its own order (the table beside the bridge pieces'). A
 * letter is a chunk and names the sides on which it is joined to its neighbours; '.' is empty.
 */
const ISLAND_SHAPES: readonly (readonly string[])[] = [
  ['.L.', 'FAG', 'INH'],
  ['FG.', 'BAG', 'INH'],
  ['FCG', 'BAD', 'INH'],
  ['OG', '.N'],
  ['OKM'],
  ['OKG', '..N'],
  ['OCM', '.N.'],
  ['FG', 'IH'],
  ['OG.', '.IM'],
  ['OCG', '.IH'],
  ['FKG', 'N.N'],
  ['.L.', 'OAM', '.N.'],
  ['L..', 'IG.', '.IM'],
  ['FKG', 'J.J', 'IKH'],
  ['.L.', 'OAG', '.IH'],
  ['..L', 'OCD', '.IH'],
  ['OCG', '.IH'],
  ['FKG', 'N.J', '..N'],
  ['.FM', 'OH.'],
  ['L..', 'BKG', 'N.N'],
  ['.L.', 'FEG', 'N.N'],
];
/** Sides a chunk is joined on, by its letter. A to K are the letters of bridge cells; L to O are
 * dead ends, joined on one side only. */
const LETTER_LINKS: Readonly<Record<string, number>> = {
  A: 15,
  B: 7,
  C: 14,
  D: 13,
  E: 11,
  F: 6,
  G: 12,
  H: 9,
  I: 3,
  J: 5,
  K: 10,
  L: SOUTH,
  M: WEST,
  N: NORTH,
  O: EAST,
};

/** The chunks a shape takes, as offsets from its top-left corner, with their links. */
function shapeCells(shape: number): [x: number, y: number, links: number][] {
  const rows = ISLAND_SHAPES[shape];

  if (!rows) {
    throw new RangeError(`Unknown island shape ${shape}`);
  }

  return rows.flatMap((row, y) =>
    [...row].flatMap((letter, x): [number, number, number][] =>
      letter === '.' ? [] : [[x, y, LETTER_LINKS[letter]!]]
    )
  );
}

/** The generator's random numbers: s = s × 65539 + 3, the high half taken modulo n. */
class Lcg {
  constructor(private s: number) {}

  next(n: number): number {
    if (this.s === 0) {
      this.s = 0xbad0bad;
    }

    this.s = (Math.imul(this.s, 0x10003) + 3) | 0;
    return ((this.s >> 16) & 0xffff) % n;
  }
}

/**
 * Build the islands and return, for every cell of the map, the index of the island whose ground
 * it is, or -1 for open sky.
 */
export function growIslands(specs: readonly IslandSpec[]): Int16Array {
  // Chunk records, indexed [cx * 16 + cy] as in the original.
  const island = new Uint8Array(CHUNKS * CHUNKS).fill(NONE);
  const links = new Uint8Array(CHUNKS * CHUNKS);
  const seeds = new Uint8Array(CHUNKS * CHUNKS);

  for (const [id, spec] of specs.entries()) {
    for (const [px, py, link] of shapeCells(spec.shape)) {
      const cx = spec.cx + px;
      const cy = spec.cy + py;

      // The builder works on chunks 1..14 only; a shape that sticks out is cut there.
      if (cx < FIRST_CHUNK || cy < FIRST_CHUNK || cx >= END_CHUNK || cy >= END_CHUNK) {
        continue;
      }

      island[cx * CHUNKS + cy] = id;
      links[cx * CHUNKS + cy] = link;
      seeds[cx * CHUNKS + cy] = spec.seed;
    }
  }

  // Ground and its island by cell, indexed [x * 256 + y] as in the original.
  const ground = new Uint8Array(W * H);
  const owner = new Uint8Array(W * H).fill(NONE);
  const budget = new Int32Array(CHUNKS * CHUNKS);
  const count = new Int32Array(NONE + 1);

  /** Fill a rectangle of cells, the far edges excluded; returns how many were new. */
  const fill = (x0: number, y0: number, x1: number, y1: number, id: number): number => {
    let fresh = 0;

    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        if (!ground[x * W + y]) {
          ground[x * W + y] = 1;
          owner[x * W + y] = id;
          fresh++;
        }
      }
    }

    return fresh;
  };

  /** Cover the square around a cell with ground of an island; returns how many cells were new.
   * Ground spreads only into chunks of its own island. */
  const spread = (x: number, y: number, id: number): number => {
    let fresh = 0;

    for (let ny = y - 1; ny <= y + 1; ny++) {
      for (let nx = x - 1; nx <= x + 1; nx++) {
        const inside = nx >= MIN_CELL && ny >= MIN_CELL && nx <= MAX_CELL && ny <= MAX_CELL;

        if (inside && !ground[nx * W + ny] && island[(nx >> 4) * CHUNKS + (ny >> 4)] === id) {
          ground[nx * W + ny] = 1;
          owner[nx * W + ny] = id;
          fresh++;
        }
      }
    }

    return fresh;
  };

  /** The island that walls a gap in: five neighbours in a row of its ground, the run ending on a
   * diagonal. NONE if there is no such run. */
  const enclosing = (x: number, y: number): number => {
    let run = 0;
    let of = NONE;

    for (let step = 0; step < 13; step++) {
      const [dx, dy] = AROUND[step & 7]!;
      const n = (x + dx) * W + y + dy;

      if (!ground[n] || (run > 0 && owner[n] !== of)) {
        run = 0;
        continue;
      }

      if (run === 0) {
        of = owner[n]!;
      }

      run++;

      if (run > 4 && (step & 1) !== 0) {
        return of;
      }
    }

    return NONE;
  };

  // The core of every chunk: a block near its middle, shifted by the seed, and ground reaching
  // out to each chunk it is joined to.
  for (let cy = FIRST_CHUNK; cy < END_CHUNK; cy++) {
    for (let cx = FIRST_CHUNK; cx < END_CHUNK; cx++) {
      const c = cx * CHUNKS + cy;
      const id = island[c]!;

      if (id === NONE) {
        continue;
      }

      const seed = seeds[c]!;
      const link = links[c]!;
      count[id]!++;
      let x0 = cx * CHUNK + 4 + (seed & 7);
      let y0 = cy * CHUNK + 4 + ((9999 - seed) & 7);
      let x1 = x0 + 2;
      let y1 = y0 + 2;
      const block = fill(x0 - 1, y0 - 1, x0 + 3, y0 + 3, id);

      if (link & NORTH) {
        y0 = cy * CHUNK;
      }

      if (link & SOUTH) {
        y1 = cy * CHUNK + CHUNK;
      }

      if (link & WEST) {
        x0 = cx * CHUNK;
      }

      if (link & EAST) {
        x1 = cx * CHUNK + CHUNK;
      }

      let filled = block + fill(x0, y0, x1, y1, id);

      // The second chunk of an island gets a square of ten cells: room for its Temple.
      if (count[id] === 2) {
        filled += fill(cx * CHUNK + 3, cy * CHUNK + 3, cx * CHUNK + 13, cy * CHUNK + 13, id);
      }

      // The chunk is to be 50 to 79 per cent ground, less what it has, and gains a fifth at least.
      const share = Math.max(20, new Lcg(block).next(30) + 50 - ((filled * 100) >> 8));
      budget[c] = Math.trunc((share << 8) / 100);
    }
  }

  // Growth: take a random cell of the chunk that is ground, and cover the square around it.
  for (let cy = FIRST_CHUNK; cy < END_CHUNK; cy++) {
    for (let cx = FIRST_CHUNK; cx < END_CHUNK; cx++) {
      const c = cx * CHUNKS + cy;
      const id = island[c]!;

      if (id === NONE) {
        continue;
      }

      const rng = new Lcg(seeds[c]! + count[id]! * 0x10e3);
      count[id]!++;
      let left = budget[c]!;
      let tries = 1000;

      while (left > 0 && tries-- > 0) {
        const x = rng.next(CHUNK - 1) + cx * CHUNK;
        const y = rng.next(CHUNK - 1) + cy * CHUNK;
        rng.next(1);

        if (!ground[x * W + y] || owner[x * W + y] !== id) {
          continue;
        }

        const before = left;
        left -= spread(x, y, id);

        if (left < before) {
          tries = 1000;
        }
      }
    }
  }

  // Two passes that close the gaps the ground walls in.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = MIN_CELL + 1; y < MAX_CELL; y++) {
      for (let x = MIN_CELL + 1; x < MAX_CELL - 1; x++) {
        const beside = ground[(x - 1) * W + y] || ground[(x + 1) * W + y]
          || ground[x * W + y - 1] || ground[x * W + y + 1];

        if (ground[x * W + y] || !beside) {
          continue;
        }

        const of = enclosing(x, y);

        if (of !== NONE) {
          ground[x * W + y] = 1;
          owner[x * W + y] = of;
        }
      }
    }
  }

  const out = new Int16Array(W * H).fill(-1);

  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (ground[x * W + y]) {
        out[y * W + x] = owner[x * W + y]!;
      }
    }
  }

  return out;
}

/** The chunks of an island in the order the builder visits them: by row, then by column. */
export function islandChunks(spec: IslandSpec): [number, number][] {
  return shapeCells(spec.shape)
    .map(([px, py]): [number, number] => [spec.cx + px, spec.cy + py])
    .filter(([cx, cy]) =>
      cx >= FIRST_CHUNK && cy >= FIRST_CHUNK && cx < END_CHUNK && cy < END_CHUNK
    )
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
/* oxlint-enable no-magic-numbers */
