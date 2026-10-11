import type { World } from '../world.js';
import { HAND_SIZE, PIECES, PIECE_INTERVAL, type Player } from '../state.js';

export function tickPlayer(world: World, player: Player): void {
  if (!player.alive) {
    return;
  }

  if (
    world.buildingsOf(player.id).some((building) => world.def(building.type).cls === 'Energy')
    && --player.pieceTimer <= 0
  ) {
    player.pieceTimer = PIECE_INTERVAL;

    if (player.hand.length < HAND_SIZE) {
      player.hand.push(world.rng.int(PIECES.length));
    }
  }
}
