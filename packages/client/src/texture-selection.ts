/** Frames used by the current scene. Shared by the loader and production packaging. */
export const TEXTURES: ReadonlyArray<readonly [string, string, string, number?]> = [
  ['suncannon:0', 'suncannon', 'scannon', 10],
  ['suncannon:1', 'suncannon', 'scannon', 5],
  ['suncannon:2', 'suncannon', 'scannon', 0],
  ['suncannon:3', 'suncannon', 'scannon', 14],
  ['sunarcher', 'sunarcher', 'f'], ['thundercannon', 'thundercannon', 'tcannon'],
  ['windarcher', 'windarcher', 'warch1'], ['sunwalker', 'sunwalker', 'golem'],
  ['windwalker', 'windwalker', 'wwalker'], ['rainwalker', 'rainwalker', 'rcrab'],
  ['bulf', 'bulf', 'bulfwalk'], ['priest', 'priest', 'priest'],
  ['priest:down', 'priest', 'pchant'], ['geyser', 'geyser', 'f'],
  ['nugget', 'nugget', 'nugget'], ['altar', 'altar', 'altar21'],
];

export type Manifest = Record<string, Record<string, Record<string, string>>>;

export function selectFrame(manifest: Manifest, type: string, gif: string, frame?: number): [string, string] | undefined {
  const frames = manifest[type]?.[gif];
  if (!frames) return undefined;
  if (frame !== undefined && frames[frame]) return [String(frame), frames[frame]];
  return Object.entries(frames)[0];
}
