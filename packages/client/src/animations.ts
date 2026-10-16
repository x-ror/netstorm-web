/**
 * Which frame of its type an entity shows on a tick. Frames are named by "slot": the number of the
 * frame's line in the .type file, as scripts/unshp.py counts them. scripts/anim-frames.py ships the
 * slots listed here. One frame is shown per tick; the original's frame rates are not read (`?`).
 */
import {
  BUILD_SECONDS,
  RUNE_INTERVAL,
  RUNES,
  TPS,
  Terrain,
  type Building,
  type DeepReadonly,
  type Entity,
  type Priest,
  type WorldView,
} from '@netstorm/sim';

type Slot = readonly [type: string, slot: number];

import { SHADOW_BASE } from './slots.js';
import type { VisualState, VisualStates } from './presentation.js';

export { SLOT_COUNTS } from './slots.js';

/** What the choice of a frame may look at besides the entity itself. */
export interface Scene {
  world: WorldView;
  /** Which way each walker last went, so that it stands as it stopped. */
  headings: Map<number, number>;
  /** Where on its ring of turning frames each unit that turns has come to. */
  aims: Map<number, number>;
  /** When each entity entered its visual state, for a walk that starts on the step. */
  states: VisualStates;
}

/* oxlint-disable no-magic-numbers -- slot counts and frame groups of the .type files */
/** Types whose first slots are one cycle played over and over, with its length. */
const LOOPS: Readonly<Record<string, number>> = {
  sunflyer: 8,
  windflyer: 13,
  rainflyer: 16,
  rainballoon: 20,
  rainwalker: 10,
  // Buildings: the Sun Generator and the Thunder Temple are whole frames; the other Generators
  // have one.
  sunbattery: 8,
  windbattery: 1,
  rainbattery: 1,
  thunderbattery: 1,
  thundervortex: 8,
};
/**
 * A geyser is its rock (slot 49, the "baseframe" of geyser.type) and its steam. The first 17 slots
 * are whole pictures, rock and a tall plume; the next two runs of 16 are the plume alone, lower
 * each time, and go over the rock. That the plume sinks as the geyser is spent, by thirds of its
 * stock, is our reading of the three heights (`?`).
 */
const GEYSER = { rock: 49, full: 17, plumes: [17, 33], plume: 16 } as const;
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
  Record<string, { groups: readonly number[]; frames: number; idle: number; turn?: Turn; }>
> = {
  sunwalker: { groups: [0, 1, 2, 3, 4, 5, 6, 7], frames: 8, idle: 5 },
  priest: { groups: [0, 1, 2, 3, 4, 5, 6, 7], frames: 8, idle: 18 },
  // The Bulf turns clockwise through 24 frames from north: six to a quarter turn.
  bulf: {
    groups: [0, 1, 1, 1, 2, 3, 3, 3],
    frames: 8,
    idle: 10,
    turn: { first: 32, size: 24, step: 6 },
  },
  // The Sail Skater's 20 frames of turning go from north to west, south and east, the order of
  // its groups: five to a quarter turn.
  windwalker: {
    groups: [0, 3, 3, 3, 2, 1, 1, 1],
    frames: 4,
    idle: 5,
    turn: { first: 16, size: 20, step: 5 },
  },
};

/** A ring of frames a unit turns through: its first slot, its length, and how far apart on it
 * the unit's groups of frames lie. One step is taken per tick, the shorter way round (ours). */
interface Turn {
  first: number;
  size: number;
  step: number;
}

/**
 * The Sun Cannon's barrel looks the same from either end, so its file has six frames between the
 * four facings and each serves two bearings: clockwise from north, north (slot 1), NNE (22), ENE
 * (23), east (3), ESE (20), SSE (21), south (0), SSW (22), WSW (23), west (2), WNW (20), NNW (21).
 */
const SUN_CANNON_RING = [1, 22, 23, 3, 20, 21, 0, 22, 23, 2, 20, 21] as const;
/** The Crossbow turns through twenty bearings, `orientations = 20` in its type, five frames of a
 * shot to each; a facing is every fifth. It leans at most `reach` bearings (36°) off its facing,
 * the nearest to the 30° of its arc. */
const CROSSBOW = { bearings: 20, shot: 5, perFacing: 5, reach: 2 } as const;
/** The frames of a sacrifice in the Altar type, after the horns and the struggling captive. */
export const SACRIFICE = { first: 15, frames: 74 } as const;

