import { Assets, Texture } from 'pixi.js';
import { TEXTURES, selectFrame, type Manifest } from './texture-selection.js';
export type { Manifest } from './texture-selection.js';

export async function loadTextures(manifest: Manifest): Promise<Map<string, Texture>> {
  const textures = new Map<string, Texture>();
  await Promise.all(
    TEXTURES.map(async ([key, type, gif, frame]) => {
      const selected = selectFrame(manifest, type, gif, frame);
      if (!selected) return; // Some original definitions have no extracted frames.
      const texture = await Assets.load<Texture>(selected[1]);
      texture.source.scaleMode = 'nearest';
      textures.set(key, texture);
    }),
  );
  return textures;
}
