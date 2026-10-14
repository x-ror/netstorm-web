import type { World } from '../world.js';
import { flies, type UnitDef } from '../defs.js';
import { TPS, WEAR_CRACKED, Terrain, type Building, type Entity, type Flyer } from '../state.js';
import { damage, targetable } from './combat.js';

// From flyer.cpp of netstorm.game 10.82 and the help.
/** A flyer's place is kept in hundredths of a cell, since it flies in a straight line. */
export const FLYER_SCALE = 100;
const WHIRLIGIG = 'sunflyer';
const DUST_DEVIL = 'windflyer';
const MAN_O_WAR = 'rainflyer';
/** The flyer each air base makes. */
const FLYER_OF: Readonly<Record<string, string>> = {
  sunaviary: WHIRLIGIG,
  windaviary: DUST_DEVIL,
  rainaviary: MAN_O_WAR,
};
/* oxlint-disable no-magic-numbers -- timings read from the original */
/** Seconds a base takes to send up a flyer once it has none: the length of its animation. */
const LAUNCH_SECONDS: Readonly<Record<string, number>> = {
  sunaviary: 5,
  windaviary: 6, // the Dust Devil forms after 4 s and spins up for 2 s more
  rainaviary: 2.4,
};
/** Seconds between strikes: a Whirligig's bombs, a Man o' War's bolt once in its 16 frames. */
const STRIKE_SECONDS: Readonly<Record<string, number>> = { [WHIRLIGIG]: 2, [MAN_O_WAR]: 1.6 };
/** The Dust Devil's life in its data counts the two seconds it spins up on its base. */
const SPIN_UP_SECONDS = 2;
/** "It will continue on with an additional fifteen seconds added to its remaining life span." */
const FEAST_SECONDS = 15;
/** A flyer hunts one cell further than the range in its data. */
const EXTRA_RANGE = 1;
/** "Nothing can ever be targeted by more than three Aerial Attackers at once, and Ground
 * Transports are only targeted by one": the original gives one to anything a single cell big. */
const ATTACKERS_ON_UNIT = 1;
const ATTACKERS_ON_BUILDING = 3;
/* oxlint-enable no-magic-numbers */

/** Cells around the middle of an air base within which its flyer hunts, or null for anything that
 * sends up no flyer. A Man o' War looks around itself, but it hovers over its base between kills. */
export function huntRadius(base: string, def: (type: string) => Readonly<UnitDef>): number | null {
  const flyer = FLYER_OF[base];
  return flyer ? def(flyer).range + EXTRA_RANGE : null;
}

/** Ticks a flyer of this type stays in the air. */
export function flightTicks(def: UnitDef): number {
  return (def.lifeSpan - (def.id === DUST_DEVIL ? SPIN_UP_SECONDS : 0)) * TPS;
}

/** "Each time a Whirligig is destroyed, its home base will make a new one": a built base with no
 * flyer of its own in the air sends one up. */
export function tickAirBase(world: World, b: Building): void {
  const type = FLYER_OF[b.type];

  if (!type || b.hp <= 0 || b.rising > 0) {
    return;
  }

  for (const e of world.entities.values()) {
    if (e.kind === 'flyer' && e.home === b.id) {
      b.cooldown = 0;
      return;
    }
  }

  // An air base has no gun, so its cooldown is free to count the launch up.
  b.cooldown++;

  if (b.cooldown >= Math.round(LAUNCH_SECONDS[b.type]! * TPS)) {
    b.cooldown = 0;
    world.spawnFlyer(type, b.owner, b);
  }
}

type Point = readonly [number, number];

/** The middle of an entity, in hundredths of a cell. */
function middle(e: Entity): Point {
  if (e.kind === 'flyer') {
    return [e.px, e.py];
  }

  const width = e.kind === 'building' ? e.fx : 1;
  const height = e.kind === 'building' ? e.fy : 1;
  return [
    e.x * FLYER_SCALE + (width * FLYER_SCALE) / 2,
    e.y * FLYER_SCALE + (height * FLYER_SCALE) / 2,
  ];
}

function distance(a: Point, b: Point): number {
  return Math.round(Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2));
}

/** The point a flyer hunts around: a Man o' War itself, the others where they were launched. */
function ground(f: Flyer): Point {
  return f.type === MAN_O_WAR ? [f.px, f.py] : [f.hx, f.hy];
}

function reach(world: World, f: Flyer): number {
  return (world.def(f.type).range + EXTRA_RANGE) * FLYER_SCALE;
}

function crowded(world: World, f: Flyer, target: Entity): boolean {
  const most = target.kind === 'building' ? ATTACKERS_ON_BUILDING : ATTACKERS_ON_UNIT;
  let others = 0;

  for (const e of world.entities.values()) {
    if (e.kind === 'flyer' && e !== f && e.target === target.id) {
      others++;
    }
  }

  return others >= most;
}

