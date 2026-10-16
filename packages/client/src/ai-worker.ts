/**
 * The computer's move, worked out off the main thread: the match hands over the world as it
 * stands (`World.handoff`), the worker rebuilds it and answers with the commands, the reasons and
 * the time it took. Each side's memory between moves lives here.
 */
import {
  aiMove,
  createAiMemory,
  World,
  type AiMemory,
  type AiOptions,
  type Command,
} from '@netstorm/sim';

export interface AiRequest {
  due: number;
  world: unknown;
  options: AiOptions;
  seed: number;
}

export interface AiReply {
  due: number;
  player: number;
  commands: Command[];
  lines: string[];
  ms: number;
}

const memories = new Map<number, AiMemory>();
const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<AiRequest>) => void) => void;
  postMessage: (reply: AiReply) => void;
};

/** The grids come as typed arrays, which the snapshot reader does not take. */
function lists(handoff: unknown): unknown {
  const raw = handoff as Record<string, unknown>;

  for (const grid of ['terrain', 'owner', 'links', 'wear', 'occupant']) {
    raw[grid] = Array.from(raw[grid] as ArrayLike<number>);
  }

  return raw;
}

scope.addEventListener('message', ({ data }) => {
  const start = performance.now();
  const world = World.fromSnapshot(lists(data.world));
  const { player } = data.options;
  const memory = memories.get(player) ?? createAiMemory(data.seed + player);
  memories.set(player, memory);
  const lines: string[] = [];
  const commands = aiMove(world.view(), data.options, memory, (line) => lines.push(line));
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's, not a window's
  scope.postMessage({ due: data.due, player, commands, lines, ms: performance.now() - start });
});
