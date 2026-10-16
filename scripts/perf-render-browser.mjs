import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const port = 4174;
const url = `http://127.0.0.1:${port}/?perf=1`;
const server = spawn(process.execPath, [
  new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname,
  '--host',
  '127.0.0.1',
  '--port',
  String(port),
  '--strictPort',
], { cwd: new URL('../packages/client/', import.meta.url), stdio: 'pipe' });
let browser;
let serverOutput = '';
server.stdout.on('data', (data) => serverOutput += data);
server.stderr.on('data', (data) => serverOutput += data);

try {
  let ready = false;

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(url)).ok;
    } catch {}

    if (ready) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(ready, `Vite did not start: ${serverOutput}`);
  const executablePath = process.env.CHROMIUM_PATH
    ?? ['/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
  browser = await chromium.launch({
    executablePath,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Сутичка/ }).click();
  await page.getByRole('button', { name: 'Почати' }).click();
  await page.waitForFunction(() => window.ns?.world?.players.size >= 2);
  await page.evaluate(() => {
    const { world, match } = window.ns;
    const themes = ['wind', 'rain', 'thunder'];

    for (let id = 3; id <= 12; id++) {
      const theme = themes[(id - 1) % themes.length];
      world.addPlayer(id, `Perf AI ${id}`, theme, 100_000, []);
    }

    world.addIsland(0, 0, 256, 256, 1);

    for (let player = 1; player <= 12; player++) {
      const col = (player - 1) % 4;
      const row = Math.floor((player - 1) / 4);
      const x = 8 + col * 62;
      const y = 8 + row * 80;

      for (let index = 0; index < 20; index++) {
        world.spawnBuilding(index % 2 ? 'sunarcher' : 'suncannon', player, x + 4 + (index % 4) * 10,
          y + 10 + Math.floor(index / 4) * 8);
      }

      for (let index = 0; index < 48; index++) {
        world.spawnTransport('sunwalker', player, x + 2 + (index % 12) * 3,
          y + 38 + Math.floor(index / 12) * 3);
      }

      if (player > 2) {
        world.addPriest(player, x + 22, y + 32);
      }
    }

    world.invalidateTerrain();
    match.step([]);
  });
  await page.waitForTimeout(5000);
  const report = await page.evaluate(() => ({
    runtime: navigator.userAgent,
    perf: window.ns.perf(),
    map: `${window.ns.world.terrain.length ** 0.5}x${window.ns.world.terrain.length ** 0.5}`,
    players: window.ns.world.players.size,
    entities: window.ns.world.entities.size,
    tick: window.ns.world.tick,
  }));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
