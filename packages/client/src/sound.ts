/**
 * The sounds of the battle, played through Web Audio. Which sound a unit makes for what comes from
 * its .type file (scripts/sounds.py); a few events of the battle have a sound matched to them by
 * its name, which is ours. Each file is fetched and decoded once and played from memory. A sound is
 * not heard more often than every tenth of a second, nor more than a few of the same at once, and
 * not at all when muted. A sound made at a place is as loud as that place is near the middle of the
 * screen, and comes from the side of the screen it is on.
 */

/** data/sounds.json: each sound's file and volume, and the sounds of each unit type. */
export interface SoundIndex {
  files: Record<string, [path: string, volume: number]>;
  units: Record<string, Partial<Record<UnitSound, string>>>;
}

export type UnitSound = 'fire' | 'impact' | 'active' | 'pickup' | 'drop' | 'move' | 'built';

const MIN_GAP_MS = 100;
/** The same sound playing at once at most: a volley of a dozen guns is not a dozen times louder. */
const MAX_VOICES = 4;
/** A sound whose file comes later than this after it was asked for is not played: it would be heard
 * after what it belongs to. */
const LATE_MS = 250;
/** How far to one side a sound at the edge of the screen is heard, -1 to 1 being all the way. */
const PAN_REACH = 0.7;
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
  /** Play a track of the original's music (music/<name>.mp3), in place of the one playing; null
   * stops it. `ended` is told when the track has played to its end; a looping one never ends. */
  music(name: string | null, loop?: boolean, ended?: () => void): void;
  muted: boolean;
  /** The sounds there are, and those of each unit type. */
  index: SoundIndex;
  /** How loud a sound made at a place is heard, 0 to 1; a match sets it from its camera. */
  heard: (at: Place) => number;
  /** Which side a sound made at a place comes from, -1 (left) to 1 (right); set like `heard`. */
  side: (at: Place) => number;
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

/** Which side a sound `dx` pixels right of the middle of a screen `half` pixels half-wide comes
 * from: -PAN_REACH at the left edge or beyond, PAN_REACH at the right. */
export function sideOf(dx: number, half: number): number {
  return half > 0 ? Math.max(-1, Math.min(1, dx / half)) * PAN_REACH : 0;
}

/** The name of the sound a unit type makes for something, if it has one. */
export function unitSound(index: SoundIndex, type: string, what: UnitSound): string | undefined {
  return index.units[type]?.[what];
}

export function createSounds(index: SoundIndex): Sounds {
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let muted = false;
  const buffers = new Map<string, Promise<AudioBuffer | undefined>>();
  const last = new Map<string, number>();
  const voices = new Map<string, number>();
  let wind: AudioBufferSourceNode | undefined;
  /** Which start of the ambience is the current one: a wind that loads after it was stopped, or
   * after it was started again, is not played. */
  let airs = 0;
  let farOff: ReturnType<typeof setTimeout> | undefined;
  let track: HTMLAudioElement | undefined;

  /** The audio of the page, made on first need. A browser keeps it silent until the player has
   * touched the page; the first press or key wakes it. Without Web Audio (tests), none. */
  const audio = (): AudioContext | undefined => {
    if (context || typeof AudioContext === 'undefined') {
      return context;
    }

    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(context.destination);
    const wake = () => void context?.resume().catch(() => undefined);

    for (const kind of ['pointerdown', 'keydown'] as const) {
      window.addEventListener(kind, wake, { capture: true });
    }

    return context;
  };
  /** A sound's file, fetched and decoded once; undefined if there is none or it will not decode. */
  const load = (name: string): Promise<AudioBuffer | undefined> => {
    let found = buffers.get(name);

    if (!found) {
      const file = index.files[name];
      const ctx = audio();
      found = file && ctx
        ? fetch(file[0]).then((response) => response.arrayBuffer())
          .then((bytes) => ctx.decodeAudioData(bytes))
          .catch(() => undefined)
        : Promise.resolve(undefined);
      buffers.set(name, found);
    }

    return found;
  };
  const release = (name: string) => voices.set(name, Math.max(0, (voices.get(name) ?? 1) - 1));
  // Which far-off sound comes and when is chance: it is only heard, never part of the battle.
  const later = () => {
    farOff = setTimeout(() => {
      sounds.play(FAR_OFF[Math.floor(Math.random() * FAR_OFF.length)]);
      later();
    }, FAR_OFF_MIN_MS + Math.random() * FAR_OFF_SPREAD_MS);
  };
  const sounds: Sounds = {
    get muted() {
      return muted;
    },
    set muted(value) {
      muted = value;

      if (master) {
        master.gain.value = value ? 0 : 1;
      }
    },
    index,
    heard: () => 1,
    side: () => 0,
    play(name, at) {
      const file = name === undefined ? undefined : index.files[name];
      const now = performance.now();

      if (
        !file || muted || now - (last.get(name!) ?? -Infinity) < MIN_GAP_MS
        || (voices.get(name!) ?? 0) >= MAX_VOICES
      ) {
        return;
      }

      last.set(name!, now);
      voices.set(name!, (voices.get(name!) ?? 0) + 1);
      // Where it sounds is taken now: the camera may have moved by the time the file is ready.
      const volume = file[1] * (at ? sounds.heard(at) : 1);
      const pan = at ? sounds.side(at) : 0;

      void load(name!).then((buffer) => {
        if (!buffer || !context || !master || performance.now() - now > LATE_MS) {
          release(name!);
          return;
        }

        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = volume;
        const panner = context.createStereoPanner();
        panner.pan.value = pan;
        source.connect(gain).connect(panner).connect(master);
        source.addEventListener('ended', () => release(name!));
        source.start();
      });
    },
    ambience(on) {
      clearTimeout(farOff);
      wind?.stop();
      wind = undefined;
      const air = ++airs;
      const file = index.files[WIND];

      if (!on || !file) {
        return;
      }

      // A match is about to be heard: every sound is fetched now, so none comes late in battle.
      for (const name of Object.keys(index.files)) {
        void load(name);
      }

      void load(WIND).then((buffer) => {
        if (!buffer || !context || !master || air !== airs) {
          return;
        }

        wind = context.createBufferSource();
        wind.buffer = buffer;
        wind.loop = true;
        const gain = context.createGain();
        gain.gain.value = file[1];
        wind.connect(gain).connect(master);
        wind.start();
      });
      later();
    },
    unit(type, what, at) {
      sounds.play(unitSound(index, type, what), at);
    },
    music(name, loop = false, ended) {
      track?.pause();
      track = undefined;
      const ctx = audio();

      if (name === null || !ctx || !master || typeof Audio === 'undefined') {
        return;
      }

      // A track is streamed, not decoded whole: it goes through the same switch as every sound.
      const playing = new Audio(`music/${name}.mp3`);
      playing.loop = loop;
      playing.addEventListener('ended', () => {
        if (track === playing) {
          ended?.();
        }
      });
      ctx.createMediaElementSource(playing).connect(master);
      track = playing;
      // Until the player has touched the page the browser refuses to play; the first touch does.
      const start = () => {
        if (track === playing) {
          void playing.play().catch(() => undefined);
        }
      };
      void playing.play().catch(() => {
        window.addEventListener('pointerdown', start, { once: true, capture: true });
      });
    },
  };
  return sounds;
}
