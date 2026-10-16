/**
 * A late game on the whole map, headless: twelve computer sides, their islands joined by bridges,
 * guns with enemies in range, and every side moving at the hardest level. Prints the cost of a tick
 * and of each system as JSON; the world hash at the end shows the run is the same every time.
 *
 *   npm run perf:stress
 *   node --cpu-prof --import tsx scripts/perf-stress.ts   # then open the .cpuprofile in DevTools
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  aiMove,
  createAiMemory,
  DIFFICULTY,
  loadDefs,
  skirmishTech,
  Terrain,
  TPS,
  World,
  type Command,
} from '../packages/sim/src/index.js';
import { PerformanceMonitor } from '../packages/client/src/perf.js';

const SEED = 0x5eed;
const PLAYERS = 12;
const COLUMNS = 4;
const ISLAND = { w: 48, h: 58, dx: 62, dy: 80, x0: 8, y0: 8 };
const GUNS_PER_PLAYER = 20;
const WALKERS_PER_PLAYER = 48;
/** Enemy walkers put down next to the guns, so that there is a battle from the first tick. */
const INTRUDERS_PER_PLAYER = 8;
const WARMUP_TICKS = 30;
const SAMPLE_TICKS = 150;
const SLOW_CALLS = 10;
const THEMES = ['wind', 'rain', 'thunder'] as const;

const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../data/units.json', import.meta.url), 'utf8')),
);

/** The Fury's own walker, or the Sun's where its .type file is missing. */
function walker(theme: string): string {
  return defs.has(`${theme}walker`) ? `${theme}walker` : 'sunwalker';
}

function corner(player: number): [number, number] {
  const col = (player - 1) % COLUMNS;
  const row = Math.floor((player - 1) / COLUMNS);
  return [ISLAND.x0 + col * ISLAND.dx, ISLAND.y0 + row * ISLAND.dy];
}

function stressWorld(): World {
  const world = new World(defs, SEED);

  for (let id = 1; id <= PLAYERS; id++) {
    const theme = THEMES[(id - 1) % THEMES.length]!;
    const [x, y] = corner(id);
    world.addPlayer(id, `AI ${id}`, theme, 100_000, skirmishTech(defs, theme));
    world.addIsland(x, y, ISLAND.w, ISLAND.h, id);
    world.spawnBuilding(`${theme}vortex`, id, x + 18, y + 20);
    world.spawnBuilding(`${theme}factory`, id, x + 4, y + 4);
    world.spawnBuilding('altar', id, x + 33, y + 4);
    world.addPriest(id, x + 22, y + 32);

    // Each Fury has guns of its own; the Sun's stand in where a .type file is missing.
    const guns = [`${theme}cannon`, `${theme}archer`, 'suncannon', 'sunarcher']
      .filter((type) => defs.has(type));

    for (let i = 0; i < GUNS_PER_PLAYER; i++) {
      world.spawnBuilding(guns[i % 2]!, id, x + 4 + (i % 4) * 10, y + 10 + Math.floor(i / 4) * 8);
    }

    for (let i = 0; i < WALKERS_PER_PLAYER; i++) {
      const tx = x + 2 + (i % 12) * 3;
      const ty = y + 38 + Math.floor(i / 12) * 3;
      world.spawnTransport(walker(theme), id, tx, ty).path = [[tx + 1, ty], [tx + 2, ty]];
    }

    const enemy = (id % PLAYERS) + 1;

    for (let i = 0; i < INTRUDERS_PER_PLAYER; i++) {
      world.spawnTransport(walker(THEMES[(enemy - 1) % THEMES.length]!), enemy,
        x + 8 + (i % 4) * 10, y + 14 + Math.floor(i / 4) * 16);
    }
  }

  // Three planks of bridge between neighbouring islands, east and south.
  const plank = (x: number, y: number, owner: number) => {
    const cell = world.at(x, y);
    world.terrain[cell] = Terrain.Bridge;
    world.owner[cell] = owner;
  };

  for (let id = 1; id <= PLAYERS; id++) {
    const [x, y] = corner(id);

    for (const offset of [-3, 0, 3]) {
      if ((id - 1) % COLUMNS < COLUMNS - 1) {
        for (let bx = x + ISLAND.w; bx < x + ISLAND.dx; bx++) {
          plank(bx, y + 24 + offset, id);
        }
      }

      if (id + COLUMNS <= PLAYERS) {
        for (let by = y + ISLAND.h; by < y + ISLAND.dy; by++) {
          plank(x + 24 + offset, by, id);
        }
      }
    }
  }

  world.invalidateTerrain();

  for (let i = 0; i < 16; i++) {
    world.addGeyser(24 + (i % 4) * 68, 35 + Math.floor(i / 4) * 56);
  }

  return world;
}

const world = stressWorld();
const view = world.view();
const memories = new Map(
  [...world.players.keys()].map((player) => [player, createAiMemory(SEED + player)]),
);
const interval = Math.max(1, Math.round(DIFFICULTY.hard.moveSeconds * TPS));
const aiCalls: { tick: number; player: number; ms: number; commands: number; }[] = [];

/** The sides take their turns on successive ticks, as the client schedules them (match.ts). */
function aiCommands(monitor?: PerformanceMonitor): Command[] {
  return [...world.players.keys()].flatMap((player) => {
    if ((world.tick - player) % interval !== 0) {
      return [];
    }

    const start = performance.now();
    const move = () => aiMove(view, { player, difficulty: 'hard' }, memories.get(player)!);
    const commands = monitor ? monitor.measure('ai', move) : move();
    aiCalls.push({
      tick: world.tick,
      player,
      ms: performance.now() - start,
      commands: commands.length,
    });
    return commands;
  });
}

for (let i = 0; i < WARMUP_TICKS; i++) {
  world.step(aiCommands());
  world.drainEvents();
}

aiCalls.length = 0;
const monitor = new PerformanceMonitor(world);
const entitiesBefore = world.entities.size;

for (let i = 0; i < SAMPLE_TICKS; i++) {
  const commands = aiCommands(monitor);
  monitor.measure('simulationTick', () => world.step(commands));
  world.drainEvents();

  if ((i + 1) % 10 === 0) {
    monitor.heapSample(process.memoryUsage().heapUsed);
  }
}

const report = monitor.snapshot();
monitor.dispose();
const { simulationTick, ai, pathfinding } = report.ms;

console.log(JSON.stringify({
  scenario: {
    seed: SEED,
    players: PLAYERS,
    difficulty: 'hard',
    aiEveryTicks: interval,
    warmupTicks: WARMUP_TICKS,
    measuredTicks: SAMPLE_TICKS,
    finalTick: world.tick,
    entities: { atStart: entitiesBefore, ...report.entities },
    projectilesInFlight: report.projectiles,
    bridgeCells: world.terrain.filter((t) => t === Terrain.Bridge).length,
    hash: world.hash(),
  },
  ms: { simulationTick, ai, pathfinding },
  slowestAiCalls: aiCalls.toSorted((a, b) => b.ms - a.ms).slice(0, SLOW_CALLS),
  heapBytes: report.heap.map((h) => h.bytes),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
}, null, 2));
