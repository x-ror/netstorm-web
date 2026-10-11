import type { WorldView } from '../src/index.js';

/** Compile-only assertions; these operations must not be available to client code. */
export function readonlyContract(view: WorldView): void {
  // @ts-expect-error The map has no mutation API.
  view.entities.clear();
  // @ts-expect-error Terrain cells are read-only.
  view.terrain[0] = 1;
  // @ts-expect-error Gameplay mutation is not part of the view.
  view.step();
  // @ts-expect-error Query implementations cannot be replaced through the view.
  view.energy = () => ({ own: 0, any: 0 });
  const player = view.players.get(1);

  if (player) {
    // @ts-expect-error Player state is read-only.
    player.storm = 0;
    // @ts-expect-error Technology sets are read-only.
    player.tech.clear();
  }

  const priest = view.priestOf(1);

  if (priest) {
    // @ts-expect-error Query results are deeply read-only.
    priest.path.push([0, 0]);
  }
}
