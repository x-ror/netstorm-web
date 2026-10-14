import { Assets, Rectangle, Texture, type TextureSource } from 'pixi.js';
import { paint, paintOf, type Side } from './owner-colours.js';

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

  addSides(atlas, sheets, textures);
  return textures;
}

const SIDES: readonly Side[] = ['blue', 'red'];

/**
 * Rims and bridges in the colours of the two sides, as `key:blue` and `key:red`: a copy of each
 * atlas that has such frames, with only those frames repainted, since the same colours are found in
 * the pictures of units too.
 */
function addSides(atlas: Atlas, sheets: Texture[], textures: Map<string, Texture>): void {
  const painted = Object.entries(atlas.frames).filter(([key]) => paintOf(key) !== null);

  for (const side of SIDES) {
    const copies = new Map<number, TextureSource>();

    for (const [index, sheet] of sheets.entries()) {
      const mine = painted.filter(([, [at]]) => at === index);

      if (mine.length === 0) {
        continue;
      }

      const canvas = document.createElement('canvas');
      canvas.width = sheet.source.width;
      canvas.height = sheet.source.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });

      if (!context) {
        return; // no 2D canvas: every side keeps the saved colours
      }

      context.drawImage(sheet.source.resource as CanvasImageSource, 0, 0);

      for (const [key, [, x, y, width, height]] of mine) {
        const frame = context.getImageData(x!, y!, width!, height!);
        paint(frame.data, paintOf(key)!, side);
        context.putImageData(frame, x!, y!);
      }

      const source = Texture.from(canvas).source;
      source.scaleMode = 'nearest';
      copies.set(index, source);
    }

    for (const [key, [at, x, y, width, height]] of painted) {
      const plain = textures.get(key)!;
      const texture = new Texture({
        source: copies.get(at!)!,
        frame: new Rectangle(x, y, width, height),
      });
      textures.set(`${key}:${side}`, texture);
      const spot = hotSpots.get(plain);

      if (spot) {
        hotSpots.set(texture, spot);
      }
    }
  }
}
