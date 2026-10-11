import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadDefs, createSkirmish, World, TPS, PIECE_INTERVAL, CRYSTAL_INTERVAL, CRYSTAL_VALUE, Command } from '../src/index.js';

const defs = loadDefs(JSON.parse(readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8')));
const players = [
  { id: 1, name: 'Blue', theme: 'wind' as const, x: 40, y: 40 },
  { id: 2, name: 'Red', theme: 'rain' as const, x: 120, y: 40 },
];
const mk = (seed = 1) => createSkirmish(defs, seed, players, [[80, 40]]);

test('defs loaded with original numbers', () => {
  const c = defs.get('suncannon')!;
  assert.equal(c.cost, 400); assert.equal(c.hp, 600); assert.equal(c.range, 22); assert.equal(c.dps, 16);
  assert.equal(defs.get('thundercannon')!.dps, 40);
});

test('deterministic: same seed and commands give the same hash', () => {
  const run = () => { const w = mk(7); for (let i = 0; i < 400; i++) w.step(i === 100 ? [{ t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 }] : []); return w.hash(); };
  assert.equal(run(), run());
  const w2 = mk(8); for (let i = 0; i < 400; i++) w2.step(); assert.notEqual(run(), w2.hash());
});

test('temple hands out bridge pieces; pieces must touch own ground', () => {
  const w = mk(); for (let i = 0; i < PIECE_INTERVAL; i++) w.step();
  const p = w.players.get(1)!; assert.equal(p.hand.length, 1);
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 60, y: 60, rot: 0 }), 'not connected');
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y: 40, rot: 0 }), null); // right edge of island is x=50
  assert.equal(p.hand.length, 0);
  const cells = (w.events.at(-1)!.data as [number, number][]); assert.ok(cells.every(([x, y]) => w.terrain[y * 256 + x] === 2 && w.owner[y * 256 + x] === 1));
});

test('build: needs tech, storm power, energy and own ground', () => {
  const w = mk(); const p = w.players.get(1)!;
  assert.equal(w.apply({ t: 'build', player: 1, type: 'thundercannon', x: 32, y: 36 }), 'unknown tech');
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 90, y: 90 }), 'blocked');
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 }), null);
  assert.equal(p.storm, 2000 - 400);
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 }), 'blocked'); // occupied
});

test('transport collects a crystal and delivers storm power', () => {
  const w = mk(); const p = w.players.get(1)!; const t = [...w.entities.values()].find(e => e.kind === 'transport' && e.owner === 1)!;
  const g = [...w.entities.values()].find(e => e.kind === 'geyser')!;
  // bridge straight from the island edge (x=50) to the geyser islet (x=79)
  for (let x = 51; x < 79; x++) { w.terrain[40 * 256 + x] = 2; w.owner[40 * 256 + x] = 1; }
  for (let i = 0; i < CRYSTAL_INTERVAL; i++) w.step();
  assert.equal(w.apply({ t: 'collect', player: 1, transport: t.id, geyser: g.id }), null);
  for (let i = 0; i < 80 * TPS; i++) w.step();
  assert.equal(p.storm, 2000 + CRYSTAL_VALUE);
});

test('cannon destroys an enemy transport in its line of fire; blocker shields it', () => {
  const w = mk(); w.spawnBuilding('suncannon', 1, 48, 39, 1); // facing east, muzzle at x=51
  const victim = w.spawnTransport('sunwalker', 2, 60, 40);     // hp 50, in line (row 40 = centre of the 3×3 footprint)
  for (let i = 0; i < 4 * TPS; i++) w.step();                  // 16 dps → dead in ~3.2 s
  assert.ok(!w.entities.has(victim.id));
  const victim2 = w.spawnTransport('sunwalker', 2, 60, 40);
  w.terrain[40 * 256 + 55] = 1; w.owner[40 * 256 + 55] = 2; w.terrain[40 * 256 + 56] = 1; w.owner[40 * 256 + 56] = 2; w.terrain[40 * 256 + 57] = 1; w.owner[40 * 256 + 57] = 2;
  w.spawnBuilding('sunblocker', 2, 55, 39);
  for (let i = 0; i < 10 * TPS; i++) w.step();
  const v2 = w.entities.get(victim2.id); assert.ok(v2 && 'hp' in v2 && v2.hp === 50);
});

test('priest: shot to half HP goes down, enemy priest carries and sacrifices → victory', () => {
  const w = mk(); const red = w.priestOf(2)!; const blue = w.priestOf(1)!;
  red.hp = 40; w.step(); assert.equal(red.state, 'down');
  // teleport blue priest next to red for the test (movement is covered by the transport test)
  w.occupant[blue.y * 256 + blue.x] = 0; blue.x = red.x + 1; blue.y = red.y; w.occupant[blue.y * 256 + blue.x] = blue.id;
  assert.equal(w.apply({ t: 'pickupPriest', player: 1, target: red.id }), null);
  assert.equal(w.apply({ t: 'sacrifice', player: 1 }), 'not at altar');
  const altar = w.buildingsOf(1).find(b => b.type === 'altar')!;
  w.occupant[blue.y * 256 + blue.x] = 0; blue.x = altar.x - 1; blue.y = altar.y; w.occupant[blue.y * 256 + blue.x] = blue.id;
  assert.equal(w.apply({ t: 'sacrifice', player: 1 }), null);
  assert.equal(w.winner, 1);
});
