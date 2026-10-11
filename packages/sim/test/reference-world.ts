import { World, type Entity, type DefTable } from '../src/index.js';

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
  }
}
