import { type Application, type Container, type Graphics } from 'pixi.js';
import {
  TPS,
  PIECES,
  rotatePiece,
  DIRS,
  type WorldView,
  type Facing,
  type Command,
  type Event as SimEvent,
} from '@netstorm/sim';
import { iso, unIso, TW, TH } from './projection.js';

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
  type Mode = 'piece' | 'cannon' | 'archer' | 'collect' | 'priest';
  let mode: Mode = 'piece';
  let rot = 0;
  let facing: Facing = 1;
  let hover = { x: 0, y: 0 };
  let selectedTransport: number | null = null;

  function renderHud() {
    const p = world.players.get(1)!;
    const en = world.energy(1);
    hud.innerHTML =
      `<b>NetStorm Web</b> · tick ${world.tick} · Storm Power <b>${p.storm}</b> · енергія ${en.own}/${en.any} · сегменти мостів: ${
        p.hand.map((i) => 'IOTLJSZ-'[i]).join(' ') || '—'
      }<br>`
      + `режим: <b>${mode}</b> &nbsp; R — повернути (${rot}) &nbsp; F — напрям гармати (${
        'ПСхЗ'[facing]
      })<br>`
      + (['piece', 'cannon', 'archer', 'collect', 'priest'] as Mode[])
        .map((m) =>
          `<button data-m="${m}" class="${m === mode ? 'on' : ''}">${
            {
              piece: 'міст',
              cannon: 'Sun Cannon',
              archer: 'Disc Thrower',
              collect: 'транспорт→гейзер',
              priest: 'жрець',
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
        e.data ? JSON.stringify(e.data).slice(0, 60) : ''
      }`;
      logEl.prepend(d);
    }

    while (logEl.childElementCount > 100) {
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
      rot = (rot + 1) & 3;
    }

    if (ev.key === 'f') {
      facing = ((facing + 1) & 3) as Facing;
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
    const z = Math.min(4, Math.max(0.5, camera.scale.x * (ev.deltaY < 0 ? 1.1 : 0.9)));
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

      if (tr) {
        selectedTransport = tr.id;
      } else if (g && selectedTransport !== null) {
        submit({ t: 'collect', player: 1, transport: selectedTransport, geyser: g.id });
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
      cells = rotatePiece(PIECES[p.hand[0]!]!, rot).map(([dx, dy]) => [hover.x + dx, hover.y + dy]);
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
    const ghostStyle = { color: error ? 0xff4444 : 0xffd166, alpha: 0.5 };

    for (const [x, y] of cells) {
      const { sx, sy } = iso(x, y);
      ghost.poly([sx, sy, sx + TW / 2, sy + TH / 2, sx, sy + TH, sx - TW / 2, sy + TH / 2]);
      // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- Pixi fills geometry with a paint style, not an array.
      ghost.fill(ghostStyle);
    }

    if (mode === 'cannon') {
      const [dx, dy] = DIRS[facing]!;
      const { sx, sy } = iso(hover.x + dx * 3, hover.y + dy * 3);
      ghost.circle(sx, sy + TH / 2, 2).fill(0xff4444);
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
