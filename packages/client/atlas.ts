/**
 * Pack the frames the client draws into a few large pictures, so that it loads those and not
 * thousands of files. Build-time only: used by vite.config.ts for the build and the dev server.
 * PNG is read and written here with node:zlib alone; the sprites are 8-bit RGBA or palette PNGs
 * without interlacing, which is all this reads.
 */
/* oxlint-disable no-magic-numbers -- the numbers of the PNG format */
import { deflateSync, inflateSync } from 'node:zlib';

export interface Picture {
  width: number;
  height: number;
  /** RGBA, four bytes a pixel, row after row. */
  pixels: Uint8Array;
}

/** What the client is told: the atlas files, and for each texture key its atlas, its rectangle
 * there and, for a frame drawn about its hot spot, where the picture lies from it. */
export interface Atlas {
  atlases: string[];
  frames: Record<string, number[]>;
}

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const RGBA = 6;
const PALETTE = 3;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;

  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }

  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;

  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }

  return (c ^ 0xffffffff) >>> 0;
}

/** The Paeth predictor of PNG filter 4. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);

  if (pa <= pb && pa <= pc) {
    return a;
  }

  return pb <= pc ? b : c;
}

/** Undo the row filters of a PNG in place and return the rows without their filter bytes. */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const from = y * (stride + 1) + 1;
    const to = y * stride;

    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? out[to + x - bpp]! : 0;
      const up = y > 0 ? out[to + x - stride]! : 0;
      const corner = x >= bpp && y > 0 ? out[to + x - stride - bpp]! : 0;
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter];

      if (predicted === undefined) {
        throw new Error(`Unknown PNG filter ${filter}`);
      }

      out[to + x] = (raw[from + x]! + predicted) & 0xff;
    }
  }

  return out;
}

export function decodePng(file: Uint8Array): Picture {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const data: Uint8Array[] = [];
  let palette: Uint8Array | undefined;
  let alpha: Uint8Array | undefined;
  let width = 0;
  let height = 0;
  let kind = RGBA;

  for (let at = SIGNATURE.length; at < file.length;) {
    const size = view.getUint32(at);
    const name = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const body = file.subarray(at + 8, at + 8 + size);

    if (name === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      kind = body[9]!;

      if (body[8] !== 8 || (kind !== RGBA && kind !== PALETTE) || body[12] !== 0) {
        throw new Error('Only 8-bit RGBA or palette PNGs without interlacing are read');
      }
    } else if (name === 'PLTE') {
      palette = body;
    } else if (name === 'tRNS') {
      alpha = body;
    } else if (name === 'IDAT') {
      data.push(body);
    }

    at += 12 + size;
  }

  const rows = unfilter(inflateSync(Buffer.concat(data)), width, height, kind === RGBA ? 4 : 1);

  if (kind === RGBA) {
    return { width, height, pixels: rows };
  }

  const pixels = new Uint8Array(width * height * 4);

  for (const [i, index] of rows.entries()) {
    pixels.set(palette!.subarray(index * 3, index * 3 + 3), i * 4);
    pixels[i * 4 + 3] = alpha?.[index] ?? 0xff;
  }

  return { width, height, pixels };
}

function chunk(name: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set([...name].map((letter) => letter.charCodeAt(0)), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

export function encodePng({ width, height, pixels }: Picture): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, RGBA, 0, 0, 0], 8);
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Side of an atlas: what any graphics card of the last fifteen years takes as one texture. */
const SIDE = 2048;
/** Clear pixels between neighbours, so that none bleeds into the next when scaled. */
const GAP = 1;

/**
 * Lay pictures out on atlases, shelf after shelf, tallest first. Returns the atlases and, for
 * each picture in the order given, its atlas and the corner of its place there.
 */
export function pack(pictures: readonly Picture[]): {
  atlases: Picture[];
  places: [atlas: number, x: number, y: number][];
} {
  const order = pictures.map((_, i) => i).sort((a, b) =>
    pictures[b]!.height - pictures[a]!.height || a - b
  );
  const places: [number, number, number][] = [];
  const heights: number[] = [];
  let atlas = 0;
  let x = 0;
  let y = 0;
  let shelf = 0;

  for (const i of order) {
    const { width, height } = pictures[i]!;

    if (width > SIDE || height > SIDE) {
      throw new Error('A picture is larger than an atlas');
    }

    if (x + width > SIDE) {
      x = 0;
      y += shelf + GAP;
      shelf = 0;
    }

    if (y + height > SIDE) {
      atlas++;
      x = 0;
      y = 0;
      shelf = 0;
    }

    places[i] = [atlas, x, y];
    shelf = Math.max(shelf, height);
    heights[atlas] = y + shelf;
    x += width + GAP;
  }

  const atlases = heights.map((height) => ({
    width: SIDE,
    height,
    pixels: new Uint8Array(SIDE * height * 4),
  }));

  for (const [i, [sheet, px, py]] of places.entries()) {
    const { width, height, pixels } = pictures[i]!;

    for (let row = 0; row < height; row++) {
      atlases[sheet]!.pixels.set(pixels.subarray(row * width * 4, (row + 1) * width * 4),
        ((py + row) * SIDE + px) * 4);
    }
  }

  return { atlases, places };
}

/**
 * Build the atlases of a set of textures. `wanted` gives, for each texture key, the file of its
 * picture and, for a frame drawn about its hot spot, where the picture lies from it; `read` loads
 * a file. Keys that share a file share its place.
 */
export function buildAtlas(
  wanted: ReadonlyMap<string, { file: string; offset?: [number, number]; }>,
  read: (file: string) => Uint8Array,
): { atlas: Atlas; files: Map<string, Uint8Array>; } {
  const names = [...new Set([...wanted.values()].map((entry) => entry.file))].sort();
  const pictures = names.map((name) => decodePng(read(name)));
  const { atlases, places } = pack(pictures);
  const files = new Map(atlases.map((sheet, i) => [`sprites/atlas-${i}.png`, encodePng(sheet)]));
  const frames: Record<string, number[]> = {};

  for (const [key, { file, offset }] of wanted) {
    const i = names.indexOf(file);
    const { width, height } = pictures[i]!;
    frames[key] = [...places[i]!, width, height, ...(offset ?? [])];
  }

  return { atlas: { atlases: [...files.keys()], frames }, files };
}
