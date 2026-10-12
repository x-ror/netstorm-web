import type { World } from '../world.js';
import type { Command, CommandError } from '../commands.js';
import type { WorldView } from '../view.js';
import type { UnitDef } from '../defs.js';
import {
  DIRS,
  ENERGY_RANGE,
  MAX_FACING,
  REFUND_SHARE,
  Terrain,
  TPS,
  isBridge,
  oppositeDir,
} from '../state.js';
import { joins, shakeBridges } from './bridges.js';
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

  if (!BUILDABLE.has(def.cls)) {
    return 'cannot build';
  }

  const maker = makerError(world, command.player, def);

  if (maker) {
    return maker;
  }

  if (player.storm < def.cost) {
    return 'no storm power';
  }

  if (player.refresh.some((entry) => entry.type === def.id)) {
    return 'not ready';
  }

  const site = def.cls === 'Ground Transport'
    ? transportSiteError(world, command.player, command.x, command.y)
    : siteError(world, command.player, def, command.x, command.y);

  if (site) {
    return site;
  }

  return def.level > 0 && !hasEnergy(world, command.player, def, command.x, command.y)
    ? 'no energy'
    : null;
}

/** Classes a player can put down. Aerial units, spells, geysers and the High Priest have no rules
 * here yet, so building them is refused rather than making a static building of them. */
const BUILDABLE = new Set<string>([
  'Shooter',
  'Defense',
  'Anti-Air',
  'Source of Energy',
  'Air Attack Base',
  'Production',
  'Energy',
  'Altar',
  'Residence',
  'Ground Transport',
]);

/** "Temples allow you to create Golems"; every other unit comes from "a Workshop of the appropriate
 * Fury alignment", and a destroyed Workshop takes that ability with it. Sun units would need a Sun
 * Workshop, but no player starts with one and the help also puts the first Disc Throwers and Sun
 * Cannons "into production with your first Workshop", so Sun units other than the Golem are not
 * held to it yet (see docs/game-rules.md). Production slots are not modelled. */
function makerError(world: WorldView, player: number, def: UnitDef): CommandError | null {
  if (def.level === 0) {
    return null;
  }

  if (def.id === GOLEM) {
    return world.templeOf(player)
      ? null
      : 'no temple';
  }

  if (!def.theme || def.theme === 'sun') {
    return null;
  }

  return world.buildingsOf(player).some((b) => {
      const maker = world.def(b.type);
      return maker.cls === 'Production' && maker.theme === def.theme;
    })
    ? null
    : 'no workshop';
}

const GOLEM = 'sunwalker';

/** A transport is laid on a cell of the player's own island that no building or priest takes up.
 * Whether the original also lets one be laid on a bridge or off its end is unknown (`?`). */
function transportSiteError(
  world: WorldView,
  player: number,
  x: number,
  y: number,
): CommandError | null {
  if (!world.inside(x, y) || world.occupant[world.at(x, y)]) {
    return 'blocked';
  }

  return world.terrain[world.at(x, y)] === Terrain.Island && world.isOwnGround(player, x, y)
    ? null
    : 'blocked';
}

/** Energy icons on a unit's card, by level. Read from the game for Sun units of level 1 (Sun Cannon,
 * Golem: one) and level 2 (Whirlibase: two). The own/any split for the Furies' units and all of
 * level 3 follow the same pattern but are not yet confirmed in the game. */
function energyNeed(level: number): { own: number; any: number; } {
  if (level <= 1) {
    return { own: 1, any: 0 };
  }

  return level === 2 ? { own: 1, any: 1 } : { own: 2, any: 1 };
}

/** Each Temple or Generator whose circle covers the build site supplies one Energy. A unit needs
 * `own` of its own alignment plus `any` more of whatever kind; Sun units accept any kind for both,
 * and the "sun-only" Sun Generator feeds nothing but Sun units. */
function hasEnergy(world: WorldView, player: number, def: UnitDef, x: number, y: number): boolean {
  const need = energyNeed(def.level);
  let own = 0;
  let total = 0;

  for (const b of world.buildingsOf(player)) {
    const source = world.def(b.type);

    if (source.cls !== 'Energy' && source.group !== 'battery') {
      continue;
    }

    // Centre to centre; which point of the unit the original tests against the circle is unknown.
    const dx = b.x + b.fx / 2 - (x + def.footX / 2);
    const dy = b.y + b.fy / 2 - (y + def.footY / 2);

    if (dx * dx + dy * dy > ENERGY_RANGE * ENERGY_RANGE) {
      continue;
    }

    if (def.theme === 'sun') {
      own++;
      total++;
    } else if (source.theme !== 'sun') {
      total++;

      if (source.theme === def.theme) {
        own++;
      }
    }
  }

  return own >= need.own && total >= need.own + need.any;
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
        isBridge(terrain)
        || (terrain === Terrain.Island && !world.isOwnGround(player, x, y))
      ) {
        return 'blocked';
      }

      if (terrain !== Terrain.Sky) {
        continue;
      }

      sky++;

      // "Stationary units are placed at the end of bridges": the bridge cell beside the unit has
      // to join on the side that faces it, as it would for another piece.
      for (const [dir, [dx, dy]] of DIRS.entries()) {
        const nx = x + dx;
        const ny = y + dy;

        if (
          world.isOwnGround(player, nx, ny)
          && isBridge(world.terrain[world.at(nx, ny)])
          && joins(world, world.at(nx, ny), oppositeDir(dir))
        ) {
          offBridge = true;
        }
      }
    }
  }

  // Either entirely on own island, or entirely in the sky at an open end of an own bridge.
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
  pl.refresh.push({ type: def.id, ticks: world.unitRate * TPS });

  // "When a Workshop creates a unit ... the unit will be created on the spot": a transport walks
  // away from where it was laid.
  if (def.cls === 'Ground Transport') {
    const transport = world.spawnTransport(def.id, c.player, c.x, c.y);
    world.emit({ what: 'build', who: c.player, data: { id: transport.id, type: def.id } });
    return null;
  }

  // A unit laid off a bridge stands on an island of its own, from which more bridge can be built.
  const islet = world.terrain[world.at(c.x, c.y)] === Terrain.Sky;

  if (islet) {
    for (let y = c.y; y < c.y + def.footY; y++) {
      for (let x = c.x; x < c.x + def.footX; x++) {
        world.terrain[world.at(x, y)] = Terrain.Island;
        world.owner[world.at(x, y)] = c.player;
      }
    }

    world.invalidateTerrain();
  }

  const b = world.spawnBuilding(def.id, c.player, c.x, c.y, c.facing ?? 0);
  b.islet = islet;
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
    shakeBridges(world, unit);
  } else {
    removeTransport(world, unit);
  }

  world.players.get(c.player)!.storm += refund;
  world.emit({ what: 'salvaged', who: c.player, data: { id: unit.id, type: unit.type, refund } });
  return null;
}
