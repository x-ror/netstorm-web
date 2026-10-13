import { SLOT_COUNTS } from './animations.js';

/** The pseudo-gif under which the manifest lists frames by slot. */
export const SLOT_GIF = '@';
/** Grass tile sets of island ground by owner's Fury; `rgrass` is our guess for unowned rock. */
export const GROUND_TILES = {
  wind: 'wigrass',
  rain: 'ragrass',
  thunder: 'thgrass',
  neutral: 'rgrass',
} as const;
/** Frames of each grass set picked for variety; every set has these. */
export const GROUND_FRAMES = [4, 5, 47, 48, 51, 52, 53, 54] as const;
/** Rim tile sets of island ground, by owner's Fury as GROUND_TILES. */
export const SHORE_TILES = {
  wind: 'wiisle',
  rain: 'raisle',
  thunder: 'thisle',
  neutral: 'risle',
} as const;
const SHORE_FRAME_COUNT = 37;
/* oxlint-disable no-magic-numbers -- frame numbers of the rim sets, from isle.type */
/** Sides a cell can have open sky on, as bits; a corner is the two sides it lies between. */
export const SKY = { north: 1, east: 2, south: 4, west: 8 } as const;
/**
 * Frames of a rim set by the sides the sky is on, as isle.type groups them: the four edges, then
 * the four outside corners. Every group has a few variants.
 */
const SHORE_EDGES: Readonly<Record<number, readonly number[]>> = {
  [SKY.west]: [0, 1, 2, 3, 4],
  [SKY.north]: [5, 6, 7, 8, 9],
  [SKY.east]: [10, 11, 12, 13, 14],
  [SKY.south]: [21, 22, 23, 24, 25, 26],
  [SKY.north | SKY.west]: [19, 31],
  [SKY.north | SKY.east]: [20, 32],
  [SKY.south | SKY.east]: [15, 27],
  [SKY.south | SKY.west]: [16, 28],
};
/** Inside corners: ground on every side and sky across one corner, named by the side clockwise
 * of it (north: the north-east corner). Which frame is which corner is read off the pictures. */
const SHORE_INSIDE: Readonly<Record<number, readonly number[]>> = {
  [SKY.north]: [35, 36],
  [SKY.east]: [18, 30],
  [SKY.south]: [17, 29],
  [SKY.west]: [33, 34],
};
/* oxlint-enable no-magic-numbers */

/**
 * Slots of the Fringe type: the rock that hangs under an island's southern rim. fringe.type names
 * its groups after the rim frames they go with: EA under a southern edge, IA under a south-west
 * corner, HA under a south-east one. Each group also has frames with lit and unlit windows, and
 * there are two for inside corners; those are not used.
 */
const FRINGE_SLOTS: Readonly<Record<number, readonly number[]>> = {
  [SKY.south]: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  [SKY.south | SKY.west]: [39, 40],
  [SKY.south | SKY.east]: [63, 64],
};

/** The Fringe slot under an island cell with the sky on `sides`, or undefined for none. */
export function fringeSlot(sides: number, pick: number): number | undefined {
  const corner = sides & (SKY.south | SKY.west | SKY.east);
  const group = sides & SKY.south ? FRINGE_SLOTS[corner] ?? FRINGE_SLOTS[SKY.south] : undefined;
  return group?.[pick % group.length];
}

/** For a cell the original's islands never have, with sky on three sides or on opposite ones: the
 * corners and edges to settle for, the southern ones first because they carry the rock face. */
const SHORE_FALLBACK: readonly number[] = [
  SKY.south | SKY.west,
  SKY.south | SKY.east,
  SKY.north | SKY.west,
  SKY.north | SKY.east,
  SKY.south,
  SKY.west,
  SKY.east,
  SKY.north,
];

/**
 * The rim frame of an island cell, or undefined where plain grass goes. `sides` and `corners` are
 * SKY bits of where the island ends; `pick` chooses among the variants.
 */
export function shoreFrame(sides: number, corners: number, pick: number): number | undefined {
  const inside = Object.entries(SHORE_INSIDE).find(([corner]) => corners & Number(corner))?.[1];
  const settled = SHORE_FALLBACK.find((bits) => (sides & bits) === bits);
  const group = sides === 0 ? inside : SHORE_EDGES[sides] ?? SHORE_EDGES[settled ?? 0];
  return group?.[pick % group.length];
}

export const BRIDGE_FRAMES = { solid: 0, cracked: 35, hard: 50 } as const;

/** Every other frame of the small explosion. */
export const EXPLOSION_FRAMES = Array.from({ length: 11 }, (_, i) => 35 + i * 2);

/* oxlint-disable no-magic-numbers -- frame numbers from the .type files */
/**
 * The frame of each facing (north, east, south, west) of the units that have one: the first frame
 * of the groups L, M, N and O of their .type files, which raincannon.type and suncannon.type label
 * N, E, S and W. The gif is given per facing where the sets differ.
 */
export const FACING_FRAMES: Readonly<
  Record<string, readonly (readonly [gif: string, frame: number])[]>
