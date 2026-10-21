import type { Command, CommandError } from '../commands.js';
import type { World } from '../world.js';
import { shakeBridges } from './bridges.js';
import { removeBuilding } from './combat.js';
import type { WorldView } from '../view.js';
import {
  ALTAR_UPGRADE_SECONDS,
  GIFT_STORM,
  GIFT_UPGRADE,
  MAX_ALTAR_UPGRADES,
  SACRIFICE_STORM,
  RUNES,
  RUNE_INTERVAL,
  TPS,
  Terrain,
  W,
  type Building,
  type Priest,
  type Transport,
} from '../state.js';

const RELEASE_SEARCH_RADIUS = 16;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** The cells of island ground joined to a player's Temple: his home island, the one the original
 * keeps from battle to battle (`?` that it is this ground). */
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

/** The Golem, known from the start, is never a gift. */
const GOLEM = 'sunwalker';

/**
 * The units a Sacrifice on the Altar may grant (FUN_00505fe0): of all four Furies, whoever is
 * sacrificed, and exactly of the Altar's Level; those the player knows are shown, not granted.
 */
export function giftsOf(world: WorldView, altar: { upgrades: number; }): string[] {
  const level = altar.upgrades + 1;
  return [...world.defs.values()]
    .filter((def) =>
      def.group !== '' && def.theme !== null && def.level === level
      && def.id !== GOLEM
    )
    .map((def) => def.id);
}

/** Why an Altar cannot take the gift asked, or null. "You will only be able to Upgrade an Altar on
 * your home island" (WarnCantUpgradeAltarOffHomeIsland), and to Level 3 at most. */
function altarGiftError(world: World, altar: Building, gift: string): CommandError | null {
  if (gift === GIFT_STORM) {
    return null;
  }

  if (gift !== GIFT_UPGRADE) {
    if (!giftsOf(world, altar).includes(gift)) {
      return 'unknown unit';
    }

    return world.players.get(altar.owner)!.tech.has(gift) ? 'already known' : null;
  }

  if (altar.upgrades >= MAX_ALTAR_UPGRADES) {
    return 'fully upgraded';
  }

  return homeIsland(world, altar.owner).has(world.at(altar.x, altar.y)) ? null : 'blocked';
}

/** Choose the gift of an Altar's next Sacrifice. */
export function altarGift(
  world: World,
  c: Extract<Command, { t: 'altarGift'; }>,
): CommandError | null {
  const altar = world.building(c.altar);

  if (
    !altar || altar.owner !== c.player || world.def(altar.type).cls !== 'Altar'
    || altar.rising > 0 || altar.upgrading > 0
  ) {
    return 'bad target';
  }

  const error = altarGiftError(world, altar, c.gift);

  if (error) {
    return error;
  }

  altar.gift = c.gift;
  return null;
}

function ownAltar(world: World, owner: number): Building | undefined {
  return world.buildingsOf(owner).find((b) => world.def(b.type).cls === 'Altar' && b.rising === 0);
}

function stop(t: Transport): void {
  t.goal = 'idle';
  t.target = null;
}

/** The Sacrificial Circle holds one priest. */
function captiveOf(world: World, altar: Building): Priest | undefined {
  for (const e of world.entities.values()) {
    if (e.kind === 'priest' && e.chainedAt === altar.id) {
      return e;
    }
  }

  return undefined;
}

/** Nearest free ground cell, scanning rings in row-major order so the result is deterministic. */
function freeCellNear(world: World, x: number, y: number): [number, number] {
  for (let r = 0; r <= RELEASE_SEARCH_RADIUS; r++) {
    for (let cy = y - r; cy <= y + r; cy++) {
      for (let cx = x - r; cx <= x + r; cx++) {
        if (Math.max(Math.abs(cx - x), Math.abs(cy - y)) !== r || !world.inside(cx, cy)) {
          continue;
        }

        const i = world.at(cx, cy);

        if (
          world.terrain[i] !== Terrain.Sky && !world.occupant[i] && !world.priestAt(cx, cy)
        ) {
          return [cx, cy];
        }
      }
    }
  }

  throw new Error(`No free cell near ${x},${y}`);
}

