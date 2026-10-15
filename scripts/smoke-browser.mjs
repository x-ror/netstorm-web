import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4173/';
const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js',
  'preview',
  'packages/client',
  '--host',
  '127.0.0.1',
  '--port',
  '4173',
  '--strictPort',
], {
  cwd: new URL('../', import.meta.url),
  env: process.env,
  stdio: 'pipe',
});
let browser;
let serverOutput = '';
server.stdout.on('data', (data) => {
  serverOutput += data;
});
server.stderr.on('data', (data) => {
  serverOutput += data;
});

try {
  let ready = false;

  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) {
      throw new Error(`Preview exited: ${serverOutput}`);
    }

    try {
      ready = (await fetch(url)).ok;
    } catch {}

    if (ready) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(ready, `Preview did not start: ${serverOutput}`);
  const executablePath = process.env.CHROMIUM_PATH
    ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
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
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Почати' }).click();
  await page.waitForFunction(() => window.ns?.world.players.get(1).hand.length > 0);
  const result = await page.evaluate(() => {
    const { world, match, ground, entityLayer } = window.ns;
    const before = ground.children.length;
    // The island is grown by the builder, so a place for the first piece is looked for.
    const temple = world.templeOf(1);
    let drop = null;

    for (let y = temple.y - 40; y < temple.y + 40 && !drop; y++) {
      for (let x = temple.x - 40; x < temple.x + 40 && !drop; x++) {
        for (let rot = 0; rot < 4 && !drop; rot++) {
          const command = { t: 'dropPiece', player: 1, hand: 0, x, y, rot };
          drop = world.canDropPiece(command) === null ? command : null;
        }
      }
    }

    match.step([{ t: 'dropPiece', player: 1, hand: 0, x: 10, y: 10, rot: 0 }, drop]);
    const events = match.drainEvents();
    const rejected = events.find((event) => event.what === 'rejected')?.data.err;
    const accepted = events.some((event) => event.what === 'bridge');
    return { rejected, accepted, before, sprites: entityLayer.children.length, tick: world.tick };
  });
  assert.equal(result.rejected, 'not connected');
  assert.equal(result.accepted, true);
  assert.ok(result.sprites > 0);
  await page.waitForFunction((before) => window.ns.ground.children.length > before, result.before);

  // Production Window: picking a unit arms the build tool, Escape returns to selection.
  const cannon = page.getByRole('button', { name: 'Сонячна гармата', exact: true });
  await cannon.click();
  assert.match(await cannon.getAttribute('class'), /\bon\b/);
  await page.keyboard.press('f');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.ns.ui.tool.kind), 'select');

  // Selecting a carrier and clicking a geyser orders it to collect; the geyser is not bridged
  // yet, so the order comes back refused in the log.
  const screenOf = (x, y) =>
    page.evaluate(([cx, cy]) => {
      const { camera } = window.ns;
      return {
        x: camera.x + (cx + 0.5) * 16 * camera.scale.x,
        y: camera.y + (cy + 0.5) * 11 * camera.scale.y,
      };
    }, [x, y]);
  // The first mission gives the player no transport; the Priest fetches crystals as one does.
  const transport = await page.evaluate(() => {
    const { world, camera } = window.ns;
    const t = world.priestOf(1);
    camera.position.set(640 - (t.x + 0.5) * 16 * camera.scale.x,
      400 - (t.y + 0.5) * 11 * camera.scale.y);
    return { id: t.id, x: t.x, y: t.y };
  });
  let point = await screenOf(transport.x, transport.y);
  await page.mouse.click(point.x, point.y);
  assert.equal(await page.evaluate(() => window.ns.ui.selected), transport.id);
  const geyser = await page.evaluate(() => {
    const { world, camera } = window.ns;
    // A geyser out in the open sky, not one that happens to sit on the island.
    const open = (e) =>
      [[-2, 0], [2, 0], [0, -2], [0, 2]].every(([dx, dy]) =>
        world.terrain[(e.y + dy) * 256 + e.x + dx] === 0
      );
    const g = [...world.entities.values()].find((e) => e.kind === 'geyser' && open(e));
    camera.position.set(640 - (g.x + 0.5) * 16 * camera.scale.x,
      400 - (g.y + 0.5) * 11 * camera.scale.y);
    return { x: g.x, y: g.y };
  });
  point = await screenOf(geyser.x, geyser.y);
  await page.mouse.click(point.x, point.y);
  await page.locator('#log').getByText('Збір: туди не дійти').waitFor();

  // Pause stops the simulation; Space resumes it.
  await page.keyboard.press(' ');
  const pausedAt = await page.evaluate(() => window.ns.world.tick);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.ns.world.tick), pausedAt);
  await page.keyboard.press(' ');

  // The minimap moves the camera.
  const cameraBefore = await page.evaluate(() => window.ns.camera.x);
  const minimap = await page.locator('#minimap').boundingBox();
  await page.mouse.click(minimap.x + minimap.width * 0.8, minimap.y + minimap.height * 0.5);
  assert.notEqual(await page.evaluate(() => window.ns.camera.x), cameraBefore);

  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 100);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(700, 450, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction((tick) => window.ns.world.tick > tick, result.tick);
  const replay = await page.evaluate(() => {
    const { world, match, playReplay } = window.ns;
    const restored = playReplay(JSON.parse(JSON.stringify(match.export())));
    return { actual: world.hash(), replayed: restored.hash(), tick: restored.tick };
  });
  assert.equal(replay.actual, replay.replayed);
  assert.ok(replay.tick > result.tick);

  // Leaving the match returns to the menu and releases the scene.
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('button', { name: 'Почати' }).waitFor();
  assert.equal(await page.evaluate(() => window.ns), undefined);
  assert.deepEqual(errors, []);
  console.log(
    'Browser smoke passed: menu, assets, ticking, bridge redraw, production, orders, pause, minimap, camera and replay.',
  );
} finally {
  await browser?.close();
  server.kill();
}
