import type { Command, CommandError } from '../commands.js';
import type { World } from '../world.js';
import { flies } from '../defs.js';
import { arriveAtObelisk, cast, loseSpell } from './spells.js';
import { arriveAtAltar, arriveAtPriest, hail, releasePriest } from './capture.js';
import { TPS, CRYSTAL_VALUE, Terrain, type Transport, type Priest, type Geyser } from '../state.js';

// From carrier.cpp of netstorm.game 10.82.
const GOLEM = 'sunwalker';
const BULF = 'bulf';
const CRYSTAL_CRAB = 'rainwalker';
/** "The Bulf ... carries two Storm Crystals at a time": it takes both from the geyser at once. */
const BULF_CRYSTALS = 2;

/** Whoever carries crystals: a transport, or the Priest, who "also serves as a Transport". */
type Carrier = Transport | Priest;

const MOVE_SCALE = 100; // fixed-point progress needed to enter the next cell
// A diagonal step is longer by the square root of two, so speed in cells per second stays the same.
// Whether the original slows diagonal steps this way is not established.
const DIAGONAL_SCALE = 141;

/** What stepCost reads: where a walker stands and the cells ahead of it. */
type Walker = Pick<Transport, 'x' | 'y'> & { readonly path: readonly (readonly number[])[]; };

/** Progress needed to step from where the unit stands to the next cell of its path. */
function stepCost(e: Walker): number {
  const next = e.path[0];
  return next && next[0] !== e.x && next[1] !== e.y ? DIAGONAL_SCALE : MOVE_SCALE;
}

/** How far a walker has come towards the next cell of its path, 0 to 1; for drawing. */
export function stepShare(e: Walker & { readonly move: number; }): number {
  return Math.min(1, e.move / stepCost(e));
}

