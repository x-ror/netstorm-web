/**
 * What the computer opponent wants this move, scored from what it sees: to defend, and to push
 * for the enemy. Each is a number from 0 to 1 that the move reads as a priority; nothing here is
 * a fixed script, and all the thresholds are invented.
 */

/** How the enemy presses on the AI's ground this move. */
export interface Pressure {
  /** An own building or the Priest stands under the enemy's guns. */
  fired: boolean;
  /** Own buildings lost since the last moves. */
  losses: number;
  /** Cells from own ground to the nearest enemy ground, or null when none is within the alarm. */
  approach: number | null;
}

/** Cells from own ground within which enemy ground, a bridge coming on, raises the alarm
 * (invented). */
export const ALARM_DISTANCE = 12;

/* oxlint-disable no-magic-numbers -- the weights of an invented opponent */
/** How badly a defence is wanted: 1 under fire, 0 when nothing comes. */
export function defendScore(p: Pressure): number {
  const approach = p.approach === null ? 0 : 0.3 + 0.7 * (1 - p.approach / ALARM_DISTANCE);
  return Math.max(p.fired ? 1 : 0, p.losses > 0 ? 0.8 : 0, approach);
}

/** Below this share of the level's push ratio a push already under way is called off: a push
 * neither starts nor stops on a single gun. */
const PUSH_HYSTERESIS = 0.7;
/* oxlint-enable no-magic-numbers */

/**
 * Whether to carry the bridge to the enemy: when the AI's guns outweigh his by the level's ratio
 * (his ground guns against the AI's), unless it is already pushing and still has most of that.
 * An enemy with no guns is always worth pushing.
 */
export function pushing(ownDps: number, enemyDps: number, ratio: number, before: boolean): boolean {
  if (enemyDps <= 0) {
    return true;
  }

  const have = ownDps / enemyDps;
  return before ? have >= ratio * PUSH_HYSTERESIS : have >= ratio;
}
