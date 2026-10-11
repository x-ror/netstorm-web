import { World } from './world.js';
import { parseCommand, type Command } from './commands.js';
import { parseSnapshot, RULES_VERSION, type WorldSnapshot } from './snapshot.js';
import { integer, keys, list, record } from './validation.js';
import type { WorldView } from './view.js';
import type { Event } from './events.js';
import { TPS } from './state.js';

export const REPLAY_VERSION = 1;

export interface ReplayFrame {
  /** Commands are applied before advancing to this tick. */
  tick: number;
  commands: Command[];
  hash: number | null;
}

export interface Replay {
  formatVersion: number;
  rulesVersion: number;
  initial: WorldSnapshot;
  frames: ReplayFrame[];
}

export function parseReplay(raw: unknown): Replay {
  const value = record(raw, 'replay');
  keys(value, ['formatVersion', 'rulesVersion', 'initial', 'frames'], 'replay');

  if (value.formatVersion !== REPLAY_VERSION || value.rulesVersion !== RULES_VERSION) {
    throw new TypeError('Unsupported replay or rules version');
  }

  const initial = parseSnapshot(value.initial);
  let expectedTick = initial.tick + 1;
  const frames = list(value.frames, 'replay.frames').map((rawFrame) => {
    const frame = record(rawFrame, 'replay frame');
    keys(frame, ['tick', 'commands', 'hash'], 'replay frame');
    const tick = integer(frame.tick, 'frame.tick');

    if (tick !== expectedTick++) {
      throw new TypeError(`Unexpected replay tick ${tick}`);
    }

    return {
      tick,
      commands: list(frame.commands, 'frame.commands').map(parseCommand),
      hash: frame.hash === null ? null : integer(frame.hash, 'frame.hash', 0, 0xffffffff),
    };
  });

  if (frames.length && frames.at(-1)!.hash === null) {
    throw new TypeError('Replay must include a final checkpoint');
  }

  return { formatVersion: REPLAY_VERSION, rulesVersion: RULES_VERSION, initial, frames };
}

export function playReplay(raw: unknown): World {
  const replay = parseReplay(raw);
  const world = World.fromSnapshot(replay.initial);

  for (const frame of replay.frames) {
    world.step(frame.commands);

    if (frame.hash !== null && world.hash() !== frame.hash) {
      throw new Error(`Replay diverged at tick ${frame.tick}`);
    }

    world.drainEvents();
  }

  return world;
}

/** Owns command submission for a recorded local match. Do not mutate the source World externally. */
export class ReplayRecorder {
  private readonly initial: WorldSnapshot;
  private readonly frames: ReplayFrame[] = [];
  private expectedTick: number;

  constructor(private readonly world: World) {
    this.initial = world.snapshot();
    this.expectedTick = world.tick;
  }

  view(): WorldView {
    return this.world.view();
  }

  step(commands: readonly Command[] = []): void {
    if (this.world.tick !== this.expectedTick) {
      throw new Error('World advanced outside replay recorder');
    }

    const recorded = commands.map(parseCommand);
    this.world.step(recorded);
    this.expectedTick = this.world.tick;
    this.frames.push({
      tick: this.world.tick,
      commands: recorded,
      hash: this.frames.length % (5 * TPS) === 5 * TPS - 1 ? this.world.hash() : null,
    });
  }

  drainEvents(): Event[] {
    return this.world.drainEvents();
  }

  export(): Replay {
    if (this.world.tick !== this.expectedTick) {
      throw new Error('World advanced outside replay recorder');
    }

    const replay = structuredClone({
      formatVersion: REPLAY_VERSION,
      rulesVersion: RULES_VERSION,
      initial: this.initial,
      frames: this.frames,
    });
    const last = replay.frames.at(-1);

    if (last) {
      last.hash = this.world.hash();
    }

    return replay;
  }
}
