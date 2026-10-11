import type { Theme } from './defs.js';

export const TPS = 10; // simulation ticks per second
export const W = 256;
export const H = 256; // world size in cells
const PIECE_INTERVAL_SECONDS = 6;
export const PIECE_INTERVAL = PIECE_INTERVAL_SECONDS * TPS; // temple emits a bridge piece every 6 s      TODO verify
// Invented: a new piece is cracked and "becomes more solid" after "a few seconds" in the window.
const PIECE_HARDEN_SECONDS = 3;
export const PIECE_HARDEN = PIECE_HARDEN_SECONDS * TPS;
export const HAND_SIZE = 6; // bridge slots in the Production Window, as seen in the campaign // pieces a player can hold                   TODO verify
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
const RUNE_SECONDS = 2; // invented: the official help does not say how long the ritual takes
export const RUNE_INTERVAL = RUNE_SECONDS * TPS;
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
}

export function isBridge(terrain: number | undefined): boolean {
  return terrain === Terrain.Bridge || terrain === Terrain.CrackedBridge;
}

/** A bridge piece waiting in the Production Window. */
export interface HandPiece {
  piece: number; // index into PIECES
  age: number; // ticks in the window, capped at PIECE_HARDEN
}
export type Facing = 0 | 1 | 2 | 3; // N, E, S, W
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Bridge pieces: 7 tetrominoes + a 2-cell domino, as cell offsets. Rotations are generated. */
export const PIECES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0], // oxlint-disable-line no-magic-numbers -- piece cell offset
  ], // I
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ], // O
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [1, 1],
  ], // T
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 1],
  ], // L
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
  ], // J
  [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ], // S
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ], // Z
  [
    [0, 0],
    [1, 0],
  ], // domino
];

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
