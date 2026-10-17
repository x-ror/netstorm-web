/**
 * Headless matches of the computer against itself or an idle side, on maps made from seeds, with a
 * line a minute on how each side fares: the yardstick for any change to the AI.
 *
 *   npm run ai:arena                               # hard vs hard, seeds 1 2 3, 20 minutes
 *   SEEDS=7 IDLE=1 MINUTES=30 npm run ai:arena     # hard against a side that does nothing
 *   LEVELS=easy,hard npm run ai:arena              # side 1 easy, side 2 hard
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  aiMove,
  createAiMemory,
  createMission,
  DIFFICULTY,
  generateMap,
  loadDefs,
  TPS,
  type Command,
  type Difficulty,
} from '../packages/sim/src/index.js';

const SIDES = [1, 2] as const;
const ISLANDS = 4;
const GEYSERS = 8;
const STORM = 2000;
const MINUTE = 60 * TPS;
const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../data/units.json', import.meta.url), 'utf8')),
);
const seeds = (process.env.SEEDS ?? '1,2,3').split(',').map(Number);
const minutes = Number(process.env.MINUTES ?? 20);
const levels = (process.env.LEVELS ?? 'hard,hard').split(',') as Difficulty[];
const idle = process.env.IDLE === '1';

// Several seeds run as one process each, on their own cores; each prints its match whole.
if (seeds.length > 1) {
  const runs = seeds.map((seed) =>
    new Promise<string>((resolve) => {
      execFile(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
        env: { ...process.env, SEEDS: String(seed) },
        maxBuffer: 1 << 24, // oxlint-disable-line no-magic-numbers -- 16 MiB of output
      }, (error, stdout, stderr) => resolve(stdout + stderr + (error ? `\n${error.message}` : '')));
    })
  );

  for (const run of runs) {
    process.stdout.write(await run);
  }

  process.exit(0);
}

for (const seed of seeds) {
  const map = generateMap(seed, {
    islands: ISLANDS,
    geysers: GEYSERS,
    sides: [{ id: 1, theme: 'wind' }, { id: 2, theme: 'rain' }],
  });
  const world = createMission(defs, seed, map, (id) => ({
    name: `S${id}`,
    theme: id === 1 ? 'wind' : 'rain',
    storm: STORM,
  }));
  const memories = new Map(SIDES.map((p) => [p, createAiMemory(seed + p)]));
  const stats = Object.fromEntries(SIDES.map((p) => [p, {
    moves: 0,
    laid: 0,
    /** Moves with a full hand and no piece laid. */
    stuck: 0,
    rejected: 0,
    lost: 0,
    spent: 0,
    built: {} as Record<string, number>,
  }]));
  const spent = { 1: 0, 2: 0 };
  const lastStorm = { 1: STORM, 2: STORM };
  console.log(`=== seed ${seed}: ${idle ? `${levels[0]} vs idle` : levels.join(' vs ')} ===`);

  for (let t = 0; t < minutes * MINUTE && world.winner === null; t++) {
    const commands: Command[] = [];

    for (const p of SIDES) {
      const level = levels[p - 1] ?? levels[0]!;
      const interval = Math.round(DIFFICULTY[level].moveSeconds * TPS);

      if ((idle && p === 2) || (world.tick - p) % interval !== 0) {
        continue;
      }

      const player = world.players.get(p)!;
      const full = player.hand.length >= world.bridgeSlots;
      const mine = aiMove(world.view(), { player: p, difficulty: level }, memories.get(p)!);
      const s = stats[p]!;
      s.moves++;
      const drops = mine.filter((c) => c.t === 'dropPiece').length;
      s.laid += drops;
      s.stuck += full && drops === 0 ? 1 : 0;

      for (const c of mine.filter((command) => command.t === 'build')) {
        s.built[c.type] = (s.built[c.type] ?? 0) + 1;
        spent[p] += defs.get(c.type)?.cost ?? 0;
      }

      commands.push(...mine);
    }

    world.step(commands);

    for (const event of world.drainEvents()) {
      if (event.what === 'rejected') {
        stats[event.who]!.rejected++;
      } else if (event.what === 'destroyed' && event.who in stats) {
        stats[event.who]!.lost++;
      }
    }

    if (world.tick % MINUTE === 0) {
      const row = SIDES.map((p) => {
        const player = world.players.get(p)!;
        const buildings = world.buildingsOf(p);
        const guns = buildings.filter((b) => world.def(b.type).dps > 0).length;
        const entities = [...world.entities.values()];
        const geysers = entities.filter((e) =>
          e.kind === 'geyser' && e.stock > 0 && world.owner[world.at(e.x, e.y)] === p
        ).length;
        const transports = entities.filter((e) =>
          e.kind === 'transport' && e.owner === p
        ).length;
        const priest = world.priestOf(p);
        const income = player.storm - lastStorm[p] + spent[p];
        lastStorm[p] = player.storm;
        stats[p]!.spent += spent[p];
        const line = `S${p} storm ${player.storm} +${income}/min geysers ${geysers} transports `
          + `${transports} guns ${guns} buildings ${buildings.length} priest `
          + `${priest?.state ?? '-'}/${priest?.hp ?? '-'} hand ${
            player.hand.map((h) => h.piece).join(' ')
          }`;
        spent[p] = 0;
        return line;
      });
      console.log(`${world.tick / MINUTE}m  ${row.join('  |  ')}`);
    }
  }

  if (world.winner !== null) {
    console.log(`WINNER side ${world.winner} at ${(world.tick / MINUTE).toFixed(1)} min`);
  }

  console.log(JSON.stringify(stats));
}
