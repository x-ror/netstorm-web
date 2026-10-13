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
/**
 * The air of the Pyrosphere. The game's code names a distant thunder and an eagle's scream among
 * its sounds, and the sound files have a quiet wind and a whale beside them; how the original
 * mixes them is not read. Here the wind loops and one of the others sounds every 20 to 60 s.
 */
const WIND = 'distantwindquiet';
const FAR_OFF = ['thunderquietdistant', 'eaglescream', 'whale'] as const;
const FAR_OFF_MIN_MS = 20_000;
const FAR_OFF_SPREAD_MS = 40_000;

/** Where something sounds, in the pixels the map is drawn in. */
export type Place = { x: number; y: number; };

export interface Sounds {
  /** Play a sound by its name; an unknown name is silence. With a place, it fades with distance. */
  play(name: string | undefined, at?: Place): void;
  /** Play what a unit type sounds like when it does something. */
  unit(type: string, what: UnitSound, at?: Place): void;
  /** Start or stop the air of the place: a wind that loops, and far-off sounds now and then. */
  ambience(on: boolean): void;
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
  let wind: HTMLAudioElement | undefined;
  let farOff: ReturnType<typeof setTimeout> | undefined;
  /** Keep the wind in step with the mute button, which may change at any time. */
  const breathe = () => {
    if (wind && sounds.muted !== wind.paused) {
      void (sounds.muted ? wind.pause() : wind.play().catch(() => undefined));
    }
  };
  // Which far-off sound comes and when is chance: it is only heard, never part of the battle.
  const later = () => {
    farOff = setTimeout(() => {
      sounds.play(FAR_OFF[Math.floor(Math.random() * FAR_OFF.length)]);
      breathe();
      later();
    }, FAR_OFF_MIN_MS + Math.random() * FAR_OFF_SPREAD_MS);
  };
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
    ambience(on) {
      clearTimeout(farOff);
      wind?.pause();
      wind = undefined;
      const file = index.files[WIND];

      if (!on || !file) {
        return;
      }

      wind = new Audio(file[0]);
      wind.loop = true;
      wind.volume = file[1];
      wind.pause();
      breathe();
      later();
    },
    unit(type, what, at) {
      sounds.play(unitSound(index, type, what), at);
    },
  };
  return sounds;
}