/** Slots of the Sun Cannon by facing (north, east, south, west): at rest, and firing. */
const SUN_CANNON = { rest: [1, 3, 0, 2], fire: [25, 27, 24, 26] } as const;
/** Its shots are 5 s apart (rules/combat.ts); the frame of fire is held for the first of them. */
const SUN_CANNON_FIRE_FROM = 47;
const CROSSBOW_COOLDOWN = 8;
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
/**
 * The Disc Thrower is a base (slot 32) with an arm laid over it: sixteen bearings of the arm wound
 * up (slots 0 to 15), then sixteen of it flung out (16 to 31), clockwise from north. Its shots
 * are 7 s apart; the flung arm is held for the first half second.
 */
const DISC_THROWER = { base: 32, bearings: 16, flungFrom: 65 } as const;
/**
 * Air bases play their frames once over the time they take to send a flyer up (rules/flyers.ts),
 * counted by their cooldown. The Whirlibase opens its dome (slots 0 to 10), then the Whirligig
 * rises out of it, laid over (11 to 26). The Devil Maker turns its six frames round.
 */
const AIR_BASES: Readonly<Record<string, { ticks: number; frames: number; }>> = {
  sunaviary: { ticks: 50, frames: 11 },
  rainaviary: { ticks: 24, frames: 13 },
};
const WHIRLIGIG_RISE = { first: 11, frames: 16 } as const;
const DEVIL_MAKER_FRAMES = 6;
/**
 * An Altar is two pictures: the ring (type Dais) and the horns over it (type Altar). The ring
 * shows how many of the five runes are warded: a still for each count (slots 3, 14, 25, ...) and
 * ten frames of the next one going. The horns hold the captive, who struggles through 13 frames.
 * A Priest warding a rune chants the 18 frames of that stage, after his 77 other slots.
 */
const DAIS = { rising: 1, laid: 2, still: 3, going: 4, stage: 11, frames: 10 } as const;
const HORNS = { empty: 0, struggle: 1, frames: 13 } as const;
const CHANT = { first: 77, frames: 18 } as const;
const FORCE_FIELD_FRAMES = 30;
/** The Priest's twelve frames of floating, after his 65 slots of walking. The original turns to them
 * when he is struck down, with his force field (Priest.cpp of netstorm.game 10.82); that he also
 * floats with no ground under him is ours (`?`). */
const FLOAT = { first: 65, frames: 12 } as const;
/** Slots of the Manabolt type by the Fury of what is being built. */
export const MANA_BOLTS: Readonly<Record<string, number>> = {
  wind: 0,
  rain: 1,
  thunder: 2,
  sun: 3,
};
/* oxlint-enable no-magic-numbers */

/** Move a unit one step round its ring toward where it should point; where it is now. */
function turnTo(aims: Map<number, number>, id: number, want: number, size: number): number {
  const at = aims.get(id) ?? want;
  const ahead = (want - at + size) % size;
  const next = ahead === 0 ? at : (at + (ahead * 2 <= size ? 1 : size - 1)) % size;
  aims.set(id, next);
  return next;
}

/** How far a geyser is spent: 0 while it has over two thirds of its stock, 1 over a third, 2 with
 * anything left, 3 run dry. */
function geyserLevel(stock: number, whole: number): number {
  const THIRDS = 3;
  return stock <= 0 ? THIRDS : Math.min(THIRDS - 1, Math.floor(((whole - stock) * THIRDS) / whole));
}

/** The slot of the shadow that lies under a slot, for the types that have shadows. */
export function shadowOf(slot: Slot | null): Slot | null {
  const base = slot ? SHADOW_BASE[slot[0]] : undefined;
  return slot && base !== undefined ? [slot[0], base + slot[1]] : null;
}

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

/** The Priest chained on an altar, if any. */
function captiveOf(world: WorldView, altar: number): DeepReadonly<Priest> | undefined {
  for (const e of world.entities.values()) {
    if (e.kind === 'priest' && e.chainedAt === altar) {
      return e;
    }
  }

  return undefined;
}

