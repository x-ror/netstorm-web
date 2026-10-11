import { Application, Container, Graphics, Sprite, Assets, Texture, Text } from 'pixi.js';
import { loadDefs, createSkirmish, World, TPS, PIECES, rotatePiece, Facing, Command, DIRS } from '@netstorm/sim';

// Original isometric cell: 16×11 px at 1×. We render at 2× with nearest-neighbour scaling.
const TW = 16, TH = 11, ZOOM = 2;
const iso = (x: number, y: number) => ({ sx: (x - y) * (TW / 2), sy: (x + y) * (TH / 2) });
const unIso = (sx: number, sy: number) => ({ x: Math.floor((sx / (TW / 2) + sy / (TH / 2)) / 2), y: Math.floor((sy / (TH / 2) - sx / (TW / 2)) / 2) });

type Manifest = Record<string, Record<string, Record<string, string>>>;

async function main() {
  const [unitsRaw, forts, manifest] = await Promise.all([
    fetch('data/units.json').then(r => r.json()), fetch('data/forts.json').then(r => r.json()), fetch('data/sprites.json').then(r => r.json()) as Promise<Manifest>,
  ]);
  const defs = loadDefs(unitsRaw);
  const geysers: [number, number][] = (forts['thewarbegins']?.geysers ?? []).map(([x, y]: number[]) => [x!, y!]);
  const world = createSkirmish(defs, 42, [
    { id: 1, name: 'Ти', theme: 'wind', x: 70, y: 150 },
    { id: 2, name: 'The Jailer', theme: 'rain', x: 150, y: 90 },
  ], geysers.length ? geysers : [[110, 120]]);

  const app = new Application();
  await app.init({ background: '#0b1020', resizeTo: window, antialias: false, resolution: 1 });
  document.body.appendChild(app.canvas);
  const camera = new Container(); camera.scale.set(ZOOM); app.stage.addChild(camera);
  const terrainG = new Graphics(); const entityLayer = new Container(); const ghost = new Graphics();
  camera.addChild(terrainG, entityLayer, ghost);

  // --- textures: pick representative frames (frame numbers from the .type orientation tables)
  const tex = new Map<string, Texture>();
  const pick = async (key: string, type: string, gif: string, frame?: number) => {
    const g = manifest[type]?.[gif]; if (!g) return;
    const file = frame !== undefined && g[frame] ? g[frame] : Object.values(g)[0];
    if (file) { const t = await Assets.load<Texture>(file); t.source.scaleMode = 'nearest'; tex.set(key, t); }
  };
  await Promise.all([
    pick('suncannon:0', 'suncannon', 'scannon', 10), pick('suncannon:1', 'suncannon', 'scannon', 5), pick('suncannon:2', 'suncannon', 'scannon', 0), pick('suncannon:3', 'suncannon', 'scannon', 14),
    pick('sunarcher', 'sunarcher', 'f'), pick('thundercannon', 'thundercannon', 'tcannon'), pick('windarcher', 'windarcher', 'warch1'),
    pick('sunwalker', 'sunwalker', 'golem'), pick('windwalker', 'windwalker', 'wwalker'), pick('rainwalker', 'rainwalker', 'rcrab'), pick('bulf', 'bulf', 'bulfwalk'),
    pick('priest', 'priest', 'priest'), pick('priest:down', 'priest', 'pchant'), pick('geyser', 'geyser', 'f'), pick('nugget', 'nugget', 'nugget'), pick('altar', 'altar', 'altar21'),
    pick('isle', 'isle', 'wiisle', 0),
  ]);

  // --- terrain
  let terrainVersion = -1;
  function drawTerrain() {
    terrainG.clear();
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const t = world.terrain[y * 256 + x]; if (!t) continue;
      const o = world.owner[y * 256 + x]!; const { sx, sy } = iso(x, y);
      const col = t === 2 ? 0x8a8f99 : o === 1 ? 0x5c7a3a : o === 2 ? 0x7a3a3a : 0x6b5a3a;
      terrainG.poly([sx, sy, sx + TW / 2, sy + TH / 2, sx, sy + TH, sx - TW / 2, sy + TH / 2]).fill(col).stroke({ color: 0x0b1020, width: 0.5 });
    }
  }

  // --- entities
  const sprites = new Map<number, Sprite | Graphics>();
  function syncEntities() {
    const seen = new Set<number>();
    for (const e of world.entities.values()) {
      seen.add(e.id);
      let s = sprites.get(e.id);
      let key = e.kind === 'building' ? (e.type === 'suncannon' ? `suncannon:${e.facing}` : e.type) : e.kind === 'transport' ? e.type : e.kind === 'priest' ? (e.state === 'normal' ? 'priest' : 'priest:down') : e.kind === 'geyser' ? 'geyser' : e.kind === 'crystal' ? 'nugget' : '';
      const t = tex.get(key);
      if (!s) {
        if (t) { const sp = new Sprite(t); sp.anchor.set(0.5, 0.85); s = sp; }
        else { const g = new Graphics(); g.circle(0, 0, 4).fill(e.kind === 'building' ? 0xffd166 : 0x66ccff); s = g; }
        entityLayer.addChild(s); sprites.set(e.id, s);
      } else if (s instanceof Sprite && t && s.texture !== t) s.texture = t;
      if (e.kind === 'crystal' && e.carriedBy !== null) { s.visible = false; continue; }
      s.visible = true;
      const cx = e.kind === 'building' ? e.x + e.fx / 2 : e.x + 0.5, cy = e.kind === 'building' ? e.y + e.fy / 2 : e.y + 0.5;
      const { sx, sy } = iso(cx, cy); s.position.set(sx, sy + TH / 2); s.zIndex = sy;
      if (e.kind === 'priest' && e.owner !== 1) s.tint = 0xff9999; else if (e.kind === 'building' && e.owner === 2) s.tint = 0xffb0b0;
      if ('hp' in e && e.hp < e.hpMax) s.alpha = 0.5 + 0.5 * e.hp / e.hpMax;
    }
    for (const [id, s] of sprites) if (!seen.has(id)) { s.destroy(); sprites.delete(id); }
    entityLayer.sortableChildren = true;
  }

  // --- HUD / input
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
    hud.querySelectorAll('button').forEach(b => b.onclick = () => { mode = b.dataset.m as Mode; renderHud(); });
  }
  let logged = 0;
  function renderLog() { for (; logged < world.events.length; logged++) { const e = world.events[logged]!; const d = document.createElement('div'); d.textContent = `${(e.tick / TPS).toFixed(1)}s ${e.what} ${e.who ?? ''} ${e.data ? JSON.stringify(e.data).slice(0, 60) : ''}`; logEl.prepend(d); } }

  window.addEventListener('keydown', ev => { if (ev.key === 'r') rot = (rot + 1) & 3; if (ev.key === 'f') facing = ((facing + 1) & 3) as Facing; renderHud(); });
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  app.canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  app.canvas.addEventListener('pointerdown', ev => { if (ev.button !== 0) drag = { x: ev.clientX, y: ev.clientY, cx: camera.x, cy: camera.y }; });
  window.addEventListener('pointerup', () => { drag = null; });
  app.canvas.addEventListener('pointermove', ev => {
    if (drag) { camera.x = drag.cx + ev.clientX - drag.x; camera.y = drag.cy + ev.clientY - drag.y; }
    const c = unIso((ev.clientX - camera.x) / camera.scale.x, (ev.clientY - camera.y) / camera.scale.y); hover = c; drawGhost();
  });
  app.canvas.addEventListener('wheel', ev => {
    const z = Math.min(4, Math.max(0.5, camera.scale.x * (ev.deltaY < 0 ? 1.1 : 0.9))); const k = z / camera.scale.x;
    camera.x = ev.clientX - (ev.clientX - camera.x) * k; camera.y = ev.clientY - (ev.clientY - camera.y) * k; camera.scale.set(z);
  });
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
  });
  function drawGhost() {
    ghost.clear(); const p = world.players.get(1)!;
    const cells: [number, number][] = mode === 'piece' && p.hand.length ? rotatePiece(PIECES[p.hand[0]!]!, rot).map(([dx, dy]) => [hover.x + dx, hover.y + dy]) :
      mode === 'cannon' || mode === 'archer' ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].map(([dx, dy]) => [hover.x + dx!, hover.y + dy!]) : [[hover.x, hover.y]];
    for (const [x, y] of cells) { const { sx, sy } = iso(x, y); ghost.poly([sx, sy, sx + TW / 2, sy + TH / 2, sx, sy + TH, sx - TW / 2, sy + TH / 2]).fill({ color: 0xffd166, alpha: 0.5 }); }
    if (mode === 'cannon') { const [dx, dy] = DIRS[facing]!; const { sx, sy } = iso(hover.x + dx * 3, hover.y + dy * 3); ghost.circle(sx, sy + TH / 2, 2).fill(0xff4444); }
  }

  // --- loop: fixed-step simulation at TPS, rendering every frame
  const me = world.priestOf(1)!; const start = iso(me.x, me.y);
  camera.position.set(window.innerWidth / 2 - start.sx * ZOOM, window.innerHeight / 2 - start.sy * ZOOM);
  (window as unknown as { ns: unknown }).ns = { world, camera, app, terrainG, entityLayer };
  let acc = 0; renderHud();
  app.ticker.add(t => {
    acc += t.deltaMS; let steps = 0;
    while (acc >= 1000 / TPS && steps++ < 5) { acc -= 1000 / TPS; world.step(queue.splice(0)); }
    if (world.tick - terrainVersion >= 20) { terrainVersion = world.tick; drawTerrain(); }
    syncEntities(); if (world.tick % 5 === 0) { renderHud(); renderLog(); }
  });
}
main();
