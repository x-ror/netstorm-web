/**
 * The sounds of the battle. Which sound a unit makes for what comes from its .type file
 * (scripts/sounds.py); a few events of the battle have a sound matched to them by its name, which
 * is ours. A sound is not heard more often than every tenth of a second, and not at all when muted.
 * A sound made at a place is as loud as that place is near the middle of the screen.
 */

/** data/sounds.json: each sound's file and volume, and the sounds of each unit type. */
export interface SoundIndex {
  files: Record<string, [path: string, volume: number]>;
  units: Record<string, Partial<Record<UnitSound, string>>>;
}

export type UnitSound = 'fire' | 'impact' | 'active' | 'pickup' | 'drop' | 'move' | 'built';

const MIN_GAP_MS = 100;

/** Where something sounds, in the pixels the map is drawn in. */
export type Place = { x: number; y: number; };

export interface Sounds {
  /** Play a sound by its name; an unknown name is silence. With a place, it fades with distance. */
  play(name: string | undefined, at?: Place): void;
  /** Play what a unit type sounds like when it does something. */
  unit(type: string, what: UnitSound, at?: Place): void;
  muted: boolean;
  /** The sounds there are, and those of each unit type. */
  index: SoundIndex;
  /** How loud a sound made at a place is heard, 0 to 1; a match sets it from its camera. */
  heard: (at: Place) => number;
}

/** Map pixels from the middle of the screen within which a sound is heard in full, and those
 * over which it then fades to the faintest it gets. All ours: the original is not read. */
const FULL_REACH = 320;
const FADE_REACH = 960;
const FAINTEST = 0.08;

/** How loud a sound is heard `far` map pixels from the middle of the screen. */
export function loudness(far: number): number {
  const faded = 1 - (far - FULL_REACH) / FADE_REACH;
  return Math.min(1, Math.max(FAINTEST, faded));
}

/** The name of the sound a unit type makes for something, if it has one. */
export function unitSound(index: SoundIndex, type: string, what: UnitSound): string | undefined {
  return index.units[type]?.[what];
}

export function createSounds(index: SoundIndex): Sounds {
  const last = new Map<string, number>();
  const sounds: Sounds = {
    muted: false,
    index,
    heard: () => 1,
    play(name, at) {
      const file = name === undefined ? undefined : index.files[name];
      const now = performance.now();

      if (!file || sounds.muted || now - (last.get(name!) ?? -Infinity) < MIN_GAP_MS) {
        return;
      }

      last.set(name!, now);
      const audio = new Audio(file[0]);
      audio.volume = file[1] * (at ? sounds.heard(at) : 1);
      // A browser may refuse sound before the player has touched the page: then it stays silent.
      audio.play().catch(() => undefined);
    },
    unit(type, what, at) {
      sounds.play(unitSound(index, type, what), at);
    },
  };
  return sounds;
}
