import type { World } from '../world.js';
import { flies, type UnitDef } from '../defs.js';
import { shakeBridges } from './bridges.js';
import {
  ACID_BARRICADE,
  ARC_SPIRE,
  band,
  barriersOf,
  fieldStops,
  line,
  overlaps,
} from './fences.js';
import {
  BUILD_SECONDS,
  Terrain,
  TPS,
  DIRS,
  FACINGS,
  type Entity,
  type Building,
  type Facing,
} from '../state.js';

export type EnemyAt = (owner: number, x: number, y: number) => Entity | null;

const PER_CENT = 100;
const HP_DECIMALS = 4; // hp is rounded to keep the simulation deterministic
// Invented, for anything that shoots without a delay in its data and without an entry below.
const DEFAULT_SHOT_SECONDS = 1;
/* oxlint-disable no-magic-numbers -- timings read from the original */
/**
 * Seconds the fire animation of a shooter takes in the original (GunAnim.cpp in netstorm.game
 * 10.82): the frames of one facing in the unit's .type file times the frame delay of its class.
 * A gun fires once per animation and then waits delayBetweenShots, so the two add up. The Sun
 * Cannon and the Vander Tower fire on the first frame, which leaves their delay alone.
 */
const FIRE_SECONDS: Readonly<Record<string, number>> = {
  thundercannon: 4, // 9 frames at 0.5 s; the shot leaves 3.5 s in ("3.5 charge" in its data)
  windarcher: 0.8, // 5 frames at 0.2 s
  // 3 frames at 0.08 s. The original fires like this for 4 s and then rests 6 s; the rest is not
  // modelled, and the average is the same because a hit carries the time since the previous one.
  raincannon: 0.24,
  // Approximate (`?`): the arm is a spring that spins up to the bearing of the target, throws
  // after 3.1 to 3.6 s and needs 2.6 to 5.6 s more to wind down. Not measured in the game.
  sunarcher: 7,
};
/** Share of its damage rate an anti-air gun deals with one hit, whatever the time between hits. */
const FLAT_SHOT_SHARE = 0.6;
/* oxlint-enable no-magic-numbers */

/** Ticks between shots: the fire animation plus delayBetweenShots, which the original reads as
 * seconds. */
export function shotInterval(def: UnitDef): number {
  const fire = FIRE_SECONDS[def.id] ?? (def.delay > 0 ? 0 : DEFAULT_SHOT_SECONDS);
  return Math.max(1, Math.round((def.delay + fire) * TPS));
}

/** The Sun Cannon "will rotate itself to target an enemy"; other cannons keep their orientation. */
function selfAiming(def: UnitDef): boolean {
  return def.group === 'cannon' && def.theme === 'sun';
}

export function tickBuilding(world: World, b: Building, enemyAt: EnemyAt): void {
  if (b.regrow > 0) {
    regrow(b);
    return;
  }

  if (b.hp <= 0) {
    if (world.blasted.has(b.id)) {
      return;
    }

    if (b.type === ICE_TOWER) {
      // It "regenerates by itself if destroyed": the tower stays where it is, out of the fight,
      // and its islet with it. Bridge around it is shaken as by any destroyed unit.
      b.regrow = REGROW_SECONDS * TPS;
      b.target = null;
      shakeBridges(world, { ...b, islet: false });
      return;
    }

    removeBuilding(world, b);
    shakeBridges(world, b);
    explode(world, b);
    world.emit({ what: 'destroyed', who: b.owner, data: { id: b.id, type: b.type } });
    return;
  }

  if (b.rising > 0) {
    construct(world, b);
    return;
  }

  const def = world.def(b.type);

  if (def.group === 'fence') {
    tickFence(world, b, def);
    return;
  }

  if (!def.dps) {
    return;
  }

  if (b.cooldown > 0) {
    b.cooldown--;
  }

  // "Once locked, they will keep at it until destroyed" — or until it can no longer be hit.
  let target = lockedTarget(world, b, def, enemyAt);

  if (!target) {
    target = acquire(world, b, def, enemyAt);
    b.target = target?.id ?? null;
  }

  if (!target || b.cooldown > 0) {
    return;
  }

  // "Damage" in the unit data is the average per second. In the original a hit from an archer or a
  // cannon deals that rate times the time since the gun's previous hit, so one shot carries a whole
  // interval of it. Other groups deal a fixed share of the rate with every hit.
  const interval = shotInterval(def);
  const usual = def.group === 'anti-air'
    ? def.dps * FLAT_SHOT_SHARE
    : (def.dps * interval) / TPS;
  // "Crucial for defense against air attack": the Disc Thrower's data sets its hit on air units.
  const amount = airborne(world, target) && def.airDamage ? def.airDamage : usual;
  b.cooldown = interval;

  // "Enemy shots miss as often as they hit": half of them pass through a Cloud Floater.
  if (target.kind === 'transport' && target.type === CLOUD_FLOATER && world.rng.int(2) === 0) {
    return;
  }

  // A shot into a hostile force field is spent on it.
  if (!fieldStops(world, b, target)) {
    damage(world, b.owner, target, amount, b);
  }
}

