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
// Both as the original computes them (netstorm.game 10.82): mining a crystal subtracts the cost
// in nugget.type from the geyser's stock, and outside a battle with options the stock starts at
// the cost in geyser.type. A battle takes it from the "Money per Geyser" option instead: 2000,
// 3000, 4000 or 5000. See docs/game-rules.md.
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
 * piece in the "Standard" bridge set, then the rows of its shape. A letter is a bridge cell and
 * names, as in the original, the sides the cell joins on (see LETTER_LINKS); '.' is empty. Mirror
 * images are separate pieces; a few shapes appear twice and differ only in artwork. The weights of
 * the other bridge sets (Traditional, Simplified, Crazy) are listed in docs/game-rules.md.
 */
/* oxlint-disable no-magic-numbers -- the weights and link masks are data of the original */
const CANONS: ReadonlyArray<readonly [weight: number, ...rows: string[]]> = [
  [0, 'J'],
  [600, 'J', 'J'],
  [200, 'J', 'J', 'J'],
  [40, 'J', 'J', 'J', 'J'],
  [160, 'KG', '.J'],
  [1950, 'J.', 'BK', 'J.'],
  [50, 'J.', 'BK', 'J.'],
  [10, 'KG.', '.IK'],
  [10, '.FK', 'KH.'],
  [80, 'J.', 'J.', 'IK'],
  [80, '.J', '.J', 'KH'],
  [850, 'J..', 'ICK', '.J.'],
  [50, 'J..', 'ICK', '.J.'],
  [850, '..J', 'KCH', '.J.'],
  [50, '..J', 'KCH', '.J.'],
  [10, 'J.', 'J.', 'J.', 'IK'],
  [10, '.J', '.J', '.J', 'KH'],
  [0, 'KG..', '.IKK'],
  [0, '..FK', 'KKH.'],
  [300, 'J..', 'BKK', 'J..'],
  [40, '.FK', 'KD.', '.IK'],
  [0, '..J', '..J', 'KKH'],
  [0, '..J', '.FH', 'KH.'],
  [1, '.J.', 'KAK', '.J.'],
  [300, 'J.', 'BK', 'J.', 'J.'],
  [300, 'J.', 'J.', 'BK', 'J.'],
  [60, '.FK', '.J.', 'KH.'],
  [60, 'KG.', '.J.', '.IK'],
  [1, 'FK', 'J.', 'BK', 'J.'],
  [1, 'J.', 'BK', 'J.', 'IK'],
  [20, '.FK', '.J.', '.J.', 'KH.'],
  [20, 'KG.', '.J.', '.J.', '.IK'],
  [40, '..J', 'KCH', '.J.', '.J.'],
  [40, 'J..', 'ICK', '.J.', '.J.'],
  [40, 'J..', 'J..', 'ICK', '.J.'],
  [40, '..J', '..J', 'KCH', '.J.'],
  [0, 'FK', 'J.', 'IK'],
  [0, 'KCK', '.J.', '.IK'],
  [0, '.FK', '.J.', 'KEK'],
  [10, '.J.', '.BK', 'KD.', '.J.'],
  [10, '.J.', 'KD.', '.BK', '.J.'],
  [5, '.J.', 'KD.', '.J.', '.IK'],
  [5, '.J.', '.BK', '.J.', 'KH.'],
  [5, '.J.', '.J.', 'KD.', '.IK'],
  [5, '.J.', '.J.', '.BK', 'KH.'],
  [0, 'J.J', 'BKD', 'J.J'],
];
/** Sides a cell joins on, by its letter: bit 0 north, 1 east, 2 south, 3 west, as in DIRS. */
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
};
/** A cell that joins on every side: island ground, and bridge laid without a piece. */
export const LINK_ALL = 15;
/* oxlint-enable no-magic-numbers */
const EMPTY_CELL = '.';

function canonCells<T>(
  rows: readonly string[],
  pick: (letter: string, x: number, y: number) => T,
): T[] {
  return rows.flatMap((row, y) =>
    [...row].flatMap((letter, x) => letter === EMPTY_CELL ? [] : [pick(letter, x, y)])
  );
}

/** Bridge pieces as cell offsets. Rotations are generated. */
export const PIECES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = CANONS.map((
  [, ...rows],
) => canonCells(rows, (_letter, x, y): readonly [number, number] => [x, y]));
/** Link mask of every cell of every piece, in the order of PIECES. */
const PIECE_LINKS: ReadonlyArray<readonly number[]> = CANONS.map(([, ...rows]) =>
  canonCells(rows, (letter) => LETTER_LINKS[letter]!)
);
/** Chance of each piece relative to the others when the Temple draws one. */
export const PIECE_WEIGHTS: readonly number[] = CANONS.map(([weight]) => weight);
// The two pieces the Temple hands out on a schedule when the window lacks them (rules/economy.ts).
export const SINGLE_PIECE = 0;
export const DOMINO_PIECE = 1;

/** Link masks of a piece's cells after `rot` quarter turns, in the order rotatePiece gives. */
export function rotateLinks(piece: number, rot: number): number[] {
  const turns = rot & ROTATION_MASK;
  return PIECE_LINKS[piece]!.map((mask) =>
    ((mask << turns) | (mask >> (DIRS.length - turns))) & LINK_ALL
  );
}

/** The open ends of a piece after `rot` quarter turns: the cell, as rotatePiece places it, and the
 * side (an index into DIRS) on which it joins something outside the piece. A piece attaches to
 * ground and to other bridge by these ends only. */
export function pieceEnds(piece: number, rot: number): [x: number, y: number, dir: number][] {
  const cells = rotatePiece(PIECES[piece]!, rot);
  const links = rotateLinks(piece, rot);
  const inside = (x: number, y: number): boolean => cells.some(([cx, cy]) => cx === x && cy === y);
  return cells.flatMap(([x, y], index) =>
    DIRS.flatMap(([dx, dy], dir): [number, number, number][] =>
      links[index]! & (1 << dir) && !inside(x + dx, y + dy) ? [[x, y, dir]] : []
    )
  );
}

/** The direction opposite to `dir`, both as indices into DIRS. */
export function oppositeDir(dir: number): number {
  return (dir + DIRS.length / 2) & ROTATION_MASK;
}

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
