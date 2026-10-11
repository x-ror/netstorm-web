import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4173/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', 'packages/client', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
  cwd: new URL('../', import.meta.url),
  env: process.env,
  stdio: 'pipe',
});
let browser;
let serverOutput = '';
server.stdout.on('data', data => { serverOutput += data; });
server.stderr.on('data', data => { serverOutput += data; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Preview exited: ${serverOutput}`);
    try { ready = (await fetch(url)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Preview did not start: ${serverOutput}`);
  const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
  browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ns?.world.tick >= 5);
  const result = await page.evaluate(() => {
    const { world, terrainG, entityLayer } = window.ns;
    const before = terrainG.context.instructions.length;
    world.players.get(1).hand = [7];
    const rejected = world.apply({ t: 'dropPiece', player: 1, hand: 0, x: 10, y: 10, rot: 0 });
    const accepted = world.apply({ t: 'dropPiece', player: 1, hand: 0, x: 81, y: 150, rot: 0 });
    return { rejected, accepted, before, sprites: entityLayer.children.length, tick: world.tick };
  });
  assert.equal(result.rejected, 'not connected');
  assert.equal(result.accepted, null);
  assert.ok(result.sprites > 0);
  await page.waitForFunction(before => window.ns.terrainG.context.instructions.length > before, result.before);
  await page.getByRole('button', { name: 'Sun Cannon', exact: true }).click();
  await page.keyboard.press('f');
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 100);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(700, 450, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction(tick => window.ns.world.tick > tick, result.tick);
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: assets, ticking, bridge redraw, HUD and camera.');
} finally {
  await browser?.close();
  server.kill();
}
