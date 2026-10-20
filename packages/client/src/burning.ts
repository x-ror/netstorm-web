/**
 * Fire on a damaged unit, after the Burning class of netstorm.game 10.82 (Damageable.cpp starts it
 * for a type with `damageEffect = 1` below half its hit points and puts it out at half). It is no
 * frame of the unit: streaks of anchors on the opaque pixels of its picture throw up sparks.
 * Time is counted in tenths of a second, as the original counts it, which is one tick here.
 */
import type { Texture } from 'pixi.js';

/* oxlint-disable no-magic-numbers -- the numbers of Burning.cpp and of the 8-bit colours it draws */

/** Sparks an anchor throws: a chance of one in 1.4 tenths of a second, about seven a second. */
const SPARK_EVERY = 1.4;
/** A spark rises 2 pixels a tenth of a second and lives 0.4 to 0.9 s. */
const RISE = 2;
const LIFE = { least: 4, most: 9 } as const;
/** A streak: 6 to 10 anchors stepping up to the right, kept if more than 3 land on the picture. */
const ANCHORS = { least: 6, most: 10, kept: 3 } as const;
const MOST_STREAKS = 6;
const TRIES = 300;
/** Colours from a dying spark to a new one: (255,115,7) to (255,245,117) of its ColorLine. */
const OLD = [255, 115, 7] as const;
const NEW = [255, 245, 117] as const;

export interface Spark {
  x: number;
  y: number;
  life: number;
}

/** Types with `damageEffect` set, by lower-case id. */
export function burners(raw: unknown): ReadonlySet<string> {
  const ids = new Set<string>();

  for (const unit of Array.isArray(raw) ? raw : []) {
    if (unit && typeof unit.id === 'string' && Number(unit.damageEffect)) {
      ids.add(unit.id.toLowerCase());
    }
  }

  return ids;
}

/** Streaks burning on a unit: none from half its hit points up, then one more for every tenth
 * lost, to six (FUN_004255b0; its single streak for the `guy` flag concerns no type that burns). */
export function streaksOf(hp: number, max: number): number {
  if (hp <= 0 || hp * 2 >= max) {
    return 0;
  }

  return Math.max(1,
    Math.min(MOST_STREAKS, MOST_STREAKS - Math.floor((hp * 5) / (max - Math.floor(max / 2)))));
}

const masks = new WeakMap<Texture, { width: number; height: number; solid: Uint8Array; }>();

/** Which pixels of a frame are drawn, read once from its atlas. */
function maskOf(texture: Texture): { width: number; height: number; solid: Uint8Array; } | null {
  const known = masks.get(texture);

  if (known) {
    return known;
  }

  const { width, height } = texture.frame;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context || width < 1 || height < 1) {
    return null;
  }

  const { x, y } = texture.frame;
  context.drawImage(texture.source.resource as CanvasImageSource, x, y, width, height, 0, 0, width,
    height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const solid = new Uint8Array(width * height);

  for (let i = 0; i < solid.length; i++) {
    solid[i] = pixels[i * 4 + 3]! > 0 ? 1 : 0;
  }

  const mask = { width, height, solid };
  masks.set(texture, mask);
  return mask;
}

/** Up to six streaks of anchors on a frame, as pixels from its top left (FUN_00425140). */
export function anchorsOf(texture: Texture, random: () => number = Math.random): number[][][] {
  const mask = maskOf(texture);

  if (!mask || mask.height < 3) {
    return [];
  }

  const { width, height, solid } = mask;
  const most = Math.min(MOST_STREAKS, Math.floor((width + height) / 5));
  const taken = new Set<number>();
  const streaks: number[][][] = [];
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));

  for (let tries = 0; tries < TRIES && streaks.length < most; tries++) {
    const x0 = between(0, Math.max(8, width - 7));
    const y0 = between(2, height - 1);
    const row = Math.floor((x0 + y0) / 5);

    if (taken.has(row)) {
      continue;
    }

    const streak: number[][] = [];

    for (let i = between(ANCHORS.least, ANCHORS.most) - 1; i >= 0; i--) {
      const x = x0 + (i >> 1);
      const y = y0 - (i >> 1);

      if (x < width && y >= 0 && solid[y * width + x]) {
        streak.push([x, y]);
      }
    }

    if (streak.length > ANCHORS.kept) {
      taken.add(row);
      streaks.push(streak);
    }
  }

  return streaks;
}

/** Throw sparks from the anchors of a burning unit whose picture's top left is at (left, top), and
 * age every spark by `dt` tenths of a second. */
export function burn(
  sparks: Spark[],
  anchors: readonly (readonly number[])[],
  left: number,
  top: number,
  dt: number,
  random: () => number = Math.random,
): void {
  for (const [x, y] of anchors) {
    if (random() * SPARK_EVERY < dt) {
      sparks.push({
        x: left + x!,
        y: top + y!,
        life: LIFE.least + random() * (LIFE.most - LIFE.least),
      });
    }
  }
}

/** Age the sparks by `dt` tenths of a second; the dead ones go. */
export function rise(sparks: Spark[], dt: number): void {
  let kept = 0;

  for (const spark of sparks) {
    spark.life -= dt;
    spark.y -= RISE * dt;

    if (spark.life > 0) {
      sparks[kept++] = spark;
    }
  }

  sparks.length = kept;
}

/** The colour of a spark: pale yellow when new, orange when dying (`?` which way the ramp runs). */
export function sparkColour(life: number): number {
  const share = Math.max(0, Math.min(1, life / LIFE.most));
  const [r, g, b] = OLD.map((from, i) => Math.round(from + (NEW[i]! - from) * share));
  return (r! << 16) | (g! << 8) | b!;
}
