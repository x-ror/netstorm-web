import { RUNES, type Event as SimEvent, type WorldView } from '@netstorm/sim';
import { m } from './paraglide/messages.js';

/** The text for a command the simulation refused, by its error. */
const REJECTIONS: Record<string, () => string> = {
  'no player': m.rejected_no_player,
  'game over': m.rejected_game_over,
  'bad coordinates': m.rejected_bad_coordinates,
  'bad facing': m.rejected_bad_facing,
  'bad piece': m.rejected_bad_piece,
  'no piece': m.rejected_no_piece,
  blocked: m.rejected_blocked,
  'not connected': m.rejected_not_connected,
  'unknown unit': m.rejected_unknown_unit,
  'unknown tech': m.rejected_unknown_tech,
  'no storm power': m.rejected_no_storm_power,
  'no energy': m.rejected_no_energy,
  'bad target': m.rejected_bad_target,
  'no temple': m.rejected_no_temple,
  'no altar': m.rejected_no_altar,
  'no workshop': m.rejected_no_workshop,
  'not in production': m.rejected_not_in_production,
  'no free slot': m.rejected_no_free_slot,
  'fully upgraded': m.rejected_fully_upgraded,
  'cannot build': m.rejected_cannot_build,
  'not ready': m.rejected_not_ready,
  casting: m.rejected_casting,
  'no path': m.rejected_no_path,
  'priest unavailable': m.rejected_priest_unavailable,
  'target not incapacitated': m.rejected_target_not_incapacitated,
};

const COMMANDS: Record<string, () => string> = {
  dropPiece: m.command_drop_piece,
  build: m.command_build,
  collect: m.command_collect,
  pickupCrystal: m.command_pickup_crystal,
  movePriest: m.command_move_priest,
  capturePriest: m.command_capture_priest,
  salvage: m.command_salvage,
  meltdown: m.command_meltdown,
  takeSpell: m.command_take_spell,
  castSpell: m.command_cast_spell,
  dropCargo: m.command_drop_cargo,
  produce: m.command_produce,
  upgradeWorkshop: m.command_upgrade_workshop,
};

/** Why the simulation refuses a command, in the player's language; the error itself if unknown. */
export function rejection(err: string): string {
  return REJECTIONS[err]?.() ?? err;
}

/** The classes of the units' .type files, as the panels name them. */
const CLASSES: Readonly<Record<string, () => string>> = {
  'Shooter': m.class_shooter,
  'Defense': m.class_defense,
  'Anti-Air': m.class_anti_air,
  'Source of Energy': m.class_source_of_energy,
  'Air Attack Base': m.class_air_attack_base,
  'Production': m.class_production,
  'Energy': m.class_energy,
  'Altar': m.class_altar,
  'Ground Transport': m.class_ground_transport,
  'Aerial Transport': m.class_aerial_transport,
  'Aerial Attack': m.class_aerial_attack,
  'High Priest': m.class_high_priest,
  'Defensive Spell': m.class_defensive_spell,
  'Offensive Spell': m.class_offensive_spell,
  // So the .type file of Treason spells it.
  'Offsensive Spell': m.class_offensive_spell,
  'Summons Spell': m.class_summons_spell,
  'Source of Storm Power': m.class_source_of_storm_power,
  'Bridge': m.class_bridge,
  'Residence': m.class_residence,
  'Spell': m.class_spell,
};

/** Every message by its key, for the names looked up by a unit's id. */
const BY_KEY = m as unknown as Readonly<Record<string, (() => string) | undefined>>;

/** A class of the units' .type files in the player's language, or as the file names it. */
export function className(cls: string): string {
  return CLASSES[cls]?.() ?? cls;
}

/** A unit's name in the player's language (`unit_<id>` in messages/), or the original's name. */
export function unitName(id: string, original: string): string {
  return BY_KEY[`unit_${id}`]?.() ?? original;
}

export type Tone = 'good' | 'bad' | 'info';

