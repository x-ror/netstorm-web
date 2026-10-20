import type { DeepReadonly, WorldView } from '../view.js';
import type * as State from '../state.js';

type World = WorldView;
type Building = DeepReadonly<State.Building>;
type Entity = DeepReadonly<State.Entity>;

// From the fence post classes of netstorm.game 10.82 (FencepostType and its Thunder and Rain
// descendants). Two posts of one kind on one row or column, no further apart than their `range`,
// are joined by a barrier.
export const SUN_BARRICADE = 'sunfence';
export const ACID_BARRICADE = 'rainfence';
export const ARC_SPIRE = 'thunderfence';

export interface Barrier {
  from: Building;
  to: Building;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Each post looks east and south for a partner, so a pair makes one barrier.
const LOOKS: readonly (readonly [number, number])[] = [[1, 0], [0, 1]];

function standing(e: Entity, type: string): e is Building {
  return e.kind === 'building' && e.type === type && e.hp > 0 && e.rising === 0;
}

/**
 * The post this one is joined to in a direction. An Arc Spire and an Acid Barricade take the
 * nearest post of their own player and look past anybody else's. A Sun Barricade takes the nearest
 * post whoever owns it, and stays unjoined if that one is hostile: "placing a Sun Barricade
 * between a hostile Sun Barricade fence will disable it".
 */
function partner(world: World, post: Building, dx: number, dy: number): Building | null {
  const { range } = world.def(post.type);
  let best: Building | null = null;
  let nearest = range + 1;

  // ponytail: scans every entity for each post; index posts by row and column if they get many.
  for (const e of world.entities.values()) {
    if (!standing(e, post.type) || (post.type !== SUN_BARRICADE && e.owner !== post.owner)) {
      continue;
    }

    const along = (e.x - post.x) * dx + (e.y - post.y) * dy;
    const across = (e.x - post.x) * dy + (e.y - post.y) * dx;

    if (across === 0 && along > 0 && along < nearest) {
      best = e;
      nearest = along;
    }
  }

  // "Your allies can connect their Sun Barricade with yours and vice-versa."
  return best && !world.hostile(best.owner, post.owner) ? best : null;
}

/** The barriers a post holds to the east and to the south of itself. */
export function barriersOf(world: World, post: Building): Barrier[] {
  const found: Barrier[] = [];

  if (post.hp <= 0 || post.rising > 0) {
    return found;
  }

  for (const [dx, dy] of LOOKS) {
    const to = partner(world, post, dx, dy);

    if (to) {
      found.push({ from: post, to });
    }
  }

  return found;
}

/** Every barrier on the map, for drawing. */
export function barriers(world: World): Barrier[] {
  const found: Barrier[] = [];

  for (const e of world.entities.values()) {
    if (e.kind === 'building' && world.def(e.type).group === 'fence') {
      found.push(...barriersOf(world, e));
    }
  }

  return found;
}

/** The band a barrier covers, as wide as its posts and with both of them inside. */
export function band({ from, to }: Barrier): Rect {
  return { x0: from.x, y0: from.y, x1: to.x + to.fx - 1, y1: to.y + to.fy - 1 };
}

/** The single line of cells from the middle of one post to the middle of the other. */
export function line({ from, to }: Barrier): Rect {
  return {
    x0: from.x + (from.fx >> 1),
    y0: from.y + (from.fy >> 1),
    x1: to.x + (to.fx >> 1),
    y1: to.y + (to.fy >> 1),
  };
}

export function overlaps(e: Entity, r: Rect): boolean {
  const width = e.kind === 'building' ? e.fx : 1;
  const height = e.kind === 'building' ? e.fy : 1;
  return e.x <= r.x1 && e.x + width > r.x0 && e.y <= r.y1 && e.y + height > r.y0;
}

type Point = readonly [number, number];

function side(a: Point, b: Point, c: Point): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

function middle(e: Entity): Point {
  const width = e.kind === 'building' ? e.fx : 1;
  const height = e.kind === 'building' ? e.fy : 1;
  return [e.x + e.x + width, e.y + e.y + height]; // doubled, to stay in whole numbers
}

/**
 * "The Barricade keeps out enemy fire ... but lets your own Shooters fire right through": the cell
 * where the straight way from a shooter to its target first crosses the force field of somebody
 * else's Sun Barricades, nearest to the shooter, or null. The original looks for it when the gun
 * fires, and the missile flies there (Missile.cpp, FUN_004660b0).
 */
export function fieldStop(
  world: World,
  shooter: Building,
  target: Entity,
): [number, number] | null {
  const a = middle(shooter);
  const b = middle(target);
  let best: [number, number] | null = null;
  let nearest = Infinity;

  for (const e of world.entities.values()) {
    if (!standing(e, SUN_BARRICADE) || !world.hostile(e.owner, shooter.owner)) {
      continue;
    }

    for (const { from, to } of barriersOf(world, e)) {
      const c = middle(from);
      const d = middle(to);

      if (!crosses(a, b, c, d)) {
        continue;
      }

      // Where the two lines meet, as a share of the way from the shooter to its target.
      const across = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
      const share = across === 0
        ? 0
        : ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / across;

      if (share < nearest) {
        nearest = share;
        // Doubled coordinates back to the cell they fall in.
        best = [
          Math.floor((a[0] + (b[0] - a[0]) * share) / 2),
          Math.floor((a[1] + (b[1] - a[1]) * share) / 2),
        ];
      }
    }
  }

  return best;
}
