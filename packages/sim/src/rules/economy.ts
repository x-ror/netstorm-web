import type { World } from '../world.js';
import { HAND_SIZE, PIECES, PIECE_HARDEN, PIECE_INTERVAL, type Player } from '../state.js';

export function tickPlayer(world: World, player: Player): void {
  if (!player.alive) {
    return;
  }

  for (const entry of player.hand) {
    entry.age = Math.min(PIECE_HARDEN, entry.age + 1);
  }

  if (
    world.buildingsOf(player.id).some((building) => world.def(building.type).cls === 'Energy')
    && --player.pieceTimer <= 0
  ) {
    player.pieceTimer = PIECE_INTERVAL;

    if (player.hand.length < HAND_SIZE) {
      player.hand.push({ piece: world.rng.int(PIECES.length), age: 0 });
    }
  }
}