/* oxlint-disable no-magic-numbers -- timings and amounts read from the original */
/** Seconds between the pulses of an Arc Spire and between the checks of an Acid Barricade. */
const FENCE_SECONDS: Readonly<Record<string, number>> = { [ARC_SPIRE]: 1, [ACID_BARRICADE]: 0.2 };
/** What the acid deals to a Priest, whom it cannot dissolve. */
const ACID_ON_PRIEST = 1000;
/* oxlint-enable no-magic-numbers */
/** "Arc Spires deal twice as much damage to large structures": Temples, workshops and altars. */
const LARGE: ReadonlySet<string> = new Set(['Energy', 'Production', 'Altar']);

/**
 * A fence post does nothing alone. Joined to another, an Arc Spire sends a pulse once a second
 * that deals its damage rate to every enemy unit in the band between the two, and an Acid
 * Barricade dissolves every enemy unit on the line between them. The Sun Barricade's force field
 * only stops shots, see `fieldStops`.
 */
function tickFence(world: World, b: Building, def: UnitDef): void {
  const seconds = FENCE_SECONDS[b.type];

  if (!seconds) {
    return;
  }

  if (b.cooldown > 0) {
    b.cooldown--;
    return;
  }

  b.cooldown = Math.round(seconds * TPS) - 1;

  for (const barrier of barriersOf(world, b)) {
    const reach = b.type === ARC_SPIRE ? band(barrier) : line(barrier);

    for (const entity of world.entities.values()) {
      if (airborne(world, entity)) {
        // The pulse passes under air units; the acid "dissolves every enemy unit", Dust Devils too.
        const dissolves = b.type === ACID_BARRICADE && targetable(world, b, entity)
          && overlaps(entity, band(barrier));

        if (dissolves && 'hp' in entity) {
          entity.hp = 0;
        }
      } else if (targetable(world, b, entity) && overlaps(entity, reach)) {
        damage(world, b.owner, entity, fenceDamage(world, b, def, entity, seconds), b);
      }
    }
  }
}

function fenceDamage(
  world: World,
  b: Building,
  def: UnitDef,
  entity: Entity,
  seconds: number,
): number {
  if (b.type === ACID_BARRICADE) {
    return entity.kind === 'priest' || !('hp' in entity) ? ACID_ON_PRIEST : entity.hp;
  }

  const large = entity.kind === 'building' && LARGE.has(world.def(entity.type).cls);
  return def.dps * seconds * (large ? 2 : 1);
}

// From the unit classes of netstorm.game 10.82.
const ICE_TOWER = 'rainblocker';
const CLOUD_FLOATER = 'rainballoon';
const WIND_TOWER = 'windblocker';
const CROSSBOW = 'windarcher';
const VANDER_TOWER = 'thunderarcher';
/** A destroyed Ice Tower is replaced by a growing one that plays its animation in 40 s. */
const REGROW_SECONDS = 40;

/**
 * A unit takes ten seconds to build, and its hit points rise evenly over that time whatever hits
 * it meanwhile. A Temple, a Workshop and an Altar wait for the Priest to come up first.
 */
function construct(world: World, b: Building): void {
  if (b.builder !== null) {
    const p = world.entities.get(b.builder);

    const able = p?.kind === 'priest' && p.state === 'normal';

    if (!able || !world.adjacentTo(p.x, p.y, b)) {
      // He was stopped on the way: struck down, sent elsewhere or cut off.
      if (!able || p.goal !== 'build' || p.target !== b.id) {
        abandon(world, b);
      }

      return;
    }

    b.builder = null;
  }

  b.rising--;
  const total = BUILD_SECONDS * TPS;
  b.hp = Math.max(1, Math.floor((b.hpMax * (total - b.rising)) / total));
}

