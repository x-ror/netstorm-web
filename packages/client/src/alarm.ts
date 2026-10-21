/**
 * "Your island is under attack": when a unit of the player's is damaged on his home island, the
 * original says so and plays islandUnderAttack.wav, at most once in 30 s (Damageable.cpp,
 * FUN_00458910); the home island as the simulation's `homeIsland` finds it.
 */
import { TPS, homeIsland, type WorldView } from '@netstorm/sim';

/** Seconds between two alarms. */
const QUIET = 30;

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
