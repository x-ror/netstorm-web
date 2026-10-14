import type { WorldView } from '../view.js';
import { W, H, DIRS, Terrain } from '../state.js';

const AROUND: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/** The way of an air unit: a straight line over any cell to the nearest cell that meets `goal`,
 * whether bridge joins it or not. */
export function airPath(
  sx: number,
  sy: number,
  goal: (c: [number, number]) => boolean,
): [number, number][] | null {
  // ponytail: a fresh breadth-first search over the open map for each order only to find the
  // nearest goal cell; skip it for a known goal cell if air transports get many.
  const prev = new Int32Array(W * H).fill(-1);
  const start = sy * W + sx;
  const queue = [start];
  prev[start] = start;

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % W;
    const y = (i / W) | 0;

    if (goal([x, y])) {
      return line(sx, sy, x, y);
    }

    for (const [dx, dy] of AROUND) {
      const nx = x + dx;
      const ny = y + dy;
      const j = ny * W + nx;

      if (nx >= 0 && ny >= 0 && nx < W && ny < H && prev[j] === -1) {
        prev[j] = i;
        queue.push(j);
      }
    }
  }

  return null;
}

/** Cells of the straight line from one cell to another, without the first: Bresenham's line, so
 * each step goes to one of the eight cells around. */
function line(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = Math.sign(x1 - x0);
  const sy = Math.sign(y1 - y0);
  let error = dx + dy;
  let x = x0;
  let y = y0;

  while (x !== x1 || y !== y1) {
    const twice = 2 * error;

    if (twice >= dy) {
      error += dy;
      x += sx;
    }

    if (twice <= dx) {
      error += dx;
      y += sy;
    }

    out.push([x, y]);
  }

  return out;
}

export class Pathfinder {
  private readonly pathPrevious = new Int32Array(W * H);
  private readonly pathVisited = new Uint32Array(W * H);
  private readonly pathQueue = new Int32Array(W * H);
  private pathSearch = 0;
  find(
    world: WorldView,
    p: number,
    sx: number,
    sy: number,
    goal: (c: [number, number]) => boolean,
    avoidOccupied = false,
  ): [number, number][] | null {
    if (!world.inside(sx, sy)) {
      return null;
    }

    // Epoch markers avoid clearing 65,536 cells for each search. No scratch allocations.
    this.pathSearch = (this.pathSearch + 1) >>> 0;

    if (this.pathSearch === 0) {
      this.pathVisited.fill(0);
      this.pathSearch = 1;
    }

    const epoch = this.pathSearch;
    const prev = this.pathPrevious;
    const visited = this.pathVisited;
    const q = this.pathQueue;
    const start = world.at(sx, sy);
    let tail = 1;
    q[0] = start;
    prev[start] = start;
    visited[start] = epoch;

    for (let head = 0; head < tail; head++) {
      const i = q[head]!;
      const x = i % W;
      const y = (i / W) | 0;

      if (goal([x, y])) {
        const out: [number, number][] = [];

        for (let cell = i; cell !== start; cell = prev[cell]!) {
          out.push([cell % W, (cell / W) | 0]);
        }

        return out.reverse();
      }

      let open = 0; // sides a straight step can be taken on, as bits by direction

      for (const [dir, [dx, dy]] of DIRS.entries()) {
        const nx = x + dx;
        const ny = y + dy;

        // A step needs ground to stand on and a join between the two cells.
        if (!world.walkable(p, nx, ny) || !world.joined(x, y, dir)) {
          continue;
        }

        const j = world.at(nx, ny);

        if (avoidOccupied && world.takenBy(nx, ny)) {
          continue;
        }

        open |= 1 << dir;

        if (visited[j] !== epoch) {
          visited[j] = epoch;
          prev[j] = i;
          q[tail++] = j;
        }
      }

      // Diagonal steps, as in the original: only across island ground (bridge frames have no
      // diagonal joins), and only where both straight steps beside the diagonal can be taken.
      if (world.terrain[i] !== Terrain.Island) {
        continue;
      }

      for (const [dir, [dx, dy]] of DIRS.entries()) {
        const next = (dir + 1) % DIRS.length;
        const nx = x + dx + DIRS[next]![0];
        const ny = y + dy + DIRS[next]![1];

        if (
          (open & (1 << dir)) === 0 || (open & (1 << next)) === 0
          || !world.walkable(p, nx, ny)
        ) {
          continue;
        }

        const j = world.at(nx, ny);

        if (
          world.terrain[j] === Terrain.Island && visited[j] !== epoch
          && !(avoidOccupied && world.takenBy(nx, ny))
        ) {
          visited[j] = epoch;
          prev[j] = i;
          q[tail++] = j;
        }
      }
    }

    return null;
  }
}
