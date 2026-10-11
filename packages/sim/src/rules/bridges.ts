import type { World } from '../world.js';
import type { Command, CommandError } from '../commands.js';
import { W, H, Terrain, DIRS, PIECES, rotatePiece } from '../state.js';

/** Cells of the player's ground joined to the Temple by an unbroken run of own island and bridge. */
function connectedToTemple(world: World, player: number): Uint8Array | null {
  const temple = world.buildingsOf(player).find((b) => world.def(b.type).cls === 'Energy');

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

    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;

      if (world.isOwnGround(player, nx, ny) && !connected[world.at(nx, ny)]) {
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

export function dropPiece(
  world: World,
  c: Extract<Command, { t: 'dropPiece'; }>,
): CommandError | null {
  const pl = world.players.get(c.player)!;

  const piece = pl.hand[c.hand];

  if (piece === undefined) {
    return 'no piece';
  }

  const cells = rotatePiece(PIECES[piece]!, c.rot).map(([dx, dy]) =>
    [c.x + dx, c.y + dy] as [number, number]
  );

  for (const [x, y] of cells) {
    if (!world.inside(x, y) || world.terrain[world.at(x, y)] !== Terrain.Sky) {
      return 'blocked';
    }
  }

  // "There must be a continuous attachment from the Temple on your island to the bridge you are
  // laying down."
  const connected = connectedToTemple(world, c.player);
  const touches = connected !== null
    && cells.some(([x, y]) =>
      DIRS.some(([dx, dy]) =>
        world.inside(x + dx, y + dy) && connected[world.at(x + dx, y + dy)] === 1
      )
    );

  if (!touches) {
    return 'not connected';
  }

  for (const [x, y] of cells) {
    world.terrain[world.at(x, y)] = Terrain.Bridge;
    world.owner[world.at(x, y)] = c.player;
  }

  for (const [x, y] of cells) {
    for (const [dx, dy] of DIRS) {
      claimIsland(world, c.player, x + dx, y + dy);
    }
  }

  world.invalidateTerrain();
  pl.hand.splice(c.hand, 1);
  world.emit({ what: 'bridge', who: c.player, data: cells });
  return null;
}
