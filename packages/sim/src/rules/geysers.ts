/**
 * New geysers during a battle, as nugget.cpp of netstorm.game 10.82 makes them: what no player
 * gets of a destroyed or salvaged unit, and the cost of every Spell cast, goes into a pool; every
 * Geyser Interval a geyser is made from the pool. "Part of its energy falls into this battle of the
 * Furies, and reappears as Geyser islands" (help 1584). See docs/game-rules.md.
 */
import type { World } from '../world.js';
import {
  GEYSER_ZONES,
  Terrain,
  TPS,
  H,
  W,
  type Building,
  type Geyser,
  type GeyserPlacement,
  type GeyserState,
  type Transport,
} from '../state.js';
import { homeIsland } from './capture.js';

/* oxlint-disable no-magic-numbers -- the constants of nugget.cpp */
const ZONES = GEYSER_ZONES;
const GRID = 4;
/** Storm Power handed to each zone at a time out of the undistributed pool (FUN_004a9410). */
const STEP = 100;
/** A geyser's islet: three by three cells, the geyser in the middle. */
const FOOT = 3;
/** Tries at a spot: per zone (FUN_004a9630), and per geyser elsewhere (FUN_004a98b0). */
const ZONE_TRIES = 255;
const SPOT_TRIES = 100;
/** Draws of a pair of zones per call of spawnBalanced (FUN_004a9be0). */
const PAIR_TRIES = 100;
/** Seeds of the spot generator: of each zone's search and the start, and of a battle's. */
const ZONE_SEED = 0xfed;
const BATTLE_SEED = 0xbeef;
const ZERO_SEED = 0xbad0bad;
/** The campaign's geyser timer (FUN_004aa060). */
const CAMPAIGN_INTERVAL = 30;
/** Geysers by each home at the start: players 1 to 4, and 5 to 8. */
const HOME_GEYSERS = 3;
const HOME_GEYSERS_HIGH = 4;
const LOW_PLAYERS = 4;
/** Cells round a home island's bounds where its own geysers go (FUN_004b7e10), and that the
 * geysers of the start keep clear of, 8 more (FUN_004aa9f0). */
const HOME_MARGIN = 4;
const HOME_CLEARANCE = 8;
/** The original's battle rectangle is the layout of the islands, widened by the Map Size; ours is
 * the map less this many cells at each edge (invented). */
const EDGE = 16;
/** "Map Size" Large, the default: `padX + padY` of the count of geysers at the start. */
const MAP_PAD = 6;
/* oxlint-enable no-magic-numbers */

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Spot {
  allow: { island: boolean; sky: boolean; };
  /** Spots of the homes no geyser may take. */
  avoid: Rect[];
}

const BATTLE: Rect = { x0: EDGE, y0: EDGE, x1: W - EDGE, y1: H - EDGE };

/** The machinery as the campaign runs it: the Traditional placement every 30 s, from the Storm
 * Power of the fallen as it is, never below the 2000 of a campaign geyser (`?` campaign). */
export function campaignGeysers(): GeyserState {
  return {
    placement: 'traditional',
    interval: CAMPAIGN_INTERVAL,
    respawn: 1,
    floor: 0,
    pool: Array.from({ length: ZONES + 1 }, () => 0),
    loose: 0,
    next: 0,
    made: 0,
    seed: 0,
  };
}

/** SyncRand (FUN_004ef720): an integer in [0, n). */
function syncRand(state: { s: number; }, n: number): number {
  /* oxlint-disable no-magic-numbers -- the generator's constants, and its top 16 bits */
  state.s = (Math.imul(state.s || ZERO_SEED, 0x10003) + 3) >>> 0;
  return ((state.s >>> 16) & 0xffff) % n;
  /* oxlint-enable no-magic-numbers */
}

/** A coordinate rounded as the original rounds it, `floor(v + 0.5)`. */
function round(v: number): number {
  // oxlint-disable-next-line no-magic-numbers -- a half
  return Math.floor(v + 0.5);
}

/** Storm Power of a unit (FUN_004570f0): its cost, times its Level for an Altar, times one more
 * than its Upgrades for a Workshop (`?` what vtable +0x80 holds for the rest; 0 here). */
export function unitValue(world: World, unit: Building | Transport): number {
  const upgrades = unit.kind === 'building' ? unit.upgrades : 0;
  return world.def(unit.type).cost * (upgrades + 1);
}

/** Storm Power into the pool (FUN_004a9460). */
export function feed(world: World, amount: number): void {
  const g = world.geysers;
  const a = Math.trunc(Math.fround(g.respawn) * amount);

  if (g.placement !== 'balanced') {
    g.loose += a;
    return;
  }

  g.pool[0]! += a;
  distribute(g);
}

