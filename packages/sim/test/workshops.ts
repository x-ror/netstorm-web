import { takesSlot, type World } from '../src/index.js';

const CORNER_Y = 246; // a row of islets along the bottom of the map, out of every test's way
const CORNER_STEP = 10;
const ISLET_W = 8;
const ISLET_H = 7;

/**
 * Let every player build what he knows, as tests written before Production Slots expect: a Sun
 * Workshop on an islet of his own at the bottom of the map, and every Workshop he has making all
 * the units of its Fury he knows, past the slots a Workshop really has.
 */
export function equipWorkshops(w: World): World {
  for (const player of w.players.values()) {
    const x = (player.id - 1) * CORNER_STEP;

    if (!w.buildingsOf(player.id).some((b) => b.type === 'sunfactory')) {
      w.addIsland(x, CORNER_Y, ISLET_W, ISLET_H, player.id);
      w.spawnBuilding('sunfactory', player.id, x, CORNER_Y);
    }

    for (const b of w.buildingsOf(player.id)) {
      const maker = w.def(b.type);

      if (maker.cls !== 'Production') {
        continue;
      }

      b.slots = [...player.tech].filter((id) => {
        const def = w.defs.get(id);
        return def !== undefined && takesSlot(def) && (def.theme ?? 'sun') === maker.theme;
      });
    }
  }

  return w;
}
