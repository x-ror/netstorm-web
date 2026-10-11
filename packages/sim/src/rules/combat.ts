import type { World } from '../world.js';
import type { UnitDef } from '../defs.js';
import { shakeBridges } from './bridges.js';
import {
  TPS,
  DIRS,
  FACINGS,
  REFUND_SHARE,
  type Entity,
  type Building,
  type Facing,
} from '../state.js';

export type EnemyAt = (owner: number, x: number, y: number) => Entity | null;

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
  if (b.hp <= 0) {
    removeBuilding(world, b);
    shakeBridges(world, b);
    world.emit({ what: 'destroyed', who: b.owner, data: { id: b.id, type: b.type } });
    return;
  }

  const def = world.def(b.type);

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
  const amount = def.group === 'anti-air' ? def.dps * FLAT_SHOT_SHARE : (def.dps * interval) / TPS;
  damage(world, b.owner, target, amount);
  b.cooldown = interval;
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

function damage(world: World, by: number, entity: Entity, amount: number): void {
  if (!('hp' in entity)) {
    return;
  }

  const before = entity.hp;
  entity.hp = Math.max(0, +(before - amount).toFixed(HP_DECIMALS));

  // "When you destroy an enemy unit you get 25% of its Storm Power value." A priest is never
  // destroyed by units, and only the shot that brings the unit down is paid.
  if (entity.kind === 'priest' || before <= 0 || entity.hp > 0) {
    return;
  }

  const amountPaid = Math.floor(world.def(entity.type).cost * REFUND_SHARE);
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

  return targetable(b, target) && inRadius(b, def, target) ? target : null;
}

/** "All units will always choose the closest available target." */
function acquire(world: World, b: Building, def: UnitDef, enemyAt: EnemyAt): Entity | null {
  if (def.group !== 'cannon') {
    return radiusTarget(b, def, enemyAt);
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

function targetable(b: Building, target: Entity): boolean {
  switch (target.kind) {
    case 'building':
      return target.owner !== b.owner && target.owner !== 0;
    case 'priest':
      return target.owner !== b.owner && (target.state === 'normal' || target.state === 'down');
    case 'transport':
      return target.owner !== b.owner && target.hp > 0;
    case 'crystal':
    case 'geyser':
      return false;
  }
}

function inRadius(b: Building, def: UnitDef, target: Entity): boolean {
  const cx = b.x + (b.fx >> 1);
  const cy = b.y + (b.fy >> 1);
  const width = target.kind === 'building' ? target.fx : 1;
  const height = target.kind === 'building' ? target.fy : 1;
  const dx = Math.max(target.x - cx, 0, cx - (target.x + width - 1));
  const dy = Math.max(target.y - cy, 0, cy - (target.y + height - 1));
  return Math.max(dx, dy) <= def.range;
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
export function radiusTarget(b: Building, def: UnitDef, enemyAt: EnemyAt): Entity | null {
  const cx = b.x + (b.fx >> 1);
  const cy = b.y + (b.fy >> 1);

  for (let r = 1; r <= def.range; r++) {
    const left = cx - r;
    const right = cx + r;
    const top = cy - r;
    const bottom = cy + r;

    for (let x = left; x <= right; x++) {
      const hit = enemyAt(b.owner, x, top);

      if (hit) {
        return hit;
      }
    }

    for (let y = top + 1; y < bottom; y++) {
      const first = enemyAt(b.owner, left, y);

      if (first) {
        return first;
      }

      const last = enemyAt(b.owner, right, y);

      if (last) {
        return last;
      }
    }

    for (let x = left; x <= right; x++) {
      const hit = enemyAt(b.owner, x, bottom);

      if (hit) {
        return hit;
      }
    }
  }

  return null;
}
