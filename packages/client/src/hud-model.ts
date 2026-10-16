import {
  PIECES,
  rotateLinks,
  MAX_UPGRADES,
  OUTPOST,
  PIECE_HARDEN,
  upgradeCost,
  WORKSHOP_SLOTS,
  canProduce,
  canUpgrade,
  makerError,
  takesSlot,
  RUNES,
  TPS,
  blastDamage,
  shotInterval,
  rotatePiece,
  type Building,
  type DeepReadonly,
  type Entity,
  type Theme,
  type UnitDef,
  type WorldView,
} from '@netstorm/sim';
import type { Atlas } from './assets.js';
import { className, unitName } from './messages.js';
import { m } from './paraglide/messages.js';
import { TH, TW } from './projection.js';
import { bridgeSlot } from './texture-selection.js';
import { hasFacing, placeable, type Tool, type UiState } from './ui-state.js';

/**
 * What the panels around the map show, as plain data: built from the world and the UI state on
 * each refresh, and drawn by Hud.svelte, which decides nothing.
 */
export interface HudModel {
  storm: number;
  energy: { own: number; total: number; };
  clock: string;
  paused: boolean;
  muted: boolean;
  bridgeSlots: number;
  /** Every slot of the Production Window, filled or waiting for the Temple's next piece. */
  slots: Slot[];
  hasTemple: boolean;
  /** No Workshop yet, so the Production Window holds the Golem alone: how to get more is told. */
  hasWorkshop: boolean;
  units: UnitCard[];
  tool: Tool['kind'];
  selected: Selected | null;
  /** What the tool in hand does, shown when nothing is selected. */
  hint: string;
  /** The computer plays every side; the panels show the side looked through and give no orders. */
  watching: boolean;
  /** The sides that can be looked through when watching, the one looked through marked. */
  sides: { id: number; name: string; on: boolean; }[];
  /** The computer plays a side, and the reasons for its moves can be copied. */
  aiLog: boolean;
}

/** What the panels ask of the match. */
export interface HudActions {
  setTool(tool: Tool): void;
  togglePause(): void;
  toggleSound(): void;
  salvageSelected(): void;
  /** Put a unit into a free Production Slot of the selected Workshop. */
  produceSelected(type: string): void;
  upgradeSelected(): void;
  meltdownSelected(): void;
  castSelected(): void;
  /** A button of the page shown over the map was pressed: its place among the page's buttons. */
  page(button: number): void;
  dropSelected(): void;
  /** Look through another side's eyes, when watching the computer play. */
  view(player: number): void;
  /** Copy the reasons the computer gave for its moves, for reading them elsewhere. */
  copyAiLog(): void;
  exit(): void;
}

/** A line of the battle log: when, what, and whether it is good or bad news. */
export interface LogLine {
  id: number;
  time: string;
  text: string;
  tone: string;
}

/** The log keeps this many lines, newest first. */
export const LOG_LINES = 60;

/** A page of the mission's script over the map, with its buttons. */
export interface Page {
  title: string;
  text: string;
  buttons: readonly string[];
}

export interface Slot {
  index: number;
  piece: Planks | null;
  active: boolean;
  cracked: boolean;
  title: string;
}

/** A piece drawn as the bridge it will be: for each cell the Bridge frame of the sides it joins
 * on, cut out of the atlas, in pixels of the original. */
export interface Planks {
  width: number;
  height: number;
  planks: { left: number; top: number; width: number; height: number; background: string; }[];
}

export interface UnitCard {
  id: string;
  name: string;
  /** The Fury of the unit; null for one of no Fury. */
  theme: Theme | null;
  cost: number;
  active: boolean;
  /** Too dear, or laid a moment ago (the Unit Rate). */
  poor: boolean;
  /** Too dear: the cost the original draws in red. */
  short: boolean;
  title: string;
  /** The way a unit laid with a facing will face, while it is in hand. */
  facing: string | null;
  /** The Unit Rate running out: seconds left and the share of the wait still to go. */
  cooling: { seconds: number; left: number; } | null;
}

