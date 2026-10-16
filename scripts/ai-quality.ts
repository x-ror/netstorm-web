import { readFileSync } from 'node:fs';
import {
  aiMove,
  aiReact,
  aiStrategicDue,
  createAiMemory,
  createSkirmish,
  loadDefs,
  type Command,
} from '../packages/sim/src/index.js';

const TICKS = Number(process.env.AI_QUALITY_TICKS ?? 3000);
const INTERVAL = 30;
const SEEDS = [31, 32, 33, 34, 35];
const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../data/units.json', import.meta.url), 'utf8')),
);

function duel(seed: number, mode: 'baseline' | 'staggered') {
  const world = createSkirmish(defs, seed, [
    { id: 1, name: 'Wind', theme: 'wind', x: 40, y: 40 },
    { id: 2, name: 'Rain', theme: 'rain', x: 120, y: 40 },
  ], [[80, 40], [48, 72], [112, 72]]);
  const memories = new Map(
    [...world.players.keys()].map((player) => [player, createAiMemory(seed + player)]),
  );
  const pending: number[] = [];
  const queued = new Set<number>();
  const firstExpansion = new Map<number, number>();
  const firstAttack = new Map<number, number>();
  const issued: Record<number, number> = {};
  const rejected: Record<number, number> = {};

  for (let index = 0; index < TICKS && world.winner === null; index++) {
    const view = world.view();
    const commands: Command[] = [];

    if (mode === 'baseline') {
      if (world.tick % INTERVAL === 0) {
        for (const player of world.players.keys()) {
          commands.push(...aiMove(view, { player, difficulty: 'hard' }, memories.get(player)!));
        }
      }
    } else {
      for (const player of world.players.keys()) {
        const memory = memories.get(player)!;
        const reactive = aiReact(view, player, memory, INTERVAL);

        if (
          (aiStrategicDue(world.tick, player, INTERVAL) || reactive) && !queued.has(player)
        ) {
          pending.push(player);
          queued.add(player);
        }
      }

      const player = pending.shift();

      if (player !== undefined) {
        queued.delete(player);
        commands.push(...aiMove(view, { player, difficulty: 'hard' }, memories.get(player)!));
      }
    }

    for (const command of commands) {
      issued[command.player] = (issued[command.player] ?? 0) + 1;
    }

    const oldShots = new Set(
      world.shots.map((shot) => `${shot.gun.id}:${shot.target}:${shot.land}`),
    );
    world.step(commands);

    for (const event of world.drainEvents()) {
      if (event.what === 'bridge' && !firstExpansion.has(event.who)) {
        firstExpansion.set(event.who, event.tick);
      } else if (event.what === 'rejected') {
        rejected[event.who] = (rejected[event.who] ?? 0) + 1;
      }
    }

    for (const shot of world.shots) {
      const key = `${shot.gun.id}:${shot.target}:${shot.land}`;
      const target = world.entities.get(shot.target);

      if (
        !oldShots.has(key) && target && 'owner' in target && target.owner !== shot.gun.owner
        && !firstAttack.has(shot.gun.owner)
      ) {
        firstAttack.set(shot.gun.owner, world.tick);
      }
    }
  }

  return {
    seed,
    mode,
    ticks: world.tick,
    winner: world.winner,
    firstExpansion: Object.fromEntries(firstExpansion),
    firstEnemyShot: Object.fromEntries(firstAttack),
    issuedCommands: issued,
    rejectedCommands: rejected,
    remainingStorm: Object.fromEntries(
      [...world.players].map(([player, state]) => [player, state.storm]),
    ),
    hash: world.hash(),
  };
}

for (const seed of SEEDS) {
  console.log(JSON.stringify([
    duel(seed, 'baseline'),
    duel(seed, 'staggered'),
  ]));
}
