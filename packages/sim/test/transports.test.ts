import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, loadDefs, TPS, CRYSTAL_VALUE, type Crystal } from '../src/index.js';

const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8')),
);

function mk() {
  const world = new World(defs, 1);
  world.addPlayer(1, 'Blue', 'wind', 0, []);
  world.addPlayer(2, 'Red', 'rain', 0, []);
  world.addIsland(10, 10, 60, 40, 1);
  world.spawnBuilding('windvortex', 1, 12, 12);
  return world;
}

function run(world: World, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    world.step();
  }
}

const crystalOf = (world: World, id: number | null) => world.entities.get(id!) as Crystal;

test('a Crab takes a captive Priest and stays; the robbed Golem stops; never its own Priest', () => {
  const world = mk();
  const golem = world.spawnTransport('sunwalker', 1, 40, 30);
  const red = world.addPriest(2, 41, 30);
  red.state = 'carried';
  red.carriedBy = golem.id;
  golem.carrying = red.id;
  golem.path = [[41, 30], [42, 30]];
  const crab = world.spawnTransport('rainwalker', 2, 40, 30);
  // The Crab's owner's own Priest it leaves where he is.
  run(world, 1);
  assert.equal(crab.carrying, null);
  assert.equal(golem.carrying, red.id);

  // A third side's Crab takes him from the Golem.
  world.addPlayer(3, 'Green', 'thunder', 0, []);
  const thief = world.spawnTransport('rainwalker', 3, golem.x, golem.y);
  run(world, 1);
  assert.equal(thief.carrying, red.id);
  assert.deepEqual([golem.carrying, golem.path, golem.goal], [null, [], 'idle']);
  assert.deepEqual([thief.path, thief.goal], [[], 'idle']);
});

test('a Bulf takes two crystals only from two crystals’ worth, tops one up, drops one at a time', () => {
  const world = mk();
  const g = world.addGeyser(30, 30, 300, false);
  const bulf = world.spawnTransport('bulf', 1, 31, 30);
  assert.equal(world.apply({ t: 'collect', player: 1, transport: bulf.id, geyser: g.id }), null);
  run(world, 1);
  assert.equal(crystalOf(world, bulf.carrying).value, CRYSTAL_VALUE);
  assert.equal(g.stock, 100);

  // Holding one, it may be sent for another: from the ground or from a geyser.
  const ground = world.spawnCrystal(bulf, CRYSTAL_VALUE);
  ground.carriedBy = null;
  [ground.x, ground.y] = [32, 31];
  bulf.path = [];
  assert.equal(
    world.apply({ t: 'pickupCrystal', player: 1, transport: bulf.id, crystal: ground.id }),
    null,
  );
  run(world, 1 * TPS);
  assert.equal(crystalOf(world, bulf.carrying).value, 2 * CRYSTAL_VALUE);
  assert.ok(!world.entities.has(ground.id));

  bulf.path = [];
  assert.equal(world.apply({ t: 'dropCargo', player: 1, transport: bulf.id }), null);
  assert.equal(crystalOf(world, bulf.carrying).value, CRYSTAL_VALUE);
  assert.equal([...world.entities.values()].filter((e) => e.kind === 'crystal').length, 2);
});

test('an Aerial Transport rises and sinks 4/speed s at each end of a trip, and casts nothing aloft', () => {
  const world = mk();
  const balloon = world.spawnTransport('sunballoon', 1, 40, 20);
  balloon.spell = 'bombheal';
  balloon.path = [[41, 20], [42, 20]];
  // Speed 2: two seconds up before it moves.
  run(world, 2 * TPS - 1);
  assert.equal(balloon.x, 40);
  assert.ok(balloon.aloft);
  assert.equal(world.apply({ t: 'castSpell', player: 1, transport: balloon.id }), 'not ready');
  run(world, 2 * TPS);
  assert.equal(balloon.x, 42);
  // Down again.
  assert.ok(!balloon.aloft);
  run(world, 2 * TPS);
  assert.equal(balloon.climbing, 0);
  world.players.get(1)!.storm = 1000;
  assert.equal(world.apply({ t: 'castSpell', player: 1, transport: balloon.id }), null);
});
