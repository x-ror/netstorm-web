import {
  BRIDGE_SETS,
  BRIDGE_SLOTS,
  DIFFICULTIES,
  GEYSER_INTERVALS,
  GEYSER_PLACEMENTS,
  GEYSER_RESPAWNS,
  GEYSER_STOCKS,
  HAND_SIZE,
  STARTING_GEYSERS,
  KILL_REWARDS,
  UNIT_RATES,
  type BridgeSet,
  type Difficulty,
  type GeyserPlacement,
  type Theme,
} from '@netstorm/sim';
import { type Mission } from './game-data.js';
import { m } from './paraglide/messages.js';

/** The options of a skirmish, what the start screen sets and the match reads; no DOM here. */

export type PlayableTheme = Exclude<Theme, 'sun'>;
/** Who plays the other side: the computer, nobody, or the computer on both sides to watch. */
export type Opponent = 'ai' | 'idle' | 'watch';

export interface MatchOptions {
  /** A mission played as its file sets it up, or a skirmish on its map between the Furies chosen. */
  mode: 'mission' | 'skirmish';
  theme: PlayableTheme;
  enemyTheme: PlayableTheme;
  /** The mission played, or the one whose map's geysers a skirmish is fought among. */
  mission: string;
  storm: number;
  seed: number;
  /** Whether the opponent is played by the computer or stands idle. */
  opponent: Opponent;
  /** How well the computer plays a skirmish; the campaign's missions set their own pace. */
  difficulty: Difficulty;
  /** Islands of a skirmish's made-up map, the two homes included. */
  islands: number;
  /** "Starting Geysers": what the count of a skirmish's geysers at the start is multiplied by. */
  startGeysers: number;
  /** "Geyser Placement", "Geyser Interval" (seconds) and "Geyser Respawn" of a skirmish. */
  geyserPlacement: GeyserPlacement;
  geyserInterval: number;
  geyserRespawn: number;
  /** The "Bridges" battle option: which set of pieces the Temples hand out. */
  bridges: BridgeSet;
  /** The "Bridge Slots" battle option: pieces the Production Window holds. */
  slots: number;
  /** "Unit Rate": seconds before the same unit can be laid again. */
  unitRate: number;
  /** "Kill Reward": per cent of a destroyed enemy unit's cost. */
  killReward: number;
  /** "Money per Geyser": Storm Power a geyser holds. */
  geyserStock: number;
  /** The language of the interface and the missions' texts: Ukrainian, or the original's English. */
  lang: 'uk' | 'en';
}

export const PLAYABLE_THEMES: readonly PlayableTheme[] = ['wind', 'rain', 'thunder'];
export const OPPONENTS: readonly Opponent[] = ['ai', 'idle', 'watch'];
/* oxlint-disable no-magic-numbers -- the choices the menu offers */
export const ISLAND_COUNTS: readonly number[] = [2, 4, 6, 9];
/* oxlint-enable no-magic-numbers */
export const BRIDGE_LABELS: Record<BridgeSet, () => string> = {
  standard: m.bridges_standard,
  traditional: m.bridges_traditional,
  simplified: m.bridges_simplified,
  crazy: m.bridges_crazy,
};
export const DIFFICULTY_LABELS: Record<Difficulty, () => string> = {
  easy: m.menu_easy,
  normal: m.menu_normal,
  hard: m.menu_hard,
};
export const UNIT_RATE_NAMES = ['Slow', 'Medium', 'Fast', 'Very Fast'];
export const STARTING_GEYSER_LABELS: (() => string)[] = [
  m.menu_none,
  m.menu_geysers_fewer,
  m.menu_normal,
  m.menu_geysers_extra,
  m.menu_geysers_insane,
];
export const GEYSER_PLACEMENT_LABELS: Record<GeyserPlacement, () => string> = {
  none: m.menu_none,
  traditional: m.menu_placement_traditional,
  balanced: m.menu_placement_balanced,
};
export const MAX_STORM = 100_000;
export const MAX_SEED = 0x7fffffff;
// The campaign's values, which the simulation takes when an option is left alone.
const DEFAULT_UNIT_RATE = 4;
const DEFAULT_KILL_REWARD = 25;
const DEFAULT_GEYSER_STOCK = 2000;
const DEFAULT_SEED = 42;
const DEFAULT_STORM = 2000;
const STORAGE_KEY = 'netstorm.menu';

