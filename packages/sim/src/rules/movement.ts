import type { Command, CommandError } from '../commands.js';
import type { World } from '../world.js';
import { TPS, CRYSTAL_VALUE, type Transport, type Priest, type Geyser } from '../state.js';

export function advance(world: World, e: Transport | Priest, speed: number): boolean {
  if (!e.path.length) {
    return false;
  }

  e.move += Math.round((speed * 100) / TPS);

  while (e.move >= 100 && e.path.length) {
    e.move -= 100;
    const [x, y] = e.path.shift()!;

    if (!world.walkable(e.owner, x, y)) {
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
    const g = [...world.entities.values()].find((e) =>
      e.kind === 'geyser' && Math.abs(e.x - t.x) + Math.abs(e.y - t.y) === 1
    ) as Geyser | undefined;

    if (g?.crystal !== null && g?.crystal !== undefined) {
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

function dropCargo(world: World, t: Transport): void {
  if (t.carrying === null) {
    return;
  }

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
  return null;
}
