/** A skirmish on rectangular islands, for tests and for maps that bring no islands. Missions are
 * built from the original's maps in mission.ts. */
import { World } from './world.js';
import { startGeysers } from './rules/geysers.js';
import { startObelisks } from './rules/spells.js';
import type { Theme, DefTable } from './defs.js';
import {
  BRIDGE_SETS,
  BRIDGE_SLOTS,
  DEFAULT_KILL_REWARD,
  DEFAULT_UNIT_RATE,
  GEYSER_INTERVALS,
  GEYSER_PLACEMENTS,
  GEYSER_RESPAWNS,
  GEYSER_STOCK,
  GEYSER_STOCKS,
  STARTING_GEYSERS,
  type GeyserPlacement,
  SPELL_OPTIONS,
  type SpellOption,
  HAND_SIZE,
  KILL_REWARDS,
  UNIT_RATES,
  type BridgeSet,
  DEVASTATION,
  OUTPOST,
} from './state.js';

/** The battle options of a skirmish; what is left out, or is not a value of the option, takes the
 * campaign's value. */
export interface SkirmishOptions {
  bridges?: BridgeSet;
  slots?: number;
  /** Seconds, one of UNIT_RATES. */
  unitRate?: number;
  /** Per cent, one of KILL_REWARDS. */
  killReward?: number;
  /** Storm Power, one of GEYSER_STOCKS. */
  geyserStock?: number;
  /** `allowAnyCapture` of a mission: friendly Priests may be carried off to safety. */
  anyCapture?: boolean;
  /** A battle of multiplayer, with its geyser options, which also make the geysers of the start.
   * Left out, a battle of the campaign: the map's geysers and the campaign's rules. */
  multiplayer?: MultiplayerOptions;
}

export interface MultiplayerOptions {
  spells?: SpellOption;
  placement?: GeyserPlacement;
  /** Seconds, one of GEYSER_INTERVALS. */
  interval?: number;
  /** One of GEYSER_RESPAWNS. */
  respawn?: number;
  /** One of STARTING_GEYSERS. */
  start?: number;
}

/** The start of a multiplayer battle: its geysers, and its machinery for new ones. */
export function startBattle(w: World, options: SkirmishOptions): void {
  const g = options.multiplayer;

  if (g) {
    w.multiplayer = true;
    w.spells = SPELL_OPTIONS.find((s) => s === g.spells) ?? 'none';

    if (w.spells === 'obelisks') {
      startObelisks(w);
    }

    startGeysers(w, {
      placement: GEYSER_PLACEMENTS.find((p) => p === g.placement) ?? DEFAULT_PLACEMENT,
      interval: pick(GEYSER_INTERVALS, g.interval, DEFAULT_INTERVAL),
      respawn: pick(GEYSER_RESPAWNS, g.respawn, 1),
      start: pick(STARTING_GEYSERS, g.start, 1),
    });
  }
}

function pick(values: readonly number[], value: number | undefined, fallback: number): number {
  return values.find((allowed) => allowed === value) ?? fallback;
}

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
// The multiplayer defaults of netstorm.game 10.82: Balanced, 1 Min.
const DEFAULT_PLACEMENT: GeyserPlacement = 'balanced';
const DEFAULT_INTERVAL = 60;

/** What a player knows at the start of a multiplayer battle before what the Furies have granted
 * him (FUN_004be9e0): the Golem, Disc Thrower, Sun Cannon, Stone Tower and Sun Generator. And the
 * Outpost and the Devastation he may pray for, which no Knowledge gates. */
export const MULTIPLAYER_TECH: readonly string[] = [
  'sunwalker',
  'sunarcher',
  'suncannon',
  'sunblocker',
  'sunbattery',
  OUTPOST,
  DEVASTATION,
];

/**
 * What a computer player knows in a multiplayer battle: one of these alignments, drawn at random
 * (FUN_00405d00, "%s of Summer" and so on). A draw past the fifteen gives the Sun one.
 */
