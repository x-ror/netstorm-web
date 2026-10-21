import type { World } from '../world.js';
import type { Command, CommandError } from '../commands.js';
import type { DeepReadonly, WorldView } from '../view.js';
import { upgradeCost, type Theme, type UnitDef } from '../defs.js';
import {
  DIRS,
  BUILD_SECONDS,
  MAX_FACING,
  REFUND_SHARE,
  Terrain,
  TPS,
  isBridge,
  oppositeDir,
  OUTPOST,
  MAX_UPGRADES,
  UPGRADE_SECONDS,
  WORKSHOP_SLOTS,
  type Building,
} from '../state.js';
import { connectedToTemple, friendlyGround, joins, shakeBridges } from './bridges.js';
import { damage, removeBuilding } from './combat.js';
import { homeIsland } from './capture.js';
import { feed, unitValue } from './geysers.js';
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

    if (b.rising > 0) {
      continue;
    }

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

  // "Outposts are only available in multiplayer games": a side has to be given them.
  if (def.id === OUTPOST && !player.tech.has(OUTPOST)) {
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

  const site = TRANSPORTS.has(def.cls)
    ? transportSiteError(world, command.player, command.x, command.y)
    : siteError(world, command.player, def, command.x, command.y);

  if (site) {
    return site;
  }

  if (PRIEST_BUILT.has(def.cls) && !builderPath(world, command.player, def, command.x, command.y)) {
    return 'priest unavailable';
  }

  return hasEnergy(world, command.player, def, command.x, command.y) ? null : 'no energy';
}

/** "Use your High Priest to build Temples, Workshops, and Altars": the building is laid as a site
 * and "the Priest will walk to it and begin construction". */
const PRIEST_BUILT: ReadonlySet<string> = new Set(['Energy', 'Production', 'Altar']);

/**
 * The way of the player's Priest to a cell beside the site. "Your Priest must be able to walk to
 * the build location", and he "cannot construct buildings while immobilized".
 */
function builderPath(
  world: WorldView,
  player: number,
  def: UnitDef,
  x: number,
  y: number,
): [number, number][] | null {
  const p = world.priestOf(player);

  if (!p || p.state !== 'normal') {
    return null;
  }

  const beside = (cx: number, cy: number) =>
    cx >= x - 1 && cx <= x + def.footX && cy >= y - 1 && cy <= y + def.footY
    && (cx < x || cx >= x + def.footX || cy < y || cy >= y + def.footY);

  return world.findPath(player, p.x, p.y, (cell) => beside(cell[0], cell[1]), true);
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
  'Aerial Transport',
]);

/** Classes that are made as a unit that moves, on a free cell of the player's island. */
const TRANSPORTS: ReadonlySet<string> = new Set(['Ground Transport', 'Aerial Transport']);

/** "Temples allow you to create Golems"; every other unit comes from "a Workshop of the appropriate
 * Fury alignment" that has it in one of its Production Slots: "Sun units in Sun Workshops, Thunder
 * units in Thunder Workshops". A destroyed Workshop takes that ability with it. What the Priest
 * builds needs no Workshop. */
export function makerError(world: WorldView, player: number, def: UnitDef): CommandError | null {
  if (def.level === 0 || PRIEST_BUILT.has(def.cls)) {
    return null;
  }

  if (def.id === GOLEM) {
    return world.templeOf(player)
      ? null
      : 'no temple';
  }

  const workshops = workshopsFor(world, player, def);

  if (workshops.length === 0) {
    return 'no workshop';
  }

  return !takesSlot(def) || workshops.some((b) => b.slots.includes(def.id))
    ? null
    : 'not in production';
}

/** The player's finished Workshops of the unit's Fury (a unit of no Fury counts as Sun's). */
function workshopsFor(world: WorldView, player: number, def: UnitDef) {
  const fury = def.theme ?? 'sun';
  return world.buildingsOf(player).filter((b) => {
    const maker = world.def(b.type);
    return maker.cls === 'Production' && maker.theme === fury && b.rising === 0;
  });
}

/** Whether a unit has to be put into a Production Slot before it is built. Generators stand apart
 * from the units in the original's Workshop menu ("a line seperator between generators and
 * units", DevLog); that they take no slot is our reading (`?`). */
