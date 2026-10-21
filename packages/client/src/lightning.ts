/**
 * A bolt of lightning as the original builds it (Lightning of netstorm.game 10.82, FUN_0048dcb0,
 * FUN_0048e160, FUN_0048e5b0, FUN_0048e800): a crooked line from one point to the other that
 * grows there within a tenth of a second, a twig off each of its points, every point living 0.3 s
 * and trembling meanwhile. Time is in tenths of a second, as burning.ts counts it.
 */

/* oxlint-disable no-magic-numbers -- the numbers of the Lightning particle system */
/** A segment's share of the whole length, and the bend it may take. */
const STEP = { first: 0.15, least: 0.08, most: 0.15, shrink: 0.9, low: 3 } as const;
const BEND = { long: 0.15, short: 0.5 } as const;
const TWIG_BEND = { long: 0.25, short: 0.5 } as const;
/** A point grows a twig while its intensity is above this. */
const TWIGGING = 0.12;
/** Tenths a point lives: 3, or 5 for the bolts of Spells. */
export const BOLT_LIFE = 3;
export const SPELL_BOLT_LIFE = 5;
/** A point trembles by up to a fortieth of the bolt's length a tenth. */
const TREMBLE = 40;
/* oxlint-enable no-magic-numbers */

export interface BoltPoint {
  x: number;
  y: number;
  /** The point it is drawn to; -1 for the start. */
  parent: number;
  intensity: number;
  /** When it appears: the share of the first tenth by which the bolt has reached it. */
  at: number;
}

export interface Bolt {
  points: BoltPoint[];
  start: number;
  life: number;
  length: number;
}

const between = (random: () => number, low: number, high: number) => low + random() * (high - low);

/** A bolt from one point to another, made at `start` (tenths). */
export function makeBolt(
  from: { x: number; y: number; },
  to: { x: number; y: number; },
  start: number,
  life = BOLT_LIFE,
  random: () => number = Math.random,
): Bolt {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const points: BoltPoint[] = [{ x: from.x, y: from.y, parent: -1, intensity: 1, at: 0 }];

  const twig = (parent: number, step: number, bend: number, intensity: number, at: number) => {
    const p = points[parent]!;
    const turn = angle + intensity * between(random, -bend, bend);
    const reach = (step * length) / 2;
    points.push({
      x: p.x + Math.cos(turn) * reach,
      y: p.y + Math.sin(turn) * reach,
      parent,
      intensity: intensity / 2,
      at,
    });

    if (intensity / 2 > TWIGGING) {
      twig(points.length - 1, step / 2, bend, intensity / 2, at);
    }
  };

  let done = 0;
  let step: number = STEP.first;
  let last = 0;

  while (done < 1) {
    const most = Math.min(STEP.most, Math.max(STEP.least, STEP.shrink * step));
    step = Math.max(STEP.least, between(random, most / STEP.low, most));
    done = Math.min(1, done + step);
    const prev = points[last]!;
    const turn = angle + between(random, -1, 1) * (step >= STEP.least ? BEND.long : BEND.short);
    const point = done >= 1
      ? { x: to.x, y: to.y }
      : { x: prev.x + Math.cos(turn) * step * length, y: prev.y + Math.sin(turn) * step * length };
    points.push({ ...point, parent: last, intensity: 1, at: done });
    last = points.length - 1;

    if (done < 1) {
      twig(last, step, step >= STEP.least ? TWIG_BEND.long : TWIG_BEND.short, 1, done);
    }
  }

  return { points, start, life, length };
}

/** Points tremble `dt` tenths; the start and the end keep their places. */
export function tremble(bolt: Bolt, dt: number, random: () => number = Math.random): void {
  const reach = (bolt.length / TREMBLE) * dt;

  for (const [i, p] of bolt.points.entries()) {
    if (i > 0 && p.at < 1) {
      p.x += between(random, -reach, reach);
      p.y += between(random, -reach, reach);
    }
  }
}

/** The lines of a bolt `now`: a white core to each point's parent, a pale-cyan line one pixel to
 * the right of it for the stronger points, and one a pixel up for the main bolt. */
export function boltLines(
  bolt: Bolt,
  now: number,
): { x0: number; y0: number; x1: number; y1: number; edge: boolean; }[] {
  const age = now - bolt.start;

  if (age >= bolt.life + 1) {
    return [];
  }

  const lines: { x0: number; y0: number; x1: number; y1: number; edge: boolean; }[] = [];

  for (const p of bolt.points) {
    const parent = bolt.points[p.parent];

    if (!parent || p.at > age) {
      continue;
    }

    const line = { x0: parent.x, y0: parent.y, x1: p.x, y1: p.y };
    lines.push({ ...line, edge: false });

    // oxlint-disable-next-line no-magic-numbers -- intensity thresholds of FUN_0048e800
    if (p.intensity >= 0.25) {
      lines.push({ x0: line.x0 + 1, y0: line.y0, x1: line.x1 + 1, y1: line.y1, edge: true });
    }

    // oxlint-disable-next-line no-magic-numbers -- intensity thresholds of FUN_0048e800
    if (p.intensity > 0.5) {
      lines.push({ x0: line.x0, y0: line.y0 - 1, x1: line.x1, y1: line.y1 - 1, edge: true });
    }
  }

  return lines;
}