export interface Selected {
  type: string;
  /** The Fury of the unit; null for one of no Fury. */
  theme: Theme | null;
  name: string;
  owner: { name: string; side: 'own' | 'enemy'; } | null;
  hp: { value: number; max: number; share: number; band: 'high' | 'mid' | 'low'; } | null;
  facts: { text: string; muted?: boolean; }[];
  actions: SelectedAction[];
}

export type SelectedAction =
  | { kind: 'cast'; label: string; cost: number; }
  | { kind: 'build'; type: string; label: string; cost: number; }
  | { kind: 'drop'; label: string; }
  | { kind: 'salvage'; label: string; key: string; }
  | { kind: 'produce'; type: string; label: string; }
  | { kind: 'upgrade'; label: string; cost: number; }
  | { kind: 'meltdown'; label: string; };

const PLANK_DROP = 9; // from the top of a cell down to the hot spot of its Bridge frame
const PLANK_FACE = 7; // pixels of a frame's front face under its cell
const SECONDS_PER_MINUTE = 60;
const HALF = 0.5;
const QUARTER = 0.25;
const FACING_NAMES = [m.facing_north, m.facing_east, m.facing_south, m.facing_west];
const GOALS: Record<string, () => string> = {
  idle: m.goal_idle,
  collect: m.goal_collect,
  pickup: m.goal_pickup,
  home: m.goal_home,
  capture: m.goal_capture,
  altar: m.goal_altar,
  obelisk: m.goal_obelisk,
};
/** The Furies by name, for the sides of a match the computer plays alone. */
const FURIES: Record<string, () => string> = {
  wind: m.fury_wind,
  rain: m.fury_rain,
  thunder: m.fury_thunder,
};
const PRIEST_STATES: Record<string, () => string> = {
  normal: m.priest_normal,
  down: m.priest_down,
  carried: m.priest_carried,
  chained: m.priest_chained,
};

export function hudModel(
  world: WorldView,
  me: number,
  ui: UiState,
  atlas: Atlas,
  aiLog = false,
): HudModel {
  const player = world.players.get(me)!;
  const seconds = Math.floor(world.tick / TPS);
  const handTool = ui.tool.kind === 'piece' ? ui.tool.hand : -1;
  return {
    storm: player.storm,
    energy: world.energy(me),
    clock: `${Math.floor(seconds / SECONDS_PER_MINUTE)}:${
      String(seconds % SECONDS_PER_MINUTE).padStart(2, '0')
    }`,
    paused: ui.paused,
    muted: ui.muted,
    bridgeSlots: world.bridgeSlots,
    slots: Array.from({ length: world.bridgeSlots }, (_, index) => {
      const h = player.hand[index];
      const cracked = h !== undefined && h.age < PIECE_HARDEN;
      const rot = index === handTool ? ui.rot : 0;
      return {
        index,
        piece: h
          ? pieceArt(atlas, rotatePiece(PIECES[h.piece]!, rot), rotateLinks(h.piece, rot),
            cracked ? 'cracked' : 'whole')
          : null,
        active: index === handTool,
        cracked,
        title: `${cracked ? m.piece_fresh() : m.piece_whole()} (${index + 1})`,
      };
    }),
    hasTemple: world.templeOf(me) !== undefined,
    hasWorkshop: world.buildingsOf(me).some((b) => world.defs.get(b.type)?.cls === 'Production'),
    units: unitCards(world, me, ui),
    tool: ui.tool.kind,
    selected: selected(world, me, ui),
    hint: ui.watching ? m.hud_watching_hint() : hint(world, ui),
    watching: ui.watching,
    aiLog,
    sides: ui.watching
      ? [...world.players.values()].map((side) => ({
        id: side.id,
        // Neither side is the player's: each is named by its number and Fury.
        name: m.hud_side({ id: side.id, fury: FURIES[side.theme]?.() ?? side.theme }),
        on: side.id === me,
      }))
      : [],
  };
}

