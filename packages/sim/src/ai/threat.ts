/**
 * Where the enemy's guns reach, for the computer opponent: a grid of the damage per second that
 * hostile shooters can bring onto each cell, measured as rules/combat.ts aims them. Radius guns
 * cover a square (Chebyshev) around their centre; the Crossbow only its 30° arc; cannons a line
 * of cells from the muzzle, and the Sun Cannon, which turns, all four lines. Guns that hit only
 * the air (the Vander Tower) and barriers add nothing to the ground. Invisible guns are not seen.
 *
 * On top of it, the path a bridge should take through the sky: a shortest path where each cell
 * costs one plus a share of the threat on it, so a bridge goes around the fire when the detour is
 * worth it.
 */
import { DIRS, FACINGS, H, Terrain, W, type Building, type Facing } from '../state.js';
import type { DeepReadonly, WorldView } from '../view.js';

const CROSSBOW = 'windarcher';
const VANDER_TOWER = 'thunderarcher';
const SUN_CANNON = 'suncannon';
// tan²(30°) is a third: a cell is within the arc when 3·across² <= along² (rules/combat.ts).
const ARC_RATIO = 3;
/** Damage per second that costs a bridge one more cell of length to cross (invented). */
export const THREAT_UNIT = 10;

export type ThreatMap = Int32Array;

/** The grid a move fills; valid until the next call. */
const threatGrid = new Int32Array(W * H);

/**
 * The threat on every cell from the hostile shooters `counted` admits (all of them by default);
 * the caller leaves out those it has not yet noticed.
 */
export function threatMap(
  world: WorldView,
  me: number,
  counted: (b: DeepReadonly<Building>) => boolean = () => true,
): ThreatMap {
  const grid = threatGrid.fill(0);

  for (const e of world.entities.values()) {
    if (
      e.kind !== 'building' || !world.hostile(e.owner, me) || e.invisible > 0 || e.hp <= 0
      || !counted(e)
    ) {
      continue;
    }

    const def = world.def(e.type);

    if (def.dps <= 0 || def.range <= 0 || def.group === 'fence' || e.type === VANDER_TOWER) {
      continue;
    }

    if (def.group === 'cannon') {
      const facings: readonly Facing[] = e.type === SUN_CANNON ? FACINGS : [e.facing];

      for (const facing of facings) {
        line(grid, e, def.range, facing, def.dps);
      }
    } else {
      square(grid, e, def.range, def.dps, e.type === CROSSBOW ? e.facing : null);
    }
  }

  return grid;
}

/** A cannon's line of fire: `range` cells from the muzzle, as lineTarget walks it. */
function line(
  grid: Int32Array,
  b: DeepReadonly<Building>,
  range: number,
  facing: Facing,
  dps: number,
): void {
  const [dx, dy] = DIRS[facing]!;
  let x = b.x + (b.fx >> 1);
  let y = b.y + (b.fy >> 1);

  if (facing === 0) {
    y = b.y - 1;
  } else if (facing === 1) {
    x = b.x + b.fx;
  } else if (facing === 2) {
    y = b.y + b.fy;
  } else {
    x = b.x - 1;
  }

  for (let r = 0; r < range && x >= 0 && y >= 0 && x < W && y < H; r++, x += dx, y += dy) {
    grid[y * W + x]! += dps;
  }
}

/** A radius gun's square, or the Crossbow's arc within it, as inRadius and inArc measure. */
function square(
  grid: Int32Array,
  b: DeepReadonly<Building>,
  range: number,
  dps: number,
  arc: Facing | null,
): void {
  const cx = b.x + (b.fx >> 1);
  const cy = b.y + (b.fy >> 1);
  // Twice the centre, in half cells, like combat's centre2.
  const cx2 = b.x + b.x + b.fx - 1;
  const cy2 = b.y + b.y + b.fy - 1;

  for (let y = Math.max(0, cy - range); y <= Math.min(H - 1, cy + range); y++) {
    for (let x = Math.max(0, cx - range); x <= Math.min(W - 1, cx + range); x++) {
      if (arc !== null) {
        const [fx, fy] = DIRS[arc]!;
        const tx = x + x - cx2;
        const ty = y + y - cy2;
        const along = tx * fx + ty * fy;
        const across = tx * fy - ty * fx;

        if (along <= 0 || ARC_RATIO * across * across > along * along) {
          continue;
        }
      }

      grid[y * W + x]! += dps;
    }
  }
}

/** What crossing a cell adds to a bridge's length, beyond the cell itself. */
export function crossingCost(threat: ThreatMap, weight: number, i: number): number {
  return weight * Math.ceil(threat[i]! / THREAT_UNIT);
}

/**
 * Cheapest way through the sky from every cell to the seeded cells (cost 0 in `field`, queued in
 * `queue[0..tail)`), going around islands: Dijkstra over sky cells, each costing one plus its
 * crossing cost. With weight 0 this is the breadth-first field of before. Fills `field` in place;
 * -1 stays where the sky does not lead to a seed and on every cell that is not sky.
 */
export function skyCosts(
  world: WorldView,
  field: Int32Array,
  queue: Int32Array,
  tail: number,
  threat: ThreatMap,
  weight: number,
): void {
  // A binary heap of cost·2^18 + cell: cheaper first, then the lower cell, so the order is fixed.
  const heap: number[] = [];
  const push = (key: number) => {
    heap.push(key);
    let i = heap.length - 1;

    while (i > 0) {
      const parent = (i - 1) >> 1;

      if (heap[parent]! <= heap[i]!) {
        break;
      }

      [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
      i = parent;
    }
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;

    if (heap.length) {
      heap[0] = last;
      let i = 0;

      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;

        if (l < heap.length && heap[l]! < heap[m]!) {
          m = l;
        }

        if (r < heap.length && heap[r]! < heap[m]!) {
          m = r;
        }

        if (m === i) {
          break;
        }

        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }

    return top;
  };

  for (let k = 0; k < tail; k++) {
    push(queue[k]!); // cost 0
  }

  while (heap.length) {
    const key = pop();
    const cost = Math.floor(key / CELLS);
    const i = key - cost * CELLS;

    if (field[i] !== cost) {
      continue; // a stale entry: the cell was reached cheaper
    }

    const x = i % W;
    const y = (i / W) | 0;

    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;

      if (!world.inside(nx, ny) || world.terrain[ny * W + nx] !== Terrain.Sky) {
        continue;
      }

      const j = ny * W + nx;
      const next = cost + 1 + crossingCost(threat, weight, j);

      if (field[j] === -1 || next < field[j]!) {
        field[j] = next;
        push(next * CELLS + j);
      }
    }
  }
}

const CELLS = W * H;
