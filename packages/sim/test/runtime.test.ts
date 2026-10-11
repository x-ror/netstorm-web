import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FixedStepClock, World, loadDefs, createSkirmish } from '../src/index.js';

const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8')),
);
const mk = () =>
  createSkirmish(defs, 42, [
    { id: 1, name: 'Blue', theme: 'wind', x: 40, y: 40 },
    { id: 2, name: 'Red', theme: 'rain', x: 120, y: 40 },
  ], []);

test('clock preserves partial ticks, bounds catch-up and resets after suspension', () => {
  const clock = new FixedStepClock(10, 5);
  let ticks = 0;
  const step = () => {
    ticks++;
  };
  assert.equal(clock.advance(40, step), 0);
  assert.equal(clock.advance(60, step), 1);
  assert.equal(clock.advance(60_000, step), 5);
  assert.equal(clock.advance(0, step), 0);
  clock.advance(90, step);
  clock.reset();
  assert.equal(clock.advance(10, step), 0);
  assert.equal(clock.advance(NaN, step), 0);
  assert.equal(ticks, 6);
  assert.throws(() => new FixedStepClock(0));
});

test('equivalent frame timing gives the same simulation state', () => {
  const a = mk();
  const b = mk();
  const ca = new FixedStepClock(10);
  const cb = new FixedStepClock(10);

  for (let i = 0; i < 100; i++) {
    ca.advance(10, () => a.step());
  }

  for (let i = 0; i < 10; i++) {
    cb.advance(100, () => b.step());
  }

  assert.equal(a.hash(), b.hash());
});

test('hash detects future-affecting changes omitted by the original checksum', () => {
  const mutations: Array<(w: World) => void> = [
    (w) => {
      w.players.get(1)!.hand.push(0);
    },
    (w) => {
      w.players.get(1)!.pieceTimer--;
    },
    (w) => {
      w.players.get(1)!.alive = false;
    },
    (w) => {
      w.players.get(1)!.tech.delete('suncannon');
    },
    (w) => {
      w.priestOf(1)!.path = [[40, 47]];
    },
    (w) => {
      w.priestOf(1)!.move++;
    },
    (w) => {
      w.priestOf(1)!.hp -= 0.001;
    },
    (w) => {
      w.buildingsOf(1)[0]!.facing = 1;
    },
    (w) => {
      w.occupant[0] = 7;
    },
    (w) => {
      w.winner = 1;
    },
    (w) => {
      w.tick += 65536;
    },
  ];
  const original = mk().hash();

  for (const mutate of mutations) {
    const w = mk();
    mutate(w);
    assert.notEqual(w.hash(), original);
  }

  const a = mk();
  const b = mk();
  a.players.get(1)!.hand = [0];
  b.players.get(1)!.hand = [1];
  assert.notEqual(a.hash(), b.hash());
});

test('path searches reuse scratch state without leaking earlier searches', () => {
  const w = new World(defs, 1);
  w.addIsland(0, 0, 3, 3, 1);
  assert.deepEqual(w.findPath(1, 0, 0, ([x, y]) => x === 2 && y === 0), [
    [1, 0],
    [2, 0],
  ]);
  assert.equal(w.findPath(1, 0, 0, ([x]) => x === 4), null);
  assert.deepEqual(w.findPath(1, 2, 0, ([x, y]) => x === 0 && y === 0), [
    [1, 0],
    [0, 0],
  ]);
  assert.equal(w.findPath(1, -1, 0, () => true), null);
});

test('terrain revisions and event draining do not alter authoritative state', () => {
  const w = mk();
  const hash = w.hash();
  const revision = w.terrainRevision;
  w.invalidateTerrain();
  assert.equal(w.terrainRevision, revision + 1);
  w.apply({ t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 });
  assert.ok(w.drainEvents().length);
  const afterBuild = w.hash();
  assert.deepEqual(w.drainEvents(), []);
  assert.equal(w.hash(), afterBuild);
  assert.notEqual(hash, afterBuild);
});

test('fractional coordinates and invalid directions reject without changing state', () => {
  const w = mk();
  const hash = w.hash();
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 32.5, y: 36 }),
    'bad coordinates');
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 32, y: 36, facing: 4 as 0 }),
    'bad facing');
  assert.equal(w.hash(), hash);
});

test('a blocked return path cannot credit a crystal away from the temple', () => {
  const w = mk();
  const t = w.spawnTransport('sunwalker', 1, 49, 40);
  t.carrying = 999;
  t.goal = 'home';
  t.path = [[50, 40]];
  w.spawnBuilding('sunblocker', 1, 50, 40);
  const storm = w.players.get(1)!.storm;

  for (let i = 0; i < 20; i++) {
    w.step();
  }

  assert.equal(w.players.get(1)!.storm, storm);
  assert.equal(t.carrying, 999);
});

test('definition loading validates numbers and preserves original duplicate overrides', () => {
  assert.throws(() => loadDefs({}), /array/);
  assert.throws(() => loadDefs([{}]), /id/);
  assert.equal(loadDefs([
    { id: 'A', cost: 1 },
    { id: 'a', cost: 2 },
  ]).get('a')!.cost, 2);
  assert.throws(() => loadDefs([{ id: 'a', speed: NaN }]), /finite/);
  assert.throws(() => loadDefs([{ id: 'a', cost: -1 }]), /non-negative/);
});