function pieceArt(
  atlas: Atlas,
  cells: [number, number][],
  links: number[],
  strength: 'whole' | 'cracked' | 'hard',
): Planks {
  const order = cells.map((cell, i) => [cell, links[i]!] as const)
    // A frame hangs a little over the cell under it: rows are laid top to bottom.
    .sort(([a], [b]) => a[1] - b[1] || a[0] - b[0]);
  const wide = Math.max(...cells.map(([x]) => x)) + 1;
  const tall = Math.max(...cells.map(([, y]) => y)) + 1;
  const planks = order.flatMap(([[x, y], joins]) => {
    const frame = atlas.frames[`slot:bridge:${bridgeSlot(joins, strength, 1)}`];

    if (!frame) {
      return [];
    }

    const [sheet, ax, ay, w, h, left = 0, top = 0] = frame as [
      number,
      number,
      number,
      number,
      number,
      number?,
      number?,
    ];
    return [{
      left: x * TW + TW - 1 + left,
      top: y * TH + PLANK_DROP + top,
      width: w,
      height: h,
      background: `url(${atlas.atlases[sheet]}) -${ax}px -${ay}px`,
    }];
  });
  return { width: wide * TW, height: tall * TH + PLANK_FACE, planks };
}

// Where an atlas entry keeps a picture's size and where it lies from its hot spot.
const WIDTH = 3;
const HEIGHT = 4;
const LEFT = 5;
const TOP = 6;
/** Small pictures are enlarged at most this many times, so a Golem does not fill a card. */
const MAX_ENLARGE = 3;
/**
 * Units drawn from several slots laid over one another about their hot spot. The Sun Disc
 * Thrower is its base (slot 32) with the thrower on it, facing north at rest (slot 0).
 */
const ICON_LAYERS: Readonly<Record<string, readonly string[]>> = {
  sunarcher: ['slot:sunarcher:32', 'slot:sunarcher:0'],
};

/** One frame of a unit's icon: where it lies in the icon and its piece of the atlas. */
export interface IconLayer {
  left: number;
  top: number;
  width: number;
  height: number;
  background: string;
}

/** The picture of a unit for the panels, fitted into a square of `size` pixels: facing east where
 * it has facings, else the larger of its plain picture and its first slot (the plain one of a
 * Golem is a speck, the first slot of a Temple only its whirl), or its slots laid over one another
 * (ICON_LAYERS). Null for a unit with no picture of its own, a Spell or a Thunder Spire. */
export function iconOf(
  atlas: Atlas,
  type: string,
  size: number,
): { width: number; height: number; layers: IconLayer[]; scale: number; } | null {
  const area = (key: string) => {
    const found = atlas.frames[key];
    return found ? found[WIDTH]! * found[HEIGHT]! : 0;
  };
  const keys = ICON_LAYERS[type] ?? [
    atlas.frames[`${type}:1`]
      ? `${type}:1`
      : [type, `slot:${type}:0`].sort((a, b) => area(b) - area(a))[0]!,
  ];
  const frames = keys.map((key) => atlas.frames[key]);

  if (frames.length === 0 || frames.some((frame) => !frame)) {
    return null;
  }

  // A lone frame stands at the corner; layered ones about the hot spot they share.
  const placed = frames.map((frame) => ({
    frame: frame!,
    x: keys.length > 1 ? frame![LEFT] ?? 0 : 0,
    y: keys.length > 1 ? frame![TOP] ?? 0 : 0,
  }));
  const left = Math.min(...placed.map((p) => p.x));
  const top = Math.min(...placed.map((p) => p.y));
  const width = Math.max(...placed.map((p) => p.x + p.frame[WIDTH]!)) - left;
  const height = Math.max(...placed.map((p) => p.y + p.frame[HEIGHT]!)) - top;
  const fit = Math.min(size / width, size / height);
  return {
    width,
    height,
    layers: placed.map(({ frame, x, y }) => {
      const [sheet, ax, ay, w, h] = frame as [number, number, number, number, number];
      return {
        left: x - left,
        top: y - top,
        width: w,
        height: h,
        background: `url(${atlas.atlases[sheet]}) -${ax}px -${ay}px`,
      };
    }),
    // Whole steps keep the pixels square when a small picture is enlarged.
    scale: fit >= 1 ? Math.min(Math.floor(fit), MAX_ENLARGE) : fit,
  };
}

