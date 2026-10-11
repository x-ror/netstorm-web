import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
const r = await p.evaluate(async () => {
  const { world } = window.ns; const log = [];
  // 1) bridge from the island's top-right corner (80,142) to the nearest geyser: along x then y
  const gs = [...world.entities.values()].filter(e => e.kind === 'geyser');
  const g = gs.sort((a, b) => (Math.abs(a.x-80)+Math.abs(a.y-142)) - (Math.abs(b.x-80)+Math.abs(b.y-142)))[0];
  const put = (x, y) => { if (world.terrain[y*256+x] === 0) { world.terrain[y*256+x] = 2; world.owner[y*256+x] = 1; } };
  let x = 80, y = 142; const tx = g.x, ty = g.y + 2; // aim below the islet
  while (x !== tx) { x += Math.sign(tx - x); put(x, y); }
  while (y !== ty) { y += Math.sign(ty - y); put(x, y); }
  log.push('geyser ' + g.x + ',' + g.y);
  // 2) build a sun cannon on the bridge start facing east, an archer on the island
  log.push(world.apply({ t: 'build', player: 1, type: 'suncannon', x: 78, y: 142, facing: 1 }));
  log.push(world.apply({ t: 'build', player: 1, type: 'sunarcher', x: 62, y: 143 }));
  // 3) transport -> geyser
  const tr = [...world.entities.values()].find(e => e.kind === 'transport' && e.owner === 1);
  log.push(world.apply({ t: 'collect', player: 1, transport: tr.id, geyser: g.id }));
  // 4) enemy transport walks into the cannon line
  world.spawnTransport('rainwalker', 2, 90, 143);
  const t0 = world.tick; await new Promise(r => setTimeout(r, 12000));
  return { log, ticks: world.tick - t0, storm: world.players.get(1).storm, events: world.events.slice(-6).map(e => e.what + ' ' + JSON.stringify(e.data ?? '')) };
});
console.log(r);
await p.mouse.move(640,400); for (let i=0;i<4;i++) await p.mouse.wheel(0,100); await p.mouse.move(900,500); await p.mouse.down({button:'right'}); await p.mouse.move(500,600,{steps:5}); await p.mouse.up({button:'right'}); await p.waitForTimeout(800);
await p.screenshot({ path: '/tmp/play.png' }); await b.close();
