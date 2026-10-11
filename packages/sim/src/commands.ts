import { FACINGS, MAX_ID, MAX_PLAYERS, type Facing } from './state.js';
import { choice, integer, keys, record, text } from './validation.js';

export type Command =
  | { t: 'dropPiece'; player: number; hand: number; x: number; y: number; rot: number; }
  | { t: 'build'; player: number; type: string; x: number; y: number; facing?: Facing; }
  | { t: 'collect'; player: number; transport: number; geyser: number; }
  | { t: 'movePriest'; player: number; x: number; y: number; }
  | { t: 'pickupPriest'; player: number; target: number; }
  | { t: 'sacrifice'; player: number; };

export type CommandError =
  | 'no player'
  | 'game over'
  | 'bad coordinates'
  | 'bad facing'
  | 'bad piece'
  | 'no piece'
  | 'blocked'
  | 'not connected'
  | 'unknown unit'
  | 'unknown tech'
  | 'no storm power'
  | 'no energy'
  | 'bad target'
  | 'no path'
  | 'priest unavailable'
  | 'target not incapacitated'
  | 'too far'
  | 'nothing to sacrifice'
  | 'not at altar';

export type CommandResult = { ok: true; } | { ok: false; error: CommandError; };

/** Decode external commands before submitting them to the simulation. */
export function parseCommand(raw: unknown): Command {
  const value = record(raw, 'command');
  const t = choice(value.t, [
    'dropPiece',
    'build',
    'collect',
    'movePriest',
    'pickupPriest',
    'sacrifice',
  ], 'command type');
  const player = integer(value.player, 'command.player', 1, MAX_PLAYERS);

  switch (t) {
    case 'dropPiece':
      keys(value, ['t', 'player', 'hand', 'x', 'y', 'rot'], 'command');
      return {
        t,
        player,
        hand: integer(value.hand, 'command.hand'),
        x: integer(value.x, 'command.x', -Number.MAX_SAFE_INTEGER),
        y: integer(value.y, 'command.y', -Number.MAX_SAFE_INTEGER),
        rot: integer(value.rot, 'command.rot'),
      };
    case 'build': {
      keys(value, ['t', 'player', 'type', 'x', 'y', 'facing'], 'command');
      const command: Extract<Command, { t: 'build'; }> = {
        t,
        player,
        type: text(value.type, 'command.type'),
        x: integer(value.x, 'command.x', -Number.MAX_SAFE_INTEGER),
        y: integer(value.y, 'command.y', -Number.MAX_SAFE_INTEGER),
      };

      if (value.facing !== undefined) {
        command.facing = choice(value.facing, FACINGS, 'command.facing');
      }

      return command;
    }
    case 'collect':
      keys(value, ['t', 'player', 'transport', 'geyser'], 'command');
      return {
        t,
        player,
        transport: integer(value.transport, 'command.transport', 1, MAX_ID),
        geyser: integer(value.geyser, 'command.geyser', 1, MAX_ID),
      };
    case 'movePriest':
      keys(value, ['t', 'player', 'x', 'y'], 'command');
      return {
        t,
        player,
        x: integer(value.x, 'command.x', -Number.MAX_SAFE_INTEGER),
        y: integer(value.y, 'command.y', -Number.MAX_SAFE_INTEGER),
      };
    case 'pickupPriest':
      keys(value, ['t', 'player', 'target'], 'command');
      return { t, player, target: integer(value.target, 'command.target', 1, MAX_ID) };
    case 'sacrifice':
      keys(value, ['t', 'player'], 'command');
      return { t, player };
  }
}
