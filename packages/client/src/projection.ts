/**
 * Screen projection of the map. The original draws its 16×11 px cells as an oblique ¾ view of a
 * square grid, not as isometric diamonds: its grass tiles are full 16×11 rectangles, island edge
 * tiles have straight horizontal rims and bridge tiles are planks with a front face below.
 * That reading of the sprites is ours, not a documented fact; see docs/architecture.md.
 * We render at 2× with nearest-neighbour scaling.
 */
export const TW = 16;
export const TH = 11;
export const ZOOM = 2;
/** Top-left corner of cell (x, y) in unscaled screen pixels; fractions address points inside. */
export const project = (x: number, y: number) => ({ sx: x * TW, sy: y * TH });
/** The cell under an unscaled screen point. */
export const unproject = (sx: number, sy: number) => ({
  x: Math.floor(sx / TW),
  y: Math.floor(sy / TH),
});
