import type { Theme } from './defs.js';

export const TPS = 10; // simulation ticks per second
export const W = 256;
export const H = 256; // world size in cells
// From the original's Production Window code (netstorm.game 10.82): a free bridge slot is refilled
// once per bridgeDrawRate, which defaults to 1 and is added to a clock that counts seconds.
const PIECE_INTERVAL_SECONDS = 1;
export const PIECE_INTERVAL = PIECE_INTERVAL_SECONDS * TPS;
// A piece in the window has three strengths, as in the original: cracked, then normal, then hard.
// It moves from normal to hard when a timer of 60 tenths of a second runs out (same code). How long
// the first step, from cracked to normal, takes is not established (`?`); 6 s is assumed for it too.
const PIECE_HARDEN_SECONDS = 6;
/** Ticks in the window after which a piece is no longer cracked. */
export const PIECE_HARDEN = PIECE_HARDEN_SECONDS * TPS;
/** Ticks in the window after which a piece is hard. */
export const PIECE_HARD = PIECE_HARDEN + PIECE_HARDEN;
export const HAND_SIZE = 6; // "Bridge Slots" battle option: 2, 4 or 6; six in the campaign
// The official help gives neither number (the stock is the "Money per Geyser" battle option);
// both come from the .type files and are unconfirmed. See docs/game-rules.md.
export const CRYSTAL_VALUE = 200; // Storm Power per crystal
export const GEYSER_STOCK = 2000; // Storm Power a geyser holds before it is depleted
export const PRIEST_HP = 100;
/** Share of a unit's cost paid for destroying an enemy unit and, at full health, for salvaging your own. */
export const REFUND_SHARE = 0.25;
// Radius, in cells, of the circle a Temple or Generator spreads its Energy over. Measured in the
// original (campaign defaults): the 12 range markers of a Rain Temple and of a Rain Generator both
// lie on a circle of radius 30.0 around the building's centre. See docs/game-rules.md.
export const ENERGY_RANGE = 30;
export const RUNES = 5; // runes the sacrificing priest must ward
// Measured in the original (campaign, The War Begins!): the runes were warded 14, 29, 44, 59 and
// 75 s after the Sacrifice was ordered, the priest walking to a new spot by the altar for each.
const RUNE_SECONDS = 15;
export const RUNE_INTERVAL = RUNE_SECONDS * TPS;
// "When you lay a unit down in the game its image in the Production Window will stay dimmed for a
// while" (Unit Rate option). The campaign default is stuffRefreshRate = 4 in setup.cfg, read as
// seconds; the unit of that number is not stated anywhere (`?`).
const UNIT_REFRESH_SECONDS = 4;
export const UNIT_REFRESH = UNIT_REFRESH_SECONDS * TPS;
export const MAX_PLAYERS = 8;
export const MAX_ID = 0x7fffffff; // ids fit a signed 32-bit integer
export const MAX_UINT32 = 0xffffffff;
export const FACINGS = [0, 1, 2, 3] as const; // oxlint-disable-line no-magic-numbers -- enumerates Facing
export const MAX_FACING = 3;
export const ROTATION_MASK = 3; // rotations and facings wrap modulo 4

export const enum Terrain {
  Sky = 0,
  Island = 1,
  Bridge = 2,
  /** Laid from a piece that had not hardened yet: it crumbles where a solid bridge only cracks. */
  CrackedBridge = 3,
  /** Laid from a piece that had turned hard: explosions and Salvage next to it leave it as it is. */
  HardBridge = 4,
}

export function isBridge(terrain: number | undefined): boolean {
  return terrain === Terrain.Bridge || terrain === Terrain.CrackedBridge
    || terrain === Terrain.HardBridge;
}

/** A bridge piece waiting in the Production Window. */
export interface HandPiece {
  piece: number; // index into PIECES
  age: number; // ticks in the window, capped at PIECE_HARD
}
export type Facing = 0 | 1 | 2 | 3; // N, E, S, W
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * The 46 bridge pieces of the original (netstorm.game 10.82), in its own order: the weight of the
 * piece in the "Standard" bridge set, then the rows of its shape, '#' being a bridge cell. Mirror
 * images are separate pieces; a few shapes appear twice and differ only in artwork. The weights of
 * the other bridge sets (Traditional, Simplified, Crazy) are listed in docs/game-rules.md.
 */