/** A site the Priest never reached is taken away and its whole price paid back. */
function abandon(world: World, b: Building): void {
  const refund = world.def(b.type).cost;
  removeBuilding(world, b);

  if (b.islet) {
    for (let y = b.y; y < b.y + b.fy; y++) {
      for (let x = b.x; x < b.x + b.fx; x++) {
        world.terrain[world.at(x, y)] = Terrain.Sky;
        world.owner[world.at(x, y)] = 0;
      }
    }

    world.invalidateTerrain();
  }

  world.players.get(b.owner)!.storm += refund;
  world.emit({ what: 'salvaged', who: b.owner, data: { id: b.id, type: b.type, refund } });
}

function regrow(b: Building): void {
  b.regrow--;

  if (b.regrow === 0) {
    b.hp = b.hpMax;
    b.killer = 0;
  }
}

/** Units that are aimed when they are laid: cannons along their line of fire, the Crossbow into
 * its arc, the Wind Tower with its invulnerable back. */
export function facesWhenLaid(def: UnitDef): boolean {
  return def.group === 'cannon' || def.id === CROSSBOW || def.id === WIND_TOWER;
}

/** Twice the centre of an entity, to keep the halves of even footprints whole numbers. */
function centre2(e: Entity): [number, number] {
  const width = e.kind === 'building' ? e.fx : 1;
  const height = e.kind === 'building' ? e.fy : 1;
  return [e.x + e.x + width - 1, e.y + e.y + height - 1];
}

/** How far `to` lies from `from` along the facing and across it, in half cells. */
function alongAcross(from: Entity, to: Entity, facing: Facing): [number, number] {
  const [fx, fy] = centre2(from);
  const [tx, ty] = centre2(to);
  const [dx, dy] = DIRS[facing]!;
  return [(tx - fx) * dx + (ty - fy) * dy, (tx - fx) * dy - (ty - fy) * dx];
}

// tan²(30°) is a third: a target is within 30° of the facing when 3·across² <= along².
const ARC_RATIO = 3;

/** "The Crossbow will target the closest unit in an arc": 30° either side of the way it faces. */
function inArc(b: Building, target: Entity): boolean {
  const [along, across] = alongAcross(b, target, b.facing);
  return along > 0 && ARC_RATIO * across * across <= along * along;
}

/** Whether this gun aims at such a target at all, wherever it stands. */
/** Flyers and Aerial Transports: what only archers and anti-air guns can hit. */
function airborne(world: World, e: Entity): boolean {
  return 'type' in e && flies(world.def(e.type));
}

function aimsAt(world: World, b: Building, target: Entity): boolean {
  // The Vander Tower shoots at flyers only; the Crossbow cannot hit them, and nothing can shoot
  // down a Dust Devil.
  if (airborne(world, target)) {
    return b.type !== CROSSBOW && (target.kind !== 'flyer' || world.def(target.type).hp > 0);
  }

  return b.type !== VANDER_TOWER && (b.type !== CROSSBOW || inArc(b, target));
}

/** "On three sides it takes normal damage, but on its curved back it is utterly invulnerable":
 * the Wind Tower takes nothing from a ground unit that stands on the side it was faced to, the
 * Arc Spire excepted. */
function shielded(target: Entity, from: Building | undefined): boolean {
  if (
    target.kind !== 'building' || target.type !== WIND_TOWER || !from || from.type === ARC_SPIRE
  ) {
    return false;
  }

  const [along, across] = alongAcross(target, from, target.facing);
  return along > 0 && Math.abs(across) <= along;
}

// Damage a destroyed Temple deals to everything around it (netstorm.game 10.82).
// The function below this constant tells what a unit of a given type deals.
const TEMPLE_BLAST = 400;
const BLAST_GROUPS: ReadonlySet<string> = new Set(['archer', 'cannon', 'anti-air']);

/**
 * "When shooting units explode they also damage every other unit nearby! They may explode from
 * that damage in a chain reaction. Temples also explode in this way." In the original a destroyed
 * archer, cannon or anti-air gun deals half of its full hit points plus one, and a Temple 400, to
 * everything with hit points that stands within one cell of its footprint, whoever owns it. The
 * damage belongs to the player who destroyed the unit. Salvage does not come through here.
 */
