/**
 * Which frame of its type an entity shows on a tick. Frames are named by "slot": the number of the
 * frame's line in the .type file, as scripts/unshp.py counts them. scripts/anim-frames.py ships the
 * slots listed here. One frame is shown per tick; the original's frame rates are not read (`?`).
 */
import type { DeepReadonly, Entity } from '@netstorm/sim';

/* oxlint-disable no-magic-numbers -- slot counts and frame groups of the .type files */
/** Slots shipped of each type, from the first; the same table as in scripts/anim-frames.py. */
export const SLOT_COUNTS: Readonly<Record<string, number>> = {
  sunwalker: 64,
  priest: 64,
  geyser: 50,
  sunflyer: 8,
  windflyer: 13,
  rainflyer: 16,
  rainballoon: 20,
  nugget: 9,
  rainwalker: 10,
  raincannon: 12,
};
/** Types whose first slots are one cycle played over and over, with its length. */
const LOOPS: Readonly<Record<string, number>> = {
  sunflyer: 8,
  windflyer: 13,
  rainflyer: 16,
  rainballoon: 20,
  rainwalker: 10,
};
/** The eruption of a geyser; the slot after it is the geyser run dry. */
const GEYSER_CYCLE = 49;
const NUGGET_CYCLE = 9;
/** Frames of one heading of a walker, and of one facing of a firing Ice Cannon. */
const WALK_FRAMES = 8;
const ICE_CANNON_FRAMES = 3;
/**
 * Golem and Priest have eight frames of walking for each of eight headings, in the groups A to H
 * of their .type files: north, then clockwise. Standing, each shows the default frame of its
 * file: the Golem north (A05), the Priest east (C02).
 */
const WALKERS: Readonly<Record<string, readonly [heading: number, frame: number]>> = {
  sunwalker: [0, 5],
  priest: [2, 2],
};
/* oxlint-enable no-magic-numbers */

/** Heading of a step, 0 north and clockwise to 7 north-west; undefined for no step. */
export function heading(dx: number, dy: number): number | undefined {
  const HEADINGS = [[7, 0, 1], [6, undefined, 2], [5, 4, 3]] as const; // oxlint-disable-line no-magic-numbers
  return HEADINGS[Math.sign(dy) + 1]![Math.sign(dx) + 1];
}

/**
 * The type and slot an entity shows, or null when it has no animation and keeps its one picture.
 * `headings` remembers which way each walker last went, so that it stands as it stopped.
 */
export function slotOf(
  entity: DeepReadonly<Entity>,
  tick: number,
  headings: Map<number, number>,
): readonly [type: string, slot: number] | null {
  if (entity.kind === 'geyser') {
    return ['geyser', entity.stock > 0 ? tick % GEYSER_CYCLE : GEYSER_CYCLE];
  }

  if (entity.kind === 'crystal') {
    return ['nugget', tick % NUGGET_CYCLE];
  }

  if (entity.kind === 'building') {
    // The Ice Cannon cycles the three frames of its facing while it has a target.
    return entity.type === 'raincannon' && entity.target !== null
      ? [entity.type, entity.facing * ICE_CANNON_FRAMES + (tick % ICE_CANNON_FRAMES)]
      : null;
  }

  if (entity.kind === 'obelisk' || (entity.kind === 'priest' && entity.state !== 'normal')) {
    return null;
  }

  const type = entity.kind === 'priest' ? 'priest' : entity.type;
  const loop = LOOPS[type];

  if (loop) {
    return [type, tick % loop];
  }

  const walker = entity.kind === 'flyer' ? undefined : WALKERS[type];

  if (!walker || entity.kind === 'flyer') {
    return null;
  }

  const next = entity.path[0];
  const going = next ? heading(next[0] - entity.x, next[1] - entity.y) : undefined;

  if (going !== undefined) {
    headings.set(entity.id, going);
    return [type, going * WALK_FRAMES + (tick % WALK_FRAMES)];
  }

  const stood = headings.get(entity.id);
  return [type, stood === undefined ? walker[0] * WALK_FRAMES + walker[1] : stood * WALK_FRAMES];
}
