import { type Container } from 'pixi.js';
import { iso, unIso } from './projection.js';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

/** Put map cell (x, y) in the middle of the screen. */
export function centerOn(camera: Container, x: number, y: number): void {
  const { sx, sy } = iso(x, y);
  centerOnScreenPoint(camera, sx, sy);
}

/** Put an unscaled isometric point in the middle of the screen. */
export function centerOnScreenPoint(camera: Container, sx: number, sy: number): void {
  camera.position.set(window.innerWidth / 2 - sx * camera.scale.x,
    window.innerHeight / 2 - sy * camera.scale.y);
}

/** Zoom by `factor` keeping the screen point (px, py) over the same spot of the map. */
export function zoomAt(camera: Container, px: number, py: number, factor: number): void {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.scale.x * factor));
  const k = z / camera.scale.x;
  camera.x = px - (px - camera.x) * k;
  camera.y = py - (py - camera.y) * k;
  camera.scale.set(z);
}

/** The map cell under a screen point. */
export function cellAt(camera: Container, px: number, py: number): { x: number; y: number; } {
  return unIso((px - camera.x) / camera.scale.x, (py - camera.y) / camera.scale.y);
}

/** Corners of the screen as unscaled isometric points, clockwise from the top left. */
export function viewCorners(camera: Container): [number, number][] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([px, py]) => [
    (px! - camera.x) / camera.scale.x,
    (py! - camera.y) / camera.scale.y,
  ]);
}
