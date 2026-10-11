import type { Command, CommandError } from '../commands.js';
import type { World } from '../world.js';
import {
  RUNES,
  RUNE_INTERVAL,
  Terrain,
  type Building,
  type Priest,
  type Transport,
} from '../state.js';

const RELEASE_SEARCH_RADIUS = 16;

function ownAltar(world: World, owner: number): Building | undefined {
  return world.buildingsOf(owner).find((b) => world.def(b.type).cls === 'Altar');
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

        if (world.terrain[i] !== Terrain.Sky && !world.occupant[i]) {
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
  world.occupant[world.at(fx, fy)] = p.id;
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
  ) {
    return 'bad target';
  }

  if (p.state !== 'down') {
    return 'target not incapacitated';
  }

  if (!ownAltar(world, c.player)) {
    return 'no altar';
  }

  const path = world.findPath(c.player, t.x, t.y,
    (cell) => Math.abs(cell[0] - p.x) + Math.abs(cell[1] - p.y) <= 1);

  if (!path) {
    return 'no path';
  }

  t.path = path;
  t.goal = 'capture';
  t.target = p.id;
  return null;
}

/** Transport reached the priest it was sent for. */
export function arriveAtPriest(world: World, t: Transport): void {
  const p = t.target === null ? undefined : world.entities.get(t.target);
  const altar = ownAltar(world, t.owner);

  // A priest that regenerated above half of his Hit Points resists being captured.
  if (
    !p
    || p.kind !== 'priest'
    || p.state !== 'down'
    || Math.abs(p.x - t.x) + Math.abs(p.y - t.y) > 1
    || !altar
  ) {
    stop(t);
    return;
  }

  const path = world.findPath(t.owner, t.x, t.y,
    (cell) => world.adjacentTo(cell[0], cell[1], altar));

  if (!path) {
    stop(t);
    return;
  }

  // Picking up is instant here; how long it takes in the original is unknown.
  world.occupant[world.at(p.x, p.y)] = 0;
  p.state = 'carried';
  p.carriedBy = t.id;
  p.path = [];
  t.carrying = p.id;
  t.path = path;
  t.goal = 'altar';
  t.target = altar.id;
  world.emit({ what: 'captured', who: t.owner, data: { priest: p.id } });
}

/** Transport carrying a priest reached the end of its way to the altar. */
export function arriveAtAltar(world: World, t: Transport): void {
  const p = t.carrying === null ? undefined : world.entities.get(t.carrying);

  if (!p || p.kind !== 'priest') {
    throw new Error(`Missing captive for transport ${t.id}`);
  }

  const altar = t.target === null ? undefined : world.building(t.target);

  // The altar is gone or the way to it was cut: the transport lets the priest go.
  if (!altar || altar.owner !== t.owner || !world.adjacentTo(t.x, t.y, altar)) {
    t.carrying = null;
    stop(t);
    releasePriest(world, p, t.x, t.y);
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
    completeSacrifice(world, p, altar.owner);
  }
}

function completeSacrifice(world: World, victim: Priest, by: number): void {
  const loser = world.players.get(victim.owner);

  if (!loser) {
    throw new Error(`Unknown player ${victim.owner}`);
  }

  loser.alive = false;
  world.entities.delete(victim.id);
  world.emit({ what: 'sacrifice', who: by, data: { victim: victim.owner } });
  const alive = [...world.players.values()].filter((player) => player.alive);

  if (alive.length === 1) {
    world.winner = alive[0]!.id;
    world.emit({ what: 'victory', who: world.winner });
  }
}
