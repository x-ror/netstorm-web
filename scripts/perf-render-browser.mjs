/**
 * The built client in headless Chromium with `?perf=1`, on a late game of twelve sides laid out as
 * in perf-stress.ts: prints `ns.perf()` after a few seconds of play. Software WebGL, so the render
 * times are an upper bound; for the real thing open the same URL in Chrome and read `ns.perf()`.
 *
 *   npm run build && npm run perf:render
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4174;
const PLAY_MS = 8000;
const url = `http://127.0.0.1:${PORT}/?perf=1`;
const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js',
  'preview',
  '--host',
  '127.0.0.1',
  '--port',
  String(PORT),
  '--strictPort',
], { cwd: 'packages/client', stdio: 'pipe' });
let browser;
let serverOutput = '';
server.stdout.on('data', (data) => serverOutput += data);
server.stderr.on('data', (data) => serverOutput += data);

try {
  let ready = false;

  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    try {
      ready = (await fetch(url)).ok;
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(ready, `Preview did not start: ${serverOutput}`);
  const executablePath = process.env.CHROMIUM_PATH
    ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
  browser = await chromium.launch({
    executablePath,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Сутичка/ }).click();
  await page.getByRole('button', { name: 'Почати' }).click();
  await page.waitForFunction(() => window.ns?.world.players.size >= 2);
  await page.evaluate(() => {
    const { world } = window.ns;
    const themes = ['wind', 'rain', 'thunder'];
    const has = (type) => world.defs.has(type);

    for (let id = 3; id <= 12; id++) {
      world.addPlayer(id, `AI ${id}`, themes[(id - 1) % 3], 100_000, []);
    }

    world.addIsland(0, 0, 256, 256, 1);

    for (let player = 1; player <= 12; player++) {
      const theme = themes[(player - 1) % 3];
      const x = 8 + ((player - 1) % 4) * 62;
      const y = 8 + Math.floor((player - 1) / 4) * 80;
      const guns = [`${theme}cannon`, `${theme}archer`, 'suncannon', 'sunarcher'].filter(has);
      const walker = has(`${theme}walker`) ? `${theme}walker` : 'sunwalker';

      for (let i = 0; i < 20; i++) {
        world.spawnBuilding(guns[i % 2], player, x + 4 + (i % 4) * 10,
          y + 10 + Math.floor(i / 4) * 8);
      }

      for (let i = 0; i < 48; i++) {
        world.spawnTransport(walker, player, x + 2 + (i % 12) * 3, y + 38 + Math.floor(i / 12) * 3);
      }

      if (player > 2) {
        world.addPriest(player, x + 22, y + 32);
      }
    }

    world.invalidateTerrain();
  });
  await page.waitForTimeout(PLAY_MS);
  const report = await page.evaluate(() => ({
    browser: navigator.userAgent,
    tick: window.ns.world.tick,
    ...window.ns.perf(),
  }));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
