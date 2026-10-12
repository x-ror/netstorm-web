import type { Command, CommandError } from '../commands.js';
import type { World } from '../world.js';
import { arriveAtAltar, arriveAtPriest, releasePriest } from './capture.js';
import { TPS, CRYSTAL_VALUE, type Transport, type Priest, type Geyser } from '../state.js';

const MOVE_SCALE = 100; // fixed-point progress needed to enter the next cell
// A diagonal step is longer by the square root of two, so speed in cells per second stays the same.
// Whether the original slows diagonal steps this way is not established.
const DIAGONAL_SCALE = 141;

/** Progress needed to step from where the unit stands to the next cell of its path. */
function stepCost(e: Transport | Priest): number {
  const next = e.path[0];
  return next && next[0] !== e.x && next[1] !== e.y ? DIAGONAL_SCALE : MOVE_SCALE;
}

export function advance(world: World, e: Transport | Priest, speed: number): boolean {
  if (!e.path.length) {
    return false;
  }

  e.move += Math.round((speed * MOVE_SCALE) / TPS);

  while (e.path.length && e.move >= stepCost(e)) {
    e.move -= stepCost(e);
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
    removeTransport(world, t);
    world.emit({ what: 'destroyed', who: t.owner, data: { id: t.id, type: t.type } });
    return;
  }

  advance(world, t, world.def(t.type).speed);

  if (t.path.length) {
    return;
  }

  if (t.goal === 'collect') {
    arriveAtGeyser(world, t);
  } else if (t.goal === 'pickup') {
    arriveAtCrystal(world, t);
  } else if (t.goal === 'home') {
    deliver(world, t);
  } else if (t.goal === 'capture') {
    arriveAtPriest(world, t);
  } else if (t.goal === 'altar') {
    arriveAtAltar(world, t);
  }
}

/** Take a transport off the map; whatever it carried is left behind. */
export function removeTransport(world: World, t: Transport): void {
  dropCargo(world, t);
  world.entities.delete(t.id);
}

function nextTo(a: { x: number; y: number; }, b: { x: number; y: number; }): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function stop(t: Transport): void {
  t.goal = 'idle';
  t.target = null;
}

function arriveAtGeyser(world: World, t: Transport): void {
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
  const value = Math.min(CRYSTAL_VALUE, g.stock);
  g.stock -= value;
  t.carrying = world.spawnCrystal(t, value).id;
  goHome(world, t);
}

function arriveAtCrystal(world: World, t: Transport): void {
  const c = t.target === null ? undefined : world.entities.get(t.target);
  t.target = null;

  if (
    !c || c.kind !== 'crystal' || c.carriedBy !== null
    || Math.abs(c.x - t.x) + Math.abs(c.y - t.y) > 1
  ) {
    stop(t);
    return;
  }

  c.carriedBy = t.id;
  t.carrying = c.id;
  goHome(world, t);
}

/** Head for the Temple with the cargo. `target` is kept so the transport returns to the same geyser. */
function goHome(world: World, t: Transport): void {
  const home = world.templeOf(t.owner);
  const path = home
    ? world.findPath(t.owner, t.x, t.y, (cell) => world.adjacentTo(cell[0], cell[1], home))
    : null;

  if (!path) {
    stop(t);
    return;
  }

  t.path = path;
  t.goal = 'home';
}

function deliver(world: World, t: Transport): void {
  const home = world.templeOf(t.owner);

  if (t.carrying === null || !home || !world.adjacentTo(t.x, t.y, home)) {
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

function sendToGeyser(world: World, t: Transport, g: Geyser): boolean {
  const path = world.findPath(t.owner, t.x, t.y, (cell) => nextTo(g, { x: cell[0], y: cell[1] }));

  if (!path) {
    return false;
  }

  t.path = path;
  t.goal = 'collect';
  t.target = g.id;
  return true;
}

/** Pick the reachable non-depleted geyser closest to the owner's Temple, even in enemy territory. */
function seekGeyser(world: World, t: Transport): void {
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

function dropCargo(world: World, t: Transport): void {
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

function ownTransport(world: World, player: number, id: number): Transport | null {
  const t = world.entities.get(id);
  return t?.kind === 'transport' && t.owner === player && t.carrying === null ? t : null;
}

export function collect(world: World, c: Extract<Command, { t: 'collect'; }>): CommandError | null {
  const t = ownTransport(world, c.player, c.transport);
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
  const t = ownTransport(world, c.player, c.transport);
  const crystal = world.entities.get(c.crystal);

  if (!t || !crystal || crystal.kind !== 'crystal' || crystal.carriedBy !== null) {
    return 'bad target';
  }

  if (!world.templeOf(c.player)) {
    return 'no temple';
  }

  const path = world.findPath(c.player, t.x, t.y,
    (cell) => Math.abs(cell[0] - crystal.x) + Math.abs(cell[1] - crystal.y) <= 1);

  if (!path) {
    return 'no path';
  }

  t.path = path;
  t.goal = 'pickup';
  t.target = crystal.id;
  return null;
}
