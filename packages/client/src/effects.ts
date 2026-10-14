/**
 * Passing pictures of the battle: missiles in flight, explosions, what a Spell leaves behind. They
 * show what the simulation has already done and decide nothing. Frames are slots of the original's
 * types (animations.ts); one frame is shown per tick.
 */

/** A run of slots of one type, played once. */
export interface Burst {
  type: string;
  first: number;
  frames: number;
}

/* oxlint-disable no-magic-numbers -- slots and counts of the .type files */
/**
 * The explosions of the Anim type: two large ones (groups A and B), a middling one (C, "kaboom")
 * and a small one (D). Which the original plays for what is not read; here a unit goes up in the
 * one that fits its footprint (`?`).
 */
const EXPLOSIONS = {
  large: { type: 'anim', first: 0, frames: 35 },
  middling: { type: 'anim', first: 58, frames: 8 },
  small: { type: 'anim', first: 66, frames: 22 },
} as const;

/** The explosion of a unit `width` cells wide. */
export function explosionFor(width: number): Burst {
  if (width >= 3) {
    return EXPLOSIONS.large;
  }

  return width === 2 ? EXPLOSIONS.middling : EXPLOSIONS.small;
}

/**
 * What a shooter throws: the type of its missile, how many bearings the type has frames for
 * (clockwise from north) and how many frames each bearing has. From the `orientations` of the
 * missile types; the Disc Thrower's disc has one picture.
 */
export const MISSILES: Readonly<
  Record<string, { type: string; bearings: number; frames: number; blast?: Burst; }>
> = {
  // The Whirligig's bomb tumbles through six frames and ends in a blast of its own.
  sunflyer: {
    type: 'sunflyerbomb',
    bearings: 1,
    frames: 6,
    blast: { type: 'sunflyerbomb', first: 6, frames: 17 },
  },
  windarcher: { type: 'bolt', bearings: 20, frames: 1 },
  raincannon: { type: 'raincannonmissile', bearings: 28, frames: 1 },
  thundercannon: { type: 'thundercannonmissile', bearings: 4, frames: 3 },
  sunarcher: { type: 'sundisc', bearings: 1, frames: 1 },
};
/** Cells a missile flies in a second, from Missile.cpp of netstorm.game 10.82: 35 for the bolt of
 * the Crossbow and the disc of the Disc Thrower, 20 for the rest (docs/game-rules.md). */
const FAST_MISSILES: ReadonlySet<string> = new Set(['windarcher', 'sunarcher']);

export function missileSpeed(shooter: string): number {
  return FAST_MISSILES.has(shooter) ? 35 : 20;
}
/** What a Sun Cannon's shot leaves where it lands: its shell is not drawn (ours). */
export const SHELL_BURST = EXPLOSIONS.small;

/** The slot of a missile on its way along (dx, dy) in screen pixels, at a tick. */
export function missileSlot(shooter: string, dx: number, dy: number, tick: number): number {
  const { bearings, frames } = MISSILES[shooter]!;
  const turn = Math.atan2(dx, -dy) / (2 * Math.PI);
  const bearing = (Math.round(turn * bearings) + bearings) % bearings;
  return bearing * frames + (tick % frames);
}

/** What each Spell shows on a unit it touches, or at the caster for a blast. */
export const SPELL_BURSTS: Readonly<
  Record<string, { each?: Burst; air?: boolean; here?: Burst; bolt?: 'caster' | 'sky'; }>
> = {
  // Thunderstorm sends a bolt from the caster to each unit; a Thunder Strike falls from the sky.
  bomblightingwave: { bolt: 'caster' },
  bomblightingzap: { bolt: 'sky' },
  bombheal: { each: { type: 'healeffect', first: 0, frames: 9 } },
  bombgraviton: { each: { type: 'gravitationeffect', first: 0, frames: 10 }, air: true },
  bombmeteor: { each: { type: 'meteoreffect', first: 0, frames: 15 } },
  bombexplodesmall: { here: EXPLOSIONS.middling },
  bombexplodemedium: { here: EXPLOSIONS.large },
  bombexplodelarge: { here: EXPLOSIONS.large },
};
/* oxlint-enable no-magic-numbers */
