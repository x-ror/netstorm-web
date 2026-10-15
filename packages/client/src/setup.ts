import {
  createMission,
  createSkirmish,
  H,
  W,
  type DefTable,
  type MissionMap,
  type World,
} from '@netstorm/sim';
import { type Maps, type Mission } from './game-data.js';
import { type MatchOptions, type PlayableTheme } from './options.js';
import { m } from './paraglide/messages.js';

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

const PRIEST = 'priest';
const TEMPLE = /vortex$/;

/**
 * The map of a mission cleared for a skirmish: its islands and geysers, and on them only the
 * Temple and the Priest of each of the two sides, the Temple turned to the Fury the menu gave.
 * Every Temple stands on the same 8×6 cells, so the swap moves nothing. Null when the map does
 * not hold both sides' Priests, as a mission played alone does not.
 */
function skirmishMap(map: MissionMap, furies: Record<number, PlayableTheme>): MissionMap | null {
  const units = map.units
    .filter(([type, owner]) => owner in furies && (type === PRIEST || TEMPLE.test(type)))
    .map(([type, owner, x, y, frame]): MissionMap['units'][number] => [
      type === PRIEST ? type : `${furies[owner]}vortex`,
      owner,
      x,
      y,
      frame,
    ]);
  const priests = new Set(units.filter(([type]) => type === PRIEST).map(([, owner]) => owner));
  return priests.size === Object.keys(furies).length
    ? { islands: map.islands, geysers: map.geysers, bridges: [], units }
    : null;
}

function inside([x, y]: [number, number]): boolean {
  return x >= MAP_EDGE && y >= MAP_EDGE && x < W - MAP_EDGE && y < H - MAP_EDGE;
}

export function createMatchWorld(
  defs: DefTable,
  maps: Maps,
  missions: Mission[],
  options: MatchOptions,
): World {
  const map = maps[options.mission];
  // A skirmish takes the map of a mission and nothing else of it: not its opponent, not its rules.
  const mission = options.mode === 'mission'
    ? missions.find((entry) => entry.id === options.mission)
    : undefined;
  const enemy = mission?.enemy || m.player_opponent();
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
  if (options.mode === 'mission' && map?.islands.length) {
    return createMission(defs, options.seed, map, (id) => {
      const side = mission?.sides[id] ?? {};
      return id === ME
        ? { ...side, name: m.player_you(), theme: options.theme, storm: options.storm }
        : { ...side, name: side.name || enemy, theme: options.enemyTheme, storm: side.storm ?? 0 };
    }, battle);
  }

  // A skirmish is fought on the map's own islands, from the bases its two sides hold there.
  const cleared = options.mode === 'skirmish' && map?.islands.length
    ? skirmishMap(map, { [ME]: options.theme, [ENEMY]: options.enemyTheme })
    : null;

  if (cleared) {
    return createMission(defs, options.seed, cleared, (id) => ({
      name: id === ME ? m.player_you() : enemy,
      theme: id === ME ? options.theme : options.enemyTheme,
      storm: options.storm,
    }), battle);
  }

  // Without a map, or on one with a single side: both bases are rectangles at fixed spots, each
  // with the Fury the menu gave it, among the map's geysers.
  const geysers = (map?.geysers ?? []).filter(inside).filter(([x, y]) =>
    Object.values(HOMES).every((home) =>
      Math.abs(x - home.x) > HOME_REACH_X || Math.abs(y - home.y) > HOME_REACH_Y
    )
  );
  return createSkirmish(defs, options.seed, [
    { id: ME, name: m.player_you(), theme: options.theme, ...HOMES[ME], storm: options.storm },
    { id: ENEMY, name: enemy, theme: options.enemyTheme, ...HOMES[ENEMY], storm: options.storm },
  ], geysers.length ? geysers : [[FALLBACK_X, FALLBACK_Y]], battle);
}
