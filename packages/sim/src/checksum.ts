import type { WorldView } from './view.js';
import { W, H } from './state.js';

export function hashWorld(world: WorldView, rngState: number, nextId: number): number {
  let h = 0x811c9dc5;
  const byte = (v: number) => {
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
  };
  const uint = (v: number) => {
    byte(v);
    byte(v >>> 8);
    byte(v >>> 16);
    byte(v >>> 24);
  };
  const text = (v: string) => {
    uint(v.length);

    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      byte(c);
      byte(c >>> 8);
    }
  };
  uint(world.tick);
  uint(rngState);
  uint(nextId);
  text(JSON.stringify(world.winner));

  for (let i = 0; i < W * H; i++) {
    byte(world.terrain[i]!);
    byte(world.owner[i]!);
    byte(world.links[i]!);
    uint(world.occupant[i]!);
  }

  uint(world.defs.size);

  for (const [id, def] of world.defs) {
    text(id);
    text(JSON.stringify(def));
  }

  uint(world.entities.size);

  for (const [id, entity] of world.entities) {
    uint(id);
    text(JSON.stringify(entity));
  }

  uint(world.players.size);

  for (const [id, player] of world.players) {
    uint(id);
    text(JSON.stringify({ ...player, tech: [...player.tech].sort() }));
  }

  return h >>> 0;
}