export const DEFAULT_OPTIONS: MatchOptions = {
  mode: 'mission',
  theme: 'wind',
  enemyTheme: 'rain',
  mission: 'thewarbegins',
  storm: DEFAULT_STORM,
  seed: DEFAULT_SEED,
  opponent: 'ai',
  difficulty: 'normal',
  islands: 4,
  startGeysers: 1,
  geyserPlacement: 'balanced',
  geyserInterval: 60,
  geyserRespawn: 1,
  bridges: 'standard',
  slots: HAND_SIZE,
  unitRate: DEFAULT_UNIT_RATE,
  killReward: DEFAULT_KILL_REWARD,
  geyserStock: DEFAULT_GEYSER_STOCK,
  lang: 'uk',
};

/** Options made whole and valid: whatever is missing or not one of an option's values falls back
 * to the default, and a mission the game does not have to the first one it has. */
export function normalizeOptions(
  raw: Partial<Record<keyof MatchOptions, unknown>>,
  missions: readonly Mission[],
): MatchOptions {
  const d = DEFAULT_OPTIONS;
  const mission = missions.some((entry) => entry.id === raw.mission)
    ? String(raw.mission)
    : d.mission;
  return {
    mode: raw.mode === 'skirmish' ? 'skirmish' : 'mission',
    theme: isTheme(raw.theme) ? raw.theme : d.theme,
    enemyTheme: isTheme(raw.enemyTheme) ? raw.enemyTheme : d.enemyTheme,
    mission: missions.some((entry) => entry.id === mission)
      ? mission
      : missions[0]?.id ?? d.mission,
    storm: clamp(given(raw.storm, d.storm), MAX_STORM, d.storm),
    seed: clamp(given(raw.seed, d.seed), MAX_SEED, d.seed),
    opponent: OPPONENTS.find((id) => id === raw.opponent) ?? d.opponent,
    islands: oneOf(ISLAND_COUNTS, Number(raw.islands), d.islands),
    startGeysers: oneOf(STARTING_GEYSERS, Number(raw.startGeysers), d.startGeysers),
    geyserPlacement: GEYSER_PLACEMENTS.find((id) => id === raw.geyserPlacement)
      ?? d.geyserPlacement,
    geyserInterval: oneOf(GEYSER_INTERVALS, Number(raw.geyserInterval), d.geyserInterval),
    geyserRespawn: oneOf(GEYSER_RESPAWNS, Number(raw.geyserRespawn), d.geyserRespawn),
    difficulty: DIFFICULTIES.find((id) => id === raw.difficulty) ?? d.difficulty,
    lang: raw.lang === 'en' ? 'en' : 'uk',
    bridges: BRIDGE_SETS.find((id) => id === raw.bridges) ?? d.bridges,
    slots: oneOf(BRIDGE_SLOTS, Number(raw.slots), d.slots),
    unitRate: oneOf(UNIT_RATES, Number(raw.unitRate), d.unitRate),
    killReward: oneOf(KILL_REWARDS, Number(raw.killReward), d.killReward),
    geyserStock: oneOf(GEYSER_STOCKS, Number(raw.geyserStock), d.geyserStock),
  };
}

/** The last options, remembered per browser; storage may be unavailable. */
export function loadOptions(missions: readonly Mission[]): MatchOptions {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');

    if (saved && typeof saved === 'object') {
      return normalizeOptions(saved as Partial<Record<keyof MatchOptions, unknown>>, missions);
    }
  } catch {
    // Private windows and blocked storage fall back to the defaults.
  }

  return normalizeOptions({}, missions);
}

export function saveOptions(options: MatchOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Not remembering the choice is harmless.
  }
}

/** A number the player gave: an emptied field (null) is 0, a missing one the default. */
function given(value: unknown, fallback: number): number {
  return value === undefined ? fallback : Number(value ?? 0);
}

function clamp(value: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : fallback;
}

function isTheme(value: unknown): value is PlayableTheme {
  return PLAYABLE_THEMES.includes(value as PlayableTheme);
}

/** The value if the option has it, otherwise the fallback. */
function oneOf(values: readonly number[], value: number, fallback: number): number {
  return values.find((allowed) => allowed === value) ?? fallback;
}
