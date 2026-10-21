/**
 * A building going up appears pixel by pixel from its base (Build, BuildSlow of netstorm.game
 * 10.82: FUN_00424380, FUN_00424520, FUN_00423fb0). Seeds are the lowest pixels of its columns,
 * from the middle out; each pixel shown brings its left, right and upper neighbours to the edge;
 * as many are shown as the work is done. A pixel shown runs through a ramp of grey, white and
 * blue for 0.2 to 0.9 s before it takes its own colour, and the edge twinkles through the same
 * ramp. Time is in tenths of a second, as burning.ts counts it.
 */

/* oxlint-disable no-magic-numbers -- the numbers of BuildSlow, and RGBA bytes */
/** Life of a pixel shown: 2 to 9 tenths (BuildSlow). */
const LIFE = { least: 2, most: 9 } as const;
/** The edge holds at most this many pixels, or a sixth of the picture's. */
const LEAST_POOL = 500;
const POOL_PART = 6;
/** Seeds are looked for from the bottom row up to a third of the height. */
const SEED_REACH = 3;

/** ColorLine (0,0,255) → (255,255,255) in 8 steps, then on to (128,128,128) in 3: a new pixel
 * takes the last, a dying one the first. */
const RAMP: readonly (readonly [number, number, number])[] = [
  ...Array.from({ length: 8 }, (_, i) => {
    const t = i / 7;
    return [Math.round(255 * t), Math.round(255 * t), 255] as const;
  }),
  ...Array.from({ length: 3 }, (_, i) => {
    const v = Math.round(255 - (127 * (i + 1)) / 3);
    return [v, v, v] as const;
  }),
];
/* oxlint-enable no-magic-numbers */

const NONE = 0;
const EDGE = 1;
const SHOWN = 2;
const DONE = 3;
const RGBA = 4;
const OPAQUE = 3;
const SOLID = 255;

export class Growth {
  /** What is drawn: the pixels shown so far, the rest clear. */
  readonly out: Uint8ClampedArray;
  private readonly state: Uint8Array;
  private readonly life: Float32Array;
  private readonly edge: number[] = [];
  private readonly pool: number;
  private readonly solid: number;
  private made = 0;

  constructor(
    private readonly rgba: Uint8ClampedArray,
    private readonly width: number,
    private readonly height: number,
    private readonly random: () => number = Math.random,
  ) {
    this.out = new Uint8ClampedArray(rgba.length);
    this.state = new Uint8Array(width * height);
    this.life = new Float32Array(width * height);
    let solid = 0;

    for (let i = 0; i < width * height; i++) {
      solid += rgba[i * RGBA + OPAQUE]! > 0 ? 1 : 0;
    }

    this.solid = solid;
    this.pool = Math.max(LEAST_POOL, Math.floor(solid / POOL_PART));
    this.seed();
  }

  /** Columns from the middle out, left and right in turn: the lowest pixel of each, shuffled. */
  private seed(): void {
    const { width } = this;
    const seeds: number[] = [];
    const middle = width >> 1;

    for (let k = 0; k < width && seeds.length < 2 * width; k++) {
      const x = k % 2 === 0 ? middle + (k >> 1) : middle - ((k + 1) >> 1);
      const lowest = this.lowestIn(x);

      if (lowest >= 0) {
        seeds.push(lowest);
      }
    }

    for (let i = 0; i < width && seeds.length > 1; i++) {
      const a = Math.floor(this.random() * seeds.length);
      const b = Math.floor(this.random() * seeds.length);
      [seeds[a], seeds[b]] = [seeds[b]!, seeds[a]!];
    }

    for (const i of seeds) {
      this.toEdge(i);
    }
  }

  /** The lowest drawn pixel of a column down to a third of the height, or -1. */
  private lowestIn(x: number): number {
    const top = Math.floor(this.height / SEED_REACH);

    if (x < 0 || x >= this.width) {
      return -1;
    }

    for (let y = this.height - 1; y >= top; y--) {
      if (this.opaque(y * this.width + x)) {
        return y * this.width + x;
      }
    }

    return -1;
  }

  private opaque(i: number): boolean {
    return this.rgba[i * RGBA + OPAQUE]! > 0;
  }

  private toEdge(i: number): void {
    if (this.state[i] === NONE && this.opaque(i) && this.edge.length < this.pool) {
      this.state[i] = EDGE;
      this.life[i] = this.random() * LIFE.most;
      this.edge.push(i);
    }
  }

  private lifeOf(): number {
    return LIFE.least + this.random() * (LIFE.most - LIFE.least);
  }

  /** `dt` tenths later, with `share` of the work done. */
  step(dt: number, share: number): void {
    const target = Math.floor(this.solid * Math.min(1, share));

    while (this.made < target) {
      if (!this.edge.length) {
        // A part of the picture the edge cannot reach: a seed of its own.
        const left = this.state.findIndex((s, i) => s === NONE && this.opaque(i));

        if (left < 0) {
          break;
        }

        this.toEdge(left);
      }

      const k = Math.floor(this.random() * this.edge.length);
      const i = this.edge[k]!;
      this.edge[k] = this.edge[this.edge.length - 1]!;
      this.edge.pop();
      this.state[i] = SHOWN;
      this.life[i] = this.lifeOf();
      this.made++;
      const x = i % this.width;

      if (x > 0) {
        this.toEdge(i - 1);
      }

      if (x < this.width - 1) {
        this.toEdge(i + 1);
      }

      if (i >= this.width) {
        this.toEdge(i - this.width);
      }
    }

    for (let i = 0; i < this.state.length; i++) {
      const state = this.state[i]!;

      if (state === NONE || state === DONE) {
        continue;
      }

      this.life[i]! -= dt;

      if (this.life[i]! <= 0) {
        if (state === SHOWN) {
          this.state[i] = DONE;
          this.out.set(this.rgba.subarray(i * RGBA, i * RGBA + RGBA), i * RGBA);
          continue;
        }

        this.life[i] = this.random() * LIFE.most;
      }

      const [r, g, b] =
        RAMP[Math.floor(((RAMP.length - 1) * Math.min(this.life[i]!, LIFE.most)) / LIFE.most)]!;
      this.out.set([r, g, b, SOLID], i * RGBA);
    }
  }
}
