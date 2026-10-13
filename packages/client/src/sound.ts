/**
 * The sounds of the battle. Which sound a unit makes for what comes from its .type file
 * (scripts/sounds.py); a few events of the battle have a sound matched to them by its name, which
 * is ours. A sound is not heard more often than every tenth of a second, and not at all when muted.
 */

/** data/sounds.json: each sound's file and volume, and the sounds of each unit type. */
export interface SoundIndex {
  files: Record<string, [path: string, volume: number]>;
  units: Record<string, Partial<Record<UnitSound, string>>>;
}

export type UnitSound = 'fire' | 'impact' | 'active' | 'pickup' | 'drop' | 'move' | 'built';

const MIN_GAP_MS = 100;

export interface Sounds {
  /** Play a sound by its name; an unknown name is silence. */
  play(name: string | undefined): void;
  /** Play what a unit type sounds like when it does something. */
  unit(type: string, what: UnitSound): void;
  muted: boolean;
}

/** The name of the sound a unit type makes for something, if it has one. */
export function unitSound(index: SoundIndex, type: string, what: UnitSound): string | undefined {
  return index.units[type]?.[what];
}

export function createSounds(index: SoundIndex): Sounds {
  const last = new Map<string, number>();
  const sounds: Sounds = {
    muted: false,
    play(name) {
      const file = name === undefined ? undefined : index.files[name];
      const now = performance.now();

      if (!file || sounds.muted || now - (last.get(name!) ?? -Infinity) < MIN_GAP_MS) {
        return;
      }

      last.set(name!, now);
      const audio = new Audio(file[0]);
      audio.volume = file[1];
      // A browser may refuse sound before the player has touched the page: then it stays silent.
      audio.play().catch(() => undefined);
    },
    unit(type, what) {
      sounds.play(unitSound(index, type, what));
    },
  };
  return sounds;
}
