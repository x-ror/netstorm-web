import { Application, Container, Graphics } from 'pixi.js';
import { World, TPS, PIECES, rotatePiece, DIRS, type Facing, type Command } from '@netstorm/sim';
import { iso, unIso, TW, TH } from './projection.js';

/** Browser input creates commands; only the fixed-step loop submits them to the world. */
export function createControls(world: World, app: Application, camera: Container, ghost: Graphics) {
  const abort = new AbortController();
  const signal = abort.signal;
  const hud = document.getElementById('hud')!, logEl = document.getElementById('log')!;
  type Mode = 'piece' | 'cannon' | 'archer' | 'collect' | 'priest';
  let mode: Mode = 'piece', rot = 0, facing: Facing = 1, hover = { x: 0, y: 0 }, selectedTransport: number | null = null;
  const queue: Command[] = [];
  function renderHud() {
    const p = world.players.get(1)!; const en = world.energy(1);
    hud.innerHTML = `<b>NetStorm Web</b> · tick ${world.tick} · Storm Power <b>${p.storm}</b> · енергія ${en.own}/${en.any} · сегменти мостів: ${p.hand.map(i => 'IOTLJSZ-'[i]).join(' ') || '—'}<br>` +
      `режим: <b>${mode}</b> &nbsp; R — повернути (${rot}) &nbsp; F — напрям гармати (${'ПСхЗ'[facing]})<br>` +
      (['piece', 'cannon', 'archer', 'collect', 'priest'] as Mode[]).map(m => `<button data-m="${m}" class="${m === mode ? 'on' : ''}">${{ piece: 'міст', cannon: 'Sun Cannon', archer: 'Disc Thrower', collect: 'транспорт→гейзер', priest: 'жрець' }[m]}</button>`).join('') +
      `<div style="margin-top:6px;opacity:.75">ЛКМ — дія, права кнопка/перетягування — камера, колесо — масштаб. ${world.winner ? '<b>Перемога гравця ' + world.winner + '</b>' : ''}</div>`;
    hud.querySelectorAll('button').forEach(b => b.onclick = () => { mode = b.dataset.m as Mode; renderHud(); drawGhost(); }, { signal });
  }
  function renderLog() { for (const e of world.drainEvents()) { const d = document.createElement('div'); d.textContent = `${(e.tick / TPS).toFixed(1)}s ${e.what} ${e.who ?? ''} ${e.data ? JSON.stringify(e.data).slice(0, 60) : ''}`; logEl.prepend(d); } while (logEl.childElementCount > 100) logEl.lastElementChild!.remove(); }

  window.addEventListener('keydown', ev => { if (ev.key === 'r') rot = (rot + 1) & 3; if (ev.key === 'f') facing = ((facing + 1) & 3) as Facing; renderHud(); drawGhost(); }, { signal });
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  app.canvas.addEventListener('contextmenu', ev => ev.preventDefault(), { signal });
  app.canvas.addEventListener('pointerdown', ev => { if (ev.button !== 0) drag = { x: ev.clientX, y: ev.clientY, cx: camera.x, cy: camera.y }; }, { signal });
  window.addEventListener('pointerup', () => { drag = null; }, { signal });
  app.canvas.addEventListener('pointermove', ev => {
    if (drag) { camera.x = drag.cx + ev.clientX - drag.x; camera.y = drag.cy + ev.clientY - drag.y; }
    const c = unIso((ev.clientX - camera.x) / camera.scale.x, (ev.clientY - camera.y) / camera.scale.y); hover = c; drawGhost();
  }, { signal });
  app.canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    const z = Math.min(4, Math.max(0.5, camera.scale.x * (ev.deltaY < 0 ? 1.1 : 0.9))); const k = z / camera.scale.x;
    camera.x = ev.clientX - (ev.clientX - camera.x) * k; camera.y = ev.clientY - (ev.clientY - camera.y) * k; camera.scale.set(z);
  }, { signal, passive: false });
  app.canvas.addEventListener('click', () => {
    const { x, y } = hover; const p = world.players.get(1)!;
    if (mode === 'piece') { if (p.hand.length) queue.push({ t: 'dropPiece', player: 1, hand: 0, x, y, rot }); }
    else if (mode === 'cannon') queue.push({ t: 'build', player: 1, type: 'suncannon', x: x - 1, y: y - 1, facing });
    else if (mode === 'archer') queue.push({ t: 'build', player: 1, type: 'sunarcher', x: x - 1, y: y - 1 });
    else if (mode === 'priest') queue.push({ t: 'movePriest', player: 1, x, y });
    else if (mode === 'collect') {
      const tr = [...world.entities.values()].find(e => e.kind === 'transport' && e.owner === 1 && Math.abs(e.x - x) <= 1 && Math.abs(e.y - y) <= 1);
      const g = [...world.entities.values()].find(e => e.kind === 'geyser' && Math.abs(e.x - x) <= 1 && Math.abs(e.y - y) <= 1);
      if (tr) selectedTransport = tr.id; else if (g && selectedTransport !== null) queue.push({ t: 'collect', player: 1, transport: selectedTransport, geyser: g.id });
    }
  }, { signal });
  function drawGhost() {
    ghost.clear(); const p = world.players.get(1)!;
    const cells: [number, number][] = mode === 'piece' && p.hand.length ? rotatePiece(PIECES[p.hand[0]!]!, rot).map(([dx, dy]) => [hover.x + dx, hover.y + dy]) :
      mode === 'cannon' || mode === 'archer' ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].map(([dx, dy]) => [hover.x + dx!, hover.y + dy!]) : [[hover.x, hover.y]];
    for (const [x, y] of cells) { const { sx, sy } = iso(x, y); ghost.poly([sx, sy, sx + TW / 2, sy + TH / 2, sx, sy + TH, sx - TW / 2, sy + TH / 2]).fill({ color: 0xffd166, alpha: 0.5 }); }
    if (mode === 'cannon') { const [dx, dy] = DIRS[facing]!; const { sx, sy } = iso(hover.x + dx * 3, hover.y + dy * 3); ghost.circle(sx, sy + TH / 2, 2).fill(0xff4444); }
  }

  return {
    takeCommands: () => queue.splice(0),
    renderHud, renderLog, drawGhost,
    dispose() { abort.abort(); hud.replaceChildren(); logEl.replaceChildren(); },
  };
}
