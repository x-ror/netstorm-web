import type { World } from '../world.js';
import type { UnitDef } from '../defs.js';
import { TPS, DIRS, type Entity, type Building } from '../state.js';

type EnemyAt = (owner: number, x: number, y: number) => Entity | null;

const HP_DECIMALS = 4; // hp is rounded to keep the simulation deterministic

export function tickBuilding(
  world: World,
  b: Building,
  select: (building: Building, def: UnitDef) => Entity | null,
): void {
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

  const target = select(b, def);

  if (target) {
    damage(target, def.dps / TPS);
  }
}

function damage(entity: Entity, amount: number): void {
  if ('hp' in entity) {
    entity.hp = Math.max(0, +(entity.hp - amount).toFixed(HP_DECIMALS));
  }
}

export function lineTarget(
  world: World,
  b: Building,
  def: UnitDef,
  enemyAt: EnemyAt,
): Entity | null {
  const [dx, dy] = DIRS[b.facing]!;
  let x = b.x + (b.fx >> 1);
  let y = b.y + (b.fy >> 1);

  switch (b.facing) {
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
      return hit;
    }

    const occ = world.entities.get(world.occupant[world.at(x, y)] ?? 0);

    if (occ?.kind === 'building') {
      return null;
    }
  }

  return null;
}

export function radiusTarget(b: Building, def: UnitDef, enemyAt: EnemyAt): Entity | null {
  const cx = b.x + (b.fx >> 1);
  const cy = b.y + (b.fy >> 1);

  // Same row-major ring order as before, without visiting the ring's interior.
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
