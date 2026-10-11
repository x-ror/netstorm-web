/** Scenario builders. Island shapes are not yet decoded from .fort, so skirmish islands are rectangles;
 *  geyser positions can be taken from data/forts.json (decoded by tools/unfort.py). */
import { World } from './world.js';
import type { Theme } from './defs.js';
import { DefTable } from './defs.js';

export interface SkirmishPlayer { id: number; name: string; theme: Theme; x: number; y: number; storm?: number; tech?: string[] }

const BASE_TECH = ['sunwalker', 'suncannon', 'sunarcher', 'sunblocker', 'sunbattery', 'sunballoon', 'sunaviary', 'sunfence'];

export function createSkirmish(defs: DefTable, seed: number, players: SkirmishPlayer[], geysers: [number, number][]): World {
  const w = new World(defs, seed);
  for (const p of players) if (p.theme === 'sun') throw new Error('a player must follow Wind, Rain or Thunder (Sun has no temple)');
  for (const p of players) {
    const themeTech = [`${p.theme}battery`, `${p.theme}walker`, `${p.theme}cannon`, `${p.theme}archer`, `${p.theme}blocker`, `${p.theme}fence`, `${p.theme}aviary`, `${p.theme}balloon`].filter(t => defs.has(t));
    w.addPlayer(p.id, p.name, p.theme, p.storm ?? 2000, p.tech ?? [...BASE_TECH, ...themeTech]);
    w.addIsland(p.x - 10, p.y - 8, 21, 17, p.id);
    w.spawnBuilding(`${p.theme}vortex`, p.id, p.x - 4, p.y - 3);        // temple
    w.spawnBuilding('altar', p.id, p.x + 2, p.y - 7);
    w.spawnBuilding(`${p.theme}factory`, p.id, p.x - 10, p.y + 1);      // workshop
    w.addPriest(p.id, p.x, p.y + 6);
    w.spawnTransport(p.theme === 'thunder' ? 'bulf' : p.theme === 'sun' ? 'sunwalker' : `${p.theme}walker`, p.id, p.x + 1, p.y + 6);
  }
  for (const [x, y] of geysers) w.addGeyser(x, y);
  return w;
}
