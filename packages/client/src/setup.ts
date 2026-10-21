import {
  createMission,
  createSkirmish,
  generateMap,
  H,
  AI_ALIGNMENTS,
  MULTIPLAYER_TECH,
  aiAlignment,
  type Difficulty,
  W,
  type DefTable,
  type World,
} from '@netstorm/sim';
import { type Maps, type Mission } from './game-data.js';
import { type MatchOptions } from './options.js';
import { loadProfile, type Profile } from './profile.js';
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
const EASY_DRAWS = 25;
// oxlint-disable-next-line no-magic-numbers -- Knuth's multiplicative hash and a salt
const [HASH, SIDE_SALT] = [2654435761, 0x9e37];

function inside([x, y]: [number, number]): boolean {
  return x >= MAP_EDGE && y >= MAP_EDGE && x < W - MAP_EDGE && y < H - MAP_EDGE;
}

/**
 * The draw of a computer side's alignment, from the seed: one of 25 for an easy computer, of 16
 * for the others (FUN_00405d00 by AI Difficulty; which of the original's nine our three are is
 * ours), so an easier one is likelier to know the Sun alone.
 */
function alignmentDraw(seed: number, side: number, difficulty: Difficulty): number {
  const draws = difficulty === 'easy' ? EASY_DRAWS : AI_ALIGNMENTS.length;
  return 1 + (Math.imul(seed ^ (side * SIDE_SALT), HASH) >>> 0) % draws;
}

export function createMatchWorld(
  defs: DefTable,
  maps: Maps,
  missions: Mission[],
  options: MatchOptions,
  profile: Profile = loadProfile(),
): World {
  const map = options.mode === 'mission' ? maps[options.mission] : undefined;
  const mission = options.mode === 'mission'
    ? missions.find((entry) => entry.id === options.mission)
    : undefined;
  const enemy = mission?.enemy || m.player_opponent();
  // Who the computer plays: every side but the player's, and his too when the computer plays both.
  const computer = (id: number) =>
    options.opponent === 'watch' || (options.opponent === 'ai' && id !== ME);
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
        ? {
          ...side,
          name: m.player_you(),
          theme: options.theme,
          storm: options.storm,
          ai: computer(id),
        }
        : {
          ...side,
          name: side.name || enemy,
          theme: options.enemyTheme,
          storm: side.storm ?? 0,
          ai: computer(id),
        };
    }, battle);
  }

  // A skirmish is fought on a map made up from its seed: two homes and the islands the menu asks
  // for, with the geysers of a multiplayer battle.
  if (options.mode === 'skirmish') {
    const made = generateMap(options.seed, {
      islands: options.islands,
      sides: [{ id: ME, theme: options.theme }, { id: ENEMY, theme: options.enemyTheme }],
    });
    // The player knows what a multiplayer battle starts with and what the Furies have granted him
    // in the battles before; the computer, the same start and one of the original's alignments.
    return createMission(defs, options.seed, made, (id) => {
      const side = id === ME
        ? { name: m.player_you(), theme: options.theme }
        : { name: enemy, theme: options.enemyTheme };
      let known: readonly string[] = id === ME ? profile.known : [];

      if (computer(id)) {
        known = aiAlignment(alignmentDraw(options.seed, id, options.difficulty)).tech;
      }

      return {
        ...side,
        storm: options.storm,
        tech: [...MULTIPLAYER_TECH, ...known],
        altarLevel: id === ME && !computer(id) ? profile.altarLevel : 1,
        ai: computer(id),
      };
    }, {
      ...battle,
      generatorRange: options.generatorRange,
      multiplayer: {
        spells: options.spells,
        placement: options.geyserPlacement,
        interval: options.geyserInterval,
        respawn: options.geyserRespawn,
        start: options.startGeysers,
      },
    });
  }

  // A mission without a map: both bases are rectangles at fixed spots, each with the Fury the
  // menu gave it, among the map's geysers.
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
