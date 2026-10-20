/**
 * What is left of a unit that goes: its picture breaks into its pixels. A unit destroyed by damage
 * throws them out from its middle (FlyingShrapnel of netstorm.game 10.82, FUN_004719f0), one
 * salvaged lets them fall (Collapse). Time is in tenths of a second, as burning.ts counts it.
 */
import type { Texture } from 'pixi.js';
import { pixelsOf } from './burning.js';

/* oxlint-disable no-magic-numbers -- the numbers of FlyingShrapnel and Collapse, and RGBA bytes */
/** A piece flies out at 0.3 of its distance from the middle a tenth, and up by 14 to 20 more,
 * falling 6 pixels a tenth faster each tenth; it lasts 0.05 to 0.55 s. */
const SHRAPNEL = { spread: 0.3, lift: { least: 14, most: 20 }, fall: 6 } as const;
/** A collapsing picture's pixels drop at 0.24; how long they last is not read (`?`), so as long. */
const COLLAPSE = { fall: 0.24 } as const;
const LIFE = { least: 0.5, most: 5.5 } as const;
/** One piece is two pixels by two: a quarter as many to draw, the look the same. */
export const PIECE = 2;

export interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fall: number;
  life: number;
  colour: number;
}

/** Break a picture whose top left is at (left, top) into pieces; `collapse` for a Salvage. */
export function shatter(
  pieces: Piece[],
  texture: Texture,
  left: number,
  top: number,
  collapse = false,
  random: () => number = Math.random,
): void {
  const picture = pixelsOf(texture);

  if (!picture) {
    return;
  }

  const { width, height, rgba } = picture;

  for (let y = 0; y < height; y += PIECE) {
    for (let x = 0; x < width; x += PIECE) {
      const at = (y * width + x) * 4;

      if (rgba[at + 3] === 0) {
        continue;
      }

      const lift = SHRAPNEL.lift.least + random() * (SHRAPNEL.lift.most - SHRAPNEL.lift.least);
      pieces.push({
        x: left + x,
        y: top + y,
        vx: collapse ? 0 : (x - width / 2) * SHRAPNEL.spread,
        vy: collapse ? 0 : (y - height / 2) * SHRAPNEL.spread - lift,
        fall: collapse ? COLLAPSE.fall : SHRAPNEL.fall,
        life: LIFE.least + random() * (LIFE.most - LIFE.least),
        colour: (rgba[at]! << 16) | (rgba[at + 1]! << 8) | rgba[at + 2]!,
      });
    }
  }
}

/** Move the pieces on by `dt` tenths of a second; the spent ones go. */
export function scatter(pieces: Piece[], dt: number): void {
  let kept = 0;

  for (const piece of pieces) {
    piece.life -= dt;
    piece.x += piece.vx * dt;
    piece.y += piece.vy * dt;
    piece.vy += piece.fall * dt;

    if (piece.life > 0) {
      pieces[kept++] = piece;
    }
  }

  pieces.length = kept;
}
