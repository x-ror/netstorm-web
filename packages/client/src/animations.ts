/**
 * Which frame of its type an entity shows on a tick. Frames are named by "slot": the number of the
 * frame's line in the .type file, as scripts/unshp.py counts them. scripts/anim-frames.py ships the
 * slots listed here. One frame is shown per tick; the original's frame rates are not read (`?`).
 */
import {
  ALTAR_UPGRADE_SECONDS,
  ARM_BUILT,
  BUILD_SECONDS,
  SUN_CANNON_FIRE,
  SUN_CANNON_FLAT,
  SUN_CANNON_RAISED,
  SUN_CANNON_STEP,
  THUNDER_CANNON,
  armSlot,
  barriers,
  bearingTo,
  CROSSBOW_BEARINGS,
  CROSSBOW_PER_FACING,
  discSpin,
  sunCannonTurn,
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
  /** What each gun did last: see `gunOf`. */
  guns: Map<number, Gun>;
}

/** What a gun was seen to do, so that its turns and shots play over the ticks after them. */
export interface Gun {
  /** The tick it was last looked at, so that it is read once a tick. */
  tick: number;
  cooldown: number;
  barrel: number;
  /** The tick it last fired, or started a cycle that ends in a shot. */
  fired: number;
  /** A Sun Cannon's turn: the slots its barrel passes, from the tick it began. */
  turn: { path: number[]; start: number; } | null;
  /** A Disc Thrower's spin: where its arm started, the bearing it throws at, and the length. */
  spin: { from: number; bearing: number; start: number; throw: number; end: number; } | null;
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

/** The Crossbow's five frames to each of its twenty bearings (guns.ts `CROSSBOW_BEARINGS`), and
 * the frame of a bearing by ticks since a shot. */
const CROSSBOW = { shot: 5, reload: [4, 3, 2, 2, 1, 1] } as const;
/** The frames of a sacrifice in the Altar type, after the horns and the struggling captive. */
export const SACRIFICE = { first: 15, frames: 74 } as const;

/** The Ice Cannon has three frames to a facing, the Thunder Cannon nine: at rest, then eight it
 * charges through, 0.5 s each, the last the one it fires on (GunAnim.cpp). */
const ICE_CANNON_FRAMES = 3;
const ICE_CANNON_FRAME = 0.08;
const THUNDER_CANNON_FRAMES = 9;
/** The frames of a Sun Barricade's post, and of an Acid Barricade's with the ticks of each. */
const SUN_POST = 9;
const ACID_POST = 3;
const ACID_STEP = 3;
/** Temples that are a still picture with a moving one laid over it: the slot of the building and
 * the first slot and length of what moves. */
const TEMPLES: Readonly<Record<string, { base: number; first: number; cycle: number; }>> = {
  windvortex: { base: 13, first: 0, cycle: 13 },
  rainvortex: { base: 0, first: 1, cycle: 14 },
};
/**
 * The Disc Thrower is a base (slot 32) with an arm laid over it, which a spring spins round about
 * four times before each throw (guns.ts `armSlot`).
 */
const DISC_THROWER = { base: 32 } as const;
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
 * A Workshop's frame groups A to D are its Levels I to IV, the building growing with each
 * (Factory.cpp of netstorm.game 10.82 shows the group of its level). The first frame of a group is
 * the whole building; how the rest of a group plays is not read (`?`), so it stands still.
 */
const WORKSHOP_GROUP: Readonly<Record<string, number>> = {
  sunfactory: 4,
  windfactory: 1,
  rainfactory: 3,
  thunderfactory: 1,
};
/**
 * An Altar is two pictures: the ring (type Dais) and the horns over it (type Altar). The ring
 * shows how many of the five runes are warded: a still for each count (slots 3, 14, 25, ... for
 * Level 1; the ring of Level 2 from slot 64, of Level 3 from 120, the table at 0x005fc85c of
 * dais.cpp) and ten frames of the next one going. The horns hold the captive, who struggles
 * through 13 frames. A Priest warding a rune chants the 18 frames of that stage, after his 77 other
 * slots.
 */
const DAIS = { rising: 1, laid: 2, rings: [3, 64, 120], stage: 11, frames: 10 } as const;
/** An Altar's Upgrade: 45 frames of 0.12 s from Level 1 to 2 (type DaisExtraFrames, slots 0 to
 * 44), and from 2 to 3 (45 to 89); the horns are hidden meanwhile (dais.cpp, FUN_00454140). */
const ALTAR_UPGRADE = { frames: 45, frame: 0.12 } as const;
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

/* oxlint-disable no-magic-numbers -- the frame clocks of BaseFlyerProcess */
/** A Whirligig's rotor: its eight frames over 0.145356 s (FUN_0046bd70). */
const WHIRLIGIG_PERIOD = 0.145356;
const WHIRLIGIG_LAST = 7;
/** Seconds a frame of a Dust Devil (FUN_0046c280) and of a Man o' War (FUN_0046c160). */
const FLYER_FRAME: Readonly<Record<string, number>> = { windflyer: 0.08, rainflyer: 0.1 };
/* oxlint-enable no-magic-numbers */

/**
 * The slot a flyer shows `ticks` into the battle, fractions of a tick included: the original
 * turns them by the clock, not by the step. A Whirligig's rotor starts where its id puts it.
 */
export function flyerSlot(type: string, id: number, ticks: number): number {
  const seconds = ticks / TPS;

  if (type === 'sunflyer') {
    const phase = (id % WHIRLIGIG_PERIOD) / WHIRLIGIG_PERIOD;
    return Math.round((WHIRLIGIG_LAST * ((seconds + phase) % WHIRLIGIG_PERIOD)) / WHIRLIGIG_PERIOD);
  }

  const frame = FLYER_FRAME[type];
  return frame ? Math.floor(seconds / frame) % LOOPS[type]! : 0;
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

/**
 * What a gun has done since it was last looked at: a Sun Cannon whose barrel moved has begun to
 * turn; any other gun whose cooldown went up has fired, or begun the cycle that ends in a shot.
 */
export function gunOf(
  guns: Map<number, Gun>,
  b: DeepReadonly<Building>,
  tick: number,
  world: WorldView,
): Gun {
  const known = guns.get(b.id);

  if (!known) {
    const gun = {
      tick,
      cooldown: b.cooldown,
      barrel: b.barrel,
      fired: -Infinity,
      turn: null,
      spin: null,
    };
    guns.set(b.id, gun);
    return gun;
  }

  if (known.tick === tick) {
    return known;
  }

  const turned = b.type === 'suncannon' && b.barrel !== known.barrel;

  if (turned) {
    const from = known.barrel < 0 ? SUN_CANNON_FLAT : known.barrel;
    known.turn = { path: sunCannonTurn(from, b.facing), start: tick };
  } else if (b.cooldown > known.cooldown) {
    known.fired = tick;
    const target = b.target === null ? undefined : world.entities.get(b.target);

    if (b.type === 'sunarcher' && target) {
      const from = known.barrel < 0 ? ARM_BUILT : known.barrel;
      const bearing = bearingTo(b.x + b.fx / 2, b.y + b.fy / 2, target.x + 1 / 2, target.y + 1 / 2);
      const spin = discSpin(from, bearing);
      known.spin = { from, bearing, start: tick, throw: spin.throw * TPS, end: spin.end * TPS };
    }
  }

  known.tick = tick;
  known.barrel = b.barrel;
  known.cooldown = b.cooldown;
  return known;
}

/**
 * The frame a gun fires on, whose launch point (muzzles.ts) its missile leaves from: a Sun
 * Cannon's raised barrel plus 24, a Thunder Cannon's eighth frame, the last of an Ice Cannon's
 * three, a Crossbow's fifth to its bearing, and the arm of a Disc Thrower as it throws.
 */
export function shotFrame(b: DeepReadonly<Building>, guns: Map<number, Gun>): number | null {
  switch (b.type) {
    case 'suncannon':
      return SUN_CANNON_RAISED[b.facing]! + SUN_CANNON_FIRE;
    case 'thundercannon':
      return b.facing * THUNDER_CANNON_FRAMES + THUNDER_CANNON_FRAMES - 1;
    case 'raincannon':
      return b.facing * ICE_CANNON_FRAMES + ICE_CANNON_FRAMES - 1;
    case 'windarcher':
      return (b.barrel < 0 ? b.facing * CROSSBOW_PER_FACING : b.barrel) * CROSSBOW.shot
        + CROSSBOW.shot - 1;
    case 'sunarcher': {
      const spin = guns.get(b.id)?.spin;
      return spin ? armSlot(spin.from, spin.bearing, spin.throw / TPS) : null;
    }
    default:
      return null;
  }
}

/** The slot of the Disc Thrower's arm its disc sits on: from the start of a spin to the throw. */
export function discOnArm(
  b: DeepReadonly<Building>,
  guns: Map<number, Gun>,
  tick: number,
): number | null {
  const spin = b.type === 'sunarcher' ? guns.get(b.id)?.spin : undefined;
  return spin && tick - spin.start < spin.throw
    ? armSlot(spin.from, spin.bearing, (tick - spin.start) / TPS)
    : null;
}

/** The slot of a Sun Cannon: flat as built, then each frame of its turn for 0.2 s, raised when it
 * is done, and its fire frame on the tick it fires (0.07 s in the original). */
function sunCannonSlot(b: DeepReadonly<Building>, gun: Gun, tick: number): number {
  const raised = SUN_CANNON_RAISED[b.facing]!;

  if (gun.fired === tick) {
    return raised + SUN_CANNON_FIRE;
  }

  if (gun.turn) {
    const { path, start } = gun.turn;
    // The first frame of a turn comes at once, as every anim of GunAnim.cpp starts.
    const step = 1 + Math.floor((tick - start) / (SUN_CANNON_STEP * TPS));
    return path[Math.min(step, path.length - 1)]!;
  }

  return b.barrel < 0 ? SUN_CANNON_FLAT : b.barrel;
}

/**
 * The Ice Cannon cycles the three frames of its facing, 0.08 s each, while it has a target, its
 * rest included (GunAnim.cpp). `ticks` may fall between ticks: the renderer turns these frames
 * faster than the simulation steps.
 */
export function iceCannonSlot(b: DeepReadonly<Building>, ticks: number): number {
  const frame = b.target === null
    ? 0
    : Math.floor(ticks / (ICE_CANNON_FRAME * TPS)) % ICE_CANNON_FRAMES;
  return b.facing * ICE_CANNON_FRAMES + frame;
}

/** The Thunder Cannon from the start of its cycle: frames 1 to 7, 0.5 s each, then 8, the one it
 * fires on, and back at rest 0.125 s later. */
function thunderCannonFrame(since: number): number {
  const release = THUNDER_CANNON.release * TPS;

  if (since < 0 || since > release) {
    return 0;
  }

  return since === release
    ? THUNDER_CANNON_FRAMES - 1
    : 1 + Math.floor(since / (THUNDER_CANNON.frame * TPS));
}

/** Of the Crossbow's five frames to a bearing: +4 as it fires, then +3, +2, +1 and +0, loaded,
 * 0.2 s each, firing again at the end of the 0.8 s (GunAnim.cpp, FUN_0047c820). */
function crossbowFrame(since: number): number {
  return since >= 0 && since < CROSSBOW.reload.length ? CROSSBOW.reload[since]! : 0;
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

  if (b.upgrading > 0) {
    const elapsed = Math.round(ALTAR_UPGRADE_SECONDS * TPS) - b.upgrading;
    const frame = Math.min(ALTAR_UPGRADE.frames - 1,
      Math.floor(elapsed / (ALTAR_UPGRADE.frame * TPS)));
    return ['daisextraframes', b.upgrades * ALTAR_UPGRADE.frames + frame];
  }

  const captive = captiveOf(world, b.id);
  const warded = Math.min(captive?.runes ?? 0, RUNES);
  const going = captive && captive.runeTimer > 0 && warded < RUNES
    ? Math.min(DAIS.frames - 1, Math.floor((captive.runeTimer * DAIS.frames) / RUNE_INTERVAL))
    : -1;
  const ring = DAIS.rings[Math.min(b.upgrades, DAIS.rings.length - 1)]!;
  return ['dais', ring + warded * DAIS.stage + (going < 0 ? 0 : 1 + going)];
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

  const group = WORKSHOP_GROUP[b.type];

  if (group) {
    return [b.type, b.upgrades * group];
  }

  switch (b.type) {
    case 'raincannon':
      return [b.type, iceCannonSlot(b, tick)];
    case 'suncannon':
      return [b.type, sunCannonSlot(b, gunOf(scene.guns, b, tick, world), tick)];
    case 'windarcher': {
      // It turns, a bearing a tick, to the bearing the simulation turned it to; it stays there.
      const gun = gunOf(scene.guns, b, tick, world);
      const rest = b.facing * CROSSBOW_PER_FACING;

      if (!scene.aims.has(b.id)) {
        scene.aims.set(b.id, rest);
      }

      const at = turnTo(scene.aims, b.id, b.barrel < 0 ? rest : b.barrel, CROSSBOW_BEARINGS.length);
      return [b.type, at * CROSSBOW.shot + crossbowFrame(tick - gun.fired)];
    }
    case 'thundercannon':
      return [
        b.type,
        b.facing * THUNDER_CANNON_FRAMES
        + thunderCannonFrame(tick - gunOf(scene.guns, b, tick, world).fired),
      ];
    case 'thunderarcher':
      // It fires lightning without a frame of its own (GunAnim.cpp, FUN_0047e150).
      return [b.type, 0];
    case 'sunfence':
      // The post turns its nine frames, 0.1 s each, field or none (FUN_00466b70).
      return [b.type, working ? tick % SUN_POST : 0];
    case 'rainfence': {
      // A joined post plays A02, A01, A00, 0.3 s each, over and over; one alone stands still.
      const joined = working
        && barriers(world).some(({ from, to }) => from.id === b.id || to.id === b.id);
      return [b.type, joined ? ACID_POST - 1 - (Math.floor(tick / ACID_STEP) % ACID_POST) : 0];
    }
    case 'sunarcher':
      gunOf(scene.guns, b, tick, world);
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
  guns: Map<number, Gun> = new Map(),
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

  // An Upgrade under way: the Workshop of the next Level is built over the old one (Factory.cpp).
  const group = WORKSHOP_GROUP[entity.type];

  if (group) {
    return entity.upgrading > 0 ? [entity.type, (entity.upgrades + 1) * group] : null;
  }

  if (entity.type === 'altar') {
    if (entity.upgrading > 0) {
      return null;
    }

    const held = captiveOf(world, entity.id);
    return ['altar', held ? HORNS.struggle + (tick % HORNS.frames) : HORNS.empty];
  }

  // The arm: through the spin of its spring, then where the spin left it. On its base frame, as
  // built, the original draws no arm (FUN_004827d0).
  if (entity.type === 'sunarcher') {
    const spin = gunOf(guns, entity, tick, world).spin;

    if (spin && tick - spin.start < spin.end) {
      return [entity.type, armSlot(spin.from, spin.bearing, (tick - spin.start) / TPS)];
    }

    return entity.barrel < 0 ? null : [entity.type, entity.barrel];
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

  return null;
}