/**
 * A log line for an event the local player should hear about, or null for noise such as the
 * enemy's routine actions. Unit names come from the definitions, so they stay in English as in
 * the original; the rest is in the locale the menu chose.
 */
export function describeEvent(
  world: WorldView,
  me: number,
  event: SimEvent,
): { text: string; tone: Tone; } | null {
  const mine = event.who === me;
  const name = (type: string) => unitName(type, world.defs.get(type)?.name ?? type);
  const player = (id: number) => world.players.get(id)?.name ?? m.player_number({ id });

  switch (event.what) {
    case 'rejected':
      return mine
        ? {
          text: `${COMMANDS[event.data.cmd]?.() ?? event.data.cmd}: ${rejection(event.data.err)}`,
          tone: 'bad',
        }
        : null;
    case 'bridge':
      return null;
    case 'build':
      return mine ? { text: m.event_built({ name: name(event.data.type) }), tone: 'info' } : null;
    case 'produce':
      return mine
        ? { text: m.event_producing({ name: name(event.data.type) }), tone: 'info' }
        : null;
    case 'upgrade':
      return mine
        ? { text: m.event_upgraded({ level: event.data.level }), tone: 'good' }
        : null;
    case 'destroyed':
      return {
        text: mine
          ? m.event_lost({ name: name(event.data.type) })
          : m.event_destroyed({ name: name(event.data.type) }),
        tone: mine ? 'bad' : 'good',
      };
    case 'reward':
      return mine ? { text: m.event_reward({ amount: event.data.amount }), tone: 'good' } : null;
    case 'salvaged':
      return mine
        ? {
          text: m.event_salvaged({ name: name(event.data.type), refund: event.data.refund }),
          tone: 'info',
        }
        : null;
    case 'spell':
      return mine
        ? { text: m.event_spell({ name: name(event.data.spell) }), tone: 'good' }
        : null;
    case 'cast':
      return {
        text: mine
          ? m.event_you_cast({ name: name(event.data.spell) })
          : m.event_they_cast({ player: player(event.who), name: name(event.data.spell) }),
        tone: mine ? 'info' : 'bad',
      };
    case 'delivered':
      return mine ? { text: m.event_delivered(), tone: 'good' } : null;
    case 'captured': {
      const priest = world.entities.get(event.data.priest);
      const friend = priest?.kind === 'priest' && !world.hostile(event.who, priest.owner);

      if (friend) {
        return mine
          ? {
            text: m.event_ally_aboard(),
            tone: 'good',
          }
          : null;
      }

      return {
        text: mine ? m.event_captured() : m.event_own_captured(),
        tone: mine ? 'good' : 'bad',
      };
    }
    case 'saved':
      return { text: m.event_saved({ player: player(event.data.owner) }), tone: 'good' };
    case 'chained':
      return {
        text: mine ? m.event_chained() : m.event_own_chained(),
        tone: mine ? 'good' : 'bad',
      };
    case 'rune':
      return {
        text: (mine ? m.event_rune : m.event_rune_enemy)({ runes: event.data.runes, total: RUNES }),
        tone: mine ? 'good' : 'bad',
      };
    case 'released':
      return {
        text: mine ? m.event_released() : m.event_escaped(),
        tone: mine ? 'good' : 'bad',
      };
    case 'sacrifice':
      return {
        text: m.event_sacrifice({ player: player(event.who), victim: player(event.data.victim) }),
        tone: mine ? 'good' : 'bad',
      };
    case 'victory':
      return { text: m.event_victory({ player: player(event.who) }), tone: mine ? 'good' : 'bad' };
    case 'priest down':
      return mine ? { text: m.event_priest_down(), tone: 'bad' } : null;
    case 'ricochet':
    case 'bridge cracked':
    case 'bridge fell':
      return null; // shown on the map and heard, not worth a line
    case 'priest up':
      return mine ? { text: m.event_priest_up(), tone: 'good' } : null;
  }
}
