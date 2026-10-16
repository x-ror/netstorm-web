import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  aiMove,
  aiReact,
  aiStrategicDue,
  createAiMemory,
  createSkirmish,
  loadDefs,
  type Command,
  type Theme,
} from '../packages/sim/src/index.js';

const SEED = 0x5eed;
const WARMUP_TICKS = 60;
const SAMPLE_TICKS = 600;
const THEMES: Theme[] = ['wind', 'rain', 'thunder'];
const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../data/units.json', import.meta.url), 'utf8')),
);

function makeWorld() {
  const players = [];

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const id = row * 4 + col + 1;
      players.push({
        id,
        name: `AI ${id}`,
        theme: THEMES[(id - 1) % THEMES.length]!,
        x: 32 + col * 64,
        y: 32 + row * 80,
      });
    }
  }

  const geysers: [number, number][] = [];

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      geysers.push([64 + col * 64, 32 + row * 80]);
    }
  }

  geysers.push([32, 72], [96, 152], [224, 72]);
  return createSkirmish(defs, SEED, players, geysers);
}

const world = makeWorld();
const memories = new Map(
  [...world.players.keys()].map((player) => [player, createAiMemory(SEED + player)]),
);
const pending: number[] = [];
const queued = new Set<number>();
const originalFindPath = world.findPath.bind(world);
let pathRequests = 0;
let pathTimeTotal = 0;
const pathTimes: number[] = [];
world.findPath = (...args) => {
  pathRequests++;
  const start = performance.now();

  try {
    return originalFindPath(...args);
  } finally {
    const elapsed = performance.now() - start;
    pathTimes.push(elapsed);
    pathTimeTotal += elapsed;
  }
};

function commandsForTick(): Command[] {
  const view = world.view();

  for (const player of world.players.keys()) {
    const memory = memories.get(player)!;
    const interval = 30;
    const reactive = aiReact(view, player, memory, interval);

    if ((aiStrategicDue(world.tick, player, interval) || reactive) && !queued.has(player)) {
      pending.push(player);
      queued.add(player);
    }
  }

  const player = pending.shift();

  if (player === undefined) {
    return [];
  }

  queued.delete(player);
  return aiMove(view, { player, difficulty: 'hard' }, memories.get(player)!);
}

for (let index = 0; index < WARMUP_TICKS; index++) {
  world.step(commandsForTick());
}

const requestsPerTick: number[] = [];
const pathTimePerTick: number[] = [];

for (let index = 0; index < SAMPLE_TICKS; index++) {
  const before = pathRequests;
  const timeBefore = pathTimeTotal;
  world.step(commandsForTick());
  requestsPerTick.push(pathRequests - before);
  pathTimePerTick.push(pathTimeTotal - timeBefore);
}

const sorted = [...requestsPerTick].sort((a, b) => a - b);
const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1]!;
const sortedTickTimes = [...pathTimePerTick].sort((a, b) => a - b);
const tickPercentile = (p: number) => sortedTickTimes[Math.ceil(sortedTickTimes.length * p) - 1]!;
const sortedPathTimes = [...pathTimes].sort((a, b) => a - b);
const pathPercentile = (p: number) =>
  sortedPathTimes[Math.ceil(sortedPathTimes.length * p) - 1] ?? 0;
console.log(JSON.stringify({
  scenario: {
    seed: SEED,
    map: '256x256',
    players: world.players.size,
    geysers: [...world.entities.values()].filter((entity) => entity.kind === 'geyser').length,
    warmupTicks: WARMUP_TICKS,
    measuredTicks: SAMPLE_TICKS,
    finalTick: world.tick,
    hash: world.hash(),
  },
  pathRequestsPerTick: {
    average: requestsPerTick.reduce((sum, count) => sum + count, 0) / requestsPerTick.length,
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1),
    total: requestsPerTick.reduce((sum, count) => sum + count, 0),
  },
  pathTimePerTickMs: {
    average: pathTimePerTick.reduce((sum, elapsed) => sum + elapsed, 0) / pathTimePerTick.length,
    p95: tickPercentile(0.95),
    p99: tickPercentile(0.99),
    max: sortedTickTimes.at(-1),
  },
  pathSearchMs: {
    average: pathTimes.reduce((sum, elapsed) => sum + elapsed, 0) / pathTimes.length,
    p95: pathPercentile(0.95),
    p99: pathPercentile(0.99),
    max: sortedPathTimes.at(-1) ?? 0,
  },
}, null, 2));
