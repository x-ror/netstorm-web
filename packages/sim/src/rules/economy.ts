import type { World } from '../world.js';
import {
  DOMINO_PIECE,
  PIECE_HARD,
  PIECE_INTERVAL,
  BRIDGE_SET_WEIGHTS,
  SINGLE_PIECE,
  type Player,
} from '../state.js';

const SET_TOTALS = BRIDGE_SET_WEIGHTS.map((weights) => weights.reduce((sum, w) => sum + w, 0));
// Every third draw into the last free slot is a single block and the draw after it a domino, and
// every fifth draw into any other slot is a single block, each only if the window has none.
const LAST_SLOT_CYCLE = 3;
const OTHER_SLOT_CYCLE = 5;

/** One piece by weight. The running total is compared with `>=`, as the original does. */
function drawPiece(world: World): number {
  const weights = BRIDGE_SET_WEIGHTS[world.bridgeSet]!;
  const roll = world.rng.int(SET_TOTALS[world.bridgeSet]!);
  let total = 0;

  for (let piece = 0; piece < weights.length; piece++) {
    total += weights[piece]!;

    if (total >= roll) {
      return piece;
    }
  }

  return weights.length - 1;
}

/** The piece for a free slot, as the original's Production Window picks it: a weighted draw,
 * redrawn once for each piece in the window it repeats, then the guaranteed small pieces. */
function nextPiece(world: World, player: Player): number {
  let piece = drawPiece(world);

  for (const entry of player.hand) {
    if (entry.piece === piece) {
      piece = drawPiece(world);
    }
  }

  const lacks = (wanted: number): boolean => !player.hand.some((entry) => entry.piece === wanted);
  const turn = player.piecesDrawn++;

  if (player.hand.length === world.bridgeSlots - 1) {
    if (turn % LAST_SLOT_CYCLE === 0) {
      return lacks(SINGLE_PIECE) ? SINGLE_PIECE : piece;
    }

    return turn % LAST_SLOT_CYCLE === 1 && lacks(DOMINO_PIECE) ? DOMINO_PIECE : piece;
  }

  return turn % OTHER_SLOT_CYCLE === 0 && lacks(SINGLE_PIECE) ? SINGLE_PIECE : piece;
}

export function tickPlayer(world: World, player: Player): void {
  if (!player.alive) {
    return;
  }

  for (const entry of player.refresh) {
    entry.ticks--;
  }

  player.refresh = player.refresh.filter((entry) => entry.ticks > 0);

  for (const entry of player.hand) {
    entry.age = Math.min(PIECE_HARD, entry.age + 1);
  }

  if (
    world.templeOf(player.id)
    && --player.pieceTimer <= 0
  ) {
    player.pieceTimer = PIECE_INTERVAL;

    if (player.hand.length < world.bridgeSlots) {
      player.hand.push({ piece: nextPiece(world, player), age: 0 });
    }
  }
}
