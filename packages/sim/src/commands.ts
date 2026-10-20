import { FACINGS, MAX_ID, MAX_PLAYERS, type Facing } from './state.js';
import { choice, integer, keys, record, text } from './validation.js';

export type Command =
  | { t: 'dropPiece'; player: number; hand: number; x: number; y: number; rot: number; }
  | { t: 'build'; player: number; type: string; x: number; y: number; facing?: Facing; }
  | { t: 'collect'; player: number; transport: number; geyser: number; }
  | { t: 'pickupCrystal'; player: number; transport: number; crystal: number; }
  | { t: 'movePriest'; player: number; x: number; y: number; }
  | { t: 'capturePriest'; player: number; transport: number; target: number; }
  | { t: 'salvage'; player: number; target: number; }
  | { t: 'meltdown'; player: number; target: number; }
  | { t: 'takeSpell'; player: number; transport: number; obelisk: number; }
  /** `transport`: the caster, a transport or the player's Priest. */
  | { t: 'castSpell'; player: number; transport: number; }
  | { t: 'pray'; player: number; spell: string; }
  | { t: 'dropCargo'; player: number; transport: number; }
  | { t: 'produce'; player: number; workshop: number; type: string; }
  | { t: 'upgradeWorkshop'; player: number; workshop: number; };

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
  | 'no temple'
  | 'no altar'
  | 'no workshop'
  | 'not in production'
  | 'no free slot'
  | 'fully upgraded'
  | 'cannot build'
  | 'not ready'
  | 'casting'
  | 'no path'
  | 'priest unavailable'
  | 'target not incapacitated';

export type CommandResult = { ok: true; } | { ok: false; error: CommandError; };

/** Decode external commands before submitting them to the simulation. */
export function parseCommand(raw: unknown): Command {
  const value = record(raw, 'command');
  const t = choice(value.t, [
    'dropPiece',
    'build',
    'collect',
    'pickupCrystal',
    'movePriest',
    'capturePriest',
    'salvage',
    'meltdown',
    'takeSpell',
    'castSpell',
    'pray',
    'dropCargo',
    'produce',
    'upgradeWorkshop',
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
    case 'pickupCrystal':
      keys(value, ['t', 'player', 'transport', 'crystal'], 'command');
      return {
        t,
        player,
        transport: integer(value.transport, 'command.transport', 1, MAX_ID),
        crystal: integer(value.crystal, 'command.crystal', 1, MAX_ID),
      };
    case 'movePriest':
      keys(value, ['t', 'player', 'x', 'y'], 'command');
      return {
        t,
        player,
        x: integer(value.x, 'command.x', -Number.MAX_SAFE_INTEGER),
        y: integer(value.y, 'command.y', -Number.MAX_SAFE_INTEGER),
      };
    case 'salvage':
    case 'meltdown':
      keys(value, ['t', 'player', 'target'], 'command');
      return { t, player, target: integer(value.target, 'command.target', 1, MAX_ID) };
    case 'takeSpell':
      keys(value, ['t', 'player', 'transport', 'obelisk'], 'command');
      return {
        t,
        player,
        transport: integer(value.transport, 'command.transport', 1, MAX_ID),
        obelisk: integer(value.obelisk, 'command.obelisk', 1, MAX_ID),
      };
    case 'castSpell':
    case 'dropCargo':
      keys(value, ['t', 'player', 'transport'], 'command');
      return { t, player, transport: integer(value.transport, 'command.transport', 1, MAX_ID) };
    case 'pray':
      keys(value, ['t', 'player', 'spell'], 'command');
      return { t, player, spell: text(value.spell, 'command.spell') };
    case 'produce':
      keys(value, ['t', 'player', 'workshop', 'type'], 'command');
      return {
        t,
        player,
        workshop: integer(value.workshop, 'command.workshop', 1, MAX_ID),
        type: text(value.type, 'command.type'),
      };
    case 'upgradeWorkshop':
      keys(value, ['t', 'player', 'workshop'], 'command');
      return { t, player, workshop: integer(value.workshop, 'command.workshop', 1, MAX_ID) };
    case 'capturePriest':
      keys(value, ['t', 'player', 'transport', 'target'], 'command');
      return {
        t,
        player,
        transport: integer(value.transport, 'command.transport', 1, MAX_ID),
        target: integer(value.target, 'command.target', 1, MAX_ID),
      };
  }
}
