/**
 * The smoke an Ice Cannon blows out of its muzzle (Smoke of netstorm.game 10.82, FUN_004d65f0,
 * FUN_004d6830, FUN_004d6b40): ten puffs, one each 0.225 to 0.3 s, drifting up and to the left;
 * a puff now and then splits in two, the old one shorter-lived for it. A puff is a two-pixel
 * stroke going from pale to deep blue-green as it dies. Time is in tenths of a second, as
 * burning.ts counts it.
 */

/* oxlint-disable no-magic-numbers -- the numbers of the Ice Cannon's Smoke */
const PUFFS = 10;
/** The next puff comes 0.75 to 1 of the interval later. */
const INTERVAL = 3;
const LIFE = 100;
/** A puff starts within 4.5 pixels of the muzzle and drifts at (−1, −1) ± 0.5 a tenth; the
 * original scales the drift by a factor of its own, not read (`?`: 1 here). */
const SPREAD = 4.5;
const DRIFT = { bias: -1, scatter: 0.5 } as const;
/** It splits while it has more than 2 tenths to live, once in 3 tenths on average. */
const SPLIT = { life: 2, every: 3, shorter: 0.8 } as const;
/** At most this many puffs of one smoke at a time: the original's cap is not read (`?`). */
const MOST = 300;
/** Palette 0x4d to 0x58: a dying puff the first, a new one the last. */
const RAMP = [
  0x366482,
  0x3e7691,
  0x4d8099,
  0x60879f,
  0x6694a3,
  0x769ca5,
  0x79aaa6,
  0x7db0b3,
  0x81c0b9,
  0x8ebab7,
  0x96c3c3,
  0x9bd2ce,
] as const;
/* oxlint-enable no-magic-numbers */

export interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface Smoke {
  x: number;
  y: number;
  /** Puffs still to come, and in how many tenths the next one does. */
  left: number;
  next: number;
  puffs: Puff[];
}

export function makeSmoke(x: number, y: number): Smoke {
  return { x, y, left: PUFFS, next: 0, puffs: [] };
}

const drift = (random: () => number) => DRIFT.bias + (random() * 2 - 1) * DRIFT.scatter;

/** Move a smoke on `dt` tenths; false once it is all gone. */
export function blow(smoke: Smoke, dt: number, random: () => number = Math.random): boolean {
  smoke.next -= dt;

  while (smoke.left > 0 && smoke.next <= 0) {
    smoke.puffs.push({
      x: smoke.x + (random() * 2 - 1) * SPREAD,
      y: smoke.y + (random() * 2 - 1) * SPREAD,
      vx: drift(random),
      vy: drift(random),
      life: LIFE,
    });
    smoke.left--;
    // oxlint-disable-next-line no-magic-numbers -- 0.75 to 1 of the interval
    smoke.next += INTERVAL * (0.75 + random() * 0.25);
  }

  const born: Puff[] = [];

  for (const puff of smoke.puffs) {
    puff.life -= dt;
    puff.x += puff.vx * dt;
    puff.y += puff.vy * dt;

    if (
      puff.life > SPLIT.life && random() * SPLIT.every < dt
      && smoke.puffs.length + born.length < MOST
    ) {
      born.push({ x: puff.x, y: puff.y, vx: drift(random), vy: drift(random), life: puff.life });
      puff.life *= SPLIT.shorter;
    }
  }

  smoke.puffs = [...smoke.puffs.filter((puff) => puff.life > 0), ...born];
  return smoke.left > 0 || smoke.puffs.length > 0;
}

/** A puff's colour by the life it has left. */
export function puffColour(life: number): number {
  return RAMP[Math.max(0, Math.floor(((RAMP.length - 1) * Math.min(life, LIFE)) / LIFE))]!;
}
