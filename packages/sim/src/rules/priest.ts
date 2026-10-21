import type { Command, CommandError } from '../commands.js';
import type { World } from '../world.js';
import { TPS, Terrain, type Priest } from '../state.js';
import { advance, arrive, dropCargo } from './movement.js';
import { tickRitual } from './capture.js';
import { tickPrayer } from './spells.js';

const PRIEST_SPEED = 1.8; // cells per second
// Healing, from Priest.cpp in netstorm.game 10.82: a sixth of the full hit points at a time, at a
// pace that would restore all of them in 50 s. For the Priest's 100 that is 16 every 8 s.
const HEAL_PARTS = 6;
const FULL_HEAL_SECONDS = 50;

/** "Notice that the Priest is constantly regenerating Hit Points." He heals whatever his state,
 * but without a Temple he cannot get back to half of his hit points, which is where he stops being
 * paralysed. */
function heal(world: World, p: Priest): void {
  const part = Math.floor(p.hpMax / HEAL_PARTS);
  const interval = Math.round(((part * FULL_HEAL_SECONDS) / p.hpMax) * TPS);

  if (p.hp >= p.hpMax || world.tick % interval !== 0) {
    return;
  }

  const half = p.hpMax / 2;
  const healed = Math.min(p.hpMax, p.hp + part);

  if (p.hp < half && healed >= half && !world.templeOf(p.owner)) {
    return;
  }

  p.hp = healed;
}

export function tickPriest(world: World, p: Priest): void {
  if (p.state === 'carried') {
    const by = p.carriedBy === null ? undefined : world.entities.get(p.carriedBy);

    if (!by || by.kind !== 'transport' || by.carrying !== p.id) {
      throw new Error(`Invalid carrier for priest ${p.id}`);
    }

    p.x = by.x;
    p.y = by.y;
    return;
  }

  if (p.state === 'chained') {
    tickRitual(world, p);
    return;
  }

  heal(world, p);

  // He is paralysed while he has less than half of his hit points.
  if (p.state === 'down') {
    if (p.hp >= p.hpMax / 2) {
      p.state = 'normal';
      world.emit({ what: 'priest up', who: p.owner });
    }

    return;
  }

  if (p.hp < p.hpMax / 2) {
    p.state = 'down';
    p.path = [];
    p.goal = 'idle';
    p.target = null;
    dropCargo(world, p); // a paralysed Priest holds nothing
    // Nor does he pray or cast: a prayer is lost, the Spell he holds he keeps (FUN_004bd760).
    p.prayer = null;
    p.praying = 0;
    p.casting = 0;
    world.emit({ what: 'priest down', who: p.owner });
    return;
  }

  // With no ground under him he hangs in place until bridge is laid there again.
  if (world.terrain[world.at(p.x, p.y)] === Terrain.Sky) {
    p.path = [];
    return;
  }

  if (tickPrayer(world, p)) {
    return;
  }

  advance(world, p, PRIEST_SPEED);

  if (!p.path.length && !arrive(world, p) && p.goal === 'build') {
    p.goal = 'idle'; // he stands by the site; the building takes it from here
    p.target = null;
  }
}

export function movePriest(
  world: World,
  c: Extract<Command, { t: 'movePriest'; }>,
): CommandError | null {
  const p = world.priestOf(c.player);

  if (!p || p.state !== 'normal' || world.terrain[world.at(p.x, p.y)] === Terrain.Sky) {
    return 'priest unavailable';
  }

  const path = world.findPath(c.player, p.x, p.y, (cell) => cell[0] === c.x && cell[1] === c.y,
    true);

  if (!path) {
    return 'no path';
  }

  // An order to walk ends his errand; a crystal he holds is banked if the walk ends at his Temple.
  p.path = path;
  p.goal = p.carrying === null ? 'idle' : 'home';
  p.target = null;
  return null;
}
