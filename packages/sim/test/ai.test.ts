import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aiMove,
  createSkirmish,
  loadDefs,
  parseCommand,
  playReplay,
  ReplayRecorder,
  TPS,
} from '../src/index.js';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../data/${name}.json`, import.meta.url), 'utf8'));
const defs = loadDefs(read('units'));
const forts = read('forts') as Record<string, { geysers: [number, number][]; }>;
// The geysers of The War Begins! that do not fall on the two rectangular home islands.
const geysers = forts.thewarbegins!.geysers.filter(([x, y]) =>
  [[70, 150], [150, 90]].every(([hx, hy]) => Math.abs(x - hx!) > 13 || Math.abs(y - hy!) > 11)
);
const MOVE = 6 * TPS;
const LIMIT = 30 * 60 * TPS;

const mk = () =>
  createSkirmish(defs, 42, [
    { id: 1, name: 'Idle', theme: 'wind', x: 70, y: 150 },
    { id: 2, name: 'AI', theme: 'rain', x: 150, y: 90 },
  ], geysers);

test('the AI wins against an idle player, and its recorded commands replay exactly', () => {
  const match = new ReplayRecorder(mk());
  const seen = new Set<string>();
  const refused: unknown[] = [];

  for (let i = 0; i < LIMIT && match.view().winner === null; i++) {
    const commands = i % MOVE === 0 ? aiMove(match.view(), { player: 2 }) : [];

    for (const command of commands) {
      assert.deepEqual(parseCommand(JSON.parse(JSON.stringify(command))), command);
      seen.add(command.t);
    }

    // A move never spends more Storm Power than the AI has.
    const cost = commands.reduce(
      (sum, command) => sum + (command.t === 'build' ? defs.get(command.type)!.cost : 0),
      0,
    );
    assert.ok(cost <= match.view().players.get(2)!.storm);
    match.step(commands);

    for (const event of match.drainEvents()) {
      if (event.what === 'rejected' && event.who === 2) {
        refused.push(event.data);
      }
    }
  }

  // Each command of a move holds against the others: none is refused.
  assert.deepEqual(refused, []);

  const world = match.view();
  assert.equal(world.winner, 2);
  assert.equal(world.players.get(1)!.alive, false);
  // It collected, bridged, built, captured and warded the runes on its own.
  assert.deepEqual([...seen].sort(), [
    'build',
    'capturePriest',
    'collect',
    'dropPiece',
    'movePriest',
  ]);
  const replayed = playReplay(JSON.parse(JSON.stringify(match.export())));
  assert.equal(replayed.tick, world.tick);
  assert.equal(replayed.winner, 2);
});

test('the AI has nothing to do for a missing or beaten player', () => {
  const world = mk();
  assert.deepEqual(aiMove(world.view(), { player: 5 }), []);
  world.players.get(2)!.alive = false;
  assert.deepEqual(aiMove(world.view(), { player: 2 }), []);
});

test('an AI move reads the world without changing it', () => {
  const world = mk();

  for (let i = 0; i < 2 * MOVE; i++) {
    world.step();
  }

  const hash = world.hash();
  const first = aiMove(world.view(), { player: 2 });
  assert.equal(world.hash(), hash);
  assert.deepEqual(aiMove(world.view(), { player: 2 }), first);
  assert.ok(first.length > 0);
});

test('one transport goes for a downed priest, and the others keep working', () => {
  const world = mk();
  world.spawnTransport('rainwalker', 2, 151, 97);
  const priest = world.priestOf(1)!;
  priest.state = 'down';
  priest.hp = 1; // stays down while the transports walk over
  // A strip of the AI's ground from under its home island to the idle player's, past the Workshop.
  world.addIsland(70, 99, 85, 1, 2);
  world.addIsland(70, 99, 5, 45, 2);
  world.invalidateTerrain();
  const sent = () =>
    aiMove(world.view(), { player: 2 }).filter((command) => command.t === 'capturePriest');
  assert.equal(sent().length, 1);
  world.step(sent());
  assert.ok(world.drainEvents().every((event) => event.what !== 'rejected'));
  assert.deepEqual(sent(), []);
});

test('a beaten player is no target', () => {
  const world = mk();
  const ai = world.players.get(2)!;
  ai.storm = 100_000; // rich enough to attack at once
  world.players.get(1)!.alive = false;
  world.entities.delete(world.priestOf(1)!.id);

  for (let i = 0; i < 2 * MOVE; i++) {
    world.step();
  }

  // With no free geyser worth taking and no live enemy, no bridge heads for the beaten Temple.
  for (const geyser of world.entities.values()) {
    if (geyser.kind === 'geyser') {
      world.entities.delete(geyser.id);
    }
  }

  assert.deepEqual(
    aiMove(world.view(), { player: 2 }).filter((command) => command.t === 'dropPiece'),
    [],
  );
});
