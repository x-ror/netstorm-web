import {
  type DeepReadonly,
  type Entity,
  type Facing,
  type UnitDef,
  type WorldView,
} from '@netstorm/sim';

/** What a left click on the map does. */
export type Tool =
  | { kind: 'select'; }
  | { kind: 'piece'; hand: number; }
  | { kind: 'build'; type: string; }
  | { kind: 'salvage'; };

/** Client-only state of the local player's interface. Never part of the simulation or replay. */
export interface UiState {
  tool: Tool;
  /** Rotation of the bridge piece being placed, 0..3. */
  rot: number;
  /** Facing of the cannon being placed. */
  facing: Facing;
  selected: number | null;
  hover: { x: number; y: number; };
  paused: boolean;
}

export function createUiState(): UiState {
  return {
    tool: { kind: 'select' },
    rot: 0,
    facing: 1,
    selected: null,
    hover: { x: 0, y: 0 },
    paused: false,
  };
}

/** Classes the Production Window cannot place yet: the simulation refuses them ('cannot build')
 * because aerial units and spells have no rules yet; see docs/game-rules.md. */
const NOT_PLACEABLE = new Set<string>([
  'Aerial Transport',
  'Aerial Attack',
  'High Priest',
  'Spell',
  'Offensive Spell',
  'Offsensive Spell',
  'Defensive Spell',
  'Summons Spell',
  'World Event',
  'Source of Storm Power',
  'Bridge',
  '',
]);

export function placeable(def: Readonly<UnitDef>): boolean {
  return !NOT_PLACEABLE.has(def.cls) && def.footX > 0 && def.footY > 0;
}

/** Cannons are laid facing one of four directions. */
export function hasFacing(def: Readonly<UnitDef>): boolean {
  return def.group === 'cannon';
}

/** Top-left cell of a footprint centred on the cursor. */
export function anchorFor(def: Readonly<UnitDef>, x: number, y: number): { x: number; y: number; } {
  return { x: x - Math.floor((def.footX - 1) / 2), y: y - Math.floor((def.footY - 1) / 2) };
}

type View = DeepReadonly<Entity>;

/** The entity a click on a cell means: one standing on the cell, then anything next to it. */
export function entityAt(world: WorldView, x: number, y: number): View | undefined {
  if (!world.inside(x, y)) {
    return undefined;
  }

  let near: View | undefined;
  let nearDistance = Infinity;

  for (const entity of world.entities.values()) {
    if (!isPickable(entity)) {
      continue;
    }

    if (entity.kind !== 'building' && entity.x === x && entity.y === y) {
      return entity;
    }

    const distance = Math.max(Math.abs(entity.x - x), Math.abs(entity.y - y));

    if (entity.kind !== 'building' && distance <= 1 && distance < nearDistance) {
      near = entity;
      nearDistance = distance;
    }
  }

  return world.entities.get(world.occupant[world.at(x, y)] ?? 0) ?? near;
}

function isPickable(entity: View): boolean {
  if (entity.kind === 'crystal') {
    return entity.carriedBy === null;
  }

  return entity.kind !== 'priest' || entity.state !== 'carried';
}
