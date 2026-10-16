import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  aiReact,
  aiMove,
  aiStrategicDue,
  createAiMemory,
  loadDefs,
  skirmishTech,
  W,
  H,
  Terrain,
  World,
  type Command,
} from '../packages/sim/src/index.js';
import { PerformanceMonitor } from '../packages/client/src/perf.js';

const SEED = 0x5eed;
const PLAYERS = 12;
const BUILDINGS_PER_PLAYER = 20;
const TRANSPORTS_PER_PLAYER = 48;
const WARMUP_TICKS = 30;
const SAMPLE_TICKS = 120;
const THEMES = ['wind', 'rain', 'thunder'] as const;
const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../data/units.json', import.meta.url), 'utf8')),
);
const durable = new Map([...defs].map(([id, def]) => [id, { ...def, hp: 1_000_000 }]));

function stressWorld(): World {
  const world = new World(durable, SEED);

  for (let id = 1; id <= PLAYERS; id++) {
    const theme = THEMES[(id - 1) % THEMES.length]!;
    const col = (id - 1) % 4;
    const row = Math.floor((id - 1) / 4);
    const x = 8 + col * 62;
    const y = 8 + row * 80;
    world.addPlayer(id, `AI ${id}`, theme, 100_000, skirmishTech(durable, theme));
    world.addIsland(x, y, 48, 58, id);
    world.spawnBuilding(`${theme}vortex`, id, x + 18, y + 20);
    world.spawnBuilding(`${theme}factory`, id, x + 4, y + 4);
    world.spawnBuilding('altar', id, x + 33, y + 4);
    world.addPriest(id, x + 22, y + 32);

    for (let index = 0; index < BUILDINGS_PER_PLAYER; index++) {
      const bx = x + 4 + (index % 4) * 10;
      const by = y + 10 + Math.floor(index / 4) * 8;
      world.spawnBuilding(index % 2 ? 'sunarcher' : 'suncannon', id, bx, by);
    }

    for (let index = 0; index < TRANSPORTS_PER_PLAYER; index++) {
      const tx = x + 2 + (index % 12) * 3;
      const ty = y + 38 + Math.floor(index / 12) * 3;
      const transport = world.spawnTransport('sunwalker', id, tx, ty);
      transport.path = [[tx + 1, ty], [tx + 2, ty]];
    }
  }

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const owner = row * 4 + col + 1;
      const x = 8 + col * 62 + 48;
      const y = 8 + row * 80 + 24;

      for (const offset of [-3, 0, 3]) {
        for (let bridgeX = x; bridgeX < x + 14; bridgeX++) {
          const cell = world.at(bridgeX, y + offset);
          world.terrain[cell] = Terrain.Bridge;
          world.owner[cell] = owner;
        }
      }
    }
  }

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const owner = row * 4 + col + 1;
      const x = 8 + col * 62 + 24;
      const y = 8 + row * 80 + 58;

      for (const offset of [-3, 0, 3]) {
        for (let bridgeY = y; bridgeY < y + 22; bridgeY++) {
          const cell = world.at(x + offset, bridgeY);
          world.terrain[cell] = Terrain.Bridge;
          world.owner[cell] = owner;
        }
      }
    }
  }

  for (let index = 0; index < 16; index++) {
    world.addGeyser(24 + (index % 4) * 68, 35 + Math.floor(index / 4) * 56);
  }

  const targets = [...world.entities.values()].filter((entity) => entity.kind === 'transport');
  const guns = [...world.entities.values()].filter((entity) =>
    entity.kind === 'building' && (entity.type === 'sunarcher' || entity.type === 'suncannon')
  );

  for (const gun of guns.slice(0, 120)) {
    const target = targets.find((entity) =>
      entity.kind === 'transport' && entity.owner !== gun.owner
    )!;
    world.shots.push({
      gun,
      target: target.id,
      x: target.x,
      y: target.y,
      amount: 1,
      land: 100_000,
    });
  }

  return world;
}

const world = stressWorld();
const memories = new Map(
  [...world.players.keys()].map((player) => [player, createAiMemory(SEED + player)]),
);
const pendingAi: number[] = [];
const queuedAi = new Set<number>();

function aiCommands(
  measure: (player: number, run: () => Command[]) => Command[] = (_player, run) => run(),
): Command[] {
  const view = world.view();

  for (const player of world.players.keys()) {
    const memory = memories.get(player)!;
    const interval = 30;
    const reactive = aiReact(view, player, memory, interval);

    if ((aiStrategicDue(world.tick, player, interval) || reactive) && !queuedAi.has(player)) {
      pendingAi.push(player);
      queuedAi.add(player);
    }
  }

  const player = pendingAi.shift();

  if (player === undefined) {
    return [];
  }

  queuedAi.delete(player);
  return measure(player, () => aiMove(view, { player, difficulty: 'hard' }, memories.get(player)!));
}

for (let index = 0; index < WARMUP_TICKS; index++) {
  world.step(aiCommands());
}

const monitor = new PerformanceMonitor(world);
const times: number[] = [];
const aiCalls: {
  tick: number;
  player: number;
  elapsedMs: number;
  decisions: Record<string, number>;
}[] = [];

for (let index = 0; index < SAMPLE_TICKS; index++) {
  const start = performance.now();
  const commands = aiCommands((player, runAi) => {
    const aiStart = performance.now();
    const playerCommands = monitor.measure('ai', runAi);
    const decisions: Record<string, number> = {};

    for (const command of playerCommands) {
      decisions[command.t] = (decisions[command.t] ?? 0) + 1;
    }

    aiCalls.push({
      tick: world.tick + 1,
      player,
      elapsedMs: performance.now() - aiStart,
      decisions,
    });
    return playerCommands;
  });
  world.step(commands);
  times.push(performance.now() - start);

  for (const player of world.players.keys()) {
    const col = (player - 1) % 4;
    const row = Math.floor((player - 1) / 4);
    const x = 8 + col * 62;
    const y = 8 + row * 80;
    monitor.measure('pathfinding', () =>
      world.findPath(player, x + 2, y + 2, ([goalX, goalY]) =>
        goalX === W - 8 && goalY === H - 8));
  }

  if ((index + 1) % 10 === 0) {
    monitor.heapSample(process.memoryUsage().heapUsed);
  }
}

const sorted = [...times].sort((a, b) => a - b);
const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1]!;
const report = monitor.snapshot();
monitor.dispose();

console.log(JSON.stringify({
  scenario: {
    seed: SEED,
    map: `${W}x${H}`,
    players: PLAYERS,
    seededBuildingsPerPlayer: BUILDINGS_PER_PLAYER + 3,
    transportsPerPlayer: TRANSPORTS_PER_PLAYER,
    geysers: 16,
    bridgeCells: world.terrain.filter((terrain) => terrain === Terrain.Bridge).length,
    warmupTicks: WARMUP_TICKS,
    measuredTicks: SAMPLE_TICKS,
    finalTick: world.tick,
    entities: report.entities,
    projectiles: report.projectiles,
    hash: world.hash(),
    slowAiCalls: aiCalls
      .toSorted((a, b) => b.elapsedMs - a.elapsedMs)
      .slice(0, 10),
  },
  simulationTickMs: {
    average: times.reduce((sum, value) => sum + value, 0) / times.length,
    p95: percentile(0.95),
    p99: percentile(0.99),
  },
  systemMs: report.systemsMs,
  heapSamples: report.heap,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
}, null, 2));