/** The ring of an Altar: being built, at rest, or with the next rune going. */
function daisSlot(b: DeepReadonly<Building>, world: WorldView): Slot {
  if (b.rising > 0) {
    return [
      'dais',
      b.builder !== null || b.rising * 2 > BUILD_SECONDS * TPS ? DAIS.rising : DAIS.laid,
    ];
  }

  const captive = captiveOf(world, b.id);
  const warded = Math.min(captive?.runes ?? 0, RUNES);
  const going = captive && captive.runeTimer > 0 && warded < RUNES
    ? Math.min(DAIS.frames - 1, Math.floor((captive.runeTimer * DAIS.frames) / RUNE_INTERVAL))
    : -1;
  return ['dais', warded * DAIS.stage + (going < 0 ? DAIS.still : DAIS.going + going)];
}

/** Which of `count` bearings, clockwise from north, a gun's target lies on. Only the picture
 * depends on it, so the arithmetic need not match between machines. */
function bearing(b: DeepReadonly<Building>, world: WorldView, count: number): number {
  const target = b.target === null ? undefined : world.entities.get(b.target);

  if (!target) {
    return 0;
  }

  const turn = Math.atan2(target.x - (b.x + b.fx / 2), b.y + b.fy / 2 - target.y) / (2 * Math.PI);
  return (Math.round(turn * count) + count) % count;
}

