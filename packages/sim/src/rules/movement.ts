import type { Command, CommandError } from '../commands.js';
import type { World } from '../world.js';
import { TPS, CRYSTAL_VALUE, type Transport, type Priest, type Geyser } from '../state.js';

const MOVE_SCALE = 100; // fixed-point progress needed to enter the next cell

export function advance(world: World, e: Transport | Priest, speed: number): boolean {
  if (!e.path.length) {
    return false;
  }

  e.move += Math.round((speed * MOVE_SCALE) / TPS);

  while (e.move >= MOVE_SCALE && e.path.length) {
    e.move -= MOVE_SCALE;
    const [x, y] = e.path.shift()!;

    // A priest occupies its cell, so it stops rather than overwrite a geyser or another priest.
    if (
      !world.walkable(e.owner, x, y)
      || (e.kind === 'priest' && world.occupant[world.at(x, y)])
    ) {
      e.path = [];
      return false;
    }

    if (e.kind === 'priest') {
      world.occupant[world.at(e.x, e.y)] = 0;
      world.occupant[world.at(x, y)] = e.id;
    }

    const previousX = e.x;
    const previousY = e.y;
    e.x = x;
    e.y = y;

    if (e.kind === 'transport') {
      world.moveTransportIndex(e, previousX, previousY);
    }
  }

  return true;
}

export function tickTransport(world: World, t: Transport): void {
  if (t.hp <= 0) {
    dropCargo(world, t);
    world.entities.delete(t.id);
    world.emit({ what: 'destroyed', who: t.owner, data: { id: t.id, type: t.type } });
    return;
  }

  advance(world, t, world.def(t.type).speed);

  if (t.path.length) {
    return;
  }

  if (t.goal === 'collect') {
    const g = targetGeyser(world, t);
    t.target = null;

    if (g && g.crystal !== null) {
      const c = world.entities.get(g.crystal);

      if (!c || c.kind !== 'crystal') {
        throw new Error(`Missing crystal for geyser ${g.id}`);
      }

      c.carriedBy = t.id;
      t.carrying = c.id;
      g.crystal = null;
      const home = world.buildingsOf(t.owner).find((b) => world.def(b.type).cls === 'Energy');
      const path = home
        ? world.findPath(t.owner, t.x, t.y, (cell) => world.adjacentTo(cell[0], cell[1], home))
        : null;

      if (path) {
        t.path = path;
        t.goal = 'home';
      } else {
        t.goal = 'idle';
      }
    } else {
      t.goal = 'idle';
    }
  } else if (t.goal === 'home' && t.carrying !== null) {
    const home = world.buildingsOf(t.owner).find((b) => world.def(b.type).cls === 'Energy');

    if (!home || !world.adjacentTo(t.x, t.y, home)) {
      t.goal = 'idle';
      return;
    }

    const pl = world.players.get(t.owner)!;
    pl.storm += CRYSTAL_VALUE;
    world.entities.delete(t.carrying);
    t.carrying = null;
    t.goal = 'idle';
    world.emit({ what: 'delivered', who: t.owner, data: { transport: t.id } });
  }
}

/** The geyser this transport was sent to, if it still exists and the transport stands next to it. */
function targetGeyser(world: World, t: Transport): Geyser | null {
  const g = t.target === null ? undefined : world.entities.get(t.target);

  if (!g || g.kind !== 'geyser' || Math.abs(g.x - t.x) + Math.abs(g.y - t.y) !== 1) {
    return null;
  }

  return g;
}

function dropCargo(world: World, t: Transport): void {
  if (t.carrying === null) {
    return;
  }

  // As in the original, the crystal falls where its carrier died. Picking it up is not implemented yet.
  const c = world.entities.get(t.carrying);

  if (c?.kind === 'crystal') {
    c.carriedBy = null;
    c.x = t.x;
    c.y = t.y;
  }

  t.carrying = null;
}

export function collect(world: World, c: Extract<Command, { t: 'collect'; }>): CommandError | null {
  const t = world.entities.get(c.transport);
  const g = world.entities.get(c.geyser);

  if (
    !t
    || t.kind !== 'transport'
    || t.owner !== c.player
    || !g
    || g.kind !== 'geyser'
    || t.carrying !== null
  ) {
    return 'bad target';
  }

  const path = world.findPath(c.player, t.x, t.y,
    (cell) => Math.abs(cell[0] - g.x) + Math.abs(cell[1] - g.y) === 1);

  if (!path) {
    return 'no path';
  }

  t.path = path;
  t.goal = 'collect';
  t.target = g.id;
  return null;
}
