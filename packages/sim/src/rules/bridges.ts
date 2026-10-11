import type { World } from '../world.js';
import type { Command, CommandError } from '../commands.js';
import { Terrain, DIRS, PIECES, rotatePiece } from '../state.js';

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
  let touches = false;

  for (const [x, y] of cells) {
    if (!world.inside(x, y) || world.terrain[world.at(x, y)] !== Terrain.Sky) {
      return 'blocked';
    }

    for (const [ddx, ddy] of DIRS) {
      if (world.isOwnGround(c.player, x + ddx, y + ddy)) {
        touches = true;
      }
    }
  }

  if (!touches) {
    return 'not connected';
  }

  for (const [x, y] of cells) {
    world.terrain[world.at(x, y)] = Terrain.Bridge;
    world.owner[world.at(x, y)] = c.player;
  }

  world.invalidateTerrain();
  pl.hand.splice(c.hand, 1);
  world.emit({ what: 'bridge', who: c.player, data: cells });
  return null;
}
