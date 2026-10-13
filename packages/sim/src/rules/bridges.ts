import type { World } from '../world.js';
import { flies } from '../defs.js';
import type { WorldView } from '../view.js';
import type { Command, CommandError } from '../commands.js';
import {
  W,
  H,
  Terrain,
  DIRS,
  LINK_ALL,
  TPS,
  WEAR_CRACKED,
  WEAR_FULL,
  isBridge,
  PIECES,
  PIECE_HARD,
  PIECE_HARDEN,
  oppositeDir,
  rotateLinks,
  rotatePiece,
  type Building,
} from '../state.js';

/** Sides a ground cell joins on: every side for island, and for bridge laid without a piece. */
function linksAt(world: WorldView, i: number): number {
  return world.terrain[i] === Terrain.Island ? LINK_ALL : world.links[i] || LINK_ALL;
}

/** Whether the ground cell joins on the side `dir`, an index into DIRS. */
export function joins(world: WorldView, i: number, dir: number): boolean {
  return (linksAt(world, i) & (1 << dir)) !== 0;
}

/** Cells of the player's ground joined to the Temple by an unbroken run of own island and bridge. */
function connectedToTemple(world: WorldView, player: number): Uint8Array | null {
  const temple = world.templeOf(player);

  if (!temple) {
    return null;
  }

  const connected = new Uint8Array(W * H);
  const queue: number[] = [];

  for (let y = temple.y; y < temple.y + temple.fy; y++) {
    for (let x = temple.x; x < temple.x + temple.fx; x++) {
      if (world.isOwnGround(player, x, y)) {
        connected[world.at(x, y)] = 1;
        queue.push(world.at(x, y));
      }
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % W;
    const y = (i / W) | 0;

    // Bridge carries the attachment on only through the sides its cells join on.
    for (const [dir, [dx, dy]] of DIRS.entries()) {
      const nx = x + dx;
      const ny = y + dy;

      if (
        world.isOwnGround(player, nx, ny)
        && !connected[world.at(nx, ny)]
        && joins(world, i, dir)
        && joins(world, world.at(nx, ny), oppositeDir(dir))
      ) {
        connected[world.at(nx, ny)] = 1;
        queue.push(world.at(nx, ny));
      }
    }
  }

  return connected;
}

/** "Once you've attached to a Geyser you own its island, and can build bridge off of it." */
function claimIsland(world: World, player: number, x: number, y: number): void {
  const queue: [number, number][] = [[x, y]];

  for (let head = 0; head < queue.length; head++) {
    const [cx, cy] = queue[head]!;

    if (
      !world.inside(cx, cy)
      || world.terrain[world.at(cx, cy)] !== Terrain.Island
      || world.owner[world.at(cx, cy)] !== 0
    ) {
      continue;
    }

    world.owner[world.at(cx, cy)] = player;

    for (const [dx, dy] of DIRS) {
      queue.push([cx + dx, cy + dy]);
    }
  }
}

export type PieceCommand = Pick<
  Extract<Command, { t: 'dropPiece'; }>,
  'player' | 'hand' | 'x' | 'y' | 'rot'
>;

/** The cells a piece from the hand would cover, or why it cannot be laid there. Shared by the
 * command and by previews, so both always agree. */
export function pieceSite(
  world: WorldView,
  c: PieceCommand,
): { cells: [number, number][]; links: number[]; } | { error: CommandError; } {
  const entry = world.players.get(c.player)?.hand[c.hand];

  if (entry === undefined) {
    return { error: 'no piece' };
  }

  const cells = rotatePiece(PIECES[entry.piece]!, c.rot).map(([dx, dy]) =>
    [c.x + dx, c.y + dy] as [number, number]
  );

  for (const [x, y] of cells) {
    if (!world.inside(x, y) || world.terrain[world.at(x, y)] !== Terrain.Sky) {
      return { error: 'blocked' };
    }
  }

  // "There must be a continuous attachment from the Temple on your island to the bridge you are
  // laying down." A piece attaches only by its open ends: a side one of its cells joins on must
  // meet attached ground, and if that ground is bridge, a side that bridge cell joins on.
  const connected = connectedToTemple(world, c.player);
  const links = rotateLinks(entry.piece, c.rot);
  const touches = connected !== null
    && cells.some(([x, y], index) =>
      DIRS.some(([dx, dy], dir) =>
        (links[index]! & (1 << dir)) !== 0
        && world.inside(x + dx, y + dy)
        && connected[world.at(x + dx, y + dy)] === 1
        && joins(world, world.at(x + dx, y + dy), oppositeDir(dir))
      )
    );

  return touches ? { cells, links } : { error: 'not connected' };
}

export function dropPiece(
  world: World,
  c: Extract<Command, { t: 'dropPiece'; }>,
): CommandError | null {
  const pl = world.players.get(c.player)!;
  const site = pieceSite(world, c);

  if ('error' in site) {
    return site.error;
  }

  const { cells, links } = site;
  const entry = pl.hand[c.hand]!;

  // The bridge keeps the strength the piece had reached in the window.
  let strength = Terrain.HardBridge;

  if (entry.age < PIECE_HARDEN) {
    strength = Terrain.CrackedBridge;
  } else if (entry.age < PIECE_HARD) {
    strength = Terrain.Bridge;
  }

  for (const [index, [x, y]] of cells.entries()) {
    world.terrain[world.at(x, y)] = strength;
    world.owner[world.at(x, y)] = c.player;
    world.links[world.at(x, y)] = links[index]!;
    world.wear[world.at(x, y)] = strength === Terrain.CrackedBridge ? WEAR_CRACKED : 0;
  }

  // An island is attached to, and so claimed, only through an open end of the piece.
  for (const [index, [x, y]] of cells.entries()) {
    for (const [dir, [dx, dy]] of DIRS.entries()) {
      if (links[index]! & (1 << dir)) {
        claimIsland(world, c.player, x + dx, y + dy);
      }
    }
  }

  world.invalidateTerrain();
  pl.hand.splice(c.hand, 1);
  world.emit({ what: 'bridge', who: c.player, data: cells });
  return null;
}

/**
 * "When a unit explodes cracked bridge nearby will also crumble. Normal bridge that was adjacent to
 * the unit will crack, or become a jagged end." Salvaging affects bridge "in the same way". As the
 * original does it (the death handlers of buildings and of islets in netstorm.game 10.82):
 *  - the islet of a unit laid off a bridge falls with the unit;
 *  - a straight bridge cell that was joined to the islet becomes an end that points away from it,
 *    with four steps of wear left, or falls at once if nothing holds it on the far side;
 *  - other bridge in the ring of cells around the unit cracks if it is normal and falls if it is
 *    cracked. Hard bridge keeps its look.
 * Call after the building is off the map.
 */
export function shakeBridges(world: World, b: Building): void {
  const joined = b.islet ? joinedToIslet(world, b) : new Map<number, number>();

  if (b.islet) {
    for (let y = b.y; y < b.y + b.fy; y++) {
      for (let x = b.x; x < b.x + b.fx; x++) {
        world.terrain[world.at(x, y)] = Terrain.Sky;
        world.owner[world.at(x, y)] = 0;
      }
    }
  }

  for (let y = b.y - 1; y <= b.y + b.fy; y++) {
    for (let x = b.x - 1; x <= b.x + b.fx; x++) {
      const i = world.inside(x, y) ? world.at(x, y) : -1;

      if (i < 0 || !isBridge(world.terrain[i])) {
        continue;
      }

      const side = joined.get(i);

      if (side !== undefined) {
        jag(world, x, y, side);
      } else if (world.terrain[i] === Terrain.Bridge) {
        world.terrain[i] = Terrain.CrackedBridge;
        world.wear[i] = WEAR_CRACKED;
      } else if (world.terrain[i] === Terrain.CrackedBridge) {
        collapse(world, x, y);
      }
    }
  }

  world.invalidateTerrain();
}

/** Bridge cells joined to the building's islet, each with the side on which it joins it. */
function joinedToIslet(world: WorldView, b: Building): Map<number, number> {
  const joined = new Map<number, number>();

  for (let y = b.y; y < b.y + b.fy; y++) {
    for (let x = b.x; x < b.x + b.fx; x++) {
      for (const [dir, [dx, dy]] of DIRS.entries()) {
        if (world.joined(x, y, dir) && isBridge(world.terrain[world.at(x + dx, y + dy)])) {
          joined.set(world.at(x + dx, y + dy), oppositeDir(dir));
        }
      }
    }
  }

  return joined;
}

/** The bridge cell at (x, y) loses the islet it was joined to on `side`. */
function jag(world: World, x: number, y: number, side: number): void {
  const i = world.at(x, y);
  const hard = world.terrain[i] === Terrain.HardBridge;
  const links = world.links[i] || LINK_ALL;

  if (!hard) {
    world.terrain[i] = Terrain.CrackedBridge;
  }

  world.wear[i] = WEAR_CRACKED;

  if (links !== NORTH_SOUTH && links !== EAST_WEST) {
    return;
  }

  // A straight cell with nothing on its other side has nothing left to hang on, hard or not.
  if (!world.joined(x, y, oppositeDir(side))) {
    collapse(world, x, y);
  } else if (!hard) {
    world.links[i] = links & ~(1 << side);
  }
}

/** A bridge cell falls away. Transports on it are lost with it; a priest cannot be killed, so he is
 * left hanging in place and cannot move until bridge is laid under him again. */
export function collapse(world: World, x: number, y: number): void {
  const i = world.at(x, y);
  world.terrain[i] = Terrain.Sky;
  world.owner[i] = 0;
  world.links[i] = 0;
  world.wear[i] = 0;

  for (const e of world.entities.values()) {
    if (e.x !== x || e.y !== y) {
      continue;
    }

    // An Aerial Transport over the cell is not standing on it.
    if (e.kind === 'transport' && !flies(world.def(e.type))) {
      e.hp = 0;
    } else if (e.kind === 'priest' && e.state !== 'carried' && e.state !== 'chained') {
      e.path = [];
    }
  }
}

// ---------- wear of loose bridge ends (bridge.cpp in netstorm.game 10.82)

const SCAN_SECONDS = 10;
/** Ticks between two looks at every bridge cell. */
export const BRIDGE_SCAN = SCAN_SECONDS * TPS;
/** A stretch of bridge that hangs in the sky with fewer cells than this falls at the next look. */
const MIN_FRAGMENT = 5;
/** Guard for the walk below: the original has none and relies on bridge not forming rings. */
const MAX_WALK = 16;
const CROSS = LINK_ALL;
// Link masks of the two straight cells, bits as in DIRS.
const NORTH_SOUTH = 5;
const EAST_WEST = 10;

/** Ground cells joined to the cell `i`. */
function joinedTo(world: WorldView, i: number): number[] {
  const x = i % W;
  const y = (i / W) | 0;
  const out: number[] = [];

  for (const [dir, [dx, dy]] of DIRS.entries()) {
    if (world.joined(x, y, dir)) {
      out.push(world.at(x + dx, y + dy));
    }
  }

  return out;
}

/** A corner, a tee or a cross of bridge: the walk goes on through these and stops at the rest,
 * which are straight bridge, stubs and island ground. */
function isJunction(world: WorldView, i: number): boolean {
  if (!isBridge(world.terrain[i])) {
    return false;
  }

  const links = world.links[i] || LINK_ALL;
  const straight = links === NORTH_SOUTH || links === EAST_WEST;
  return !straight && (links & (links - 1)) !== 0;
}

interface Walk {
  /** Cells that wear together. */
  cells: Set<number>;
  /** The loose end is confirmed: the cells do wear. */
  wears: boolean;
  /** A junction beside the loose end has at most two joins itself. */
  thin: boolean;
}

/** How many firm continuations lie beyond the junctions next to a loose end. With two or more the
 * end is held and does not wear. */
function supports(world: WorldView, walk: Walk, i: number, depth: number, from: number): number {
  let count = 0;

  if (depth > MAX_WALK) {
    return count;
  }

  for (const n of joinedTo(world, i)) {
    if (n === from) {
      continue;
    }

    if (isJunction(world, n)) {
      if (depth === 0 && joinedTo(world, n).length <= 2) {
        walk.thin = true;
      }

      count += supports(world, walk, n, depth + 1, i);
    } else if (depth > 1 || (depth === 1 && !walk.thin)) {
      count += joinedTo(world, n).length > 1 ? 1 : 0;
    }
  }

  return count;
}

/** Gather the cells that wear with the loose end `i`, and settle whether they wear at all. */
function gather(
  world: WorldView,
  walk: Walk,
  i: number,
  depth: number,
  from: number,
  cross: boolean,
): void {
  if (depth > MAX_WALK) {
    return;
  }

  const around = joinedTo(world, i);
  let firm = 0;

  for (const n of around) {
    if (n === from) {
      continue;
    }

    if (isBridge(world.terrain[n])) {
      walk.cells.add(n);
    }

    if (isJunction(world, n)) {
      if (depth === 0 && joinedTo(world, n).length <= 2) {
        walk.thin = true;
      }

      gather(world, walk, n, depth + 1, i, (world.links[n] || LINK_ALL) === CROSS);
    } else if (depth === 0 || (depth === 1 && walk.thin)) {
      walk.wears = true;
      walk.cells.delete(n);
    } else if (joinedTo(world, n).length > 1) {
      firm++;
      walk.cells.delete(n);
    } else {
      walk.wears = true;
    }
  }

  // A cross held on two sides stays, with everything around it.
  if (cross && firm > 1) {
    for (const n of around) {
      walk.cells.delete(n);
    }

    walk.cells.delete(i);
  }
}

/** Set the time a bridge cell has left; with none left it falls, below five it looks cracked. */
function wearTo(world: World, i: number, left: number): void {
  if (!isBridge(world.terrain[i])) {
    return;
  }

  if (left <= 0) {
    collapse(world, i % W, (i / W) | 0);
    return;
  }

  world.wear[i] = left;

  if (left <= WEAR_CRACKED && world.terrain[i] === Terrain.Bridge) {
    world.terrain[i] = Terrain.CrackedBridge;
  }

  if (left <= FLEE_AT) {
    flee(world, i);
  }
}

// "If a Priest or a Crystal Crab is standing on a dangerous bridge, it will try to move
// automatically to a safer position." From bridge.cpp and carrier.cpp: the two are told to move
// when the cell under them has five steps left or fewer; bridge is dangerous while it wears and
// has fewer than seven left; they look five cells around.
const FLEE_AT = 5;
const FLEE_REACH = 5;
const CRYSTAL_CRAB = 'rainwalker';

/** Bridge that has begun to wear and is past its first step. */
function dangerous(world: WorldView, i: number): boolean {
  return isBridge(world.terrain[i]) && world.wear[i]! > 0 && world.wear[i]! < WEAR_FULL;
}

/** Send the Priest or Crystal Crab standing still on the cell `i` to the nearest safe ground it
 * can walk to. Other transports stay and fall with the bridge. */
function flee(world: World, i: number): void {
  const x = i % W;
  const y = (i / W) | 0;

  // ponytail: scans every entity when a cell gets this worn; use the cell index if it shows up.
  for (const e of world.entities.values()) {
    const minds = (e.kind === 'priest' && e.state === 'normal')
      || (e.kind === 'transport' && e.type === CRYSTAL_CRAB && e.goal === 'idle');

    if (!minds || e.x !== x || e.y !== y || e.path.length > 0) {
      continue;
    }

    const spots: [number, number, number][] = [];

    for (let cy = y - FLEE_REACH; cy <= y + FLEE_REACH; cy++) {
      for (let cx = x - FLEE_REACH; cx <= x + FLEE_REACH; cx++) {
        if (
          (cx !== x || cy !== y) && world.walkable(e.owner, cx, cy)
          && !dangerous(world, world.at(cx, cy))
        ) {
          spots.push([cx, cy, (cx - x) ** 2 + (cy - y) ** 2]);
        }
      }
    }

    spots.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);

    for (const [cx, cy] of spots) {
      const path = world.findPath(e.owner, x, y, (cell) => cell[0] === cx && cell[1] === cy,
        e.kind === 'priest');

      if (path) {
        e.path = path;
        break;
      }
    }
  }
}

