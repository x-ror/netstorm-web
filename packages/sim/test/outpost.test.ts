import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, loadDefs, TPS, Terrain, createSkirmish } from '../src/index.js';

const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8')),
);

function run(world: World, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    world.step();
  }
}

test('an Outpost takes a neutral island, takes crystals, and the most Outposts dominate', () => {
  const world = new World(defs, 1);
  world.addPlayer(1, 'Blue', 'wind', 5000, []);
  world.addPlayer(2, 'Red', 'rain', 0, []);
  world.addIsland(10, 10, 20, 20, 1);
  world.spawnBuilding('windvortex', 1, 12, 12);
  world.addIsland(40, 10, 30, 20, 0);

  for (let x = 30; x < 40; x++) {
    world.terrain[world.at(x, 20)] = Terrain.Bridge;
    world.owner[world.at(x, 20)] = 1;
  }

  world.addPriest(1, 28, 20);
  // Within the Temple's Energy, which an Outpost needs one of.
  const order = { t: 'build', player: 1, type: 'outpost', x: 42, y: 15 } as const;
  // "Outposts are only available in multiplayer games."
  assert.equal(world.apply(order), 'unknown tech');
  world.players.get(1)!.tech.add('outpost');
  assert.equal(world.apply(order), null);
  assert.equal(world.owner[world.at(60, 25)], 0);
  run(world, 30 * TPS);
  assert.equal(world.owner[world.at(60, 25)], 1);
  assert.equal(world.depotsOf(1).length, 2);

  // A crystal brought to the Outpost is handed in there.
  const golem = world.spawnTransport('sunwalker', 1, 47, 17);
  golem.goal = 'home';
  golem.carrying = world.spawnCrystal(golem, 200).id;
  const before = world.players.get(1)!.storm;
  run(world, 3 * TPS);
  assert.equal(world.players.get(1)!.storm, before + 200);

  // The enemy matches it: nobody dominates. When his is destroyed the island is Blue's again.
  const rival = world.spawnBuilding('outpost', 2, 60, 22);
  rival.rising = 1;
  world.step();
  assert.equal(world.owner[world.at(60, 15)], 0);
  rival.hp = 0;
  world.step();
  assert.equal(world.owner[world.at(60, 15)], 1);
});

test('a skirmish gives its sides the Outpost; nobody builds on an island warded by one', () => {
  const world = createSkirmish(defs, 7, [
    { id: 1, name: 'Blue', theme: 'wind', x: 40, y: 40 },
    { id: 2, name: 'Red', theme: 'rain', x: 120, y: 40 },
  ], []);
  assert.ok(world.players.get(1)!.tech.has('outpost'));
  world.players.get(1)!.storm = 5000;
  assert.equal(world.canBuild({ player: 1, type: 'outpost', x: 115, y: 42 }), 'blocked');
});
