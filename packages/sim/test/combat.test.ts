import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, loadDefs } from '../src/index.js';

import { ScanWorld } from './reference-world.js';

const defs = loadDefs(JSON.parse(readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8')));
const mk = () => new World(defs, 42);

test('stacked transports keep entity order after an earlier transport moves into their cell', () => {
  const world = mk();
  world.addIsland(0, 0, 100, 100, 2);
  const first = world.spawnTransport('sunwalker', 2, 59, 40);
  const second = world.spawnTransport('sunwalker', 2, 60, 40);
  first.path = [[60, 40]]; first.move = 100;
  world.spawnBuilding('suncannon', 1, 48, 39, 1);
  world.step();
  assert.equal(first.x, 60);
  assert.ok(first.hp < first.hpMax);
  assert.equal(second.hp, second.hpMax);
});

test('a transport moves out of the firing line before a later cannon updates', () => {
  const world = mk();
  world.addIsland(0, 0, 100, 100, 2);
  const target = world.spawnTransport('sunwalker', 2, 60, 40);
  target.path = [[60, 41]]; target.move = 100;
  world.spawnBuilding('suncannon', 1, 48, 39, 1);
  world.step();
  assert.equal(target.hp, target.hpMax);
});

test('dead transports cannot hide the next target in the same tick', () => {
  const world = mk();
  world.spawnBuilding('suncannon', 1, 48, 39, 1);
  world.spawnBuilding('suncannon', 1, 59, 28, 2);
  const first = world.spawnTransport('sunwalker', 2, 60, 40);
  const second = world.spawnTransport('sunwalker', 2, 60, 40);
  first.hp = 0.1;
  world.step();
  assert.ok(!world.entities.has(first.id));
  assert.ok(second.hp < second.hpMax);
});

test('tick rebuild includes externally moved, removed and newly spawned transports', () => {
  const world = mk();
  world.spawnBuilding('suncannon', 1, 48, 39, 1);
  const target = world.spawnTransport('sunwalker', 2, 60, 41);
  world.step();
  target.y = 40;
  world.step();
  assert.ok(target.hp < target.hpMax);
  world.entities.delete(target.id);
  const replacement = world.spawnTransport('sunwalker', 2, 60, 40);
  world.step();
  assert.ok(replacement.hp < replacement.hpMax);
});

test('indexed combat matches full scans through moving, stacked, blocked and destroyed targets', () => {
  const indexed = mk(), scanned = new ScanWorld(defs);
  for (const world of [indexed, scanned]) {
    world.addIsland(0, 0, 256, 256, 2);
    for (let row = 0; row < 8; row++) {
      world.spawnBuilding(row % 2 ? 'sunarcher' : 'suncannon', 1, 30, 20 + row * 10, 1);
      for (let i = 0; i < 10; i++) {
        const transport = world.spawnTransport('sunwalker', i % 3 === 0 ? 1 : 2, 35 + i, 21 + row * 10);
        transport.path = [[transport.x, transport.y + 1], [transport.x + 1, transport.y + 1], [transport.x + 1, transport.y]];
      }
      if (row % 3 === 0) world.spawnBuilding('sunblocker', 2, 38, 19 + row * 10);
    }
  }
  for (let tick = 0; tick < 120; tick++) {
    indexed.step(); scanned.step();
    assert.equal(indexed.hash(), scanned.hash(), `state diverged at tick ${tick}`);
    assert.deepEqual(indexed.drainEvents(), scanned.drainEvents());
  }
});

test('radius targeting keeps row-major tie breaking near a map edge', () => {
  const world = mk();
  world.spawnBuilding('sunarcher', 1, 0, 0);
  // Both targets are four cells from the building centre; the east cell's row is first.
  const south = world.spawnTransport('sunwalker', 2, 1, 5);
  const east = world.spawnTransport('sunwalker', 2, 5, 1);
  world.step();
  assert.ok(east.hp < east.hpMax);
  assert.equal(south.hp, south.hpMax);
});

test('an enemy occupant has priority over stacked transports', () => {
  const world = mk();
  world.spawnBuilding('suncannon', 1, 48, 39, 1);
  const blocker = world.spawnBuilding('sunblocker', 2, 60, 39);
  const transport = world.spawnTransport('sunwalker', 2, 60, 40);
  world.step();
  assert.ok(blocker.hp < blocker.hpMax);
  assert.equal(transport.hp, transport.hpMax);
});
