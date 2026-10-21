/** Deterministic PRNG (mulberry32). Every random decision in the simulation goes through one of these. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(r * n);
  }

  state(): number {
    return this.s;
  }
}

const ZERO_SEED = 0xbad0bad;

/** SyncRand of netstorm.game (FUN_004ef720): an integer in [0, n) from a state of its own, for
 * what the original draws from a seed of its own (geyser spots, Edge Farms). */
export function syncRand(state: { s: number; }, n: number): number {
  /* oxlint-disable no-magic-numbers -- the generator's constants, and its top 16 bits */
  state.s = (Math.imul(state.s || ZERO_SEED, 0x10003) + 3) >>> 0;
  return ((state.s >>> 16) & 0xffff) % n;
  /* oxlint-enable no-magic-numbers */
}