export function takesSlot(def: UnitDef): boolean {
  return def.level > 0 && def.id !== GOLEM && !PRIEST_BUILT.has(def.cls)
    && def.group !== 'battery' && BUILDABLE.has(def.cls);
}

/** Where the Storm Power Stream of a unit comes from: the nearest of the player's Workshops that
 * make it ("a Storm Power Stream streaks from the Workshop to the build site"), or the Temple for
 * a Golem. Null for what the Priest builds or when nothing makes it. */
export function makerOf(
  world: WorldView,
  player: number,
  type: string,
  x: number,
  y: number,
): DeepReadonly<Building> | null {
  const def = world.defs.get(type);

  if (!def || def.level === 0 || PRIEST_BUILT.has(def.cls)) {
    return null;
  }

  if (def.id === GOLEM) {
    return world.templeOf(player) ?? null;
  }

  const away = (b: DeepReadonly<Building>) =>
    (b.x + b.fx / 2 - x - def.footX / 2) ** 2 + (b.y + b.fy / 2 - y - def.footY / 2) ** 2;
  return workshopsFor(world, player, def)
    .filter((b) => !takesSlot(def) || b.slots.includes(def.id))
    .sort((a, b) => away(a) - away(b) || a.id - b.id)[0] ?? null;
}

/** Why a unit cannot be put into a free Production Slot of the Workshop, or null. "Each Workshop
 * can only build the units corresponding to its alignment", and only what the player knows. */
export function canProduce(
  world: WorldView,
  command: { player: number; workshop: number; type: string; },
): CommandError | null {
  const b = world.entities.get(command.workshop);
  const maker = b?.kind === 'building' ? world.defs.get(b.type) : undefined;
  const def = world.defs.get(command.type);

  if (
    b?.kind !== 'building' || !maker || maker.cls !== 'Production' || b.owner !== command.player
    || b.rising > 0
  ) {
    return 'bad target';
  }

  if (!def || !takesSlot(def) || (def.theme ?? 'sun') !== maker.theme) {
    return 'cannot build';
  }

  if (!world.players.get(command.player)?.tech.has(def.id)) {
    return 'unknown tech';
  }

  if (b.slots.includes(def.id)) {
    return 'bad target';
  }

  return b.slots.length < WORKSHOP_SLOTS + b.upgrades ? null : 'no free slot';
}

/** "Once you've chosen what a Workshop will build, you can't change it." */
export function produce(
  world: World,
  c: Extract<Command, { t: 'produce'; }>,
): CommandError | null {
  const error = canProduce(world, c);

  if (error) {
    return error;
  }

  world.building(c.workshop)!.slots.push(c.type);
  world.emit({ what: 'produce', who: c.player, data: { workshop: c.workshop, type: c.type } });
  return null;
}

/** Why the Workshop cannot be Upgraded now, or null. */
export function canUpgrade(
  world: WorldView,
  command: { player: number; workshop: number; },
): CommandError | null {
  const b = world.entities.get(command.workshop);

  if (
    b?.kind !== 'building' || world.defs.get(b.type)?.cls !== 'Production'
    || b.owner !== command.player || b.rising > 0
  ) {
    return 'bad target';
  }

  if (b.upgrades >= MAX_UPGRADES) {
    return 'fully upgraded';
  }

  // "alreadyUpgrading": one at a time.
  if (b.upgrading > 0) {
    return 'not ready';
  }

  return (world.players.get(command.player)?.storm ?? 0) < upgradeCost(world.def(b.type))
    ? 'no storm power'
    : null;
}

/** "To get more Production Slots in a Workshop you may Upgrade it by paying Storm Power." It is paid
 * at once and done UPGRADE_SECONDS later. */
export function upgradeWorkshop(
  world: World,
  c: Extract<Command, { t: 'upgradeWorkshop'; }>,
): CommandError | null {
  const error = canUpgrade(world, c);

  if (error) {
    return error;
  }

  const b = world.building(c.workshop)!;
  world.players.get(c.player)!.storm -= upgradeCost(world.def(b.type));
  b.upgrading = UPGRADE_SECONDS * TPS;
  return null;
}

