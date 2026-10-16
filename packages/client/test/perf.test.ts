import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerformanceMonitor } from '../src/perf.js';
import { World } from '@netstorm/sim';

test('performance monitor records metrics without changing world state', () => {
  const world = new World(new Map(), 1);
  const reference = new World(new Map(), 1);
  world.addPlayer(1, 'Blue', 'wind', 0, []);
  reference.addPlayer(1, 'Blue', 'wind', 0, []);
  world.addIsland(0, 0, 4, 4, 1);
  reference.addIsland(0, 0, 4, 4, 1);
  const gl = { drawArrays() {} };
  const renderer = {
    gl,
    render() {
      gl.drawArrays();
    },
  };
  const render = renderer.render;
  const drawArrays = gl.drawArrays;
  const monitor = new PerformanceMonitor(world, renderer);

  monitor.frame();
  monitor.measure('simulationTick', () => world.step());
  monitor.measure('terrainBuild', () => undefined);
  monitor.measure('entitySync', () => undefined);
  monitor.recordSceneCounts(12, 24);
  world.findPath(1, 0, 0, ([x, y]) => x === 3 && y === 3);
  renderer.render();
  reference.step();

  const metrics = monitor.snapshot();
  monitor.dispose();

  assert.equal(world.hash(), reference.hash());
  assert.equal(Object.hasOwn(world, 'findPath'), false);
  assert.equal(Object.hasOwn(world, 'tickBuilding'), false);
  assert.equal(renderer.render, render);
  assert.equal(gl.drawArrays, drawArrays);
  assert.equal(metrics.frameMs.samples, 1);
  assert.equal(metrics.simulationTickMs.samples, 1);
  assert.equal(metrics.systemsMs.pathfinding.samples, 1);
  assert.equal(metrics.terrainBuildMs.samples, 1);
  assert.equal(metrics.entitySyncMs.samples, 1);
  assert.deepEqual(metrics.scene, { terrainTiles: 12, displayObjects: 24 });
  assert.equal(metrics.renderMs.samples, 1);
  assert.equal(metrics.drawCalls.average, 1);
  assert.equal(metrics.entities.total, 0);
  assert.equal(metrics.projectiles, 0);
});