/** "The Priest will be fully healed and un-paralyzed when released by the Transport." */
export function releasePriest(world: World, p: Priest, x: number, y: number): void {
  const [fx, fy] = freeCellNear(world, x, y);
  p.state = 'normal';
  p.hp = p.hpMax;
  p.carriedBy = null;
  p.chainedAt = null;
  p.runes = 0;
  p.runeTimer = 0;
  p.path = [];
  p.move = 0;
  p.x = fx;
  p.y = fy;
  world.emit({ what: 'released', who: p.owner, data: { priest: p.id } });
}

export function capturePriest(
  world: World,
  c: Extract<Command, { t: 'capturePriest'; }>,
): CommandError | null {
  const t = world.entities.get(c.transport);
  const p = world.entities.get(c.target);

  // A Transport cannot carry its owner's Priest, nor a Priest together with a Storm Crystal.
  if (
    !t
    || t.kind !== 'transport'
    || t.owner !== c.player
    || t.carrying !== null
    || !p
    || p.kind !== 'priest'
    || p.owner === c.player
    || p.invisible > 0 // "nothing can be targeted or picked up while it is invisible"
  ) {
    return 'bad target';
  }

  // A mission with `allowAnyCapture` lets a friendly Priest be picked up as he stands and
  // carried home: "bring me to safety by dropping me on your island".
  if (!world.hostile(p.owner, c.player)) {
    if (!world.anyCapture || (p.state !== 'normal' && p.state !== 'down')) {
      return 'bad target';
    }

    if (!world.templeOf(c.player)) {
      return 'no temple';
    }
  } else if (p.state !== 'down') {
    return 'target not incapacitated';
  } else if (!ownAltar(world, c.player)) {
    return 'no altar';
  }

  const path = world.wayOf(t, (cell) => Math.abs(cell[0] - p.x) + Math.abs(cell[1] - p.y) <= 1);

  if (!path) {
    return 'no path';
  }

  t.path = path;
  t.goal = 'capture';
  t.target = p.id;
  return null;
}

/** A friendly Priest set down on the island of whoever carried him is saved: "bring me to safety
 * by dropping me on your island". */
export function hail(world: World, by: number, p: Priest, x: number, y: number): void {
  const home = world.terrain[world.at(x, y)] === Terrain.Island && world.isOwnGround(by, x, y);

  if (home && !world.hostile(by, p.owner) && by !== p.owner) {
    world.emit({ what: 'saved', who: by, data: { priest: p.id, owner: p.owner } });
  }
}

/** Transport reached the priest it was sent for. */
export function arriveAtPriest(world: World, t: Transport): void {
  const p = t.target === null ? undefined : world.entities.get(t.target);
  const friend = p?.kind === 'priest' && !world.hostile(p.owner, t.owner);
  // A friend is taken to the Temple, a captive to the Altar.
  const altar = friend ? world.templeOf(t.owner) : ownAltar(world, t.owner);

  // A priest that regenerated above half of his Hit Points resists being captured.
  if (
    !p
    || p.kind !== 'priest'
    || (friend ? p.state !== 'normal' && p.state !== 'down' : p.state !== 'down')
    || Math.abs(p.x - t.x) + Math.abs(p.y - t.y) > 1
    || !altar
  ) {
    stop(t);
    return;
  }

  const path = world.wayOf(t, (cell) => world.adjacentTo(cell[0], cell[1], altar));

  if (!path) {
    stop(t);
    return;
  }

  // Picking up is instant here; how long it takes in the original is unknown.
  p.state = 'carried';
  p.carriedBy = t.id;
  p.path = [];
  t.carrying = p.id;
  t.path = path;
  t.goal = 'altar';
  t.target = altar.id;
  world.emit({ what: 'captured', who: t.owner, data: { priest: p.id } });
}

/**
 * Hand a captive over from the transport that carries him to another one, which sets off for its
 * owner's altar. Refused, with nothing changed, when that owner has no altar to reach.
 */
export function takeCaptive(world: World, from: Transport, to: Transport, p: Priest): boolean {
  const altar = ownAltar(world, to.owner);
  const path = altar
    && world.wayOf(to, (cell) => world.adjacentTo(cell[0], cell[1], altar));

  if (!altar || !path) {
    return false;
  }

  from.carrying = null;
  p.carriedBy = to.id;
  to.carrying = p.id;
  to.path = path;
  to.goal = 'altar';
  to.target = altar.id;
  return true;
}

