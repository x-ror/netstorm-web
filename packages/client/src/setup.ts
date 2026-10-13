import { createMission, createSkirmish, H, W, type DefTable, type World } from '@netstorm/sim';
import { type Maps, type Mission } from './game-data.js';
import { type MatchOptions } from './menu.js';

export const ME = 1;
export const ENEMY = 2;
// Where the bases stand when there is no map to play on: rectangles at fixed spots (invented).
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

function inside([x, y]: [number, number]): boolean {
  return x >= MAP_EDGE && y >= MAP_EDGE && x < W - MAP_EDGE && y < H - MAP_EDGE;
}

export function createMatchWorld(
  defs: DefTable,
  maps: Maps,
  missions: Mission[],
  options: MatchOptions,
): World {
  const mission = missions.find((m) => m.id === options.mission);
  const map = maps[options.mission];
  const enemy = mission?.enemy || 'Суперник';
  const battle = {
    bridges: options.bridges,
    slots: options.slots,
    unitRate: options.unitRate,
    killReward: options.killReward,
    geyserStock: options.geyserStock,
    anyCapture: mission?.anyCapture ?? false,
  };

  // A mission is played on its map as the original stores it: the islands, bridges and units of
  // every side. A side with a Temple on the map follows that Temple's Fury.
  if (map?.islands.length) {
    return createMission(defs, options.seed, map, (id) => {
      const side = mission?.sides[id] ?? {};
      return id === ME
        ? { ...side, name: 'Ви', theme: options.theme, storm: options.storm }
        : { ...side, name: side.name || enemy, theme: options.enemyTheme, storm: side.storm ?? 0 };
    }, battle);
  }

  // Without a map both bases are rectangles at fixed spots.
  const geysers = (map?.geysers ?? []).filter(inside).filter(([x, y]) =>
    Object.values(HOMES).every((home) =>
      Math.abs(x - home.x) > HOME_REACH_X || Math.abs(y - home.y) > HOME_REACH_Y
    )
  );
  return createSkirmish(defs, options.seed, [
    { id: ME, name: 'Ви', theme: options.theme, ...HOMES[ME], storm: options.storm },
    { id: ENEMY, name: enemy, theme: options.enemyTheme, ...HOMES[ENEMY], storm: options.storm },
  ], geysers.length ? geysers : [[FALLBACK_X, FALLBACK_Y]], battle);
}