function unitCards(world: WorldView, me: number, ui: UiState): UnitCard[] {
  const player = world.players.get(me)!;
  return [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> => def !== undefined && placeable(def))
    // As the original's Production Window: the Golem of the Temple, and what a Workshop has in
    // its Production Slots, nothing that has no maker yet.
    .filter((def) => makerError(world, me, def) === null)
    .sort((a, b) => a.level - b.level || a.cost - b.cost)
    .map((def) => {
      const active = ui.tool.kind === 'build' && ui.tool.type === def.id;
      const cooling = player.refresh.find((entry) => entry.type === def.id);
      let warning = '';

      if (cooling) {
        warning = ` — ${m.unit_cooling()}`;
      } else if (player.storm < def.cost) {
        warning = ` — ${m.rejected_no_storm_power()}`;
      }

      return {
        id: def.id,
        name: unitName(def.id, def.name),
        theme: def.theme,
        cost: def.cost,
        active,
        poor: player.storm < def.cost || cooling !== undefined,
        short: player.storm < def.cost,
        title: m.unit_title({
          name: unitName(def.id, def.name),
          cls: className(def.cls),
          level: def.level,
          size: `${def.footX}×${def.footY}`,
        }) + warning,
        facing: active && hasFacing(def) ? FACING_NAMES[ui.facing]!() : null,
        cooling: cooling
          ? {
            seconds: Math.ceil(cooling.ticks / TPS),
            left: cooling.ticks / (world.unitRate * TPS),
          }
          : null,
      };
    });
}

/** A Workshop's level and Production Slots and, for the player's own, the units of its Fury he
 * knows that it could take into a free slot, and its Upgrade. */
function workshop(
  world: WorldView,
  me: number,
  b: DeepReadonly<Building>,
  say: (text: string, muted?: boolean) => void,
  actions: SelectedAction[],
): void {
  const room = WORKSHOP_SLOTS + b.upgrades;
  const names = b.slots.map((type) => unitName(type, world.defs.get(type)?.name ?? type));
  say(m.workshop_level({ level: b.upgrades + 1, used: b.slots.length, room }));
  say(names.length ? m.workshop_makes({ names: names.join(', ') }) : m.workshop_empty());

  if (b.owner !== me || b.rising > 0) {
    return;
  }

  const offered = [...(world.players.get(me)?.tech ?? [])]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> =>
      def !== undefined
      && canProduce(world, { player: me, workshop: b.id, type: def.id }) !== 'cannot build'
      && takesSlot(def) && !b.slots.includes(def.id)
    )
    .sort((a, c) => a.level - c.level || a.cost - c.cost);

  if (b.slots.length < room) {
    say(offered.length
      ? m.slot_final()
      : m.slot_no_knowledge(), true);

    for (const def of offered) {
      actions.push({
        kind: 'produce',
        type: def.id,
        label: m.action_produce({ name: unitName(def.id, def.name) }),
      });
    }
  } else if (offered.length) {
    say(m.slots_full(), true);
  }

  if (
    b.upgrades < MAX_UPGRADES && canUpgrade(world, { player: me, workshop: b.id }) !== 'bad target'
  ) {
    actions.push({
      kind: 'upgrade',
      label: m.action_upgrade({ level: b.upgrades + 2 }),
      cost: upgradeCost(world.def(b.type)),
    });
  }
}