/* oxlint-disable no-magic-numbers -- the weights are data of the original */
const CANONS: ReadonlyArray<readonly [weight: number, ...rows: string[]]> = [
  [0, '#'],
  [600, '#', '#'],
  [200, '#', '#', '#'],
  [40, '#', '#', '#', '#'],
  [160, '##', '.#'],
  [1950, '#.', '##', '#.'],
  [50, '#.', '##', '#.'],
  [10, '##.', '.##'],
  [10, '.##', '##.'],
  [80, '#.', '#.', '##'],
  [80, '.#', '.#', '##'],
  [850, '#..', '###', '.#.'],
  [50, '#..', '###', '.#.'],
  [850, '..#', '###', '.#.'],
  [50, '..#', '###', '.#.'],
  [10, '#.', '#.', '#.', '##'],
  [10, '.#', '.#', '.#', '##'],
  [0, '##..', '.###'],
  [0, '..##', '###.'],
  [300, '#..', '###', '#..'],
  [40, '.##', '##.', '.##'],
  [0, '..#', '..#', '###'],
  [0, '..#', '.##', '##.'],
  [1, '.#.', '###', '.#.'],
  [300, '#.', '##', '#.', '#.'],
  [300, '#.', '#.', '##', '#.'],
  [60, '.##', '.#.', '##.'],
  [60, '##.', '.#.', '.##'],
  [1, '##', '#.', '##', '#.'],
  [1, '#.', '##', '#.', '##'],
  [20, '.##', '.#.', '.#.', '##.'],
  [20, '##.', '.#.', '.#.', '.##'],
  [40, '..#', '###', '.#.', '.#.'],
  [40, '#..', '###', '.#.', '.#.'],
  [40, '#..', '#..', '###', '.#.'],
  [40, '..#', '..#', '###', '.#.'],
  [0, '##', '#.', '##'],
  [0, '###', '.#.', '.##'],
  [0, '.##', '.#.', '###'],
  [10, '.#.', '.##', '##.', '.#.'],
  [10, '.#.', '##.', '.##', '.#.'],
  [5, '.#.', '##.', '.#.', '.##'],
  [5, '.#.', '.##', '.#.', '##.'],
  [5, '.#.', '.#.', '##.', '.##'],
  [5, '.#.', '.#.', '.##', '##.'],
  [0, '#.#', '###', '#.#'],
];
/* oxlint-enable no-magic-numbers */

/** Bridge pieces as cell offsets. Rotations are generated. */
export const PIECES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = CANONS.map((
  [, ...rows],
) =>
  rows.flatMap((row, y) =>
    [...row].flatMap((cell, x): (readonly [number, number])[] => cell === '#' ? [[x, y]] : [])
  )
);
/** Chance of each piece relative to the others when the Temple draws one. */
export const PIECE_WEIGHTS: readonly number[] = CANONS.map(([weight]) => weight);
// The two pieces the Temple hands out on a schedule when the window lacks them (rules/economy.ts).
export const SINGLE_PIECE = 0;
export const DOMINO_PIECE = 1;

export function rotatePiece(
  cells: ReadonlyArray<readonly [number, number]>,
  rot: number,
): [number, number][] {
  let out: [number, number][] = cells.map((c) => [c[0], c[1]]);

  for (let r = 0; r < (rot & ROTATION_MASK); r++) {
    out = out.map(([x, y]) => [-y, x]);
  }

  const mx = Math.min(...out.map((c) => c[0]));
  const my = Math.min(...out.map((c) => c[1]));
  return out.map(([x, y]) => [x - mx, y - my]);
}

export interface Player {
  id: number; // 1..8 (0 = neutral)
  name: string;
  theme: Theme;
  storm: number; // Storm Power
  tech: Set<string>; // unit ids the player knows
  hand: HandPiece[];
  pieceTimer: number;
  /** Pieces the Temple has drawn so far; drives the guaranteed single block and domino. */
  piecesDrawn: number;
  /** Unit types laid down recently, with the ticks left before they can be laid again. */
  refresh: { type: string; ticks: number; }[];
  alive: boolean;
}

export interface Building {
  id: number;
  kind: 'building';
  type: string;
  owner: number;
  x: number;
  y: number;
  fx: number;
  fy: number; // anchor (top-left) and footprint
  hp: number;
  hpMax: number;
  facing: Facing;
  target: number | null; // entity this shooter is locked on
  cooldown: number; // ticks until the next shot
  /** Player whose damage brought the building down, 0 until then; its explosion is his too. */
  killer: number;
}
export interface Transport {
  id: number;
  kind: 'transport';
  type: string;
  owner: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  carrying: number | null; // crystal id, or the enemy priest being carried to the altar
  path: [number, number][]; // remaining cells to walk
  move: number; // movement accumulator (×100)
  goal: 'idle' | 'collect' | 'pickup' | 'home' | 'capture' | 'altar';
  /** Geyser being mined (kept through 'home' so the transport loops), the crystal or priest to pick
   * up, or the altar the captive is carried to. */
  target: number | null;
}
export interface Priest {
  id: number;
  kind: 'priest';
  owner: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  /** down: immobilized at half HP; carried: on an enemy transport; chained: on an enemy altar. */
  state: 'normal' | 'down' | 'carried' | 'chained';
  carriedBy: number | null; // enemy transport carrying this priest
  chainedAt: number | null; // enemy altar this priest is chained on
  runes: number; // runes warded so far in the sacrifice of this priest
  runeTimer: number; // ticks spent on the current rune
  path: [number, number][];
  move: number;
}
export interface Crystal {
  id: number;
  kind: 'crystal';
  x: number;
  y: number;
  value: number; // Storm Power credited on delivery
  carriedBy: number | null;
}
export interface Geyser {
  id: number;
  kind: 'geyser';
  x: number;
  y: number;
  stock: number; // Storm Power left; 0 = depleted
}
export type Entity = Building | Transport | Priest | Crystal | Geyser;