function buildingSlot(b: DeepReadonly<Building>, tick: number, scene: Scene): Slot | null {
  const { world } = scene;
  const working = b.rising === 0 && b.regrow === 0;
  const base = AIR_BASES[b.type];

  if (base) {
    const frame = Math.floor(
      (b.cooldown * base.frames * (b.type === 'sunaviary' ? 2 : 1)) / base.ticks,
    );
    return [b.type, working ? Math.min(base.frames - 1, frame) : 0];
  }

  switch (b.type) {
    case 'raincannon':
      // It cycles the three frames of its facing while it has a target.
      return [
        b.type,
        b.facing * ICE_CANNON_FRAMES + (b.target === null ? 0 : tick % ICE_CANNON_FRAMES),
      ];
    case 'suncannon': {
      // The ring follows the facing, but the shot is the simulation's: it is never held for a turn.
      const quarter = SUN_CANNON_RING.length / SUN_CANNON.rest.length;
      const at = turnTo(scene.aims, b.id, b.facing * quarter, SUN_CANNON_RING.length);
      const fired = b.target !== null && b.cooldown >= SUN_CANNON_FIRE_FROM;
      return [b.type, fired ? SUN_CANNON.fire[b.facing] : SUN_CANNON_RING[at]!];
    }
    case 'windarcher': {
      // It leans a bearing a tick toward its target, and back to its facing when it has none.
      const { bearings, shot, perFacing, reach } = CROSSBOW;
      const rest = b.facing * perFacing;
      const off = b.target === null
        ? 0
        : ((bearing(b, world, bearings) - rest + bearings + bearings / 2) % bearings)
          - bearings / 2;
      const want = (rest + Math.max(-reach, Math.min(reach, off)) + bearings) % bearings;
      const at = turnTo(scene.aims, b.id, want, bearings);
      // Its shots are 0.8 s apart: the frames of a shot follow each one.
      const since = b.target === null ? shot : CROSSBOW_COOLDOWN - b.cooldown;
      return [b.type, at * shot + (since < shot - 1 ? since + 1 : 0)];
    }
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
    case 'sunarcher':
      return [b.type, DISC_THROWER.base];
    case 'windaviary':
      return [b.type, working && b.cooldown > 0 ? tick % DEVIL_MAKER_FRAMES : 0];
    case 'altar':
      return daisSlot(b, world);
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

function visualStateOf(entity: DeepReadonly<Entity>, ritual: boolean): VisualState {
  if (entity.kind === 'building' && (entity.rising > 0 || entity.regrow > 0)) {
    return 'constructing';
  }

  if (ritual) {
    return 'ritual';
  }

  if ('target' in entity && entity.target !== null) {
    return 'firing';
  }

  return 'path' in entity && entity.path.length > 0 ? 'walking' : 'idle';
}

/**
 * The type and slot an entity shows, or null when it has no animation and keeps its one picture.
 * `headings` remembers which way each walker last went, so that it stands as it stopped.
 */
export function slotOf(entity: DeepReadonly<Entity>, tick: number, scene: Scene): Slot | null {
  const { headings, world } = scene;
  const ritual = entity.kind === 'priest' ? ritualOf(world, entity.owner) : undefined;
  const state = visualStateOf(entity, ritual !== undefined);
  const elapsed = scene.states.enter(entity.id, state, tick);

  if (entity.kind === 'geyser') {
    return [
      'geyser',
      geyserLevel(entity.stock, world.geyserStock) === 0 ? tick % GEYSER.full : GEYSER.rock,
    ];
  }

  if (entity.kind === 'crystal') {
    return ['nugget', tick % NUGGET_CYCLE];
  }

  if (entity.kind === 'building') {
    return buildingSlot(entity, tick, scene);
  }

  if (entity.kind === 'obelisk') {
    return null;
  }

  if (entity.kind === 'priest') {
    const hanging = world.terrain[world.at(entity.x, entity.y)] === Terrain.Sky;

    if (entity.state === 'down' || (entity.state === 'normal' && hanging)) {
      return ['priest', FLOAT.first + (tick % FLOAT.frames)];
    }

    if (entity.state !== 'normal') {
      return null;
    }
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
  }

  // A unit with frames of turning comes round to its heading before it shows that heading.
  const facing = headings.get(entity.id);

  if (walker.turn && facing !== undefined) {
    const want = walker.groups[facing]! * walker.turn.step;
    const at = turnTo(scene.aims, entity.id, want, walker.turn.size);

    if (at !== want) {
      scene.states.enter(entity.id, 'turning', tick);
      return [type, walker.turn.first + at];
    }
  }

  if (going !== undefined) {
    return [type, walker.groups[going]! * walker.frames + (elapsed % walker.frames)];
  }

  // Standing by his altar while a rune is warded, the Priest chants.
  if (ritual) {
    return [
      type,
      CHANT.first + Math.min(ritual.runes, RUNES - 1) * CHANT.frames + (tick % CHANT.frames),
    ];
  }

  const stood = headings.get(entity.id);
  return [type, stood === undefined ? walker.idle : walker.groups[stood]! * walker.frames];
}

/** The captive whose rune a player's Priest is warding right now, if he is at it. */
function ritualOf(world: WorldView, owner: number): DeepReadonly<Priest> | undefined {
  for (const e of world.entities.values()) {
    if (
      e.kind === 'priest' && e.chainedAt !== null && e.runeTimer > 0
      && world.entities.get(e.chainedAt)?.kind === 'building'
      && (world.entities.get(e.chainedAt) as DeepReadonly<Building>).owner === owner
    ) {
      return e;
    }
  }

  return undefined;
}

/** The slot laid over an entity's own picture, about the same hot spot: the whirl of a Temple,
 * the charge of a Thunder Cannon. Null when there is nothing over it. */
export function overlayOf(
  entity: DeepReadonly<Entity>,
  tick: number,
  world: WorldView,
): Slot | null {
  // "A thin force field will form around him, keeping him alive": the game sets a ForceField on
  // a Priest the moment he is struck down (Priest.cpp of netstorm.game 10.82).
  if (entity.kind === 'priest') {
    return entity.state === 'down' ? ['forcefield', tick % FORCE_FIELD_FRAMES] : null;
  }

  if (entity.kind === 'geyser') {
    const plume = GEYSER.plumes[geyserLevel(entity.stock, world.geyserStock) - 1];
    return plume === undefined ? null : ['geyser', plume + (tick % GEYSER.plume)];
  }

  if (entity.kind !== 'building' || entity.rising > 0) {
    return null;
  }

  if (entity.type === 'altar') {
    const held = captiveOf(world, entity.id);
    return ['altar', held ? HORNS.struggle + (tick % HORNS.frames) : HORNS.empty];
  }

  if (entity.type === 'sunarcher') {
    const flung = entity.target !== null && entity.cooldown >= DISC_THROWER.flungFrom;
    return [
      entity.type,
      bearing(entity, world, DISC_THROWER.bearings) + (flung ? DISC_THROWER.bearings : 0),
    ];
  }

  if (entity.type === 'sunaviary') {
    const rise = Math.floor(
      ((entity.cooldown * 2 - AIR_BASES.sunaviary!.ticks) * WHIRLIGIG_RISE.frames)
        / AIR_BASES.sunaviary!.ticks,
    );
    return rise < 0
      ? null
      : [entity.type, WHIRLIGIG_RISE.first + Math.min(WHIRLIGIG_RISE.frames - 1, rise)];
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
