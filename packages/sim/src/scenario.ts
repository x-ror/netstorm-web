/** Scenario builders. Island shapes are not yet decoded from .fort, so skirmish islands are rectangles;
 *  geyser positions can be taken from data/forts.json (decoded by tools/unfort.py). */
import { World } from './world.js';
import type { Theme, DefTable } from './defs.js';

export interface SkirmishPlayer {
  id: number;
  name: string;
  theme: Theme;
  x: number;
  y: number;
  storm?: number;
  tech?: string[];
}

const DEFAULT_STORM = 2000; // starting Storm Power

const BASE_TECH = [
  'sunwalker',
  'suncannon',
  'sunarcher',
  'sunblocker',
  'sunbattery',
  'sunballoon',
  'sunaviary',
  'sunfence',
];

export function createSkirmish(
  defs: DefTable,
  seed: number,
  players: SkirmishPlayer[],
  geysers: [number, number][],
): World {
  const w = new World(defs, seed);

  for (const p of players) {
    if (p.theme === 'sun') {
      throw new Error('a player must follow Wind, Rain or Thunder (Sun has no temple)');
    }
  }

  for (const p of players) {
    const themeTech = [
      `${p.theme}battery`,
      `${p.theme}walker`,
      `${p.theme}cannon`,
      `${p.theme}archer`,
      `${p.theme}blocker`,
      `${p.theme}fence`,
      `${p.theme}aviary`,
      `${p.theme}balloon`,
    ].filter((t) => defs.has(t));
    w.addPlayer(p.id, p.name, p.theme, p.storm ?? DEFAULT_STORM,
      p.tech ?? [...BASE_TECH, ...themeTech]);
    // oxlint-disable no-magic-numbers -- starting base layout, offsets from the player origin
    w.addIsland(p.x - 10, p.y - 8, 21, 17, p.id);
    w.spawnBuilding(`${p.theme}vortex`, p.id, p.x - 4, p.y - 3); // temple
    w.spawnBuilding('altar', p.id, p.x + 2, p.y - 7);
    w.spawnBuilding(`${p.theme}factory`, p.id, p.x - 10, p.y + 1); // workshop
    w.addPriest(p.id, p.x, p.y + 6);
    const transportType = startingTransport(p.theme);
    w.spawnTransport(transportType, p.id, p.x + 1, p.y + 6);
    // oxlint-enable no-magic-numbers
  }

  for (const [x, y] of geysers) {
    w.addGeyser(x, y);
  }

  return w;
}

function startingTransport(theme: Theme): string {
  if (theme === 'thunder') {
    return 'bulf';
  }

  if (theme === 'sun') {
    return 'sunwalker';
  }

  return `${theme}walker`;
}
