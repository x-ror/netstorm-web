import { World, type Entity, type DefTable, type Building, type UnitDef } from '../src/index.js';

// Reference the previous full scan. Compare authoritative outcomes, not bucket internals.
export class ScanWorld extends World {
  constructor(defs: DefTable) {
    super(defs, 42);
    Object.defineProperty(this, 'enemyAt', {
      value: (me: number, x: number, y: number): Entity | null => {
        if (!this.inside(x, y)) {
          return null;
        }

        const occupant = this.entities.get(this.occupant[this.at(x, y)] ?? 0);

        if (
          occupant
          && (occupant.kind === 'building' || occupant.kind === 'priest')
          && occupant.owner !== me
          && occupant.owner !== 0
        ) {
          return occupant;
        }

        for (const entity of this.entities.values()) {
          if (
            entity.kind === 'transport'
            && entity.owner !== me
            && entity.x === x
            && entity.y === y
            && entity.hp > 0
          ) {
            return entity;
          }
        }

        return null;
      },
    });
    Object.defineProperty(this, 'radiusTarget', {
      value: (building: Building, def: UnitDef): Entity | null => {
        const cx = building.x + (building.fx >> 1);
        const cy = building.y + (building.fy >> 1);

        for (let r = 1; r <= def.range; r++) {
          for (let y = cy - r; y <= cy + r; y++) {
            for (let x = cx - r; x <= cx + r; x++) {
              if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) {
                continue;
              }

              const hit = (
                this as unknown as { enemyAt(owner: number, x: number, y: number): Entity | null; }
              ).enemyAt(building.owner, x, y);

              if (hit) {
                return hit;
              }
            }
          }
        }

        return null;
      },
    });
  }
}
