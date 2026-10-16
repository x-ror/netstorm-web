import assert from 'node:assert/strict';
import { test } from 'node:test';
import { World } from '@netstorm/sim';
import { PerformanceMonitor } from '../src/perf.js';

test('the performance monitor times the world and the renderer without changing either', () => {
  const world = new World(new Map(), 1);
  const reference = new World(new Map(), 1);

  for (const w of [world, reference]) {
    w.addPlayer(1, 'Blue', 'wind', 0, []);
    w.addIsland(0, 0, 4, 4, 1);
  }

  const gl = { drawArrays() {} };
  const renderer = {
    gl,
    render() {
      gl.drawArrays();
    },
  };
  const { render } = renderer;
  const { drawArrays } = gl;
  const monitor = new PerformanceMonitor(world, renderer);

  monitor.frame();
  monitor.measure('simulationTick', () => world.step());
  world.findPath(1, 0, 0, ([x, y]) => x === 3 && y === 3);
  renderer.render();
  reference.step();

  const { ms, entities } = monitor.snapshot();
  monitor.dispose();

  assert.equal(world.hash(), reference.hash());
  assert.equal(Object.hasOwn(world, 'findPath'), false);
  assert.equal(renderer.render, render);
  assert.equal(gl.drawArrays, drawArrays);
  assert.equal(ms.frame.samples, 1);
  assert.equal(ms.simulationTick.samples, 1);
  assert.equal(ms.pathfinding.samples, 1);
  assert.equal(ms.render.samples, 1);
  assert.equal(ms.drawCalls.average, 1);
  assert.equal(entities.total, 0);
});
