import { type Application, type Container, type Graphics } from 'pixi.js';
import {
  TPS,
  PIECES,
  PIECE_HARDEN,
  ROTATION_MASK,
  rotatePiece,
  DIRS,
  type WorldView,
  type Facing,
  type Command,
  type Event as SimEvent,
} from '@netstorm/sim';
import { iso, unIso, TW, TH } from './projection.js';

const LOG_DATA_CHARS = 60;
const LOG_MAX_ENTRIES = 100;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_IN = 1.1;
const ZOOM_OUT = 0.9;
const COLOR_VALID = 0xffd166;
const COLOR_INVALID = 0xff4444;
const GHOST_ALPHA = 0.5;
const AIM_DISTANCE = 3; // cells from the cursor to the cannon aim marker

/** Browser input creates commands; only the fixed-step loop submits them to the world. */
export function createControls(
  world: WorldView,
  app: Application,
  camera: Container,
  ghost: Graphics,
  submit: (command: Command) => void,
  takeEvents: () => SimEvent[],
) {
  const abort = new AbortController();
  const signal = abort.signal;
  const hud = document.getElementById('hud')!;
  const logEl = document.getElementById('log')!;
  type Mode = 'piece' | 'cannon' | 'archer' | 'collect' | 'priest' | 'salvage';
  let mode: Mode = 'piece';
  let rot = 0;
  let facing: Facing = 1;
  let hover = { x: 0, y: 0 };
  let selectedTransport: number | null = null;

  function renderHud() {
    const p = world.players.get(1)!;
    const en = world.energy(1);
    hud.innerHTML =
      `<b>NetStorm Web</b> · tick ${world.tick} · Storm Power <b>${p.storm}</b> · енергія ${en.own}/${en.total} · сегменти мостів: ${
        p.hand.map((h) => 'IOTLJSZ-'[h.piece] + (h.age < PIECE_HARDEN ? '*' : '')).join(' ') || '—'
      }<br>`
      + `режим: <b>${mode}</b> &nbsp; R — повернути (${rot}) &nbsp; F — напрям гармати (${
        'ПСхЗ'[facing]
      })<br>`
      + (['piece', 'cannon', 'archer', 'collect', 'priest', 'salvage'] as Mode[])
        .map((m) =>
          `<button data-m="${m}" class="${m === mode ? 'on' : ''}">${
            {
              piece: 'міст',
              cannon: 'Sun Cannon',
              archer: 'Disc Thrower',
              collect: 'транспорт→гейзер',
              priest: 'жрець',
              salvage: 'розібрати',
            }[m]
          }</button>`
        )
        .join('')
      + `<div style="margin-top:6px;opacity:.75">ЛКМ — дія, права кнопка/перетягування — камера, колесо — масштаб. ${
        world.winner ? '<b>Перемога гравця ' + world.winner + '</b>' : ''
      }</div>`;
  }

  function renderLog() {
    for (const e of takeEvents()) {
      const d = document.createElement('div');
      d.textContent = `${(e.tick / TPS).toFixed(1)}s ${e.what} ${e.who ?? ''} ${
        e.data ? JSON.stringify(e.data).slice(0, LOG_DATA_CHARS) : ''
      }`;
      logEl.prepend(d);
    }

    while (logEl.childElementCount > LOG_MAX_ENTRIES) {
      logEl.lastElementChild!.remove();
    }
  }

  hud.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('button[data-m]')
      : null;

    if (!button) {
      return;
    }

    mode = button.dataset.m as Mode;
    renderHud();
    drawGhost();
  }, { signal });

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'r') {
      rot = (rot + 1) & ROTATION_MASK;
    }

    if (ev.key === 'f') {
      facing = ((facing + 1) & ROTATION_MASK) as Facing;
    }

    renderHud();
    drawGhost();
  }, { signal });
  let drag: { x: number; y: number; cx: number; cy: number; } | null = null;
  app.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault(), { signal });
  app.canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) {
      drag = { x: ev.clientX, y: ev.clientY, cx: camera.x, cy: camera.y };
    }
  }, { signal });
  window.addEventListener('pointerup', () => {
    drag = null;
  }, { signal });
  app.canvas.addEventListener('pointermove', (ev) => {
    if (drag) {
      camera.x = drag.cx + ev.clientX - drag.x;
      camera.y = drag.cy + ev.clientY - drag.y;
    }

    const c = unIso((ev.clientX - camera.x) / camera.scale.x,
      (ev.clientY - camera.y) / camera.scale.y);
    hover = c;
    drawGhost();
  }, { signal });
  app.canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const z = Math.min(MAX_ZOOM,
      Math.max(MIN_ZOOM, camera.scale.x * (ev.deltaY < 0 ? ZOOM_IN : ZOOM_OUT)));
    const k = z / camera.scale.x;
    camera.x = ev.clientX - (ev.clientX - camera.x) * k;
    camera.y = ev.clientY - (ev.clientY - camera.y) * k;
    camera.scale.set(z);
  }, { signal, passive: false });
  app.canvas.addEventListener('click', () => {
    const { x, y } = hover;
    const p = world.players.get(1)!;

    if (mode === 'piece') {
      if (p.hand.length) {
        submit({ t: 'dropPiece', player: 1, hand: 0, x, y, rot });
      }
    } else if (mode === 'cannon') {
      submit({ t: 'build', player: 1, type: 'suncannon', x: x - 1, y: y - 1, facing });
    } else if (mode === 'archer') {
      submit({ t: 'build', player: 1, type: 'sunarcher', x: x - 1, y: y - 1 });
    } else if (mode === 'priest') {
      submit({ t: 'movePriest', player: 1, x, y });
    } else if (mode === 'salvage') {
      const unit = world.inside(x, y)
        ? world.entities.get(world.occupant[world.at(x, y)] ?? 0)
        : undefined;

      if (unit?.kind === 'building' && unit.owner === 1) {
        submit({ t: 'salvage', player: 1, target: unit.id });
      }
    } else if (mode === 'collect') {
      const tr = [...world.entities.values()].find((e) =>
        e.kind === 'transport'
        && e.owner === 1
        && Math.abs(e.x - x) <= 1
        && Math.abs(e.y - y) <= 1
      );
      const g = [...world.entities.values()].find((e) =>
        e.kind === 'geyser' && Math.abs(e.x - x) <= 1 && Math.abs(e.y - y) <= 1
      );

      const crystal = [...world.entities.values()].find((e) =>
        e.kind === 'crystal' && e.carriedBy === null && Math.abs(e.x - x) <= 1
        && Math.abs(e.y - y) <= 1
      );

      const downed = [...world.entities.values()].find((e) =>
        e.kind === 'priest'
        && e.owner !== 1
        && e.state === 'down'
        && Math.abs(e.x - x) <= 1
        && Math.abs(e.y - y) <= 1
      );

      if (tr) {
        selectedTransport = tr.id;
      } else if (g && selectedTransport !== null) {
        submit({ t: 'collect', player: 1, transport: selectedTransport, geyser: g.id });
      } else if (downed && selectedTransport !== null) {
        submit({ t: 'capturePriest', player: 1, transport: selectedTransport, target: downed.id });
      } else if (crystal && selectedTransport !== null) {
        submit({
          t: 'pickupCrystal',
          player: 1,
          transport: selectedTransport,
          crystal: crystal.id,
        });
      }
    }
  }, { signal });

  function drawGhost() {
    ghost.clear();
    const p = world.players.get(1)!;
    let buildingType: string | null = null;

    if (mode === 'cannon') {
      buildingType = 'suncannon';
    } else if (mode === 'archer') {
      buildingType = 'sunarcher';
    }

    const definition = buildingType ? world.def(buildingType) : null;
    let cells: [number, number][];

    if (mode === 'piece' && p.hand.length) {
      cells = rotatePiece(PIECES[p.hand[0]!.piece]!, rot).map((
        [dx, dy],
      ) => [hover.x + dx, hover.y + dy]);
    } else if (definition) {
      cells = Array.from({ length: definition.footX * definition.footY }, (_, index) => [
        hover.x - 1 + (index % definition.footX),
        hover.y - 1 + Math.floor(index / definition.footX),
      ]);
    } else {
      cells = [[hover.x, hover.y]];
    }

    const error = buildingType
      ? world.canBuild({
        player: 1,
        type: buildingType,
        x: hover.x - 1,
        y: hover.y - 1,
        ...(mode === 'cannon' ? { facing } : {}),
      })
      : null;
    const ghostStyle = { color: error ? COLOR_INVALID : COLOR_VALID, alpha: GHOST_ALPHA };

    for (const [x, y] of cells) {
      const { sx, sy } = iso(x, y);
      ghost.poly([sx, sy, sx + TW / 2, sy + TH / 2, sx, sy + TH, sx - TW / 2, sy + TH / 2]);
      // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- Pixi fills geometry with a paint style, not an array.
      ghost.fill(ghostStyle);
    }

    if (mode === 'cannon') {
      const [dx, dy] = DIRS[facing]!;
      const { sx, sy } = iso(hover.x + dx * AIM_DISTANCE, hover.y + dy * AIM_DISTANCE);
      ghost.circle(sx, sy + TH / 2, 2).fill(COLOR_INVALID);
    }
  }

  return {
    renderHud,
    renderLog,
    drawGhost,
    dispose() {
      abort.abort();
      hud.replaceChildren();
      logEl.replaceChildren();
    },
  };
}
