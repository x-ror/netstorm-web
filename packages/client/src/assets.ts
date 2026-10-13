import { Assets, Rectangle, Texture } from 'pixi.js';

/** What the build packs the frames into (atlas.ts): the atlas files, and for each texture key its
 * atlas, its rectangle there and, for a frame drawn about its hot spot, where the picture lies
 * from it. */
export interface Atlas {
  atlases: string[];
  frames: Record<string, number[]>;
}

/** The anchor of each texture that is placed by the hot spot of its frame. */
export const hotSpots = new WeakMap<Texture, { x: number; y: number; }>();

export async function loadTextures(atlas: Atlas): Promise<Map<string, Texture>> {
  const sheets = await Promise.all(atlas.atlases.map((url) => Assets.load<Texture>(url)));
  const textures = new Map<string, Texture>();

  for (const sheet of sheets) {
    sheet.source.scaleMode = 'nearest';
  }

  for (const [key, [sheet, x, y, width, height, left, top]] of Object.entries(atlas.frames)) {
    const texture = new Texture({
      source: sheets[sheet!]!.source,
      frame: new Rectangle(x, y, width, height),
    });
    textures.set(key, texture);

    // A slot is drawn about the hot spot of its frame, which lies off its picture by the offset.
    if (left !== undefined && top !== undefined) {
      hotSpots.set(texture, { x: -left / width!, y: -top / height! });
    }
  }

  return textures;
}
