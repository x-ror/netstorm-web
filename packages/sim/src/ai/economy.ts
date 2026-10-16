/**
 * What the computer opponent's Storm Power is for: how many transports its geysers are worth,
 * when it is sitting on more than it can use, and what a shooter is worth for its price. All
 * invented.
 */
import type { UnitDef } from '../defs.js';

/** Transports worth keeping for this many geysers with stock in reach: one each and a spare, at
 * least one to go and look, and no more than the level keeps (invented). */
export function wantedTransports(geysers: number, most: number): number {
  return Math.max(1, Math.min(most, geysers + 1));
}

/** Storm Power beyond which the AI is hoarding: enough for this many of its dearest shooter
 * (invented). Hoarded Storm Power buys shooters whatever else the move had in mind. */
const HOARD_SHOOTERS = 3;

export function hoarding(storm: number, shooters: readonly Readonly<UnitDef>[]): boolean {
  const dearest = shooters.reduce((most, def) => Math.max(most, def.cost), 0);
  return dearest > 0 && storm > HOARD_SHOOTERS * dearest;
}

/** Cells of range beyond which more range is not worth paying for in a shooter (invented). */
const RANGE_WORTH = 16;

/** Damage a shooter deals, over a range worth having, for each Storm Power it costs. */
export function worth(def: Readonly<UnitDef>): number {
  return (def.dps * Math.min(def.range, RANGE_WORTH)) / def.cost;
}

/** Units the AI puts into Production Slots: what it lays. It never lays a blocker, and buys an
 * Aerial Transport only when no geyser can be walked to. */
export function useful(def: Readonly<UnitDef>, stranded: boolean): boolean {
  return def.group !== 'blocker' && (stranded || def.group !== 'balloon');
}