function selected(world: WorldView, me: number, ui: UiState): Selected | null {
  const entity = ui.selected === null ? undefined : world.entities.get(ui.selected);

  if (!entity) {
    return null;
  }

  const ownerId = 'owner' in entity ? entity.owner : null;
  const owner = ownerId === null ? undefined : world.players.get(ownerId);
  const facts: Selected['facts'] = [];
  const actions: SelectedAction[] = [];
  const say = (text: string, muted = false) => facts.push(muted ? { text, muted } : { text });

  if (entity.kind === 'building') {
    combat(world.defs.get(entity.type), entity.hpMax, say);

    if (entity.regrow > 0) {
      say(m.regrow({ seconds: Math.ceil(entity.regrow / TPS) }));
    }

    if (entity.builder !== null) {
      say(m.waits_priest());
    } else if (entity.rising > 0) {
      say(m.rising({ seconds: Math.ceil(entity.rising / TPS) }));
    }

    if (world.defs.get(entity.type)?.cls === 'Production') {
      workshop(world, me, entity, say, actions);
    }
  }

  if (entity.kind === 'transport') {
    say(
      `${GOALS[entity.goal]?.() ?? entity.goal}${
        entity.carrying === null ? '' : `, ${m.with_cargo()}`
      }`,
    );
    const spell = entity.spell === null ? undefined : world.defs.get(entity.spell);

    if (spell) {
      say(
        `${m.spell_fact({ name: unitName(spell.id, spell.name), range: spell.range })}${
          entity.casting > 0
            ? ` — ${m.casting({ seconds: Math.ceil(entity.casting / TPS) })}`
            : ''
        }`,
      );
    }

    if (entity.owner === me) {
      if (spell) {
        actions.push({
          kind: 'cast',
          label: m.action_cast({ name: unitName(spell.id, spell.name) }),
          cost: spell.cost,
        });
      }

      say(m.transport_hint(), true);
    }
  } else if (entity.kind === 'priest') {
    say(
      `${PRIEST_STATES[entity.state]?.() ?? entity.state}${
        entity.carrying === null ? '' : `, ${m.with_crystal()}`
      }`,
    );

    if (entity.state === 'chained') {
      say(m.runes({ runes: entity.runes, total: RUNES }));
    }

    if (entity.owner === me && entity.state === 'normal') {
      say(m.priest_hint(), true);
      // "Use your High Priest to build Temples, Workshops, and Altars."
      const player = world.players.get(me);
      const theme = player?.theme;

      // The Outpost is offered to a side that has it: in the original, in multiplayer only.
      for (const id of [`${theme}vortex`, `${theme}factory`, 'sunfactory', 'altar', OUTPOST]) {
        const def = world.defs.get(id);

        if (def && (id !== OUTPOST || player?.tech.has(OUTPOST))) {
          actions.push({
            kind: 'build',
            type: def.id,
            label: m.action_build({ name: unitName(def.id, def.name) }),
            cost: def.cost,
          });
        }
      }
    }
  } else if (entity.kind === 'flyer') {
    say(entity.returning
      ? m.flyer_returning()
      : m.flyer_life({ seconds: Math.ceil(entity.life / TPS) }));
  } else if (entity.kind === 'geyser') {
    say(entity.stock > 0 ? m.geyser_stock({ stock: entity.stock }) : m.geyser_depleted());
  } else if (entity.kind === 'obelisk') {
    const spell = world.defs.get(entity.spell);
    say(m.obelisk_fact({
      cls: className(spell?.cls ?? ''),
      range: spell?.range ?? 0,
      cost: spell?.cost ?? 0,
    }));
    say(m.obelisk_hint(), true);
  }

  if ('hp' in entity && entity.paralyzed > 0) {
    say(m.paralyzed({ seconds: Math.ceil(entity.paralyzed / TPS) }));
  }

  if ('hp' in entity && entity.invisible > 0) {
    say(m.invisible({ seconds: Math.ceil(entity.invisible / TPS) }));
  }

  // "Right-click a cargo-carrying Transport, and choose 'Drop ...'."
  if (
    (entity.kind === 'transport' || entity.kind === 'priest') && entity.owner === me
    && entity.carrying !== null
  ) {
    actions.push({ kind: 'drop', label: m.action_drop() });
  }

  if ((entity.kind === 'building' || entity.kind === 'transport') && entity.owner === me) {
    actions.push({ kind: 'salvage', label: m.hud_salvage(), key: 'Del' });
    // Offered as in the original: a Generator of a Fury, with more than half of its hit points.
    const def = entity.kind === 'building' ? world.defs.get(entity.type) : undefined;

    if (
      entity.kind === 'building' && def?.group === 'battery' && def.theme !== 'sun'
      && entity.rising === 0 && entity.hp * 2 > entity.hpMax
    ) {
      actions.push({ kind: 'meltdown', label: 'Meltdown!' });
    }
  }

  const share = 'hp' in entity && entity.hpMax > 0 ? entity.hp / entity.hpMax : 0;
  return {
    type: 'type' in entity ? entity.type : entity.kind,
    theme: 'type' in entity ? world.defs.get(entity.type)?.theme ?? null : null,
    name: entityName(world, entity),
    owner: owner && ownerId !== null
      ? {
        name: owner.name,
        side: ownerId === me || !world.hostile(me, ownerId) ? 'own' : 'enemy',
      }
      : null,
    hp: 'hp' in entity
      ? { value: Math.ceil(entity.hp), max: entity.hpMax, share, band: healthBand(share) }
      : null,
    facts,
    actions: ui.watching ? [] : actions,
  };
}

