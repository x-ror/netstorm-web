import type { World } from '../world.js';
import type { Command, CommandError } from '../commands.js';
import type { WorldView } from '../view.js';
import { energyNeed } from '../defs.js';
import { MAX_FACING } from '../state.js';

export function energy(world: WorldView, p: number): { own: number; total: number; } {
  const pl = world.players.get(p);

  if (!pl) {
    throw new Error(`Unknown player ${p}`);
  }

  let own = 0;
  let other = 0;

  for (const b of world.buildingsOf(p)) {
    const d = world.def(b.type);
    let n = 0;

    if (d.cls === 'Energy') {
      n = 2;
    } else if (d.group === 'battery') {
      n = 1;
    }

    if (!n) {
      continue;
    }

    if (d.theme === pl.theme || d.theme === 'sun') {
      own += n;
    } else {
      other += n;
    }
  }

  return { own, total: own + other };
}

export function canBuild(
  world: WorldView,
  command: { player: number; type: string; x: number; y: number; facing?: number; },
): CommandError | null {
  const player = world.players.get(command.player);

  if (!player || !player.alive) {
    return 'no player';
  }

  if (world.winner !== null) {
    return 'game over';
  }

  if (!world.inside(command.x, command.y)) {
    return 'bad coordinates';
  }

  if (
    command.facing !== undefined
    && (!Number.isInteger(command.facing) || command.facing < 0 || command.facing > MAX_FACING)
  ) {
    return 'bad facing';
  }

  const def = world.defs.get(command.type.toLowerCase());

  if (!def) {
    return 'unknown unit';
  }

  if (!player.tech.has(def.id) && def.level > 0) {
    return 'unknown tech';
  }

  if (player.storm < def.cost) {
    return 'no storm power';
  }

  if (def.level > 0) {
    const need = energyNeed(def);
    const have = world.energy(command.player);

    if (have.own < need.own || have.total < need.own + need.any) {
      return 'no energy';
    }
  }

  for (let y = command.y; y < command.y + def.footY; y++) {
    for (let x = command.x; x < command.x + def.footX; x++) {
      if (!world.isOwnGround(command.player, x, y) || world.occupant[world.at(x, y)]) {
        return 'blocked';
      }
    }
  }

  return null;
}

export function build(world: World, c: Extract<Command, { t: 'build'; }>): CommandError | null {
  const pl = world.players.get(c.player)!;

  const error = world.canBuild(c);

  if (error) {
    return error;
  }

  const def = world.def(c.type);
  pl.storm -= def.cost;
  const b = world.spawnBuilding(def.id, c.player, c.x, c.y, c.facing ?? 0);
  world.emit({ what: 'build', who: c.player, data: { id: b.id, type: def.id } });
  return null;
}
