import type { World } from '../world.js';
import type { Command, CommandError } from '../commands.js';
import type { WorldView } from '../view.js';
import type { UnitDef } from '../defs.js';
import { DIRS, ENERGY_RANGE, MAX_FACING, REFUND_SHARE, Terrain } from '../state.js';
import { removeBuilding } from './combat.js';
import { removeTransport } from './movement.js';

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

  const site = siteError(world, command.player, def, command.x, command.y);

  if (site) {
    return site;
  }

  return def.level > 0 && !hasEnergy(world, command.player, def, command.x, command.y)
    ? 'no energy'
    : null;
}

/** A unit needs Energy of its own alignment from a Temple or Generator nearby; Sun units accept any.
 * How much each unit needs is shown in the game by icons and is not in the help, so one source is
 * enough here. */
function hasEnergy(world: WorldView, player: number, def: UnitDef, x: number, y: number): boolean {
  for (const b of world.buildingsOf(player)) {
    const source = world.def(b.type);

    if (source.cls !== 'Energy' && source.group !== 'battery') {
      continue;
    }

    // The Sun Generator is "sun-only"; every other source also feeds Sun units.
    const feeds = def.theme === 'sun' || source.theme === def.theme;
    const dx = Math.max(b.x - (x + def.footX - 1), 0, x - (b.x + b.fx - 1));
    const dy = Math.max(b.y - (y + def.footY - 1), 0, y - (b.y + b.fy - 1));

    if (feeds && Math.max(dx, dy) <= ENERGY_RANGE) {
      return true;
    }
  }

  return false;
}

/** "You can build units on your home island, on any un-owned island connected by bridges, or off of
 * any bridge that you own" — but "never directly on" a bridge. A unit laid off a bridge gets an
 * island of its own. */
function siteError(
  world: WorldView,
  player: number,
  def: UnitDef,
  x0: number,
  y0: number,
): CommandError | null {
  let sky = 0;
  let offBridge = false;

  for (let y = y0; y < y0 + def.footY; y++) {
    for (let x = x0; x < x0 + def.footX; x++) {
      if (!world.inside(x, y) || world.occupant[world.at(x, y)]) {
        return 'blocked';
      }

      const terrain = world.terrain[world.at(x, y)];

      if (
        terrain === Terrain.Bridge
        || (terrain === Terrain.Island && !world.isOwnGround(player, x, y))
      ) {
        return 'blocked';
      }

      if (terrain !== Terrain.Sky) {
        continue;
      }

      sky++;

      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;

        if (
          world.isOwnGround(player, nx, ny) && world.terrain[world.at(nx, ny)] === Terrain.Bridge
        ) {
          offBridge = true;
        }
      }
    }
  }

  // Either entirely on own island, or entirely in the sky next to an own bridge.
  if (sky === 0) {
    return null;
  }

  if (sky !== def.footX * def.footY) {
    return 'blocked';
  }

  return offBridge ? null : 'not connected';
}

export function build(world: World, c: Extract<Command, { t: 'build'; }>): CommandError | null {
  const pl = world.players.get(c.player)!;

  const error = world.canBuild(c);

  if (error) {
    return error;
  }

  const def = world.def(c.type);
  pl.storm -= def.cost;

  // A unit laid off a bridge stands on an island of its own, from which more bridge can be built.
  if (world.terrain[world.at(c.x, c.y)] === Terrain.Sky) {
    for (let y = c.y; y < c.y + def.footY; y++) {
      for (let x = c.x; x < c.x + def.footX; x++) {
        world.terrain[world.at(x, y)] = Terrain.Island;
        world.owner[world.at(x, y)] = c.player;
      }
    }

    world.invalidateTerrain();
  }

  const b = world.spawnBuilding(def.id, c.player, c.x, c.y, c.facing ?? 0);
  world.emit({ what: 'build', who: c.player, data: { id: b.id, type: def.id } });
  return null;
}

/** "You may Salvage any unit and recoup 25% of the Storm Power you spent to build it. If the unit has
 * been damaged, you will recoup less... If the damage goes beyond half of the unit's hit points you
 * will recoup no Storm Power at all." Salvaging does not cause an explosion. */
export function salvage(world: World, c: Extract<Command, { t: 'salvage'; }>): CommandError | null {
  const unit = world.entities.get(c.target);

  if (!unit || (unit.kind !== 'building' && unit.kind !== 'transport') || unit.owner !== c.player) {
    return 'bad target';
  }

  const def = world.def(unit.type);
  const refund = unit.hp * 2 < unit.hpMax
    ? 0
    : Math.floor((def.cost * REFUND_SHARE * unit.hp) / unit.hpMax);

  if (unit.kind === 'building') {
    removeBuilding(world, unit);
  } else {
    removeTransport(world, unit);
  }

  world.players.get(c.player)!.storm += refund;
  world.emit({ what: 'salvaged', who: c.player, data: { id: unit.id, type: unit.type, refund } });
  return null;
}
