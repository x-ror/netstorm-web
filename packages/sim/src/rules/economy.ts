import type { World } from '../world.js';
import {
  HAND_SIZE,
  PIECES,
  PIECE_INTERVAL,
  CRYSTAL_INTERVAL,
  type Player,
  type Geyser,
} from '../state.js';

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

export function tickGeyser(world: World, geyser: Geyser): void {
  if (geyser.crystal !== null || --geyser.timer > 0) {
    return;
  }

  geyser.timer = CRYSTAL_INTERVAL;
  geyser.crystal = world.spawnCrystal(geyser).id;
}
