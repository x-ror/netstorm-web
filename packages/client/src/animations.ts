/**
 * Which frame of its type an entity shows on a tick. Frames are named by "slot": the number of the
 * frame's line in the .type file, as scripts/unshp.py counts them. scripts/anim-frames.py ships the
 * slots listed here. One frame is shown per tick; the original's frame rates are not read (`?`).
 */
import type { Building, DeepReadonly, Entity } from '@netstorm/sim';

type Slot = readonly [type: string, slot: number];

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
  windwalker: 16,
  bulf: 32,
  windvortex: 14,
  rainvortex: 15,
  thundervortex: 8,
  thundercannon: 36,
  suncannon: 28,
  sunbattery: 8,
  thunderarcher: 2,
};
/** Types whose first slots are one cycle played over and over, with its length. */
const LOOPS: Readonly<Record<string, number>> = {
  sunflyer: 8,
  windflyer: 13,
  rainflyer: 16,
  rainballoon: 20,
  rainwalker: 10,
  // Buildings: the Sun Generator and the Thunder Temple are whole frames.
  sunbattery: 8,
  thundervortex: 8,
};
/** The eruption of a geyser; the slot after it is the geyser run dry. */
const GEYSER_CYCLE = 49;
const NUGGET_CYCLE = 9;

/**
 * Units with frames of walking for each heading. `groups` gives, for each of the eight headings
 * (north, then clockwise), which group of `frames` slots shows it; `idle` is the default frame of
 * the .type file, shown until the unit has walked.
 *  - Golem and Priest: groups A to H, the eight headings in order.
 *  - Bulf: north, east, south, west. Sail Skater: north, west, south, east. A diagonal step takes
 *    the east or the west group (ours: the files have none for it).
 */
const WALKERS: Readonly<
  Record<string, { groups: readonly number[]; frames: number; idle: number; }>
> = {
  sunwalker: { groups: [0, 1, 2, 3, 4, 5, 6, 7], frames: 8, idle: 5 },
  priest: { groups: [0, 1, 2, 3, 4, 5, 6, 7], frames: 8, idle: 18 },
  bulf: { groups: [0, 1, 1, 1, 2, 3, 3, 3], frames: 8, idle: 10 },
  windwalker: { groups: [0, 3, 3, 3, 2, 1, 1, 1], frames: 4, idle: 5 },
};

/** Slots of the Sun Cannon by facing (north, east, south, west): at rest, and firing. */
const SUN_CANNON = { rest: [1, 3, 0, 2], fire: [25, 27, 24, 26] } as const;
/** Its shots are 5 s apart (rules/combat.ts); the frame of fire is held for the first of them. */
const SUN_CANNON_FIRE_FROM = 47;
/** The Ice Cannon has three frames to a facing, the Thunder Cannon nine: the gun at rest, six
 * frames of charge that are laid over it, and two of fire. */
const ICE_CANNON_FRAMES = 3;
const THUNDER_CANNON = { frames: 9, charge: 6, fire: 7, cooldown: 40, fired: 36 } as const;
/** Temples that are a still picture with a moving one laid over it: the slot of the building and
 * the first slot and length of what moves. */
const TEMPLES: Readonly<Record<string, { base: number; first: number; cycle: number; }>> = {
  windvortex: { base: 13, first: 0, cycle: 13 },
  rainvortex: { base: 0, first: 1, cycle: 14 },
};
/* oxlint-enable no-magic-numbers */

/** Heading of a step, 0 north and clockwise to 7 north-west; undefined for no step. */
export function heading(dx: number, dy: number): number | undefined {
  const HEADINGS = [[7, 0, 1], [6, undefined, 2], [5, 4, 3]] as const; // oxlint-disable-line no-magic-numbers
  return HEADINGS[Math.sign(dy) + 1]![Math.sign(dx) + 1];
}

/** Ticks since a Thunder Cannon fired, or -1 when it is not at work. Its cooldown runs down from
 * the 4 s between its shots; spreading the charge over that time is our reading (`?`). */
function sinceShot(b: DeepReadonly<Building>): number {
  return b.target === null ? -1 : THUNDER_CANNON.cooldown - b.cooldown;
}

function buildingSlot(b: DeepReadonly<Building>, tick: number): Slot | null {
  const working = b.rising === 0 && b.regrow === 0;

  switch (b.type) {
    case 'raincannon':
      // It cycles the three frames of its facing while it has a target.
      return [
        b.type,
        b.facing * ICE_CANNON_FRAMES + (b.target === null ? 0 : tick % ICE_CANNON_FRAMES),
      ];
    case 'suncannon':
      return [
        b.type,
        (b.target !== null && b.cooldown >= SUN_CANNON_FIRE_FROM
          ? SUN_CANNON.fire
          : SUN_CANNON.rest)[b.facing],
      ];
    case 'thundercannon': {
      const since = sinceShot(b);
      const firing = since >= 0 && since < THUNDER_CANNON.cooldown - THUNDER_CANNON.fired;
      return [
        b.type,
        b.facing * THUNDER_CANNON.frames + (firing ? THUNDER_CANNON.fire + (since >> 1) : 0),
      ];
    }
    case 'thunderarcher':
      return [b.type, b.target === null ? 0 : tick % 2];
    default:
      break;
  }

  const temple = TEMPLES[b.type];

  if (temple) {
    return [b.type, temple.base];
  }

  const loop = LOOPS[b.type];
  return loop ? [b.type, working ? tick % loop : 0] : null;
}

/**
 * The type and slot an entity shows, or null when it has no animation and keeps its one picture.
 * `headings` remembers which way each walker last went, so that it stands as it stopped.
 */
export function slotOf(
  entity: DeepReadonly<Entity>,
  tick: number,
  headings: Map<number, number>,
): Slot | null {
  if (entity.kind === 'geyser') {
    return ['geyser', entity.stock > 0 ? tick % GEYSER_CYCLE : GEYSER_CYCLE];
  }

  if (entity.kind === 'crystal') {
    return ['nugget', tick % NUGGET_CYCLE];
  }

  if (entity.kind === 'building') {
    return buildingSlot(entity, tick);
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
    return [type, walker.groups[going]! * walker.frames + (tick % walker.frames)];
  }

  const stood = headings.get(entity.id);
  return [type, stood === undefined ? walker.idle : walker.groups[stood]! * walker.frames];
}

/** The slot laid over an entity's own picture, about the same hot spot: the whirl of a Temple,
 * the charge of a Thunder Cannon. Null when there is nothing over it. */
export function overlayOf(entity: DeepReadonly<Entity>, tick: number): Slot | null {
  if (entity.kind !== 'building' || entity.rising > 0) {
    return null;
  }

  const temple = TEMPLES[entity.type];

  if (temple) {
    return [entity.type, temple.first + (tick % temple.cycle)];
  }

  if (entity.type !== 'thundercannon') {
    return null;
  }

  const charging = sinceShot(entity) - (THUNDER_CANNON.cooldown - THUNDER_CANNON.fired);

  if (charging < 0) {
    return null;
  }

  const step = Math.min(THUNDER_CANNON.charge - 1,
    Math.floor((charging * THUNDER_CANNON.charge) / THUNDER_CANNON.fired));
  return [entity.type, entity.facing * THUNDER_CANNON.frames + 1 + step];
}
