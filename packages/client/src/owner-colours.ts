/**
 * The colours of a side. The original paints the rim of an island and the rails of a bridge in the
 * colour of their owner: blue for the player and his allies, red for the enemy; land of nobody
 * keeps the colours its pictures are saved with (orange rims, grey rails). Read off the running
 * game (10.82) by laying our frames over its screen: each of these colours of a rim or a rail
 * became the same colour wherever it was, while the same colours in a plank or in grass did not
 * change, so only rim and bridge frames are repainted.
 */

/** Which of the two colours a side shows to the player; null for nobody. */
export type Side = 'blue' | 'red';

/** The textures that carry an owner's colour, and which table repaints each. */
export function paintOf(key: string): 'rim' | 'rail' | null {
  if (key.startsWith('shore:')) {
    return 'rim';
  }

  return key.startsWith('slot:bridge:') || key.startsWith('slot:bridgeconnector:') ? 'rail' : null;
}

/* oxlint-disable no-magic-numbers -- colours measured on the original's screen */
const rgb = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
const BLUE = [
  rgb(39, 48, 81),
  rgb(47, 59, 97),
  rgb(48, 72, 104),
  rgb(49, 87, 115),
  rgb(68, 105, 134),
  rgb(96, 135, 159),
] as const;
const RED_DARK = rgb(99, 36, 7);
const RED = rgb(119, 9, 9);
const RED_LIGHT = rgb(167, 66, 56);
const RED_RAIL = rgb(191, 75, 71);

/** Rim colours as saved, and what each becomes for the player's side and for the enemy's. */
const RIM: readonly [number, number, number][] = [
  [rgb(125, 47, 40), BLUE[0], RED_DARK],
  [rgb(128, 57, 30), BLUE[0], RED_DARK],
  [rgb(134, 81, 49), BLUE[0], RED_DARK],
  [rgb(136, 77, 32), BLUE[0], RED_DARK], // red measured; blue by its neighbours (`?`)
  [rgb(142, 94, 34), BLUE[0], RED_DARK],
  [rgb(142, 98, 53), BLUE[1], RED_DARK],
  [rgb(153, 86, 52), BLUE[2], RED],
  [rgb(160, 119, 48), BLUE[2], RED],
  [rgb(156, 107, 60), BLUE[3], RED],
  [rgb(162, 123, 70), BLUE[3], RED],
  [rgb(176, 116, 54), BLUE[3], RED],
  [rgb(178, 103, 54), BLUE[3], RED],
  [rgb(187, 86, 34), BLUE[3], RED],
  [rgb(185, 123, 71), BLUE[4], RED],
  [rgb(197, 149, 60), BLUE[4], RED],
  [rgb(211, 100, 27), BLUE[4], RED],
  [rgb(193, 135, 80), BLUE[4], RED_LIGHT],
  [rgb(238, 126, 40), BLUE[4], RED_LIGHT],
  [rgb(238, 144, 41), BLUE[4], RED_LIGHT],
  [rgb(201, 151, 80), BLUE[5], RED_LIGHT],
  [rgb(226, 185, 82), BLUE[5], RED_LIGHT],
  [rgb(239, 162, 43), BLUE[5], RED_LIGHT],
];
/** Rail colours of the Bridge frames, likewise. */
const RAIL: readonly [number, number, number][] = [
  [rgb(90, 90, 107), BLUE[3], RED_RAIL],
  [rgb(82, 90, 99), BLUE[4], RED_RAIL],
  [rgb(82, 82, 107), BLUE[5], RED_RAIL],
];
/* oxlint-enable no-magic-numbers */

const TABLES = {
  rim: { blue: table(RIM, 1), red: table(RIM, 2) },
  rail: { blue: table(RAIL, 1), red: table(RAIL, 2) },
} as const;

function table(rows: readonly [number, number, number][], column: 1 | 2): Map<number, number> {
  return new Map(rows.map((row) => [row[0], row[column]]));
}

const CHANNEL = 8;
const BYTE = 0xff;
const PIXEL = 4;

/** Repaint RGBA pixels in place with a side's colours. */
export function paint(pixels: Uint8ClampedArray, kind: 'rim' | 'rail', side: Side): void {
  const swap = TABLES[kind][side];

  for (let i = 0; i < pixels.length; i += PIXEL) {
    const to = swap.get(
      (pixels[i]! << (2 * CHANNEL)) | (pixels[i + 1]! << CHANNEL) | pixels[i + 2]!,
    );

    if (to !== undefined) {
      pixels[i] = to >> (2 * CHANNEL);
      pixels[i + 1] = (to >> CHANNEL) & BYTE;
      pixels[i + 2] = to & BYTE;
    }
  }
}
