import {
  BRIDGE_SETS,
  BRIDGE_SLOTS,
  GEYSER_STOCKS,
  HAND_SIZE,
  KILL_REWARDS,
  UNIT_RATES,
  type BridgeSet,
  type Theme,
} from '@netstorm/sim';
import { type Mission } from './game-data.js';

/** The options of a skirmish, what the start screen sets and the match reads; no DOM here. */

export type PlayableTheme = Exclude<Theme, 'sun'>;
export type Opponent = 'ai' | 'idle';

export interface MatchOptions {
  theme: PlayableTheme;
  enemyTheme: PlayableTheme;
  /** Mission whose geysers and texts the match uses. */
  mission: string;
  storm: number;
  seed: number;
  /** Whether the opponent is played by the computer or stands idle. */
  opponent: Opponent;
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
}

export const PLAYABLE_THEMES: readonly PlayableTheme[] = ['wind', 'rain', 'thunder'];
export const BRIDGE_LABELS: Record<BridgeSet, string> = {
  standard: 'Standard — основний набір',
  traditional: 'Traditional — як у версії 10.37',
  simplified: 'Simplified — лише найкорисніші',
  crazy: 'Crazy — усі форми порівну',
};
export const UNIT_RATE_NAMES = ['Slow', 'Medium', 'Fast', 'Very Fast'];
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
  theme: 'wind',
  enemyTheme: 'rain',
  mission: 'thewarbegins',
  storm: DEFAULT_STORM,
  seed: DEFAULT_SEED,
  opponent: 'ai',
  bridges: 'standard',
  slots: HAND_SIZE,
  unitRate: DEFAULT_UNIT_RATE,
  killReward: DEFAULT_KILL_REWARD,
  geyserStock: DEFAULT_GEYSER_STOCK,
};

/** Options made whole and valid: whatever is missing or not one of an option's values falls back
 * to the default, and a mission the game does not have to the first one it has. */
export function normalizeOptions(
  raw: Partial<Record<keyof MatchOptions, unknown>>,
  missions: readonly Mission[],
): MatchOptions {
  const d = DEFAULT_OPTIONS;
  const mission = missions.some((m) => m.id === raw.mission) ? String(raw.mission) : d.mission;
  return {
    theme: isTheme(raw.theme) ? raw.theme : d.theme,
    enemyTheme: isTheme(raw.enemyTheme) ? raw.enemyTheme : d.enemyTheme,
    mission: missions.some((m) => m.id === mission) ? mission : missions[0]?.id ?? d.mission,
    storm: clamp(Number(raw.storm ?? d.storm), MAX_STORM, d.storm),
    seed: clamp(Number(raw.seed ?? d.seed), MAX_SEED, d.seed),
    opponent: raw.opponent === 'idle' ? 'idle' : 'ai',
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
