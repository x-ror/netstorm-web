/** Grass tile sets of island ground by owner's Fury; `rgrass` is our guess for unowned rock. */
export const GROUND_TILES = {
  wind: 'wigrass',
  rain: 'ragrass',
  thunder: 'thgrass',
  neutral: 'rgrass',
} as const;
/** Frames of each grass set picked for variety; every set has these. */
export const GROUND_FRAMES = [4, 5, 47, 48, 51, 52, 53, 54] as const;
export const BRIDGE_FRAMES = { solid: 0, cracked: 35, hard: 50 } as const;

/** Every other frame of the small explosion. */
export const EXPLOSION_FRAMES = Array.from({ length: 11 }, (_, i) => 35 + i * 2);

/** Frames used by the current scene. Shared by the loader and production packaging. */
export const TEXTURES: ReadonlyArray<readonly [string, string, string, number?]> = [
  ...Object.entries(GROUND_TILES).flatMap(([owner, gif]) =>
    GROUND_FRAMES.map((frame) => [`ground:${owner}:${frame}`, 'isle', gif, frame] as const)
  ),
  ...EXPLOSION_FRAMES.map((frame, i) => [`explosion:${i}`, 'anim', 'xsmall', frame] as const),
  ...Object.entries(BRIDGE_FRAMES).map(([state, frame]) =>
    [`bridge:${state}`, 'bridge', 'bridge', frame] as const
  ),
  ['suncannon:0', 'suncannon', 'scannon', 10],
  ['suncannon:1', 'suncannon', 'scannon', 5],
  ['suncannon:2', 'suncannon', 'scannon', 0],
  ['suncannon:3', 'suncannon', 'scannon', 14],
  // The base of the Disc Thrower; its arm is a set of small frames of its own, not drawn yet.
  ['sunarcher', 'sunarcher', 'sarcher', 0],
  // The whole-body frame of each facing (N, E, S, W); the other frames of the set are small
  // overlays of the charging animation.
  ['thundercannon:0', 'thundercannon', 'tcannon', 19],
  ['thundercannon:1', 'thundercannon', 'tcannon', 7],
  ['thundercannon:2', 'thundercannon', 'tcannon', 24],
  ['thundercannon:3', 'thundercannon', 'tcannon', 36],
  ['windarcher', 'windarcher', 'warch1'],
  ['sunwalker', 'sunwalker', 'golem'],
  ['windwalker', 'windwalker', 'wwalker'],
  ['rainwalker', 'rainwalker', 'rcrab'],
  ['bulf', 'bulf', 'bulfwalk'],
  ['priest', 'priest', 'priest'],
  ['priest:down', 'priest', 'pchant'],
  ['geyser', 'geyser', 'f'],
  ['nugget', 'nugget', 'nugget'],
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
  ['windblocker', 'windblocker', 'wblocker', 0],
  ['rainblocker', 'rainblocker', 'rblock', 14],
  ['thunderblocker', 'thunderblocker', 'thblock', 1],
  ['sunaviary', 'sunaviary', 'sflyer', 8],
  ['windaviary', 'windaviary', 'wflyer', 42],
  ['rainaviary', 'rainaviary', 'rflyer', 0],
  ['sunfence', 'sunfence', 'sfence', 5],
  ['rainfence', 'rainfence', 'sfence', 0],
  ['thunderfence', 'thunderfence', 'tfence', 0],
  ['raincannon', 'raincannon', 'rcannon', 0],
  ['thunderarcher', 'thunderarcher', 'tarcher', 0],
  ['sunballoon', 'sunballoon', 'sunbaloo', 0],
  ['windballoon', 'windballoon', 'ship', 0],
  ['rainballoon', 'rainballoon', 'rballoon', 0],
  ['sunflyer', 'sunflyer', 'sflyer', 0],
  ['windflyer', 'windflyer', 'wflyer', 0],
  ['rainflyer', 'rainflyer', 'rflyer', 13],
];

export type Manifest = Record<string, Record<string, Record<string, string>>>;

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