function explode(world: World, b: Building): void {
  const amount = blastDamage(world.def(b.type), b.hpMax);

  if (!amount) {
    return;
  }

  // ponytail: scans every entity for each explosion; use the cell index if blasts get frequent.
  for (const entity of world.entities.values()) {
    if (airborne(world, entity)) {
      continue; // the blast stays on the ground
    }

    const width = entity.kind === 'building' ? entity.fx : 1;
    const height = entity.kind === 'building' ? entity.fy : 1;

    if (
      entity.x + width >= b.x && entity.x <= b.x + b.fx
      && entity.y + height >= b.y && entity.y <= b.y + b.fy
    ) {
      damage(world, b.killer, entity, amount);

      if (entity.kind === 'building' && entity.hp <= 0) {
        world.blasted.add(entity.id);
      }
    }
  }
}

/** Damage a unit of this type deals around itself when it is destroyed, 0 if it does not explode. */
export function blastDamage(def: UnitDef, hpMax: number): number {
  if (def.cls === 'Energy') {
    return TEMPLE_BLAST;
  }

  return BLAST_GROUPS.has(def.group) ? Math.floor(hpMax / 2) + 1 : 0;
}

/** Take a building off the map. Its island, if it stood on one of its own, stays. */
export function removeBuilding(world: World, b: Building): void {
  for (let y = b.y; y < b.y + b.fy; y++) {
    for (let x = b.x; x < b.x + b.fx; x++) {
      world.occupant[world.at(x, y)] = 0;
    }
  }

  world.entities.delete(b.id);
}

/** Units an air attack does nothing to: "invulnerable to air assault". */
const AIR_PROOF: ReadonlySet<string> = new Set(['thunderblocker', 'bulf']);

/**
 * Take hit points off an entity for a player. `from` is the gun that fired, for the Wind Tower's
 * back; `air` marks the strike of a flyer.
 */
export function damage(
  world: World,
  by: number,
  entity: Entity,
  amount: number,
  from?: Building,
  air = false,
): void {
  if (!('hp' in entity) || shielded(entity, from)) {
    return;
  }

  if (air && 'type' in entity && AIR_PROOF.has(entity.type)) {
    return;
  }

  // The Dust Devil has no hit points to lose.
  if (entity.kind === 'flyer' && world.def(entity.type).hp === 0) {
    return;
  }

  // A growing Ice Tower has nothing to hit, and a unit being built takes its hit points from the
  // progress of the work, whatever strikes it meanwhile.
  if (entity.kind === 'building' && (entity.regrow > 0 || entity.rising > 0)) {
    return;
  }

  const before = entity.hp;
  // A Priest cannot be destroyed: damage never takes him below one hit point.
  const least = entity.kind === 'priest' ? Math.min(1, before) : 0;
  entity.hp = Math.max(least, +(before - amount).toFixed(HP_DECIMALS));

  if (entity.kind === 'building' && before > 0 && entity.hp <= 0) {
    entity.killer = by;
  }

  // "When you destroy an enemy unit you get 25% of its Storm Power value." A priest is never
  // destroyed by units, and only the shot that brings the unit down is paid.
  // Nor is anything paid for an Ice Tower, which grows back.
  if (
    entity.kind === 'priest' || entity.kind === 'flyer' || before <= 0 || entity.hp > 0
    || (entity.kind === 'building' && entity.type === ICE_TOWER)
  ) {
    return;
  }

  const amountPaid = Math.floor((world.def(entity.type).cost * world.killReward) / PER_CENT);
  const player = world.players.get(by);

  if (player && amountPaid > 0) {
    player.storm += amountPaid;
    world.emit({ what: 'reward', who: by, data: { id: entity.id, amount: amountPaid } });
  }
}

function lockedTarget(world: World, b: Building, def: UnitDef, enemyAt: EnemyAt): Entity | null {
  const target = b.target === null ? undefined : world.entities.get(b.target);

  if (!target) {
    return null;
  }

  if (def.group === 'cannon') {
    return lineTarget(world, b, def, enemyAt, b.facing)?.entity === target ? target : null;
  }

  return targetable(world, b, target) && inRadius(world, b, def, target) && aimsAt(world, b, target)
    ? target
    : null;
}

/** "All units will always choose the closest available target." */
function acquire(world: World, b: Building, def: UnitDef, enemyAt: EnemyAt): Entity | null {
  if (def.group !== 'cannon') {
    return airTarget(world, b, def) ?? radiusTarget(world, b, def, enemyAt);
  }

  if (!selfAiming(def)) {
    return lineTarget(world, b, def, enemyAt, b.facing)?.entity ?? null;
  }

  let best: { entity: Entity; distance: number; } | null = null;

  for (const facing of FACINGS) {
    const hit = lineTarget(world, b, def, enemyAt, facing);

    if (hit && (!best || hit.distance < best.distance)) {
      best = hit;
      b.facing = facing; // turning is instant here; the original has a turning speed
    }
  }

  return best?.entity ?? null;
}