export function advance(world: World, e: Transport | Priest, speed: number): boolean {
  if (!e.path.length) {
    return false;
  }

  e.move += Math.round((speed * MOVE_SCALE) / TPS);

  while (e.path.length && e.move >= stepCost(e)) {
    e.move -= stepCost(e);
    const [x, y] = e.path.shift()!;

    // A priest stops rather than step onto a geyser, an Obelisk or another priest.
    const airborne = e.kind === 'transport' && flies(world.def(e.type));

    if (
      (!airborne && !world.walkable(e.owner, x, y))
      || (e.kind === 'priest' && world.takenBy(x, y))
    ) {
      e.path = [];

      // "Golem are dumb, and they will walk straight off a bridge if it is broken. All other
      // Transports stop before falling to their deaths."
      if (e.kind === 'transport' && e.type === GOLEM && fallsAt(world, x, y)) {
        e.hp = 0;
      }

      return false;
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

/** Cells an Aerial Transport rises before it flies and sinks before it lands: an altitude of 44 at
 * 11 a cell (BalloonProcess, FUN_004acce0). Every trip ends landed. */
const CLIMB_CELLS = 4;

/** An Aerial Transport's take-off and landing, `CLIMB_CELLS / speed` seconds each; true while it
 * keeps it from flying on or from what it came for. */
function climb(t: Transport, speed: number): boolean {
  if (t.climbing > 0) {
    t.climbing--;
    return true;
  }

  if (t.aloft === (t.path.length > 0)) {
    return false;
  }

  t.aloft = !t.aloft;
  t.climbing = Math.max(1, Math.round((CLIMB_CELLS / speed) * TPS));
  t.climbing--;
  return true;
}

const CLOUD_FLOATER = 'rainballoon';
/** A Cloud Floater with a crystal gets a sixtieth of its hit points back every second. */
const MEND_PARTS = 60;

/** "They slowly regenerate while transporting Storm Crystals." */
function mend(world: World, t: Transport): void {
  const cargo = t.carrying === null ? undefined : world.entities.get(t.carrying);

  if (t.type === CLOUD_FLOATER && cargo?.kind === 'crystal' && world.tick % TPS === 0) {
    t.hp = Math.min(t.hpMax, t.hp + Math.floor(t.hpMax / MEND_PARTS));
  }
}

function fallsAt(world: World, x: number, y: number): boolean {
  return world.inside(x, y) && world.terrain[world.at(x, y)] === Terrain.Sky;
}

/**
 * "If it encounters another Transport other than a fellow Crab, it will stun it, and steal what
 * it's carrying, whether Priest or Storm Crystal." A Crab with no cargo (a Spell it may hold) robs
 * an enemy carrier on foot that stands on its cell (FUN_0042cdb0). The victim stops where it is
 * and loses its errand: no stun lasts, its way is only taken from it. From a Bulf with two
 * crystals the Crab takes one. With a crystal the Crab heads for its Temple; with a captive Priest
 * it stays, for its player to send on. It never takes a Spell, nor its owner's own Priest.
 */
function steal(world: World, crab: Transport): void {
  const onFoot = world.priestAt(crab.x, crab.y);
  const victims: Carrier[] = [...world.transportsAt(crab.x, crab.y)];

  if (onFoot?.kind === 'priest') {
    victims.push(onFoot);
  }

  for (const victim of victims) {
    const cargo = victim.carrying === null ? undefined : world.entities.get(victim.carrying);
    // It robs those on foot: a fellow Crab is spared and an Aerial Transport is out of reach.
    const fellow = victim.kind === 'transport'
      && (victim.type === CRYSTAL_CRAB || flies(world.def(victim.type)));

    if (!world.hostile(victim.owner, crab.owner) || fellow || victim.hp <= 0 || !cargo) {
      continue;
    }

    if (cargo.kind === 'priest') {
      if (cargo.owner === crab.owner) {
        continue;
      }

      victim.carrying = null;
      cargo.carriedBy = crab.id;
      crab.carrying = cargo.id;
      crab.path = [];
      stop(crab);
    } else if (cargo.kind === 'crystal') {
      if (cargo.value > CRYSTAL_VALUE) {
        cargo.value -= CRYSTAL_VALUE;
        crab.carrying = world.spawnCrystal(crab, CRYSTAL_VALUE).id;
      } else {
        victim.carrying = null;
        cargo.carriedBy = crab.id;
        crab.carrying = cargo.id;
      }

      crab.target = null;
      goHome(world, crab);
    }

    victim.path = [];
    stop(victim);
    return;
  }
}

export function tickTransport(world: World, t: Transport): void {
  if (t.hp <= 0) {
    removeTransport(world, t);
    world.emit({ what: 'destroyed', who: t.owner, data: { id: t.id, type: t.type } });
    return;
  }

  // "Once you cast the Spell, your Transport will halt in place until the Spell is cast."
  if (t.casting > 0) {
    cast(world, t);
    return;
  }

  const speed = world.def(t.type).speed;

  if (flies(world.def(t.type)) && climb(t, speed)) {
    return;
  }

  advance(world, t, speed);
  mend(world, t);

  if (t.type === CRYSTAL_CRAB && t.carrying === null) {
    steal(world, t);
  }

  if (t.path.length) {
    return;
  }

  if (arrive(world, t)) {
    return;
  }

  if (t.goal === 'obelisk') {
    arriveAtObelisk(world, t);
  } else if (t.goal === 'capture') {
    arriveAtPriest(world, t);
  } else if (t.goal === 'altar') {
    arriveAtAltar(world, t);
  }
}

/** What a carrier of crystals does at the end of its way; false if it was on another errand. */
export function arrive(world: World, t: Carrier): boolean {
  if (t.goal === 'collect') {
    arriveAtGeyser(world, t);
  } else if (t.goal === 'pickup') {
    arriveAtCrystal(world, t);
  } else if (t.goal === 'home') {
    deliver(world, t);
  } else {
    return false;
  }

  return true;
}

/** Take a transport off the map; whatever it carried is left behind. */
export function removeTransport(world: World, t: Transport): void {
  dropCargo(world, t);
  world.entities.delete(t.id);
  loseSpell(world, t.spell);
}

function nextTo(a: { x: number; y: number; }, b: { x: number; y: number; }): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function stop(t: Carrier): void {
  t.goal = 'idle';
  t.target = null;
}

function arriveAtGeyser(world: World, t: Carrier): void {
  const g = t.target === null ? undefined : world.entities.get(t.target);

  // Stopped short of the geyser: the path was cut on the way.
  if (!g || g.kind !== 'geyser' || !nextTo(g, t)) {
    stop(t);
    return;
  }

  if (g.stock <= 0) {
    seekGeyser(world, t);
    return;
  }

  // Taking the crystal is instant here; the help does not say how long it takes in the original.
  // A Bulf takes two when the geyser holds two crystals' worth, else one, and tops one up to two
  // (FUN_0042ba90).
  const held = t.carrying === null ? undefined : world.entities.get(t.carrying);

  if (held?.kind === 'crystal') {
    const more = Math.min(CRYSTAL_VALUE, g.stock);
    g.stock -= more;
    held.value += more;
  } else {
    const crystals = isBulf(t) && g.stock >= BULF_CRYSTALS * CRYSTAL_VALUE ? BULF_CRYSTALS : 1;
    const value = Math.min(crystals * CRYSTAL_VALUE, g.stock);
    g.stock -= value;
    t.carrying = world.spawnCrystal(t, value).id;
  }

  goHome(world, t);

  if (g.stock <= 0 && onIsland(world, g)) {
    vanish(world, g);
  }
}

/** Whether a geyser stands on an island, not on the islet of its own that a geyser in open sky
 * has: there is ground past the three cells of that islet. */
function onIsland(world: World, g: Geyser): boolean {
  const RING = 2;

  for (let dy = -RING; dy <= RING; dy++) {
    for (let dx = -RING; dx <= RING; dx++) {
      const rim = Math.max(Math.abs(dx), Math.abs(dy)) === RING;

      if (
        rim && world.inside(g.x + dx, g.y + dy)
        && world.terrain[world.at(g.x + dx, g.y + dy)] === Terrain.Island
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * A geyser on an island is gone once it is spent, and its ground is free. One in open sky stays
 * as an "Empty Storm Geyser" (emptygeyser.type), which keeps its islet. From the mining code of
 * netstorm.game 10.82: the spent geyser is destroyed, and an empty one is set in its place unless
 * the ground under it is that of an island. Carriers on their way to it look
 * for another; the one that took the last crystal does so after handing it in.
 */
function vanish(world: World, g: Geyser): void {
  world.occupant[world.at(g.x, g.y)] = 0;
  world.entities.delete(g.id);

  for (const e of world.entities.values()) {
    if (
      (e.kind === 'transport' || e.kind === 'priest') && e.target === g.id && e.goal === 'collect'
    ) {
      seekGeyser(world, e);
    }
  }
}

function arriveAtCrystal(world: World, t: Carrier): void {
  const c = t.target === null ? undefined : world.entities.get(t.target);
  t.target = null;

  if (
    !c || c.kind !== 'crystal' || c.carriedBy !== null
    || Math.abs(c.x - t.x) + Math.abs(c.y - t.y) > 1
  ) {
    stop(t);
    return;
  }

  const held = t.carrying === null ? undefined : world.entities.get(t.carrying);

  // A Bulf holding one crystal takes a second off the ground; the two are one load (FUN_00428640).
  if (held?.kind === 'crystal') {
    held.value = BULF_CRYSTALS * CRYSTAL_VALUE;
    world.entities.delete(c.id);
  } else {
    c.carriedBy = t.id;
    t.carrying = c.id;
  }

  goHome(world, t);
}

/** A Bulf that holds a single crystal, which can take one more. */
function bulfWithOne(world: World, t: Carrier): boolean {
  const held = t.carrying === null ? undefined : world.entities.get(t.carrying);
  return isBulf(t) && held?.kind === 'crystal' && held.value <= CRYSTAL_VALUE;
}

function isBulf(t: Carrier): boolean {
  return t.kind === 'transport' && t.type === BULF;
}

/** Head for the Temple with the cargo. `target` is kept so the transport returns to the same geyser. */
function goHome(world: World, t: Carrier): void {
  // "Transports may return Storm Crystals to the Outpost": it goes to whichever is nearest.
  const depots = world.templeOf(t.owner) ? world.depotsOf(t.owner) : [];
  const path = depots.length
    ? world.wayOf(t, (cell) => depots.some((home) => world.adjacentTo(cell[0], cell[1], home)))
    : null;

  if (!path) {
    stop(t);
    return;
  }

  t.path = path;
  t.goal = 'home';
}

function deliver(world: World, t: Carrier): void {
  const home = world.templeOf(t.owner)
    && world.depotsOf(t.owner).some((depot) => world.adjacentTo(t.x, t.y, depot));

  if (t.carrying === null || !home) {
    stop(t);
    return;
  }

  const crystal = world.entities.get(t.carrying);

  if (!crystal || crystal.kind !== 'crystal') {
    throw new Error(`Missing cargo for transport ${t.id}`);
  }

  world.players.get(t.owner)!.storm += crystal.value;
  world.entities.delete(crystal.id);
  t.carrying = null;
  world.emit({ what: 'delivered', who: t.owner, data: { transport: t.id } });

  if (t.target === null) {
    stop(t);
    return;
  }

  // Loop back to the same geyser until it is depleted, then move on.
  const g = world.entities.get(t.target);

  if (g?.kind === 'geyser' && g.stock > 0 && sendToGeyser(world, t, g)) {
    return;
  }

  seekGeyser(world, t);
}

function sendToGeyser(world: World, t: Carrier, g: Geyser): boolean {
  const path = world.wayOf(t, (cell) => nextTo(g, { x: cell[0], y: cell[1] }));

  if (!path) {
    return false;
  }

  t.path = path;
  t.goal = 'collect';
  t.target = g.id;
  return true;
}

/** Pick the reachable non-depleted geyser closest to the owner's Temple, even in enemy territory. */
function seekGeyser(world: World, t: Carrier): void {
  const home = world.templeOf(t.owner);

  if (!home) {
    stop(t);
    return;
  }

  const hx = home.x + (home.fx >> 1);
  const hy = home.y + (home.fy >> 1);
  const distance = (g: Geyser) => Math.abs(g.x - hx) + Math.abs(g.y - hy);
  const candidates: Geyser[] = [];

  for (const e of world.entities.values()) {
    if (e.kind === 'geyser' && e.stock > 0) {
      candidates.push(e);
    }
  }

  candidates.sort((a, b) => distance(a) - distance(b) || a.id - b.id);

  for (const g of candidates) {
    if (sendToGeyser(world, t, g)) {
      return;
    }
  }

  stop(t);
}

export function dropCargo(world: World, t: Carrier): void {
  if (t.carrying === null) {
    return;
  }

  // The help does not say what happens to the cargo of a destroyed transport. Here the crystal
  // falls on the spot and any transport can fetch it with `pickupCrystal`.
  const c = world.entities.get(t.carrying);
  t.carrying = null;

  if (c?.kind === 'crystal') {
    c.carriedBy = null;
    c.x = t.x;
    c.y = t.y;
  } else if (c?.kind === 'priest') {
    // Losing the carrier counts as being released by it (likely, not stated in the help).
    releasePriest(world, c, t.x, t.y);
  }
}

/** The player's transport, or his Priest on his feet, with nothing in its hands, or a Bulf with
 * room for a second crystal. */
function ownCarrier(world: World, player: number, id: number): Carrier | null {
  const t = world.entities.get(id);

  if (!t || (t.kind !== 'transport' && t.kind !== 'priest') || t.owner !== player) {
    return null;
  }

  const free = t.carrying === null || bulfWithOne(world, t);
  return free && (t.kind === 'transport' || t.state === 'normal') ? t : null;
}

/**
 * "Right-click a cargo-carrying Transport, and choose 'Drop ...'": the crystal is left where the
 * carrier stands, a Priest is set down beside it, and the carrier's errand is over. A friendly
 * Priest set down on the carrier's own island is saved.
 */
export function unload(
  world: World,
  c: Extract<Command, { t: 'dropCargo'; }>,
): CommandError | null {
  const t = world.entities.get(c.transport);

  if (!t || (t.kind !== 'transport' && t.kind !== 'priest') || t.owner !== c.player) {
    return 'bad target';
  }

  const cargo = t.carrying === null ? undefined : world.entities.get(t.carrying);

  if (!cargo) {
    return 'bad target';
  }

  // "Not while flying" (FUN_0042aa80).
  if (t.kind === 'transport' && (t.aloft || t.climbing > 0)) {
    return 'not ready';
  }

  // A Bulf with two crystals drops one of them (FUN_0044f8a0).
  if (cargo.kind === 'crystal' && cargo.value > CRYSTAL_VALUE) {
    cargo.value -= CRYSTAL_VALUE;
    const dropped = world.spawnCrystal(t, CRYSTAL_VALUE);
    dropped.carriedBy = null;
    return null;
  }

  dropCargo(world, t);
  t.path = [];
  stop(t);

  if (cargo.kind === 'priest') {
    hail(world, t.owner, cargo, t.x, t.y);
  }

  return null;
}

export function collect(world: World, c: Extract<Command, { t: 'collect'; }>): CommandError | null {
  const t = ownCarrier(world, c.player, c.transport);
  const g = world.entities.get(c.geyser);

  if (!t || !g || g.kind !== 'geyser') {
    return 'bad target';
  }

  // "Without a Temple you can't collect or process Storm Power."
  if (!world.templeOf(c.player)) {
    return 'no temple';
  }

  return sendToGeyser(world, t, g) ? null : 'no path';
}

export function pickupCrystal(
  world: World,
  c: Extract<Command, { t: 'pickupCrystal'; }>,
): CommandError | null {
  const t = ownCarrier(world, c.player, c.transport);
  const crystal = world.entities.get(c.crystal);

  if (!t || !crystal || crystal.kind !== 'crystal' || crystal.carriedBy !== null) {
    return 'bad target';
  }

  if (!world.templeOf(c.player)) {
    return 'no temple';
  }

  const path = world.wayOf(t,
    (cell) => Math.abs(cell[0] - crystal.x) + Math.abs(cell[1] - crystal.y) <= 1);

  if (!path) {
    return 'no path';
  }

  t.path = path;
  t.goal = 'pickup';
  t.target = crystal.id;
  return null;
}