> = {
  suncannon: [['scannon', 10], ['scannon', 5], ['scannon', 0], ['scannon', 14]],
  thundercannon: [['tcannon', 12], ['tcannon', 0], ['tcannon', 24], ['tcannon', 36]],
  raincannon: [['rcannon', 0], ['rcannon', 9], ['rcannon', 3], ['rcannon', 6]],
  windarcher: [['warch1', 0], ['warch1', 26], ['warch1', 51], ['warch2', 76]],
  windblocker: [['wblocker', 0], ['wblocker', 3], ['wblocker', 1], ['wblocker', 2]],
};
/* oxlint-enable no-magic-numbers */
const FACING_TEXTURES = Object.entries(FACING_FRAMES).flatMap(([type, frames]) =>
  frames.map(([gif, frame], facing) => [`${type}:${facing}`, type, gif, frame] as const)
);

/** Frames used by the current scene. Shared by the loader and production packaging. */
export const TEXTURES: ReadonlyArray<readonly [string, string, string, number?]> = [
  ...Object.entries(GROUND_TILES).flatMap(([owner, gif]) =>
    GROUND_FRAMES.map((frame) => [`ground:${owner}:${frame}`, 'isle', gif, frame] as const)
  ),
  ...Object.entries(SHORE_TILES).flatMap(([owner, gif]) =>
    Array.from({ length: SHORE_FRAME_COUNT }, (_, frame) =>
      [`shore:${owner}:${frame}`, 'isle', gif, frame] as const)
  ),
  ...EXPLOSION_FRAMES.map((frame, i) => [`explosion:${i}`, 'anim', 'xsmall', frame] as const),
  ...Object.entries(BRIDGE_FRAMES).map(([state, frame]) =>
    [`bridge:${state}`, 'bridge', 'bridge', frame] as const
  ),
  ...FACING_TEXTURES,
  ...Object.entries(SLOT_COUNTS).flatMap(([type, count]) =>
    Array.from({ length: count }, (_, slot) =>
      [`slot:${type}:${slot}`, type, SLOT_GIF, slot] as const)
  ),
  ['sunwalker', 'sunwalker', 'golem'],
  ['windwalker', 'windwalker', 'wwalker'],
  ['rainwalker', 'rainwalker', 'rcrab'],
  ['bulf', 'bulf', 'bulfwalk'],
  ['priest', 'priest', 'priest'],
  ['priest:down', 'priest', 'pchant'],
  ['geyser', 'geyser', 'f'],
  ['nugget', 'nugget', 'nugget'],
  ['obelisk', 'buried', 'obelisk', 0],
  ['outpost', 'outpost', 'embassy', 0],
  // The whole Altar as it stands before a sacrifice: the last frame of its ring.
  ['altar', 'altar', 'altar01', 3],
  // The default frame of each type, as its .type file names it.
  ['sunbattery', 'sunbattery', 'sbattery', 1],
  ['windbattery', 'windbattery', 'focus', 0],
  ['rainbattery', 'rainbattery', 'focus', 2],
  ['thunderbattery', 'thunderbattery', 'focus', 1],
  ['sunblocker', 'sunblocker', 'sunblock', 0],
  ['windvortex', 'windvortex', 'wvortex', 13],
  ['rainvortex', 'rainvortex', 'rvortex', 0],
  ['thundervortex', 'thundervortex', 'tvortex2', 7],
  ['sunfactory', 'sunfactory', 'sfactory', 0],
  ['windfactory', 'windfactory', 'wfactory', 0],
  ['rainfactory', 'rainfactory', 'rfactory', 0],
  ['thunderfactory', 'thunderfactory', 'tfactory', 0],
  ['rainblocker', 'rainblocker', 'rblock', 14],
  ['thunderblocker', 'thunderblocker', 'thblock', 1],
  ['sunaviary', 'sunaviary', 'sflyer', 8],
  ['windaviary', 'windaviary', 'wflyer', 42],
  ['rainaviary', 'rainaviary', 'rflyer', 0],
  ['sunfence', 'sunfence', 'sfence', 5],
  ['rainfence', 'rainfence', 'sfence', 0],
  ['thunderfence', 'thunderfence', 'tfence', 0],
  ['thunderarcher', 'thunderarcher', 'tarcher', 0],
  ['sunballoon', 'sunballoon', 'sunbaloo', 0],
  ['windballoon', 'windballoon', 'ship', 0],
  ['rainballoon', 'rainballoon', 'rballoon', 0],
  ['sunflyer', 'sunflyer', 'sflyer', 0],
  ['windflyer', 'windflyer', 'wflyer', 0],
  ['rainflyer', 'rainflyer', 'rflyer', 13],
];

/**
 * Paths of the shipped frames by type, gif and frame number. Under the pseudo-gif "@" a type lists
 * frames by slot instead, each path followed by "#x,y": where the picture lies from the hot spot
 * of its frame (scripts/anim-frames.py).
 */
export type Manifest = Record<string, Record<string, Record<string, string>>>;

/** A manifest path split into the file and, for a slot, the offset of its picture. */
export function parsePath(entry: string): { file: string; offset?: [x: number, y: number]; } {
  const [file = '', at] = entry.split('#');
  const [x, y] = (at ?? '').split(',').map(Number);
  return at === undefined || x === undefined || y === undefined
    ? { file }
    : { file, offset: [x, y] };
}

export function selectFrame(
  manifest: Manifest,
  type: string,
  gif: string,
  frame?: number,
): [string, string] | undefined {
  const frames = manifest[type]?.[gif];

  if (!frames) {
    return undefined;
  }

  if (frame !== undefined && frames[frame]) {
    return [String(frame), frames[frame]];
  }

  return Object.entries(frames)[0];
}
