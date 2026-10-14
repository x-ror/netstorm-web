import type { Atlas } from './assets.js';
import { escapeHtml } from './menu.js';

/** The picture of a unit for the panels, cut out of the atlas and fitted into a square: facing east
 * where it has facings, else the larger of its plain picture and its first slot (the plain one of a
 * Golem is a speck, the first slot of a Temple only its whirl). */
export function unitIcon(atlas: Atlas, type: string, name: string, size: number): string {
  const area = (key: string) => {
    const found = atlas.frames[key];
    return found ? found[WIDTH]! * found[HEIGHT]! : 0;
  };
  const key = atlas.frames[`${type}:1`]
    ? `${type}:1`
    : [type, `slot:${type}:0`].sort((a, b) => area(b) - area(a))[0]!;
  const frame = atlas.frames[key];

  if (!frame) {
    // A unit with no picture of its own (a Spell, a Thunder Spire): its initial.
    return `<span class="icon glyph" style="--size:${size}px" aria-hidden="true">${
      escapeHtml(name.slice(0, 1))
    }</span>`;
  }

  const [sheet, x, y, w, h] = frame as [number, number, number, number, number];
  const fit = Math.min(size / w, size / h);
  // Whole steps keep the pixels square when a small picture is enlarged.
  const scale = fit >= 1 ? Math.min(Math.floor(fit), MAX_ENLARGE) : fit;
  return `<span class="icon" style="--size:${size}px" aria-hidden="true"><i style="width:${w}px;height:${h}px;background:url(${
    atlas.atlases[sheet]
  }) -${x}px -${y}px;transform:translate(-50%,-50%) scale(${scale})"></i></span>`;
}

// Where an atlas entry keeps a picture's size.
const WIDTH = 3;
const HEIGHT = 4;
/** Small pictures are enlarged at most this many times, so a Golem does not fill a card. */
const MAX_ENLARGE = 3;
