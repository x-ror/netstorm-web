import { createSkirmish, H, W, type DefTable, type World } from '@netstorm/sim';
import { type Maps, type Mission } from './game-data.js';
import { type MatchOptions } from './menu.js';

export const ME = 1;
export const ENEMY = 2;
// Invented layout: island shapes are not decoded from .fort yet, so both bases are rectangles at
// fixed spots and only the geysers come from the chosen map.
const HOMES = {
  [ME]: { x: 70, y: 150 },
  [ENEMY]: { x: 150, y: 90 },
} as const;
// A lone geyser midway between the bases for maps without geysers.
const FALLBACK_X = 110;
const FALLBACK_Y = 120;
/** Half-size of the rectangular home islands made by createSkirmish, plus a gap of open sky. */
const HOME_REACH_X = 13;
const HOME_REACH_Y = 11;
const MAP_EDGE = 2;

export function createMatchWorld(
  defs: DefTable,
  maps: Maps,
  missions: Mission[],
  options: MatchOptions,
): World {
  const mission = missions.find((m) => m.id === options.mission);
  const geysers = (maps[options.mission]?.geysers ?? []).filter(([x, y]) =>
    x >= MAP_EDGE && y >= MAP_EDGE && x < W - MAP_EDGE && y < H - MAP_EDGE
    && Object.values(HOMES).every((home) =>
      Math.abs(x - home.x) > HOME_REACH_X || Math.abs(y - home.y) > HOME_REACH_Y
    )
  );
  return createSkirmish(defs, options.seed, [
    { id: ME, name: 'Ви', theme: options.theme, ...HOMES[ME], storm: options.storm },
    {
      id: ENEMY,
      name: mission?.enemy || 'Суперник',
      theme: options.enemyTheme,
      ...HOMES[ENEMY],
      storm: options.storm,
    },
  ], geysers.length ? geysers : [[FALLBACK_X, FALLBACK_Y]], {
    bridges: options.bridges,
    slots: options.slots,
    unitRate: options.unitRate,
    killReward: options.killReward,
    geyserStock: options.geyserStock,
  });
}
