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
}

/* oxlint-disable no-magic-numbers -- the tuning table of an invented opponent */
export const DIFFICULTY: Readonly<Record<Difficulty, Readonly<AiParams>>> = {
  easy: { moveSeconds: 8, reactionMoves: 3, threatWeight: 0 },
  normal: { moveSeconds: 5, reactionMoves: 1, threatWeight: 1 },
  hard: { moveSeconds: 3, reactionMoves: 0, threatWeight: 2 },
};
/* oxlint-enable no-magic-numbers */
