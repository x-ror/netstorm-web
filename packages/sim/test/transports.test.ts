import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  World,
  aiAlignment,
  aiMove,
  loadDefs,
  TPS,
  CRYSTAL_VALUE,
  type Crystal,
} from '../src/index.js';

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

test('in multiplayer no Priest is chained in the first 120 s; the carrier is sent again later', () => {
  const world = mk();
  world.multiplayer = true;
  const altar = world.spawnBuilding('altar', 1, 30, 20);
  const golem = world.spawnTransport('sunwalker', 1, altar.x - 1, altar.y);
  const red = world.addPriest(2, golem.x, golem.y);
  red.state = 'carried';
  red.carriedBy = golem.id;
  golem.carrying = red.id;
  const send = () =>
    world.apply({ t: 'capturePriest', player: 1, transport: golem.id, target: red.id });
  assert.equal(send(), null);
  run(world, 2);
  assert.deepEqual([golem.goal, golem.carrying, red.state], ['idle', red.id, 'carried']);
  assert.ok(world.drainEvents().some((e) => e.what === 'too early'));
  run(world, 120 * TPS);
  assert.equal(send(), null);
  run(world, 2);
  assert.equal(red.state, 'chained');
});

test('a unit goes up on an ally’s island that his ground joins to the player’s own', () => {
  const world = new World(defs, 1);
  world.addPlayer(1, 'Blue', 'wind', 9000, ['sunblocker'], [2]);
  world.addPlayer(2, 'Green', 'rain', 0, []);
  world.addIsland(10, 10, 30, 20, 1);
  world.spawnBuilding('windvortex', 1, 12, 12);
  world.spawnBuilding('windbattery', 1, 36, 14);
  world.spawnBuilding('sunfactory', 1, 14, 22).slots.push('sunblocker');
  world.addIsland(40, 10, 20, 20, 2);
  world.addIsland(42, 40, 10, 10, 2); // the ally's, joined to nothing of Blue's
  const order = (x: number, y: number) => world.canBuild({ player: 1, type: 'sunblocker', x, y });
  assert.equal(order(42, 15), null);
  assert.equal(order(44, 42), 'blocked');
});

test('a computer’s Temple gives one Energy, a player’s two; its Knowledge is one of 16 alignments', () => {
  const world = new World(defs, 1);
  world.addPlayer(1, 'Blue', 'wind', 9000, ['windarcher'], [], 0, 1, true);
  world.addIsland(10, 10, 30, 20, 1);
  world.spawnBuilding('windvortex', 1, 12, 12);
  world.spawnBuilding('windfactory', 1, 30, 22).slots.push('windarcher');
  // A Crossbow needs `ws`: two Energy, where the computer's Temple gives one.
  const order = { player: 1, type: 'windarcher', x: 22, y: 14 } as const;
  assert.equal(world.canBuild(order), 'no energy');
  world.players.get(1)!.ai = false;
  assert.equal(world.canBuild(order), null);

  assert.equal(aiAlignment(1).name, 'Summer');
  assert.ok(aiAlignment(1).tech.includes('windballoon'));
  assert.equal(aiAlignment(16).name, 'Sun');
  assert.equal(aiAlignment(150).name, 'Sun');
});

test('in multiplayer an idle computer Priest prays for the Devastation', () => {
  const world = mk();
  world.multiplayer = true;
  world.addPriest(1, 30, 30);
  const orders = aiMove(world, { player: 1, collect: false });
  assert.ok(orders.some((c) => c.t === 'pray' && c.spell === 'bombspecialone'));
  world.multiplayer = false;
  assert.ok(!aiMove(world, { player: 1, collect: false }).some((c) => c.t === 'pray'));
});