function prey(world: World, f: Flyer, e: Entity): boolean {
  // Flyers strike the ground only, and "a Whirligig will never target a Transport".
  if (e.kind === 'flyer' || ('type' in e && flies(world.def(e.type))) || !targetable(world, f, e)) {
    return false;
  }

  if (f.type === WHIRLIGIG && e.kind !== 'building') {
    return false;
  }

  return distance(ground(f), middle(e)) <= reach(world, f);
}

/** The nearest prey with room for one more attacker. "The Man o' War prefers to attack Ground
 * Transports, but if none are available it will strike at the nearest unit." */
function pick(world: World, f: Flyer): Entity | null {
  let best: Entity | null = null;
  let bestScore = Infinity;

  // ponytail: scans every entity for each flyer without a target; index by cell if flyers get many.
  for (const e of world.entities.values()) {
    if (!prey(world, f, e) || crowded(world, f, e)) {
      continue;
    }

    const favoured = f.type === MAN_O_WAR && e.kind !== 'transport' ? reach(world, f) : 0;
    const score = distance(ground(f), middle(e)) + favoured;

    if (score < bestScore) {
      best = e;
      bestScore = score;
    }
  }

  return best;
}

/** Fly towards a point at the flyer's speed; true once it is there. */
function fly(world: World, f: Flyer, to: Point): boolean {
  const step = Math.round((world.def(f.type).speed * FLYER_SCALE) / TPS);
  const left = distance([f.px, f.py], to);

  if (left <= step) {
    [f.px, f.py] = to;
  } else {
    f.px += Math.round(((to[0] - f.px) * step) / left);
    f.py += Math.round(((to[1] - f.py) * step) / left);
  }

  f.x = Math.floor(f.px / FLYER_SCALE);
  f.y = Math.floor(f.py / FLYER_SCALE);
  return left <= step;
}

/** A hit of a flyer carries its damage rate times the time since its last one, as a gun's does. */
function strike(world: World, f: Flyer, target: Entity): void {
  if (f.cooldown > 0) {
    f.cooldown--;
    return;
  }

  const def = world.def(f.type);
  const seconds = STRIKE_SECONDS[f.type]!;
  f.cooldown = Math.round(seconds * TPS) - 1;
  damage(world, f.owner, target, def.dps * seconds, undefined, true);

  // "If it kills something other than a shooter the Storm Power released nourishes the Man o' War."
  const shooter = target.kind === 'building' && world.def(target.type).dps > 0;

  if (f.type === MAN_O_WAR && 'hp' in target && target.hp <= 0 && !shooter) {
    f.life = Math.min(f.life + FEAST_SECONDS * TPS, flightTicks(def));
  }
}

/** The Dust Devil hurts every enemy on the cell it is over and "cracks bridge when it passes". */
function sweep(world: World, f: Flyer): void {
  const i = world.at(f.x, f.y);
  const amount = world.def(f.type).dps / TPS;
  const under: Entity[] = [...world.transportsAt(f.x, f.y)];
  const standing = world.entities.get(world.occupant[i] ?? 0);
  const priest = world.priestAt(f.x, f.y);

  if (standing) {
    under.push(standing);
  }

  if (priest) {
    under.push(priest);
  }

  for (const e of under) {
    if (targetable(world, f, e) && !('type' in e && flies(world.def(e.type)))) {
      damage(world, f.owner, e, amount, undefined, true);
    }
  }

  if (world.terrain[i] === Terrain.Bridge) {
    world.terrain[i] = Terrain.CrackedBridge;
    world.wear[i] = WEAR_CRACKED;
    world.invalidateTerrain();
  }
}

export function tickFlyer(world: World, f: Flyer): void {
  const base = f.home === null ? undefined : world.entities.get(f.home);
  const home = base?.kind === 'building' && base.hp > 0;
  f.life--;

  // A Whirligig goes home to refuel, where its base sends it up again whole. Without a base it
  // has "no place to refuel"; the others simply live their time.
  if (f.life <= 0 && f.type === WHIRLIGIG && home) {
    f.returning = true;
  }

  if (f.hp <= 0 || (f.life <= 0 && !f.returning) || (f.returning && !home)) {
    world.entities.delete(f.id);
    return;
  }

  if (f.returning) {
    if (fly(world, f, [f.hx, f.hy])) {
      world.entities.delete(f.id);
    }

    return;
  }

  let target = f.target === null ? undefined : world.entities.get(f.target);

  if (!target || !prey(world, f, target) || ('hp' in target && target.hp <= 0)) {
    target = pick(world, f) ?? undefined;
    f.target = target?.id ?? null;
  }

  // With nothing to strike it waits over the spot it was launched from.
  const there = fly(world, f, target ? middle(target) : [f.hx, f.hy]);

  if (f.type === DUST_DEVIL) {
    sweep(world, f);
  } else if (target && there) {
    strike(world, f, target);
  }
}
