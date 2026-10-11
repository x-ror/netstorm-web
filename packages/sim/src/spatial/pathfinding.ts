import type { WorldView } from '../view.js';
import { W, H, DIRS } from '../state.js';

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

      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;

        if (!world.walkable(p, nx, ny)) {
          continue;
        }

        const j = world.at(nx, ny);

        if (avoidOccupied && world.occupant[j]) {
          continue;
        }

        if (visited[j] !== epoch) {
          visited[j] = epoch;
          prev[j] = i;
          q[tail++] = j;
        }
      }
    }

    return null;
  }
}
