import type { Theme } from './defs.js';

export const TPS = 10; // simulation ticks per second
export const W = 256;
export const H = 256; // world size in cells
const PIECE_INTERVAL_SECONDS = 6;
const CRYSTAL_INTERVAL_SECONDS = 20;
export const PIECE_INTERVAL = PIECE_INTERVAL_SECONDS * TPS; // temple emits a bridge piece every 6 s      TODO verify
export const HAND_SIZE = 3; // pieces a player can hold                   TODO verify
export const CRYSTAL_INTERVAL = CRYSTAL_INTERVAL_SECONDS * TPS; // geyser spawns a crystal every 20 s     TODO verify
export const CRYSTAL_VALUE = 200; // Storm Power per crystal (nugget cost=200)
export const PRIEST_HP = 100;
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
  hand: number[]; // bridge piece indices
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
  carrying: number | null; // crystal id
  path: [number, number][]; // remaining cells to walk
  move: number; // movement accumulator (×100)
  goal: 'idle' | 'collect' | 'home';
}
export interface Priest {
  id: number;
  kind: 'priest';
  owner: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  state: 'normal' | 'down' | 'carried';
  carriedBy: number | null; // id of the enemy priest carrying this one
  carrying: number | null; // id of the priest being carried
  path: [number, number][];
  move: number;
}
export interface Crystal {
  id: number;
  kind: 'crystal';
  x: number;
  y: number;
  geyser: number;
  carriedBy: number | null;
}
export interface Geyser {
  id: number;
  kind: 'geyser';
  x: number;
  y: number;
  timer: number;
  crystal: number | null;
}
export type Entity = Building | Transport | Priest | Crystal | Geyser;
