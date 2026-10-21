import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  World,
  createMission,
  generateMap,
  loadDefs,
  TPS,
  Terrain,
  type Geyser,
} from '../src/index.js';

const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8')),
);
const sides = [{ id: 1, theme: 'wind' }, { id: 2, theme: 'rain' }] as const;

function battle(geysers = {}) {
  const map = generateMap(42, { islands: 4, sides });
  return createMission(defs, 42, map, (id) => ({
    name: String(id),
    theme: id === 1 ? 'wind' : 'rain',
    storm: 5000,
  }), { geysers });
}

const geysersOf = (world: World) =>
  [...world.entities.values()].filter((e): e is Geyser => e.kind === 'geyser');

function run(world: World, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    world.step();
  }
}

test('a battle starts with geysers by each home and over the map, and keeps more in the pool', () => {
  const world = battle();
  const geysers = geysersOf(world);
  // 3 by each home; of N = 4 × (6 + 2) − 8 = 24, about 18 more, the rest kept for the battle.
  assert.ok(geysers.length >= 3 * 2 + 12, `${geysers.length}`);
  assert.equal(world.geysers.made, geysers.length);
  assert.ok(world.geysers.pool.reduce((sum, p) => sum + p, 0) >= 12 * world.geyserStock);

  // Each stands in the middle of three by three cells all sky (its islet now) or all island.
  for (const g of geysers) {
    assert.equal(world.terrain[world.at(g.x, g.y)], Terrain.Island);
    assert.equal(g.stock, world.geyserStock);
  }

  // The same seed makes the same battle.
  assert.deepEqual(geysersOf(battle()).map((g) => [g.x, g.y]), geysers.map((g) => [g.x, g.y]));
});

test('Balanced: a pair of geysers comes up every Geyser Interval while the pool holds two', () => {
  const world = battle({ interval: 30 });
  const before = geysersOf(world).length;
  run(world, 1);
  const first = geysersOf(world).length;
  assert.ok(first >= before + 2, `${before} → ${first}`);
  run(world, 30 * TPS - 1);
  assert.equal(geysersOf(world).length, first);
  run(world, 1);
  assert.ok(geysersOf(world).length > first);
});

test('what the killer is not paid, and what Salvage does not return, goes to the pool', () => {
  const world = battle({ placement: 'traditional', respawn: 0.9, start: 0 });
  assert.equal(world.geysers.loose, 0);
  const temple = world.templeOf(2)!;
  const golem = world.spawnTransport('sunwalker', 1, temple.x - 3, temple.y);
  const cost = world.def('sunwalker').cost;
  assert.equal(world.apply({ t: 'salvage', player: 1, target: golem.id }), null);
  // Undamaged, Salvage returns a quarter: three quarters times 0.9 go to the pool.
  assert.equal(world.geysers.loose, Math.trunc(Math.fround(0.9) * (cost - cost / 4)));
});

test('the campaign makes a geyser every 30 s once the pool holds a geyser’s worth', () => {
  const world = new World(defs, 1);
  world.addPlayer(1, 'Blue', 'wind', 0, []);
  world.addIsland(100, 100, 20, 20, 1);
  world.geysers.loose = world.geyserStock + 1;
  run(world, 1);
  assert.equal(geysersOf(world).length, 1);
  assert.equal(world.geysers.loose, 1);
  world.geysers.loose = world.geyserStock + 1;
  run(world, 30 * TPS - 1);
  assert.equal(geysersOf(world).length, 1);
  run(world, 1);
  assert.equal(geysersOf(world).length, 2);
});
