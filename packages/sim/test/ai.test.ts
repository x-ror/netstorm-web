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

  for (let i = 0; i < LIMIT && match.view().winner === null; i++) {
    const commands = i % MOVE === 0 ? aiMove(match.view(), { player: 2 }) : [];

    for (const command of commands) {
      assert.deepEqual(parseCommand(JSON.parse(JSON.stringify(command))), command);
      seen.add(command.t);
    }

    match.step(commands);
    match.drainEvents();
  }

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
