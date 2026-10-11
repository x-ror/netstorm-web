import { type Container } from 'pixi.js';
import { H, Terrain, W, type WorldView } from '@netstorm/sim';
import { iso, TH, TW } from './projection.js';
import { centerOnScreenPoint, viewCorners } from './camera.js';

/** Minimap pixels per isometric pixel of the map at 1×. */
const SCALE = 0.05;
const RGBA = 4;
const OPAQUE = 255;
const DOT = 2;
const COLOR = {
  bridge: 0x8a8f99,
  crackedBridge: 0x5a5148,
  own: 0x5c7a3a,
  enemy: 0x7a3a3a,
  neutral: 0x6b5a3a,
} as const;
const SKY = [0, 0, 0, 0] as const;
const BYTE = 8;
const BYTE_MASK = 0xff;

/** An opaque colour as the RGBA bytes of an ImageData pixel. */
function rgba(hex: number): number[] {
  return [hex >> (BYTE * 2), hex >> BYTE, hex].map((c) => c & BYTE_MASK).concat(OPAQUE);
}

const PIXELS = Object.fromEntries(
  Object.entries(COLOR).map(([name, hex]) => [name, rgba(hex)]),
) as Record<keyof typeof COLOR, number[]>;
const DOT_COLOR = {
  own: '#9fe870',
  enemy: '#ff6b6b',
  geyser: '#66ccff',
  neutral: '#ffd166',
  view: '#ffffff',
} as const;

/** The whole map in the same isometric projection, scaled down. A click or drag moves the camera. */
export function createMinimap(
  canvas: HTMLCanvasElement,
  world: WorldView,
  me: number,
  camera: Container,
) {
  // The map's isometric extent: x - y spans ±W cells, x + y spans 0..W + H cells.
  const left = iso(0, H).sx;
  canvas.width = Math.ceil((iso(W, 0).sx - left) * SCALE);
  canvas.height = Math.ceil(iso(W, H).sy * SCALE);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const cells = document.createElement('canvas');
  cells.width = W;
  cells.height = H;
  const cellCtx = cells.getContext('2d')!;
  const image = cellCtx.createImageData(W, H);
  const abort = new AbortController();
  let terrainRevision = -1;

  const toMinimap = (sx: number, sy: number): [number, number] => [
    (sx - left) * SCALE,
    sy * SCALE,
  ];

  function paintCells(): void {
    for (let i = 0; i < W * H; i++) {
      const terrain = world.terrain[i];
      const owner = world.owner[i];
      let color: readonly number[] = SKY;

      if (terrain === Terrain.Bridge) {
        color = PIXELS.bridge;
      } else if (terrain === Terrain.CrackedBridge) {
        color = PIXELS.crackedBridge;
      } else if (terrain === Terrain.Island) {
        if (owner === me) {
          color = PIXELS.own;
        } else {
          color = owner ? PIXELS.enemy : PIXELS.neutral;
        }
      }

      image.data.set(color, i * RGBA);
    }

    cellCtx.putImageData(image, 0, 0);
  }

  function draw(): void {
    if (terrainRevision !== world.terrainRevision) {
      terrainRevision = world.terrainRevision;
      paintCells();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // A cell's unit vectors in isometric pixels are (TW/2, TH/2) along x and (-TW/2, TH/2) along y.
    const a = (TW / 2) * SCALE;
    const b = (TH / 2) * SCALE;
    ctx.setTransform(a, b, -a, b, -left * SCALE, 0);
    ctx.drawImage(cells, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    for (const entity of world.entities.values()) {
      if (entity.kind === 'crystal') {
        continue;
      }

      let color: string = DOT_COLOR.geyser;

      if ('owner' in entity) {
        color = entity.owner === me ? DOT_COLOR.own : DOT_COLOR.enemy;
      }

      const [mx, my] = toMinimap(iso(entity.x, entity.y).sx, iso(entity.x, entity.y).sy);
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, DOT, DOT);
    }

    ctx.strokeStyle = DOT_COLOR.view;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (const [sx, sy] of viewCorners(camera)) {
      ctx.lineTo(...toMinimap(sx, sy));
    }

    ctx.closePath();
    ctx.stroke();
  }

  let dragging = false;
  const jump = (ev: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * canvas.width;
    const my = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    centerOnScreenPoint(camera, mx / SCALE + left, my / SCALE);
    draw();
  };
  canvas.addEventListener('pointerdown', (ev) => {
    dragging = true;
    canvas.setPointerCapture(ev.pointerId);
    jump(ev);
  }, { signal: abort.signal });
  canvas.addEventListener('pointermove', (ev) => {
    if (dragging) {
      jump(ev);
    }
  }, { signal: abort.signal });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
  }, { signal: abort.signal });

  return {
    draw,
    dispose() {
      abort.abort();
    },
  };
}