function distribute(g: GeyserState): void {
  while (g.pool[0]! >= ZONES * STEP) {
    for (let z = 1; z <= ZONES; z++) {
      g.pool[z]! += STEP;
    }

    g.pool[0]! -= ZONES * STEP;
  }
}

function zoneRect(z: number): Rect {
  if (z === 0) {
    return BATTLE;
  }

  const w = (BATTLE.x1 - BATTLE.x0) / GRID;
  const h = (BATTLE.y1 - BATTLE.y0) / GRID;
  const col = (z - 1) % GRID;
  const row = Math.floor((z - 1) / GRID);
  return {
    x0: BATTLE.x0 + col * w,
    y0: BATTLE.y0 + row * h,
    x1: BATTLE.x0 + (col + 1) * w,
    y1: BATTLE.y0 + (row + 1) * h,
  };
}

/**
 * One try at a spot (FUN_004aaac0): a random far corner in the rectangle, its 3×3 all sky or all
 * island, clear of everything but a depleted geyser, which the new one takes the place of. The
 * middle cell, and the depleted geyser there if any; null when the try fails.
 */
function trySpot(
  world: World,
  rect: Rect,
  state: { s: number; },
  spot: Spot,
): { x: number; y: number; old: Geyser | null; } | null {
  const x = round(rect.x0 + syncRand(state, Math.trunc(rect.x1 - rect.x0) + 1));
  const y = round(rect.y0 + syncRand(state, Math.trunc(rect.y1 - rect.y0) + 1));
  const [left, top] = [x - FOOT + 1, y - FOOT + 1];

  if (
    spot.avoid.some((r) => r.x0 < x && x <= r.x1 && r.y0 < y && y <= r.y1)
    || left < rect.x0 || left > rect.x1 || top < rect.y0 || top > rect.y1
  ) {
    return null;
  }

  let ground: Terrain | null = null;

  for (let cy = top; cy <= y; cy++) {
    for (let cx = left; cx <= x; cx++) {
      if (!world.inside(cx, cy)) {
        return null;
      }

      const cell = world.at(cx, cy);
      const there = world.entities.get(world.occupant[cell]!);

      if (there?.kind === 'geyser' && there.stock === 0) {
        return { x: there.x, y: there.y, old: there };
      }

      const t = world.terrain[cell]! as Terrain;

      if (
        there || world.residenceAt(cx, cy) || (t !== Terrain.Sky && t !== Terrain.Island)
        || (t === Terrain.Sky && !spot.allow.sky) || (t === Terrain.Island && !spot.allow.island)
        || (ground !== null && t !== ground)
      ) {
        return null;
      }

      ground = t;
    }
  }

  return { x: x - 1, y: y - 1, old: null };
}

/** A geyser on the first spot found in `tries`; false when none is. A geyser in the sky gets its
 * islet. */
function spawn(
  world: World,
  rect: Rect,
  state: { s: number; },
  spot: Spot,
  tries: number,
): boolean {
  for (let i = 0; i < tries; i++) {
    const at = trySpot(world, rect, state, spot);

    if (!at) {
      continue;
    }

    if (at.old) {
      world.occupant[world.at(at.x, at.y)] = 0;
      world.entities.delete(at.old.id);
    }

    const sky = world.terrain[world.at(at.x - 1, at.y - 1)] === Terrain.Sky;
    const g = world.addGeyser(at.x, at.y, world.geyserStock, sky);
    world.emit({ what: 'geyser', who: 0, data: { id: g.id } });
    return true;
  }

  return false;
}

/** One geyser in a zone, charged to the zone's pool (FUN_004a9630). Each zone searches from the
 * same seed every time. */
function spawnInZone(world: World, z: number, spot: Spot): void {
  if (spawn(world, zoneRect(z), { s: ZONE_SEED }, spot, ZONE_TRIES)) {
    world.geysers.pool[z]! -= world.geyserStock;
  }
}

/**
 * `count` geysers in pairs of point-symmetric zones, each pair drawn by the Storm Power the two
 * hold, while the pools hold two geysers' worth; then one more in a zone holding more than any
 * other (FUN_004a9be0).
 */
