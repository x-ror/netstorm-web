import type { World } from '../world.js';
import type { UnitDef } from '../defs.js';
import { TPS, DIRS, FACINGS, type Entity, type Building, type Facing } from '../state.js';

export type EnemyAt = (owner: number, x: number, y: number) => Entity | null;

const HP_DECIMALS = 4; // hp is rounded to keep the simulation deterministic
// Invented: most shooters have no delayBetweenShots in the data and the help gives no rate of fire.
const DEFAULT_SHOT_SECONDS = 1;

/** Ticks between shots. `delay` is delayBetweenShots from the unit data, read as seconds (unconfirmed). */
export function shotInterval(def: UnitDef): number {
  return Math.max(1, Math.round((def.delay > 0 ? def.delay : DEFAULT_SHOT_SECONDS) * TPS));
}

/** The Sun Cannon "will rotate itself to target an enemy"; other cannons keep their orientation. */
function selfAiming(def: UnitDef): boolean {
  return def.group === 'cannon' && def.theme === 'sun';
}

export function tickBuilding(world: World, b: Building, enemyAt: EnemyAt): void {
  if (b.hp <= 0) {
    for (let y = b.y; y < b.y + b.fy; y++) {
      for (let x = b.x; x < b.x + b.fx; x++) {
        world.occupant[world.at(x, y)] = 0;
      }
    }

    world.entities.delete(b.id);
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

  // "Damage" in the unit data is the average per second, so one shot carries a whole interval of it.
  const interval = shotInterval(def);
  damage(target, (def.dps * interval) / TPS);
  b.cooldown = interval;
}

function damage(entity: Entity, amount: number): void {
  if ('hp' in entity) {
    entity.hp = Math.max(0, +(entity.hp - amount).toFixed(HP_DECIMALS));
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
