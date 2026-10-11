import type { World } from '../world.js';
import type { WorldView } from '../view.js';
import type { Command, CommandError } from '../commands.js';
import {
  W,
  H,
  Terrain,
  DIRS,
  LINK_ALL,
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

/** "When a unit explodes cracked bridge nearby will also crumble. Normal bridge that was adjacent to
 * the unit will crack." Salvaging affects bridge "in the same way". Applies to the cells sharing an
 * edge with the unit's footprint, which is where the original looks too. Hard bridge is left as it
 * is: the original neither changes its look nor lets it decay. See docs/game-rules.md for what the
 * original does beyond this. */
export function shakeBridges(world: World, b: Building): void {
  let changed = false;

  const shake = (x: number, y: number): void => {
    if (!world.inside(x, y)) {
      return;
    }

    const i = world.at(x, y);

    if (world.terrain[i] === Terrain.Bridge) {
      world.terrain[i] = Terrain.CrackedBridge;
      changed = true;
    } else if (world.terrain[i] === Terrain.CrackedBridge) {
      collapse(world, x, y);
      changed = true;
    }
  };

  for (let x = b.x; x < b.x + b.fx; x++) {
    shake(x, b.y - 1);
    shake(x, b.y + b.fy);
  }

  for (let y = b.y; y < b.y + b.fy; y++) {
    shake(b.x - 1, y);
    shake(b.x + b.fx, y);
  }

  if (changed) {
    world.invalidateTerrain();
  }
}

/** A bridge cell falls away. Transports on it are lost with it; a priest cannot be killed, so he is
 * left hanging in place and cannot move until bridge is laid under him again. */
function collapse(world: World, x: number, y: number): void {
  const i = world.at(x, y);
  world.terrain[i] = Terrain.Sky;
  world.owner[i] = 0;
  world.links[i] = 0;

  for (const e of world.entities.values()) {
    if (e.x !== x || e.y !== y) {
      continue;
    }

    if (e.kind === 'transport') {
      e.hp = 0;
    } else if (e.kind === 'priest' && e.state !== 'carried' && e.state !== 'chained') {
      e.path = [];
    }
  }
}
