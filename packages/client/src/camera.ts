import { type Container } from 'pixi.js';
import { project, unproject } from './projection.js';

/** Screen pixels for each pixel of the original's pictures. Only whole numbers (and a half, to
 * see more) keep the pictures crisp: at 2.2 nearest-neighbour scaling doubles some pixels and
 * triples others, and the fine patterns of bridge and ground smear. */
// oxlint-disable-next-line no-magic-numbers -- the levels themselves
const ZOOM_LEVELS = [0.5, 1, 2, 3, 4] as const;
/** A level counts as the current one this close to it. */
const LEVEL_SLACK = 0.01;

/** The zoom levels in CSS pixels on this screen. */
function levels(): number[] {
  const density = window.devicePixelRatio || 1;
  return ZOOM_LEVELS.map((level) => level / density);
}

/** The zoom level closest to `zoom`. */
export function snapZoom(zoom: number): number {
  return levels().reduce((best, level) =>
    Math.abs(level - zoom) < Math.abs(best - zoom) ? level : best
  );
}

/** Put map cell (x, y) in the middle of the screen. */
export function centerOn(camera: Container, x: number, y: number): void {
  const { sx, sy } = project(x, y);
  centerOnScreenPoint(camera, sx, sy);
}

/** Put an unscaled screen point in the middle of the screen. */
export function centerOnScreenPoint(camera: Container, sx: number, sy: number): void {
  camera.position.set(window.innerWidth / 2 - sx * camera.scale.x,
    window.innerHeight / 2 - sy * camera.scale.y);
}

/** Zoom one level in (`factor` above 1) or out, keeping the screen point (px, py) over the same
 * spot of the map. */
export function zoomAt(camera: Container, px: number, py: number, factor: number): void {
  const now = camera.scale.x;
  const all = levels();
  const z = factor > 1
    ? all.find((level) => level > now * (1 + LEVEL_SLACK)) ?? now
    : [...all].reverse().find((level) => level < now * (1 - LEVEL_SLACK)) ?? now;
  const k = z / now;
  camera.x = px - (px - camera.x) * k;
  camera.y = py - (py - camera.y) * k;
  camera.scale.set(z);
}

/** The map cell under a screen point. */
export function cellAt(camera: Container, px: number, py: number): { x: number; y: number; } {
  return unproject((px - camera.x) / camera.scale.x, (py - camera.y) / camera.scale.y);
}

/** Corners of the screen as unscaled screen points, clockwise from the top left. */
export function viewCorners(camera: Container): [number, number][] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([px, py]) => [
    (px! - camera.x) / camera.scale.x,
    (py! - camera.y) / camera.scale.y,
  ]);
}