/** The Upgrade is done: a slot more, and the Workshop is whole again ("Upgrading!" in Factory.cpp
 * sets its hit points to full). */
export function tickUpgrade(world: World, b: Building): void {
  if (b.upgrading === 0 || --b.upgrading > 0) {
    return;
  }

  b.upgrades++;

  // An Altar's Upgrade ends with the ring of its new Level (dais.cpp, notifySacrificeDone).
  if (world.def(b.type).cls === 'Altar') {
    world.emit({
      what: 'altar upgrade',
      who: b.owner,
      data: { altar: b.id, level: b.upgrades + 1 },
    });
    return;
  }

  b.hp = b.hpMax;
  world.emit({ what: 'upgrade', who: b.owner, data: { workshop: b.id, level: b.upgrades + 1 } });
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
  if (
    !world.inside(x, y) || world.occupant[world.at(x, y)] || world.priestAt(x, y)
    || world.residenceAt(x, y)
  ) {
    return 'blocked';
  }

  // On ground of his own or of an ally ("Only on Controlled Island").
  return world.terrain[world.at(x, y)] === Terrain.Island && friendlyGround(world, player, x, y)
    ? null
    : 'blocked';
}

/** The letter of a Fury's Energy; Sun's stands for any. */
const LETTERS: Record<Theme, string> = { wind: 'w', rain: 'r', thunder: 't', sun: 's' };
const ANY = 's';
/** "Temples now provide 2 themed mana" (DevLog 415); a computer's Temple 1 (FUN_00404e10). */
const TEMPLE_ENERGY = 2;
const AI_TEMPLE_ENERGY = 1;

/**
 * The Energy a unit needs, one letter an icon on its card (FUN_004c6250): of level 1 its Fury's,
 * of level 2 one more of any, of level 3 its Fury's twice and one of any. The Generators and the
 * Outpost need one of any (`mana = "s"`), and what has no group none.
 */
export function energyNeed(def: UnitDef): string {
  if (def.group === 'battery' || def.id === OUTPOST) {
    return ANY;
  }

  if (def.group === '' || def.theme === null || def.level <= 0) {
    return '';
  }

  const own = LETTERS[def.theme];

  if (def.level === 1) {
    return own;
  }

  // oxlint-disable-next-line no-magic-numbers -- level 2
  return def.level === 2 ? own + ANY : own + own + ANY;
}

/**
 * Whether Temples and Generators of the player and his allies cover the site with the Energy the
 * unit needs (FUN_0048f7c0, FUN_0048fab0). A Temple gives two of its Fury, a Generator one, the
 * Sun Generator one of Sun. A Fury's icon takes a source of that Fury; the "any" icon a Sun one
 * first, else any left. Nothing is used up: one source serves every unit. A source covers the
 * site when the distance between their middles is below the range, widened by half the
 * diagonal of the unit's footprint.
 */
