import { Assets, type Texture } from 'pixi.js';
import { TEXTURES, parsePath, selectFrame, type Manifest } from './texture-selection.js';
export type { Manifest } from './texture-selection.js';

/** The anchor of each texture that is placed by the hot spot of its frame. */
export const hotSpots = new WeakMap<Texture, { x: number; y: number; }>();

export async function loadTextures(manifest: Manifest): Promise<Map<string, Texture>> {
  const textures = new Map<string, Texture>();
  await Promise.all(TEXTURES.map(async ([key, type, gif, frame]) => {
    const selected = selectFrame(manifest, type, gif, frame);

    if (!selected) {
      return;
    } // Some original definitions have no extracted frames.

    const { file, offset } = parsePath(selected[1]);
    const texture = await Assets.load<Texture>(file);
    texture.source.scaleMode = 'nearest';

    // A slot is drawn about the hot spot of its frame, which lies off its picture by the offset.
    if (offset) {
      hotSpots.set(texture, { x: -offset[0] / texture.width, y: -offset[1] / texture.height });
    }

    textures.set(key, texture);
  }));
  return textures;
}