/** Transport carrying a priest reached the end of its way to the altar. */
export function arriveAtAltar(world: World, t: Transport): void {
  const p = t.carrying === null ? undefined : world.entities.get(t.carrying);

  if (!p || p.kind !== 'priest') {
    throw new Error(`Missing captive for transport ${t.id}`);
  }

  const altar = t.target === null ? undefined : world.building(t.target);
  const friend = !world.hostile(p.owner, t.owner);

  // The altar is gone or the way to it was cut: the transport lets the priest go. A friend is
  // let go in any case: carried to the Temple, he is set down on the carrier's island and saved.
  if (friend || !altar || altar.owner !== t.owner || !world.adjacentTo(t.x, t.y, altar)) {
    t.carrying = null;
    stop(t);
    releasePriest(world, p, t.x, t.y);
    hail(world, t.owner, p, t.x, t.y);
    return;
  }

  if (captiveOf(world, altar)) {
    return; // wait until the circle is free
  }

  p.state = 'chained';
  p.carriedBy = null;
  p.chainedAt = altar.id;
  p.x = altar.x + (altar.fx >> 1);
  p.y = altar.y + (altar.fy >> 1);
  t.carrying = null;
  stop(t);
  world.emit({ what: 'chained', who: t.owner, data: { priest: p.id, altar: altar.id } });
}

/** One tick of a chained priest: the altar owner's priest wards five runes to complete the Sacrifice. */
export function tickRitual(world: World, p: Priest): void {
  const altar = p.chainedAt === null ? undefined : world.building(p.chainedAt);

  // "When an Altar is destroyed, a captive Priest will go free."
  if (!altar || altar.hp <= 0) {
    releasePriest(world, p, p.x, p.y);
    return;
  }

  const sacrificer = world.priestOf(altar.owner);

  if (!sacrificer) {
    return;
  }

  if (sacrificer.state !== 'normal') {
    // "If he is rendered immobile during the Sacrifice the Spell will be broken and the enemy
    // Priest will escape."
    if (p.runes > 0 || p.runeTimer > 0) {
      releasePriest(world, p, p.x, p.y);
    }

    return;
  }

  // The Sacrifice commences whenever the owner's priest is at the altar; away from it, it pauses.
  if (!world.adjacentTo(sacrificer.x, sacrificer.y, altar)) {
    return;
  }

  if (++p.runeTimer < RUNE_INTERVAL) {
    return;
  }

  p.runeTimer = 0;
  p.runes++;
  world.emit({ what: 'rune', who: altar.owner, data: { priest: p.id, runes: p.runes } });

  if (p.runes >= RUNES) {
    completeSacrifice(world, p, altar);
  }
}

function completeSacrifice(world: World, victim: Priest, altar: Building): void {
  const by = altar.owner;
  const loser = world.players.get(victim.owner);

  if (!loser) {
    throw new Error(`Unknown player ${victim.owner}`);
  }

  loser.alive = false;
  world.entities.delete(victim.id);
  // The gift of the window (FUN_004554d0, FUN_00453f80): a unit known from now on, 5000 Storm
  // Power, or the Altar's Upgrade, which keeps it. Every gift but the Upgrade consumes the Altar
  // and takes the Level kept between battles back to 1. The campaign has no window: 5000.
  const sacrificer = world.players.get(by)!;
  const gift = !world.multiplayer || altarGiftError(world, altar, altar.gift) !== null
    ? GIFT_STORM
    : altar.gift;
  world.emit({ what: 'sacrifice', who: by, data: { victim: victim.owner, gift } });

  if (gift === GIFT_STORM) {
    sacrificer.storm += SACRIFICE_STORM;
  } else if (gift !== GIFT_UPGRADE) {
    sacrificer.tech.add(gift);
  }

  if (gift === GIFT_UPGRADE) {
    sacrificer.altarLevel = altar.upgrades + 2;
    altar.gift = GIFT_STORM;
    altar.upgrading = Math.round(ALTAR_UPGRADE_SECONDS * TPS);
  } else {
    sacrificer.altarLevel = 1;
    // In the original it blows up a few seconds after the last rune.
    removeBuilding(world, altar);
    shakeBridges(world, altar);
  }

  // The battle is over when nobody left standing has an enemy. Of allies who win together, the
  // one who made the sacrifice is named.
  const alive = [...world.players.values()].filter((player) => player.alive);
  const fighting = alive.some((a) => alive.some((b) => world.hostile(a.id, b.id)));

  if (!fighting && alive.length) {
    world.winner = alive.some((player) => player.id === by) ? by : alive[0]!.id;
    world.emit({ what: 'victory', who: world.winner });
  }
}