function hasEnergy(world: WorldView, player: number, def: UnitDef, x: number, y: number): boolean {
  const need = energyNeed(def);

  if (!need) {
    return true;
  }

  const reach = world.energyRange ** 2 + (def.footX * def.footX) / 2;
  const sources: string[] = [];

  for (const b of world.entities.values()) {
    if (b.kind !== 'building' || b.rising > 0 || !b.owner || world.hostile(player, b.owner)) {
      continue;
    }

    const source = world.def(b.type);
    const temple = world.players.get(b.owner)?.ai ? AI_TEMPLE_ENERGY : TEMPLE_ENERGY;
    const count = source.cls === 'Energy' ? temple : Number(source.group === 'battery');
    const dx = b.x + b.fx / 2 - (x + def.footX / 2);
    const dy = b.y + b.fy / 2 - (y + def.footY / 2);

    if (count && source.theme && dx * dx + dy * dy < reach) {
      sources.push(...Array.from({ length: count }, () => LETTERS[source.theme!]));
    }
  }

  for (const icon of need) {
    const at = icon === ANY
      ? (sources.includes(ANY) ? sources.indexOf(ANY) : sources.length - 1)
      : sources.indexOf(icon);

    if (at < 0) {
      return false;
    }

    sources.splice(at, 1);
  }

  return true;
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
  let joined: Uint8Array | null | undefined;
  const allied = (x: number, y: number) => {
    const owner = world.owner[world.at(x, y)]!;
    return owner !== 0 && owner !== player && !world.hostile(player, owner);
  };

  for (let y = y0; y < y0 + def.footY; y++) {
    for (let x = x0; x < x0 + def.footX; x++) {
      if (
        !world.inside(x, y) || world.occupant[world.at(x, y)] || world.priestAt(x, y)
        || world.residenceAt(x, y)
      ) {
        return 'blocked';
      }

      const terrain = world.terrain[world.at(x, y)];

      if (
        isBridge(terrain) || terrain === Terrain.EdgeFarm
        || (terrain === Terrain.Island && !world.isOwnGround(player, x, y)
          // An ally's island takes the unit if his ground joins it to the player's own.
          && !(allied(x, y)
            && (joined ??= connectedToTemple(world, player))?.[world.at(x, y)] === 1)
          // An Outpost may also go up on an island nobody owns, which is how it is taken.
          && !(def.id === OUTPOST && world.owner[world.at(x, y)] === 0))
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

  // Only a unit that makes an islet for itself can stand off a bridge.
  if (sky !== def.footX * def.footY || !def.createsIsland) {
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
  if (TRANSPORTS.has(def.cls)) {
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

  // The way is looked for before the site takes up its cells; the Priest stops when it is cut.
  const way = PRIEST_BUILT.has(def.cls) ? builderPath(world, c.player, def, c.x, c.y) : null;
  const b = world.spawnBuilding(def.id, c.player, c.x, c.y, c.facing ?? 0);
  b.islet = islet;

  // An Altar on the home island is of the Level the player keeps between battles.
  if (def.cls === 'Altar' && homeIsland(world, c.player).has(world.at(c.x, c.y))) {
    b.upgrades = world.players.get(c.player)!.altarLevel - 1;
  }

  // Its hit points grow with the work, from next to nothing to all of them.
  b.rising = BUILD_SECONDS * TPS;
  b.hp = 1;
  const priest = world.priestOf(c.player);

  if (way && priest) {
    b.builder = priest.id;
    priest.path = way;
    priest.goal = 'build';
    priest.target = b.id;
  }

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
  feed(world, unitValue(world, unit) - refund);
  return null;
}

/** What a Meltdown deals to each enemy unit beside the Generator. Invented (`?`): the help says
 * only that it will "slightly damage enemy units". */
const MELTDOWN_DAMAGE = 100;

/**
 * "You can cause Generators to Meltdown to slightly damage enemy units or break through bridges";
 * "Sun Generators ... will never Meltdown". The original offers it for a Generator of the player's
 * own that has more than half of its hit points (netstorm.game 10.82). The Generator is lost, the
 * bridge around it falls, and every enemy unit within a cell of it is hurt.
 */
export function meltdown(
  world: World,
  c: Extract<Command, { t: 'meltdown'; }>,
): CommandError | null {
  const b = world.building(c.target);
  const def = b && world.def(b.type);

  if (
    !b || !def || b.owner !== c.player || def.group !== 'battery' || def.theme === 'sun'
    || b.rising > 0 || b.hp * 2 <= b.hpMax
  ) {
    return 'bad target';
  }

  removeBuilding(world, b);
  // Twice: sound bridge beside it cracks, and cracked bridge falls.
  shakeBridges(world, b);
  shakeBridges(world, { ...b, islet: false });

  for (const e of world.entities.values()) {
    const width = e.kind === 'building' ? e.fx : 1;
    const height = e.kind === 'building' ? e.fy : 1;
    const beside = e.x + width >= b.x && e.x <= b.x + b.fx && e.y + height >= b.y
      && e.y <= b.y + b.fy;

    if (beside && 'owner' in e && world.hostile(b.owner, e.owner)) {
      damage(world, b.owner, e, MELTDOWN_DAMAGE);
    }
  }

  world.emit({ what: 'destroyed', who: b.owner, data: { id: b.id, type: b.type } });
  return null;
}
