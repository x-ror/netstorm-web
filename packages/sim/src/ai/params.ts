/**
 * What tells the levels of the computer opponent apart. None of it is a cheat: every level has
 * the same Storm Power, the same prices and the same build times as a player; a harder one only
 * acts more often. Invented: the original's levels are not read. More knobs come in with the
 * layers of docs/ai-design.md that use them.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export interface AiParams {
  /** Seconds of game time between two moves. */
  moveSeconds: number;
  /** Moves after an enemy gun appears before it is taken into account. */
  reactionMoves: number;
  /** How much a cell under fire lengthens a bridge: 0 ignores the enemy's guns altogether. */
  threatWeight: number;
  /** Units a move lays at most; each must be of another type, as a player's refresh allows. */
  actionsPerMove: number;
  /** Transports it keeps at most, however many geysers it has. */
  maxTransports: number;
  /** Storm Power held back for a defence: this many of its cheapest shooter. */
  reserveShooters: number;
  /** Its guns over the enemy's before it bridges to him. */
  pushRatio: number;
  /** Chance that a gun which has had nothing to shoot at for long is salvaged, 0 to 1. */
  salvageChance: number;
  /** Free geysers it weighs as the next to bridge to, the best first. */
  planningGeysers: number;
  /** Bridges it grows in one move, each toward another target. */
  bridgeHeads: number;
  /** Guns it wants to have the enemy's Priest in reach of before it lays no more at him. */
  concentrate: number;
  /** Guns it keeps within reach of its Altar while it holds a captive. */
  altarGuards: number;
}

/* oxlint-disable no-magic-numbers -- the tuning table of an invented opponent */
export const DIFFICULTY: Readonly<Record<Difficulty, Readonly<AiParams>>> = {
  easy: {
    moveSeconds: 8,
    reactionMoves: 3,
    threatWeight: 0,
    actionsPerMove: 2,
    maxTransports: 2,
    reserveShooters: 0,
    pushRatio: 1.6,
    salvageChance: 0,
    planningGeysers: 1,
    bridgeHeads: 1,
    concentrate: 1,
    altarGuards: 0,
  },
  normal: {
    moveSeconds: 5,
    reactionMoves: 1,
    threatWeight: 1,
    actionsPerMove: 3,
    maxTransports: 3,
    reserveShooters: 1,
    pushRatio: 1.2,
    salvageChance: 0.5,
    planningGeysers: 3,
    bridgeHeads: 2,
    concentrate: 2,
    altarGuards: 1,
  },
  hard: {
    moveSeconds: 3,
    reactionMoves: 0,
    threatWeight: 2,
    actionsPerMove: 5,
    maxTransports: 4,
    reserveShooters: 2,
    pushRatio: 1,
    salvageChance: 1,
    planningGeysers: 99,
    bridgeHeads: 3,
    concentrate: 3,
    altarGuards: 2,
  },
};
/* oxlint-enable no-magic-numbers */
