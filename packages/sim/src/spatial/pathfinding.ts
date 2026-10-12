import type { WorldView } from '../view.js';
import { W, H, DIRS, Terrain } from '../state.js';

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

        if (avoidOccupied && world.occupant[j]) {
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
          && !(avoidOccupied && world.occupant[j])
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