/** Bridge that hangs in the sky in a stretch of fewer than five cells falls at once. */
function dropFragments(world: World, seen: Uint8Array): void {
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || !isBridge(world.terrain[start])) {
      continue;
    }

    const cells = [start];
    let anchored = false;
    seen[start] = 1;

    for (let head = 0; head < cells.length; head++) {
      for (const n of joinedTo(world, cells[head]!)) {
        if (world.terrain[n] === Terrain.Island) {
          anchored = true;
        } else if (!seen[n]) {
          seen[n] = 1;
          cells.push(n);
        }
      }
    }

    if (!anchored && cells.length < MIN_FRAGMENT) {
      for (const i of cells) {
        collapse(world, i % W, (i / W) | 0);
      }
    }
  }
}

/**
 * The look the original takes at every bridge cell once in ten seconds. A cell joined to one thing
 * only is a loose end, and a loose end wears: it and the cells the walk gathers with it are set a
 * step below the least time any of them has left, starting from seven. So normal bridge left
 * hanging falls in about eighty seconds and cracked bridge in forty, end first, and bridge joined
 * at both ends, to an island or to a unit's islet, stays. Hard bridge never starts to wear.
 */
export function ageBridges(world: World): void {
  dropFragments(world, new Uint8Array(W * H));

  for (let i = 0; i < W * H; i++) {
    const terrain = world.terrain[i];

    if (terrain !== Terrain.Bridge && terrain !== Terrain.CrackedBridge) {
      continue;
    }

    const around = joinedTo(world, i);

    if (around.length === 0) {
      wearTo(world, i, world.wear[i]! - 1);
      continue;
    }

    if (around.length > 1) {
      continue;
    }

    const walk: Walk = { cells: new Set([i]), wears: false, thin: false };

    if (supports(world, walk, i, 0, -1) > 1) {
      continue;
    }

    walk.thin = false;
    gather(world, walk, i, 0, -1, false);

    if (!walk.wears) {
      continue;
    }

    let least = Infinity;

    for (const cell of walk.cells) {
      if (world.wear[cell]! > 0) {
        least = Math.min(least, world.wear[cell]!);
      }
    }

    const left = least === Infinity ? WEAR_FULL : least - 1;

    for (const cell of walk.cells) {
      wearTo(world, cell, left);
    }
  }

  world.invalidateTerrain();
}
