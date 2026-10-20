/**
 * "Your island is under attack": when a unit of the player's is damaged on his home island, the
 * original says so and plays islandUnderAttack.wav, at most once in 30 s (Damageable.cpp,
 * FUN_00458910). The home island is the one the original keeps from battle to battle; here it is
 * the ground joined to the player's Temple (`?`).
 */
import { TPS, Terrain, W, type WorldView } from '@netstorm/sim';

/** Seconds between two alarms. */
const QUIET = 30;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** The cells of island ground joined to the player's Temple. */
export function homeIsland(world: WorldView, player: number): Set<number> {
  const temple = world.templeOf(player);
  const home = new Set<number>();

  if (!temple) {
    return home;
  }

  const queue = [world.at(temple.x, temple.y)];
  home.add(queue[0]!);

  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const [x, y] = [next % W, Math.floor(next / W)];

    for (const [dx, dy] of STEPS) {
      const cell = world.at(x + dx, y + dy);

      if (
        world.inside(x + dx, y + dy) && !home.has(cell) && world.terrain[cell] === Terrain.Island
      ) {
        home.add(cell);
        queue.push(cell);
      }
    }
  }

  return home;
}

/** Whether to sound the alarm this tick: watches the hit points of the player's units at home. */
export function createAlarm(world: WorldView) {
  const hp = new Map<number, number>();
  let home = new Set<number>();
  let revision = -1;
  let player = -1;
  let last = -Infinity;

  return (viewer: number): boolean => {
    if (revision !== world.terrainRevision || player !== viewer) {
      home = homeIsland(world, viewer);
      revision = world.terrainRevision;
      player = viewer;
      hp.clear();
    }

    let hurt = false;

    for (const e of world.entities.values()) {
      if (!('hp' in e) || e.owner !== viewer || !home.has(world.at(e.x, e.y))) {
        continue;
      }

      const before = hp.get(e.id);
      hurt ||= before !== undefined && e.hp < before;
      hp.set(e.id, e.hp);
    }

    if (!hurt || world.tick - last < QUIET * TPS) {
      return false;
    }

    last = world.tick;
    return true;
  };
}
