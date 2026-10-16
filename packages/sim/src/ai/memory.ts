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
}

/** Moves the memory keeps a figure for: enough to average an income over (invented). */
export const MEMORY_MOVES = 10;

export function createAiMemory(): AiMemory {
  return { storm: [], spent: [], firstSeen: new Map() };
}

/** Record one move: what it started with and what it spent, forgetting the oldest. */
export function remember(memory: AiMemory, storm: number, spent: number): void {
  memory.storm.push(storm);
  memory.spent.push(spent);

  if (memory.storm.length > MEMORY_MOVES) {
    memory.storm.shift();
    memory.spent.shift();
  }
}
