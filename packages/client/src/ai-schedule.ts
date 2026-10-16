import type { Command } from '@netstorm/sim';

/**
 * The computer's moves, asked for on one tick and owed on a later one: the move is worked out off
 * the main thread from the world as it stood, and its commands join the step of the tick they are
 * owed on, whatever the wall clock did meanwhile. A tick whose owed commands have not come waits.
 */
export class AiSchedule {
  /** By the tick the commands are owed on: each side's commands, or null while still to come. */
  private readonly owed = new Map<number, Map<number, Command[] | null>>();

  /** `lead`: ticks between asking for a move and applying it. */
  constructor(readonly lead: number) {}

  /** A move asked for on `tick`; returns the tick its commands are owed on. */
  request(tick: number, player: number): number {
    const due = tick + this.lead;
    let sides = this.owed.get(due);

    if (!sides) {
      sides = new Map();
      this.owed.set(due, sides);
    }

    sides.set(player, null);
    return due;
  }

  deliver(due: number, player: number, commands: Command[]): void {
    this.owed.get(due)?.set(player, commands);
  }

  /** The commands owed on `tick`, in the order of the sides; null while any are still to come. */
  take(tick: number): Command[] | null {
    const sides = this.owed.get(tick);

    if (!sides) {
      return [];
    }

    const moves = [...sides.entries()].sort(([a], [b]) => a - b).map(([, move]) => move);

    if (moves.some((move) => move === null)) {
      return null;
    }

    this.owed.delete(tick);
    return moves.flatMap((move) => move!);
  }
}
