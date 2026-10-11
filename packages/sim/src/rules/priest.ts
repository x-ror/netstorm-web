import type { Command, CommandError } from '../commands.js';
import type { World } from '../world.js';
import { TPS, type Priest } from '../state.js';
import { advance } from './movement.js';

export function tickPriest(world: World, p: Priest): void {
  if (p.state === 'carried') {
    const by = p.carriedBy === null ? undefined : world.entities.get(p.carriedBy);

    if (!by || by.kind !== 'priest' || by.carrying !== p.id) {
      throw new Error(`Invalid carrier for priest ${p.id}`);
    }

    p.x = by.x;
    p.y = by.y;
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

  advance(world, p, 1.8);
}

export function movePriest(
  world: World,
  c: Extract<Command, { t: 'movePriest'; }>,
): CommandError | null {
  const p = world.priestOf(c.player);

  if (!p || p.state !== 'normal') {
    return 'priest unavailable';
  }

  const path = world.findPath(c.player, p.x, p.y, (cell) => cell[0] === c.x && cell[1] === c.y);

  if (!path) {
    return 'no path';
  }

  p.path = path;
  return null;
}

export function pickupPriest(
  world: World,
  c: Extract<Command, { t: 'pickupPriest'; }>,
): CommandError | null {
  const me = world.priestOf(c.player);
  const tgt = world.entities.get(c.target);

  if (
    !me
    || me.state !== 'normal'
    || me.carrying !== null
    || !tgt
    || tgt.kind !== 'priest'
    || tgt.owner === c.player
    || tgt.carrying !== null
  ) {
    return 'bad target';
  }

  if (tgt.state !== 'down') {
    return 'target not incapacitated';
  }

  if (Math.abs(me.x - tgt.x) + Math.abs(me.y - tgt.y) > 1) {
    return 'too far';
  }

  tgt.state = 'carried';
  tgt.carriedBy = me.id;
  me.carrying = tgt.id;
  world.occupant[world.at(tgt.x, tgt.y)] = 0;
  world.emit({ what: 'captured', who: c.player, data: { priest: tgt.id } });
  return null;
}

export function sacrifice(
  world: World,
  c: Extract<Command, { t: 'sacrifice'; }>,
): CommandError | null {
  const me = world.priestOf(c.player);

  if (!me || me.carrying === null) {
    return 'nothing to sacrifice';
  }

  const altar = world.buildingsOf(c.player).find((b) => world.def(b.type).cls === 'Altar');

  if (!altar || !world.adjacentTo(me.x, me.y, altar)) {
    return 'not at altar';
  }

  const victim = world.entities.get(me.carrying);

  if (
    !victim
    || victim.kind !== 'priest'
    || victim.state !== 'carried'
    || victim.carriedBy !== me.id
  ) {
    throw new Error(`Invalid sacrifice target for priest ${me.id}`);
  }

  const loser = world.players.get(victim.owner);

  if (!loser) {
    throw new Error(`Unknown player ${victim.owner}`);
  }

  loser.alive = false;
  world.entities.delete(victim.id);
  me.carrying = null;
  world.emit({ what: 'sacrifice', who: c.player, data: { victim: victim.owner } });
  const alive = [...world.players.values()].filter((p) => p.alive);

  if (alive.length === 1) {
    world.winner = alive[0]!.id;
    world.emit({ what: 'victory', who: world.winner });
  }

  return null;
}