export const AI_ALIGNMENTS: readonly { name: string; tech: readonly string[]; }[] = [
  [
    'Summer',
    'sunWalker;sunCannon;sunArcher;windBattery;windWalker;windBalloon;windBlocker;windAviary',
  ],
  [
    'Spring',
    'sunWalker;sunCannon;sunArcher;rainBattery;rainWalker;rainBalloon;rainBlocker;rainAviary',
  ],
  [
    'Power',
    'sunWalker;sunBalloon;sunCannon;sunAviary;thunderBattery;bulf;thunderArcher;thunderBlocker',
  ],
  [
    'Deserts',
    'sunWalker;windBattery;windArcher;windWalker;sunBalloon;sunCannon;sunBlocker;sunAviary',
  ],
  [
    'Wind',
    'sunWalker;sunCannon;windBattery;windArcher;windWalker;windBlocker;windAviary;windBalloon',
  ],
  [
    'Typhoons',
    'sunWalker;windBattery;windArcher;windWalker;rainBattery;rainBalloon;rainCannon;rainBlocker;rainAviary',
  ],
  [
    'Hurricanes',
    'sunWalker;windBattery;windArcher;windWalker;windBalloon;windAviary;thunderBattery;thunderCannon;thunderBlocker',
  ],
  [
    'Rainbows',
    'sunWalker;rainBattery;rainCannon;rainWalker;sunBalloon;sunArcher;sunBlocker;sunAviary',
  ],
  [
    'Blizzards',
    'sunWalker;rainBattery;rainCannon;rainWalker;windBattery;windArcher;windBlocker;windAviary;windBalloon',
  ],
  [
    'Rain',
    'sunWalker;sunArcher;rainBattery;rainCannon;rainWalker;rainBlocker;rainAviary;rainBalloon',
  ],
  [
    'the Monsoon',
    'sunWalker;rainBattery;rainWalker;rainBalloon;rainCannon;rainAviary;thunderBattery;thunderArcher;thunderBlocker',
  ],
  ['Rays', 'sunWalker;thunderBattery;bulf;thunderCannon;sunBalloon;sunArcher;sunBlocker;sunAviary'],
  [
    'Gales',
    'sunWalker;thunderBattery;bulf;thunderCannon;windBattery;windArcher;windBlocker;windAviary',
  ],
  [
    'Hail',
    'sunWalker;thunderBattery;bulf;thunderCannon;thunderArcher;rainBattery;rainBalloon;rainBlocker;rainAviary',
  ],
  [
    'Thunder',
    'sunWalker;thunderBattery;thunderCannon;thunderArcher;bulf;thunderBlocker;sunAviary;sunBalloon',
  ],
  ['Sun', 'sunWalker;sunBattery;sunCannon;sunArcher;sunBlocker;sunAviary;sunBalloon'],
].map(([name, tech]) => ({ name: name!, tech: tech!.toLowerCase().split(';') }));

/** The alignment of a draw from 1: the AI Difficulty sets how many there are to draw from. The
 * lowest draws 1 to 150, the next 1 to 25, the rest 1 to 16, so the weaker the computer, the
 * likelier it is all Sun. */
export function aiAlignment(draw: number): { name: string; tech: readonly string[]; } {
  return AI_ALIGNMENTS[Math.min(draw, AI_ALIGNMENTS.length) - 1]!;
}

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

/** Set the battle options of a world. */
export function applyOptions(w: World, options: SkirmishOptions): void {
  w.bridgeSet = Math.max(0, BRIDGE_SETS.indexOf(options.bridges ?? 'standard'));
  w.bridgeSlots = pick(BRIDGE_SLOTS, options.slots, HAND_SIZE);
  w.unitRate = pick(UNIT_RATES, options.unitRate, DEFAULT_UNIT_RATE);
  w.killReward = pick(KILL_REWARDS, options.killReward, DEFAULT_KILL_REWARD);
  w.geyserStock = pick(GEYSER_STOCKS, options.geyserStock, GEYSER_STOCK);
  w.anyCapture = options.anyCapture ?? false;
}

/** What a player of a Fury knows at the start: the Sun units and those of his own Fury. */
export function skirmishTech(defs: DefTable, theme: Theme): string[] {
  const themeTech = [
    `${theme}battery`,
    `${theme}walker`,
    `${theme}cannon`,
    `${theme}archer`,
    `${theme}blocker`,
    `${theme}fence`,
    `${theme}aviary`,
    `${theme}balloon`,
  ].filter((t) => defs.has(t));
  return [...BASE_TECH, ...themeTech];
}

export function createSkirmish(
  defs: DefTable,
  seed: number,
  players: SkirmishPlayer[],
  geysers: [number, number][],
  options: SkirmishOptions = {},
): World {
  const w = new World(defs, seed);
  applyOptions(w, options);

  for (const p of players) {
    if (p.theme === 'sun') {
      throw new Error('a player must follow Wind, Rain or Thunder (Sun has no temple)');
    }
  }

  for (const p of players) {
    w.addPlayer(p.id, p.name, p.theme, p.storm ?? DEFAULT_STORM,
      p.tech ?? [...skirmishTech(defs, p.theme), OUTPOST, DEVASTATION]);

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

  startBattle(w, options);
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
