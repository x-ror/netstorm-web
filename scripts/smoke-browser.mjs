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
  // The title screen opens on its categories; a skirmish starts from its own page.
  await page.getByRole('button', { name: /Сутичка/ }).click();
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

  // Production Window: picking a unit arms the build tool, Escape returns to selection. Without a
  // Workshop it holds only what the Temple makes, the Golem.
  const golem = page.getByRole('button', { name: 'Голем', exact: true });
  await golem.click();
  assert.match(await golem.getAttribute('class'), /\bon\b/);
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

  // Synthetic key schedules are independent of OS repeats and display refresh rate.
  const cameraTiming = await page.evaluate(() => {
    const { app, camera, advanceCamera } = window.ns;
    app.stop();
    const distances = [];

    for (const fps of [30, 60, 144]) {
      camera.position.set(0, 0);
      advanceCamera(0);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

      for (let frame = 0; frame < fps; frame++) {
        advanceCamera(1000 / fps);
      }

      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
      distances.push(camera.x);
    }

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    window.dispatchEvent(new Event('blur'));
    const before = camera.x;
    advanceCamera(100);
    app.start();
    return { distances, stoppedOnBlur: camera.x === before };
  });
  assert.deepEqual(cameraTiming.distances, [480, 480, 480]);
  assert.equal(cameraTiming.stoppedOnBlur, true);

  const toggles = await page.evaluate(() => {
    const { world, animation } = window.ns;
    const before = world.hash();
    animation.setImproved(false);
    animation.setImproved(true);
    return { before, after: world.hash() };
  });
  assert.equal(toggles.before, toggles.after);
  const hiddenTick = await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    return window.ns.world.tick;
  });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.ns.world.tick), hiddenTick);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction((tick) => window.ns.world.tick > tick, hiddenTick);

  // Opt-in, reproducible CPU measurements; no debug mutation is recorded as a replay.
  if (process.env.NS_ANIMATION_BENCH) {
    const session = await page.context().newCDPSession(page);
    const environment = await page.evaluate(() => ({
      browser: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      cores: navigator.hardwareConcurrency,
      zoom: window.ns.camera.scale.x,
    }));
    console.log('Animation environment', JSON.stringify(environment));

    for (const throttle of [1, 4]) {
      await session.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      const measurements = await page.evaluate(async () => {
        const fixture = window.ns.createAnimationFixture();
        const { app, world, animation, camera, entityLayer } = fixture;
        app.stop();
        const initialTick = world.tick;
        const results = [];
        // Kept inside evaluate because Playwright serializes this entire function.
        // oxlint-disable-next-line unicorn/consistent-function-scoping
        const percentile = (values, fraction) =>
          // oxlint-disable-line unicorn/consistent-function-scoping
          [...values].sort((a, b) => a - b)[Math.floor(values.length * fraction)];
        const temple = world.templeOf(1);
        // oxlint-disable-next-line unicorn/consistent-function-scoping
        const countObjects = (root) => {
          const pending = [root];
          let count = 0;

          while (pending.length) {
            const node = pending.pop();
            count++;
            pending.push(...node.children);
          }

          return count;
        };
        camera.position.set(640 - temple.x * 16 * camera.scale.x,
          400 - temple.y * 11 * camera.scale.y);
        const advance = (added, i, combat) => {
          if (i % 6 !== 0) {
            return;
          }

          world.tick++;

          for (const id of added) {
            const unit = world.entities.get(id);

            if (unit.kind === 'building' && combat) {
              unit.cooldown = i % 12 === 0 ? 8 : 0;
            }
          }
        };

        for (const scene of ['idle', 'combat', 'construction']) {
          const added = [];

          if (scene === 'construction') {
            const workshop = world.spawnBuilding('windfactory', 1, temple.x - 12, temple.y - 12);
            workshop.rising = 0;
            workshop.slots.push('windarcher');
            added.push(workshop.id);
          }

          if (scene !== 'idle') {
            for (let i = 0; i < 48; i++) {
              const x = temple.x + (i % 8) * 3 - 12;
              const y = temple.y + Math.floor(i / 8) * 3 - 9;
              const unit = world.spawnBuilding('windarcher', 1, x, y);
              unit.hp /= 2;
              unit.rising = scene === 'construction' ? 100 : 0;
              const target = world.spawnTransport('sunwalker', 2, x + 2, y + 2);
              target.hp /= 2;
              unit.target = scene === 'combat' ? target.id : null;
              added.push(unit.id, target.id);
            }
          }

          // Alternate modes within the same warmed scene, not two cold page loads.
          for (let round = 0; round < 4; round++) {
            const improved = round % 2 === 1;
            animation.setImproved(improved);

            // Settle every finite burst before measuring a round. Warm CPU/state separately from
            // the GPU queue, then discard the first 30 submitted frames as well.
            for (let i = 0; i < 180; i++) {
              advance(added, i, scene === 'combat');
              animation.sync((i % 6) / 6);
            }

            const sync = [];
            const frame = [];
            const intervals = [];
            let previousFrame;
            const heapBefore = performance.memory?.usedJSHeapSize;

            for (let i = 0; i < 60; i++) {
              const timestamp = await new Promise((resolve) => requestAnimationFrame(resolve));

              if (i >= 30 && previousFrame !== undefined) {
                intervals.push(timestamp - previousFrame);
              }

              previousFrame = timestamp;
              // Synthetic ticks exercise capture and transient creation without running AI.
              advance(added, i, scene === 'combat');

              const start = performance.now();
              animation.sync((i % 6) / 6);
              const drawn = performance.now();
              app.render();
              const end = performance.now();

              if (i >= 30) {
                sync.push(drawn - start);
                frame.push(end - start);
              }
            }

            const effects = animation.inspect?.();
            results.push({
              scene,
              improved,
              round,
              entities: world.entities.size,
              displayObjects: countObjects(camera),
              entityLayerChildren: entityLayer.children.length,
              effects: effects
                ? {
                  missiles: effects.missiles.length,
                  bursts: effects.bursts.length,
                  streams: effects.streams,
                  bolts: effects.bolts,
                }
                : null,
              heapDelta: performance.memory ? performance.memory.usedJSHeapSize - heapBefore : null,
              syncMedian: percentile(sync, 0.5),
              syncP95: percentile(sync, 0.95),
              frameMedian: percentile(frame, 0.5),
              frameP95: percentile(frame, 0.95),
              intervalMedian: percentile(intervals, 0.5),
              intervalP95: percentile(intervals, 0.95),
              over60: frame.filter((ms) => ms > 1000 / 60).length,
              over144: frame.filter((ms) => ms > 1000 / 144).length,
            });
          }

          for (const id of added) {
            world.entities.delete(id);
          }
        }

        fixture.dispose();
        return { results, initialTick };
      });
      console.log('Animation benchmark', JSON.stringify({ throttle, ...measurements }));
    }

    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }

  // Leaving the match returns to the menu and releases the scene.
  if (process.env.NS_ANIMATION_BENCH) {
    await page.getByRole('button', { name: 'Меню' }).dispatchEvent('click');
  } else {
    await page.getByRole('button', { name: 'Меню' }).click();
  }

  await page.getByRole('button', { name: /Сутичка/ }).waitFor();
  assert.equal(await page.evaluate(() => window.ns), undefined);
  assert.deepEqual(errors, []);

  // Actual emulated DPRs and each discrete physical-pixel zoom level, with reduced motion.
  for (const deviceScaleFactor of [1, 1.5, 2]) {
    const pixelPage = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor,
      reducedMotion: 'reduce',
    });
    await pixelPage.goto(url, { waitUntil: 'networkidle' });
    await pixelPage.getByRole('button', { name: /Сутичка/ }).click();
    await pixelPage.getByRole('button', { name: 'Почати' }).click();
    await pixelPage.waitForFunction(() => !!window.ns);
    const pixels = await pixelPage.evaluate(() => {
      const { camera, cameraTools, app } = window.ns;
      app.stop();
      const samples = [];
      camera.scale.set(0.5 / devicePixelRatio);
      samples.push({ scale: camera.scale.x * devicePixelRatio, snapped: true, error: 0 });

      for (let level = 0; level < 5; level++) {
        const before = cameraTools.cellAt(camera, 640, 400);
        cameraTools.zoomAt(camera, 640, 400, 1.1);
        const after = cameraTools.cellAt(camera, 640, 400);
        samples.push({
          scale: camera.scale.x * devicePixelRatio,
          snapped: Math.abs(camera.x * devicePixelRatio - Math.round(camera.x * devicePixelRatio))
            < 1e-8,
          error: Math.hypot(before.x - after.x, before.y - after.y),
        });
      }

      camera.scale.set(1 / devicePixelRatio);
      const touch = (type, id, x) =>
        app.canvas.dispatchEvent(new PointerEvent(type, {
          pointerId: id,
          pointerType: 'touch',
          clientX: x,
          clientY: 400,
          bubbles: true,
        }));
      touch('pointerdown', 101, 640);
      touch('pointerdown', 102, 740);
      touch('pointermove', 102, 820);
      touch('pointerup', 101, 640);
      touch('pointerup', 102, 820);
      return { samples, pinchScale: camera.scale.x * devicePixelRatio };
    });
    assert.deepEqual(pixels.samples.map((sample) => sample.scale), [0.5, 1, 2, 3, 4, 4]);
    assert.ok(pixels.samples.every((sample) => sample.snapped && sample.error <= 1));
    assert.equal(pixels.pinchScale, 2);
    await pixelPage.close();
  }

  console.log(
    'Browser smoke passed: menu, assets, ticking, bridge redraw, production, orders, pause, minimap, camera and replay.',
  );
} finally {
  await browser?.close();
  server.kill();
}