function spawnBalanced(world: World, count: number, spot: Spot): void {
  const pool = world.geysers.pool;
  let left = count;

  for (let tries = PAIR_TRIES; left > 0 && tries > 0; tries--) {
    const total = pool.reduce((sum, p) => sum + p, 0);

    if (total < 2 * world.geyserStock) {
      continue;
    }

    let r = world.rng.int(total);

    for (let i = 1; i <= ZONES; i++) {
      const j = ZONES + 1 - i;

      if (pool[i]! > 0 && pool[j]! > 0) {
        const w = pool[i]! + pool[j]!;

        if (r <= w) {
          spawnInZone(world, i, spot);
          spawnInZone(world, j, spot);
          left -= 2;
          break;
        }

        r -= w;
      }
    }
  }

  let best = 0;
  let gap = 0;

  for (let z = 0; z <= ZONES; z++) {
    if (pool[best]! <= pool[z]!) {
      gap = pool[z]! - pool[best]!;
      best = z;
    }
  }

  if (gap > 0 && pool[best]! > 0) {
    spawnInZone(world, best, spot);
  }
}

/** Each home island's bounds, widened by `margin`. */
function homes(world: World, margin: number): Rect[] {
  const rects: Rect[] = [];

  for (const id of world.players.keys()) {
    const cells = homeIsland(world, id);

    if (cells.size === 0) {
      continue;
    }

    const xs = [...cells].map((c) => c % W);
    const ys = [...cells].map((c) => Math.floor(c / W));
    rects.push({
      x0: Math.min(...xs) - margin,
      y0: Math.min(...ys) - margin,
      x1: Math.max(...xs) + margin,
      y1: Math.max(...ys) + margin,
    });
  }

  return rects;
}

/**
 * The geysers of a battle's start (FUN_004a9e70): three by each home, in the sky round it; then,
 * Balanced, a quarter of `N` on islands and half of it in the sky, all clear of the homes, and the
 * Storm Power of another half of `N` kept in the pool for the battle. Other placements put half of
 * `N` anywhere and the rest in the sky. `N` follows the original's sum for a Large map.
 */
export function startGeysers(
  world: World,
  options: { placement: GeyserPlacement; interval: number; respawn: number; start: number; },
): void {
  const g = world.geysers;
  const players = world.players.size;
  g.placement = options.placement;
  g.interval = options.interval;
  g.respawn = options.respawn;

  const seed = { s: ZONE_SEED };

  for (const [i, home] of homes(world, HOME_MARGIN).entries()) {
    const count = i < LOW_PLAYERS ? HOME_GEYSERS : HOME_GEYSERS_HIGH;

    for (let k = 0; k < count; k++) {
      spawn(world, home, seed, { allow: { island: false, sky: true }, avoid: [] }, SPOT_TRIES);
    }
  }

  const avoid = homes(world, HOME_MARGIN + HOME_CLEARANCE);
  const money = world.geyserStock;

  if (g.placement !== 'balanced') {
    // oxlint-disable-next-line no-magic-numbers -- pad × 0.25 × (12 − n) × n
    const n = Math.trunc(Math.fround(options.start) * MAP_PAD * 0.25 * (12 - players) * players);
    // oxlint-disable-next-line no-magic-numbers -- a third
    g.floor = Math.trunc(n / 3);
    const half = Math.trunc(n / 2);

    for (let k = 0; k < n; k++) {
      const sky = { island: k < half, sky: true };
      spawn(world, BATTLE, seed, { allow: sky, avoid }, SPOT_TRIES);
    }

    return;
  }

  // oxlint-disable-next-line no-magic-numbers -- 4 × (pad + n) − 8
  const n = Math.trunc(Math.fround(options.start) * (4 * (MAP_PAD + players) - 8));
  // oxlint-disable-next-line no-magic-numbers -- a quarter
  const quarter = Math.trunc(n / 4);
  const half = Math.trunc(n / 2);
  g.pool[0] = money * (quarter + half);
  distribute(g);
  spawnBalanced(world, quarter, { allow: { island: true, sky: false }, avoid });
  spawnBalanced(world, quarter + half, { allow: { island: false, sky: true }, avoid });
  g.pool[0]! += money * half;
  distribute(g);
}

/** One tick of the machinery (FUN_004aa060): every Geyser Interval, from the first tick on. */
export function tickGeysers(world: World): void {
  const g = world.geysers;

  if (world.tick < g.next || g.interval === 0) {
    return;
  }

  g.next = world.tick + g.interval * TPS;
  const money = world.geyserStock;
  const anywhere = { allow: { island: true, sky: true }, avoid: [] };

  if (g.placement === 'balanced') {
    spawnBalanced(world, 1, anywhere);
    return;
  }

  if (g.placement === 'traditional' && (money < g.loose || g.made < g.floor)) {
    const state = { s: g.seed || BATTLE_SEED };

    if (spawn(world, BATTLE, state, anywhere, SPOT_TRIES)) {
      g.loose = Math.max(0, g.loose - money);
    }

    g.seed = state.s;
  }
}
