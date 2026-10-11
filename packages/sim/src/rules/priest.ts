import type { Command, CommandError } from '../commands.js';
import type { World } from '../world.js';
import { TPS, Terrain, type Priest } from '../state.js';
import { advance } from './movement.js';
import { tickRitual } from './capture.js';

const PRIEST_SPEED = 1.8; // cells per second

export function tickPriest(world: World, p: Priest): void {
  if (p.state === 'carried') {
    const by = p.carriedBy === null ? undefined : world.entities.get(p.carriedBy);

    if (!by || by.kind !== 'transport' || by.carrying !== p.id) {
      throw new Error(`Invalid carrier for priest ${p.id}`);
    }

    p.x = by.x;
    p.y = by.y;
    return;
  }

  if (p.state === 'chained') {
    tickRitual(world, p);
    return;
  }

  if (p.state === 'down') {
    // regenerates while the player still has a temple
    if (
      world.buildingsOf(p.owner).some((b) => world.def(b.type).cls === 'Energy')
      && world.tick % TPS === 0
    ) {
      p.hp = Math.min(p.hpMax, p.hp + 2);
    }

    if (p.hp > p.hpMax / 2) {
      p.state = 'normal';
      world.emit({ what: 'priest up', who: p.owner });
    }

    return;
  }

  if (p.hp <= p.hpMax / 2) {
    p.state = 'down';
    p.path = [];
    world.emit({ what: 'priest down', who: p.owner });
    return;
  }

  // With no ground under him he hangs in place until bridge is laid there again.
  if (world.terrain[world.at(p.x, p.y)] === Terrain.Sky) {
    p.path = [];
    return;
  }

  advance(world, p, PRIEST_SPEED);
}

export function movePriest(
  world: World,
  c: Extract<Command, { t: 'movePriest'; }>,
): CommandError | null {
  const p = world.priestOf(c.player);

  if (!p || p.state !== 'normal' || world.terrain[world.at(p.x, p.y)] === Terrain.Sky) {
    return 'priest unavailable';
  }

  const path = world.findPath(c.player, p.x, p.y, (cell) => cell[0] === c.x && cell[1] === c.y,
    true);

  if (!path) {
    return 'no path';
  }

  p.path = path;
  return null;
}