export function targetable(world: World, b: { owner: number; }, target: Entity): boolean {
  switch (target.kind) {
    case 'building':
      return world.hostile(b.owner, target.owner) && target.regrow === 0;
    case 'priest':
      return world.hostile(b.owner, target.owner)
        && (target.state === 'normal' || target.state === 'down');
    case 'transport':
    case 'flyer':
      return world.hostile(b.owner, target.owner) && target.hp > 0;
    case 'crystal':
    case 'geyser':
      return false;
  }
}

function inRadius(world: World, b: Building, def: UnitDef, target: Entity): boolean {
  const range = airborne(world, target) ? def.airRange || def.range : def.range;
  const cx = b.x + (b.fx >> 1);
  const cy = b.y + (b.fy >> 1);
  const width = target.kind === 'building' ? target.fx : 1;
  const height = target.kind === 'building' ? target.fy : 1;
  const dx = Math.max(target.x - cx, 0, cx - (target.x + width - 1));
  const dy = Math.max(target.y - cy, 0, cy - (target.y + height - 1));
  return Math.max(dx, dy) <= range;
}

/** First enemy along a straight line from the muzzle; any building in the way stops the shot. */
export function lineTarget(
  world: World,
  b: Building,
  def: UnitDef,
  enemyAt: EnemyAt,
  facing: Facing,
): { entity: Entity; distance: number; } | null {
  const [dx, dy] = DIRS[facing]!;
  let x = b.x + (b.fx >> 1);
  let y = b.y + (b.fy >> 1);

  switch (facing) {
    case 0:
      y = b.y - 1;
      break;
    case 1:
      x = b.x + b.fx;
      break;
    case 2:
      y = b.y + b.fy;
      break;
    case 3: // oxlint-disable-line no-magic-numbers -- Facing W
      x = b.x - 1;
      break;
  }

  for (let r = 0; r < def.range && world.inside(x, y); r++, x += dx, y += dy) {
    const hit = enemyAt(b.owner, x, y);

    if (hit) {
      return { entity: hit, distance: r };
    }

    const occ = world.entities.get(world.occupant[world.at(x, y)] ?? 0);

    if (occ?.kind === 'building') {
      return null;
    }
  }

  return null;
}

/** Closest enemy by ring: rings grow outward, each scanned in row-major order. */
/** Archers and anti-air guns take an air unit before anything on the ground: the nearest one. */
function airTarget(world: World, b: Building, def: UnitDef): Entity | null {
  const cx = b.x + (b.fx >> 1);
  const cy = b.y + (b.fy >> 1);
  let best: Entity | null = null;
  let nearest = Infinity;

  for (const e of world.entities.values()) {
    if (
      !airborne(world, e) || !targetable(world, b, e) || !inRadius(world, b, def, e)
      || !aimsAt(world, b, e)
    ) {
      continue;
    }

    const far = Math.max(Math.abs(e.x - cx), Math.abs(e.y - cy));

    if (far < nearest) {
      best = e;
      nearest = far;
    }
  }

  return best;
}

export function radiusTarget(
  world: World,
  b: Building,
  def: UnitDef,
  enemyAt: EnemyAt,
): Entity | null {
  const cx = b.x + (b.fx >> 1);
  const cy = b.y + (b.fy >> 1);
  const seen: EnemyAt = (owner, x, y) => {
    const hit = enemyAt(owner, x, y);
    return hit && aimsAt(world, b, hit) ? hit : null;
  };

  for (let r = 1; r <= def.range; r++) {
    const left = cx - r;
    const right = cx + r;
    const top = cy - r;
    const bottom = cy + r;

    for (let x = left; x <= right; x++) {
      const hit = seen(b.owner, x, top);

      if (hit) {
        return hit;
      }
    }

    for (let y = top + 1; y < bottom; y++) {
      const first = seen(b.owner, left, y);

      if (first) {
        return first;
      }

      const last = seen(b.owner, right, y);

      if (last) {
        return last;
      }
    }

    for (let x = left; x <= right; x++) {
      const hit = seen(b.owner, x, bottom);

      if (hit) {
        return hit;
      }
    }
  }

  return null;
}
