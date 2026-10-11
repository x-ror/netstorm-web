import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { World, createSkirmish, loadDefs, type DefTable } from '../packages/sim/src/index.js';
import { ScanWorld } from '../packages/sim/test/reference-world.js';

const defs = loadDefs(JSON.parse(readFileSync(new URL('../data/units.json', import.meta.url), 'utf8')));
// Large HP keeps each sample's entity count constant during sustained combat.
const durable: DefTable = new Map([...defs].map(([id, def]) => [id, { ...def, hp: 1_000_000 }]));
const samples = 120, warmup = 20;

function fixture(scan: boolean, combat: boolean): World {
  const world = scan ? new ScanWorld(durable) : new World(durable, 42);
  world.addIsland(0, 0, 256, 256, 0);
  for (let i = 0; i < 24; i++) {
    const x = 20 + (i % 8) * 26, y = 20 + Math.floor(i / 8) * 36;
    world.spawnBuilding(i % 2 ? 'sunarcher' : 'suncannon', 1, x, y, 1);
    if (combat) world.spawnTransport('sunwalker', 2, x + 6, y + 1);
  }
  for (let i = 0; i < 512; i++) {
    const x = 10 + i % 220, y = 160 + Math.floor(i / 220) * 3;
    const transport = world.spawnTransport('sunwalker', 2, x, y);
    transport.path = [[x, y + 1], [x + 1, y + 1], [x + 1, y]];
  }
  return world;
}

function measure(world: World) {
  for (let i = 0; i < warmup; i++) { world.step(); world.drainEvents(); }
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    world.step();
    times.push(performance.now() - start);
    world.drainEvents();
  }
  times.sort((a, b) => a - b);
  return { p50: times[Math.floor(samples * 0.5)]!, p95: times[Math.floor(samples * 0.95)]! };
}

const results = [];
for (const combat of [true, false]) {
  const scan = fixture(true, combat), indexed = fixture(false, combat);
  const before = measure(scan), after = measure(indexed);
  assert.equal(indexed.hash(), scan.hash(), 'Benchmark changed simulation results');
  results.push({
    scenario: combat ? '24 towers, 536 transports, targets in range' : '24 towers, 512 transports, targets out of range',
    'scan p50 ms': before.p50.toFixed(3), 'indexed p50 ms': after.p50.toFixed(3),
    'scan p95 ms': before.p95.toFixed(3), 'indexed p95 ms': after.p95.toFixed(3),
    'p50 speedup': `${(before.p50 / after.p50).toFixed(1)}x`,
  });
}
const small = createSkirmish(defs, 42, [
  { id: 1, name: 'Blue', theme: 'wind', x: 40, y: 40 },
  { id: 2, name: 'Red', theme: 'rain', x: 120, y: 40 },
], [[80, 40]]);
const smallResult = measure(small);
console.table(results);
console.log(`Default skirmish: p50 ${smallResult.p50.toFixed(3)} ms, p95 ${smallResult.p95.toFixed(3)} ms per tick.`);
console.log(`Node ${process.version}, ${warmup} warmup ticks + ${samples} measured ticks per fixture. Synthetic CPU measurements, excludes rendering and hashing.`);