/** The colour of a health bar: green, then amber below a half, red below a quarter. */
function healthBand(share: number): 'high' | 'mid' | 'low' {
  if (share > HALF) {
    return 'high';
  }

  return share > QUARTER ? 'mid' : 'low';
}

/** How a building fights, in the numbers the simulation uses. */
function combat(
  def: Readonly<UnitDef> | undefined,
  hpMax: number,
  say: (text: string, muted?: boolean) => void,
): void {
  if (!def) {
    return;
  }

  if (def.dps && def.range) {
    say(m.weapon({ dps: def.dps, interval: shotInterval(def) / TPS, range: def.range }));
  }

  const blast = blastDamage(def, hpMax);

  if (blast) {
    say(m.blast({ blast }), true);
  }
}

function hint(world: WorldView, ui: UiState): string {
  switch (ui.tool.kind) {
    case 'piece':
      return m.hint_piece();
    case 'build':
      return world.defs.get(ui.tool.type)?.cls.endsWith('Transport')
        ? m.hint_build_transport()
        : `${m.hint_build()}${
          hasFacing(world.def(ui.tool.type)) ? ` ${m.hint_build_facing()}` : ''
        }`;
    case 'salvage':
      return m.hint_salvage();
    case 'select':
      return m.hint_select();
  }
}

export function entityName(world: WorldView, entity: DeepReadonly<Entity>): string {
  switch (entity.kind) {
    case 'building':
    case 'transport':
    case 'flyer':
      return unitName(entity.type, world.defs.get(entity.type)?.name ?? entity.type);
    case 'priest':
      return unitName('priest', 'High Priest');
    case 'geyser':
      return unitName('geyser', 'Storm Geyser');
    case 'crystal':
      return m.crystal_name({ value: entity.value });
    case 'obelisk':
      return m.obelisk_name({
        name: unitName(entity.spell, world.defs.get(entity.spell)?.name ?? entity.spell),
      });
  }
}
