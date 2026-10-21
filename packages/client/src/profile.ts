/**
 * What the player keeps from one skirmish to the next, as the original keeps it in its core data
 * (ch.cpp): the units the Furies have granted him and the Level of his Altar. Remembered per
 * browser; storage may be unavailable.
 */
import {
  MAX_ALTAR_UPGRADES,
  MULTIPLAYER_TECH,
  type DeepReadonly,
  type Player,
} from '@netstorm/sim';

export interface Profile {
  known: string[];
  altarLevel: number;
}

const STORAGE_KEY = 'netstorm.profile';
const EMPTY: Profile = { known: [], altarLevel: 1 };

export function loadProfile(): Profile {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');

    if (saved && typeof saved === 'object') {
      const { known, altarLevel } = saved as Partial<Record<keyof Profile, unknown>>;
      return {
        known: Array.isArray(known) ? known.filter((id) => typeof id === 'string') : [],
        altarLevel: Number.isInteger(altarLevel)
            && (altarLevel as number) >= 1 && (altarLevel as number) <= MAX_ALTAR_UPGRADES + 1
          ? altarLevel as number
          : 1,
      };
    }
  } catch {
    // Blocked storage: a new player.
  }

  return EMPTY;
}

/** Keep what the player knows beyond the start of every battle, and his Altar's Level. */
export function saveProfile(player: DeepReadonly<Player>): void {
  const profile: Profile = {
    known: [...player.tech].filter((id) => !MULTIPLAYER_TECH.includes(id)).sort(),
    altarLevel: player.altarLevel,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Not remembering is harmless.
  }
}
