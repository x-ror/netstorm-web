/**
 * What the computer opponent carries from one move to the next: nothing a single WorldView shows.
 * The caller owns it, one per computer side, and hands it to every move; it is not part of the
 * world, so the snapshot and the replay never see it. It holds only what past moves derived from
 * past views, which keeps a move a function of the views so far and nothing else.
 */
export interface AiMemory {
  /** Storm Power at the start of the last moves, oldest first. */
  storm: number[];
  /** Storm Power each of those moves spent. */
  spent: number[];
  /** The tick each enemy building was first seen on, by id: a new gun is reacted to only after
   * the level's delay. */
  firstSeen: Map<number, number>;
  /** Own buildings at the last move, by id, where they stood: what is gone was lost or salvaged. */
  buildings: Map<number, { x: number; y: number; }>;
  /** Where and when own buildings were lost, newest last. */
  losses: { x: number; y: number; tick: number; }[];
  /** Own guns with nothing in reach, by id, and the tick that began. */
  idle: Map<number, number>;
  /** Whether the last move was pushing for the enemy. */
  pushing: boolean;
  /** Where the bridge to the enemy was last headed: his Priest's cell then, kept while he stays
   * near it, so the bridge does not wander after his every step. */
  mark: { x: number; y: number; } | null;
  /** The siege point the bridge to the enemy is headed for, kept while it still serves: a new one
   * every move would have the bridge, and the Generators behind it, start over. */
  siege: { x: number; y: number; } | null;
  /** Siege points the bridge came up to without room for a gun, by cell: not tried again. */
  badSieges: Set<number>;
  /** The tick of the last look for a piece that makes room for a gun, which found none. */
  slotLook: number;
  /** The state of the AI's own random numbers, for its mistakes and its salvage; never the
   * world's. */
  rng: number;
}

/** Moves the memory keeps a figure for: enough to average an income over (invented). */
export const MEMORY_MOVES = 10;

export function createAiMemory(seed = 1): AiMemory {
  return {
    storm: [],
    spent: [],
    firstSeen: new Map(),
    buildings: new Map(),
    losses: [],
    idle: new Map(),
    pushing: false,
    mark: null,
    siege: null,
    badSieges: new Set(),
    slotLook: -Infinity,
    rng: seed >>> 0 || 1,
  };
}

/** Moves a loss is held against the enemy for (invented). */
export const LOSS_MOVES = 3;

/* oxlint-disable no-magic-numbers -- mulberry32, the same as World.rng's */
/** The next number from 0 up to 1 of the AI's own stream. */
export function random(memory: AiMemory): number {
  memory.rng = (memory.rng + 0x6d2b79f5) >>> 0;
  let t = memory.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/* oxlint-enable no-magic-numbers */

/** Record one move: what it started with and what it spent, forgetting the oldest. */
export function remember(memory: AiMemory, storm: number, spent: number): void {
  memory.storm.push(storm);
  memory.spent.push(spent);

  if (memory.storm.length > MEMORY_MOVES) {
    memory.storm.shift();
    memory.spent.shift();
  }
}
