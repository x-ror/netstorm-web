import { UNIT_CLASSES, UNIT_GROUPS, type UnitDef } from './defs.js';
import type { Entity, GeyserState, Player, Shot, SpellOption } from './state.js';
import {
  BRIDGE_SETS,
  BRIDGE_SLOTS,
  GEYSER_INTERVALS,
  GEYSER_PLACEMENTS,
  GEYSER_RESPAWNS,
  GEYSER_STOCKS,
  GEYSER_ZONES,
  SPELL_OPTIONS,
  KILL_REWARDS,
  UNIT_RATES,
  LINK_ALL,
  WEAR_FULL,
  W,
  H,
  PIECES,
  PIECE_HARDEN,
  FACINGS,
  MAX_ID,
  MAX_PLAYERS,
  MAX_ALTAR_UPGRADES,
  MAX_UPGRADES,
  MAX_UINT32,
  Terrain,
} from './state.js';
import {
  boolean,
  choice,
  finite,
  integer,
  keys,
  list,
  nullableId,
  record,
  text,
} from './validation.js';

export const SNAPSHOT_VERSION = 38;
export const RULES_VERSION = 70;

export type SnapshotPlayer = Omit<Player, 'tech'> & { tech: string[]; };

/** JSON-safe authoritative state. Array order preserves Map insertion order. */
export interface WorldSnapshot {
  formatVersion: number;
  rulesVersion: number;
  tick: number;
  rngState: number;
  nextId: number;
  winner: number | null;
  bridgeSet: number;
  bridgeSlots: number;
  unitRate: number;
  killReward: number;
  geyserStock: number;
  anyCapture: boolean;
  multiplayer: boolean;
  spells: SpellOption;
  obelisks: { left: number; next: number; };
  geysers: GeyserState;
  terrain: number[];
  owner: number[];
  links: number[];
  wear: number[];
  occupant: number[];
  defs: UnitDef[];
  entities: Entity[];
  shots: Shot[];
  /** Top-left cells of the Residences, which nothing can harm or move. */
  residences: [number, number][];
  players: SnapshotPlayer[];
}

function parseDef(raw: unknown): UnitDef {
  const value = record(raw, 'definition');
  keys(value, [
    'id',
    'name',
    'cls',
    'theme',
    'level',
    'cost',
    'hp',
    'range',
    'dps',
    'footX',
    'footY',
    'speed',
    'group',
    'delay',
    'lifeSpan',
    'airRange',
    'airDamage',
    'createsIsland',
    'castTime',
    'prayTime',
    'effectTime',
    'spawns',
  ], 'definition');
  const id = text(value.id, 'definition.id');

  if (!id || id !== id.toLowerCase()) {
    throw new TypeError('Invalid definition id');
  }

  return {
    id,
    name: text(value.name, 'definition.name'),
    cls: choice(value.cls, UNIT_CLASSES, 'definition.cls'),
    theme: value.theme === null
      ? null
      : choice(value.theme, ['sun', 'wind', 'rain', 'thunder'], 'definition.theme'),
    level: integer(value.level, 'definition.level'),
    cost: finite(value.cost, 'definition.cost'),
    hp: finite(value.hp, 'definition.hp'),
    range: finite(value.range, 'definition.range'),
    dps: finite(value.dps, 'definition.dps'),
    footX: integer(value.footX, 'definition.footX', 0, W),
    footY: integer(value.footY, 'definition.footY', 0, H),
    speed: finite(value.speed, 'definition.speed'),
    group: choice(value.group, UNIT_GROUPS, 'definition.group'),
    delay: finite(value.delay, 'definition.delay'),
    lifeSpan: finite(value.lifeSpan, 'definition.lifeSpan'),
    airRange: finite(value.airRange, 'definition.airRange'),
    airDamage: finite(value.airDamage, 'definition.airDamage'),
    createsIsland: boolean(value.createsIsland, 'definition.createsIsland'),
    castTime: finite(value.castTime, 'definition.castTime'),
    prayTime: finite(value.prayTime, 'definition.prayTime'),
    effectTime: finite(value.effectTime, 'definition.effectTime'),
    spawns: integer(value.spawns, 'definition.spawns'),
  };
}

function parsePath(raw: unknown): [number, number][] {
  return list(raw, 'path').map((cell) => {
    const pair = list(cell, 'path cell');

    if (pair.length !== 2) {
      throw new TypeError('Path cell must have two coordinates');
    }

    return [integer(pair[0], 'path.x', 0, W - 1), integer(pair[1], 'path.y', 0, H - 1)];
  });
}

function parseEntity(raw: unknown): Entity {
  const value = record(raw, 'entity');
  const kind = choice(value.kind, [
    'building',
    'transport',
    'priest',
    'crystal',
    'geyser',
    'flyer',
    'obelisk',
  ], 'entity.kind');
  const id = integer(value.id, 'entity.id', 1, MAX_ID);
  const x = integer(value.x, 'entity.x', 0, W - 1);
  const y = integer(value.y, 'entity.y', 0, H - 1);
  const common = ['id', 'kind', 'x', 'y'];

  if (kind === 'crystal') {
    keys(value, [...common, 'value', 'carriedBy'], 'crystal');
    return {
      id,
      kind,
      x,
      y,
      value: integer(value.value, 'crystal.value', 1),
      carriedBy: nullableId(value.carriedBy, 'crystal.carriedBy'),
    };
  }

  if (kind === 'geyser') {
    keys(value, [...common, 'stock'], 'geyser');
    return {
      id,
      kind,
      x,
      y,
      stock: integer(value.stock, 'geyser.stock'),
    };
  }

  if (kind === 'obelisk') {
    keys(value, [...common, 'spell'], 'obelisk');
    return { id, kind, x, y, spell: text(value.spell, 'obelisk.spell') };
  }

  const owner = integer(value.owner, 'entity.owner', 0, MAX_PLAYERS);
  const hp = finite(value.hp, 'entity.hp');
  const hpMax = finite(value.hpMax, 'entity.hpMax');

  if (hp > hpMax) {
    throw new TypeError('Entity HP exceeds maximum');
  }

  const living = [...common, 'owner', 'hp', 'hpMax', 'paralyzed', 'invisible'];
  const paralyzed = integer(value.paralyzed, 'entity.paralyzed', 0);
  const invisible = integer(value.invisible, 'entity.invisible', 0);

  if (kind === 'building') {
    keys(value, [
      ...living,
      'type',
      'fx',
      'fy',
      'facing',
      'target',
      'cooldown',
      'barrel',
      'lastShot',
      'burst',
      'killer',
      'islet',
      'regrow',
      'rising',
      'builder',
      'slots',
      'upgrades',
      'upgrading',
      'gift',
    ], 'building');
    return {
      id,
      kind,
      type: text(value.type, 'building.type'),
      owner,
      x,
      y,
      fx: integer(value.fx, 'building.fx', 0, W),
      fy: integer(value.fy, 'building.fy', 0, H),
      hp,
      hpMax,
      facing: choice(value.facing, FACINGS, 'building.facing'),
      target: nullableId(value.target, 'building.target'),
      cooldown: integer(value.cooldown, 'building.cooldown'),
      barrel: integer(value.barrel, 'building.barrel', -1),
      lastShot: integer(value.lastShot, 'building.lastShot', -1),
      burst: integer(value.burst, 'building.burst', -1),
      killer: integer(value.killer, 'building.killer', 0, MAX_PLAYERS),
      islet: boolean(value.islet, 'building.islet'),
      regrow: integer(value.regrow, 'building.regrow', 0),
      rising: integer(value.rising, 'building.rising', 0),
      builder: nullableId(value.builder, 'building.builder'),
      paralyzed,
      invisible,
      slots: list(value.slots, 'building.slots').map((slot) => text(slot, 'building.slot')),
      upgrades: integer(value.upgrades, 'building.upgrades', 0, MAX_UPGRADES),
      upgrading: integer(value.upgrading, 'building.upgrading', 0),
      gift: text(value.gift, 'building.gift'),
    };
  }

  if (kind === 'flyer') {
    keys(value, [
      ...living,
      'type',
      'px',
      'py',
      'home',
      'hx',
      'hy',
      'target',
      'life',
      'cooldown',
      'returning',
    ], 'flyer');
    return {
      id,
      kind,
      type: text(value.type, 'flyer.type'),
      owner,
      x,
      y,
      px: integer(value.px, 'flyer.px', 0),
      py: integer(value.py, 'flyer.py', 0),
      hp,
      hpMax,
      home: nullableId(value.home, 'flyer.home'),
      hx: integer(value.hx, 'flyer.hx', 0),
      hy: integer(value.hy, 'flyer.hy', 0),
      target: nullableId(value.target, 'flyer.target'),
      life: integer(value.life, 'flyer.life'),
      cooldown: integer(value.cooldown, 'flyer.cooldown', 0),
      returning: boolean(value.returning, 'flyer.returning'),
      paralyzed,
      invisible,
    };
  }

  if (kind === 'transport') {
    keys(value, [
      ...living,
      'type',
      'carrying',
      'path',
      'move',
      'goal',
      'target',
      'spell',
      'casting',
      'aloft',
      'climbing',
    ], 'transport');
    return {
      id,
      kind,
      type: text(value.type, 'transport.type'),
      owner,
      x,
      y,
      hp,
      hpMax,
      carrying: nullableId(value.carrying, 'transport.carrying'),
      path: parsePath(value.path),
      move: integer(value.move, 'transport.move'),
      goal: choice(value.goal, [
        'idle',
        'collect',
        'pickup',
        'home',
        'capture',
        'altar',
        'obelisk',
      ], 'transport.goal'),
      target: nullableId(value.target, 'transport.target'),
      spell: value.spell === null ? null : text(value.spell, 'transport.spell'),
      casting: integer(value.casting, 'transport.casting', 0),
      aloft: boolean(value.aloft, 'transport.aloft'),
      climbing: integer(value.climbing, 'transport.climbing', 0),
      paralyzed,
      invisible,
    };
  }

  keys(value, [
    ...living,
    'state',
    'carriedBy',
    'chainedAt',
    'runes',
    'runeTimer',
    'path',
    'move',
    'carrying',
    'goal',
    'target',
    'spell',
    'prayer',
    'praying',
    'casting',
  ], 'priest');
  return {
    id,
    kind,
    owner,
    x,
    y,
    hp,
    hpMax,
    state: choice(value.state, ['normal', 'down', 'carried', 'chained'], 'priest.state'),
    carriedBy: nullableId(value.carriedBy, 'priest.carriedBy'),
    chainedAt: nullableId(value.chainedAt, 'priest.chainedAt'),
    runes: integer(value.runes, 'priest.runes'),
    runeTimer: integer(value.runeTimer, 'priest.runeTimer'),
    path: parsePath(value.path),
    move: integer(value.move, 'priest.move'),
    carrying: nullableId(value.carrying, 'priest.carrying'),
    goal: choice(value.goal, ['idle', 'collect', 'pickup', 'home', 'build'], 'priest.goal'),
    target: nullableId(value.target, 'priest.target'),
    spell: value.spell === null ? null : text(value.spell, 'priest.spell'),
    prayer: value.prayer === null ? null : text(value.prayer, 'priest.prayer'),
    praying: integer(value.praying, 'priest.praying'),
    casting: integer(value.casting, 'priest.casting'),
    paralyzed,
    invisible,
  };
}

function parseShot(raw: unknown): Shot {
  const value = record(raw, 'shot');
  keys(value, ['gun', 'target', 'x', 'y', 'amount', 'leave', 'land', 'blocked', 'ricochet'],
    'shot');
  const gun = parseEntity(value.gun);

  if (gun.kind !== 'building') {
    throw new TypeError('Shot fired by something other than a gun');
  }

  return {
    gun,
    target: integer(value.target, 'shot.target', 1, MAX_ID),
    x: integer(value.x, 'shot.x', 0, W - 1),
    y: integer(value.y, 'shot.y', 0, H - 1),
    amount: finite(value.amount, 'shot.amount'),
    leave: integer(value.leave, 'shot.leave'),
    land: integer(value.land, 'shot.land'),
    blocked: boolean(value.blocked, 'shot.blocked'),
    ricochet: boolean(value.ricochet, 'shot.ricochet'),
  };
}

function parseResidence(raw: unknown): [number, number] {
  const [x, y, ...rest] = list(raw, 'residence');

  if (rest.length > 0) {
    throw new TypeError('residence must be [x, y]');
  }

  return [integer(x, 'residence.x', 0, W - 1), integer(y, 'residence.y', 0, H - 1)];
}

function parsePlayer(raw: unknown): SnapshotPlayer {
  const value = record(raw, 'player');
  keys(value, [
    'id',
    'name',
    'theme',
    'storm',
    'tech',
    'hand',
    'pieceTimer',
    'piecesDrawn',
    'refresh',
    'alive',
    'allies',
    'income',
    'altarLevel',
  ], 'player');
  const tech = list(value.tech, 'player.tech').map((entry) => text(entry, 'technology'));
  unique(tech, (entry) => entry, 'technology');
  return {
    id: integer(value.id, 'player.id', 1, MAX_PLAYERS),
    name: text(value.name, 'player.name'),
    theme: choice(value.theme, ['sun', 'wind', 'rain', 'thunder'], 'player.theme'),
    storm: finite(value.storm, 'player.storm'),
    tech,
    hand: list(value.hand, 'player.hand').map((rawPiece) => {
      const entry = record(rawPiece, 'hand piece');
      keys(entry, ['piece', 'age'], 'hand piece');
      return {
        piece: integer(entry.piece, 'piece', 0, PIECES.length - 1),
        age: integer(entry.age, 'piece.age', 0, PIECE_HARDEN),
      };
    }),
    pieceTimer: integer(value.pieceTimer, 'player.pieceTimer', -Number.MAX_SAFE_INTEGER),
    piecesDrawn: integer(value.piecesDrawn, 'player.piecesDrawn', 0),
    refresh: list(value.refresh, 'player.refresh').map((rawEntry) => {
      const entry = record(rawEntry, 'refresh');
      keys(entry, ['type', 'ticks'], 'refresh');
      return {
        type: text(entry.type, 'refresh.type'),
        ticks: integer(entry.ticks, 'refresh.ticks', 1),
      };
    }),
    alive: boolean(value.alive, 'player.alive'),
    allies: list(value.allies, 'player.allies').map((ally) =>
      integer(ally, 'player.ally', 1, MAX_PLAYERS)
    ),
    income: finite(value.income, 'player.income'),
    altarLevel: integer(value.altarLevel, 'player.altarLevel', 1, MAX_ALTAR_UPGRADES + 1),
  };
}

function unique<T>(values: T[], id: (value: T) => string | number, label: string): void {
  const ids = new Set<string | number>();

  for (const value of values) {
    const key = id(value);

    if (ids.has(key)) {
      throw new TypeError(`Duplicate ${label}: ${key}`);
    }

    ids.add(key);
  }
}

function grid(raw: unknown, label: string, max: number): number[] {
  const values = list(raw, label);

  if (values.length !== W * H) {
    throw new TypeError(`Invalid ${label} dimensions`);
  }

  return values.map((value) => integer(value, label, 0, max));
}

function parseObelisks(raw: unknown): { left: number; next: number; } {
  const value = record(raw, 'obelisks');
  keys(value, ['left', 'next'], 'obelisks');
  return { left: integer(value.left, 'obelisks.left'), next: integer(value.next, 'obelisks.next') };
}

function parseGeysers(raw: unknown): GeyserState {
  const value = record(raw, 'geysers');
  keys(value, [
    'placement',
    'interval',
    'respawn',
    'floor',
    'pool',
    'loose',
    'next',
    'made',
    'seed',
  ], 'geysers');
  const pool = list(value.pool, 'geysers.pool').map((p) => integer(p, 'geysers.pool', -MAX_UINT32));

  if (pool.length !== GEYSER_ZONES + 1) {
    throw new TypeError('Invalid geysers.pool length');
  }

  return {
    placement: choice(value.placement, GEYSER_PLACEMENTS, 'geysers.placement'),
    // The campaign's 30 s is one of the option's values.
    interval: choice(value.interval, GEYSER_INTERVALS, 'geysers.interval'),
    respawn: choice(value.respawn, GEYSER_RESPAWNS, 'geysers.respawn'),
    floor: integer(value.floor, 'geysers.floor'),
    pool,
    loose: integer(value.loose, 'geysers.loose', -MAX_UINT32),
    next: integer(value.next, 'geysers.next'),
    made: integer(value.made, 'geysers.made'),
    seed: integer(value.seed, 'geysers.seed', 0, MAX_UINT32),
  };
}

/** Validate and detach all data. Cross-reference invariants are checked by World.fromSnapshot. */
export function parseSnapshot(raw: unknown): WorldSnapshot {
  const value = record(raw, 'snapshot');
  keys(value, [
    'formatVersion',
    'rulesVersion',
    'tick',
    'rngState',
    'nextId',
    'winner',
    'bridgeSet',
    'bridgeSlots',
    'unitRate',
    'killReward',
    'geyserStock',
    'anyCapture',
    'multiplayer',
    'spells',
    'obelisks',
    'geysers',
    'terrain',
    'owner',
    'links',
    'wear',
    'occupant',
    'defs',
    'entities',
    'shots',
    'residences',
    'players',
  ], 'snapshot');

  if (value.formatVersion !== SNAPSHOT_VERSION || value.rulesVersion !== RULES_VERSION) {
    throw new TypeError('Unsupported snapshot or rules version');
  }

  const defs = list(value.defs, 'snapshot.defs').map(parseDef);
  const entities = list(value.entities, 'snapshot.entities').map(parseEntity);
  const shots = list(value.shots, 'snapshot.shots').map(parseShot);
  const residences = list(value.residences, 'snapshot.residences').map(parseResidence);
  const players = list(value.players, 'snapshot.players').map(parsePlayer);
  unique(defs, (def) => def.id, 'definition');
  unique(entities, (entity) => entity.id, 'entity');
  unique(players, (player) => player.id, 'player');
  const nextId = integer(value.nextId, 'snapshot.nextId', 1, MAX_ID);

  if (entities.some((entity) => entity.id >= nextId)) {
    throw new TypeError('Invalid next entity id');
  }

  return {
    formatVersion: SNAPSHOT_VERSION,
    rulesVersion: RULES_VERSION,
    tick: integer(value.tick, 'snapshot.tick'),
    rngState: integer(value.rngState, 'snapshot.rngState', 0, MAX_UINT32),
    nextId,
    winner: nullableId(value.winner, 'snapshot.winner'),
    bridgeSet: integer(value.bridgeSet, 'snapshot.bridgeSet', 0, BRIDGE_SETS.length - 1),
    bridgeSlots: choice(value.bridgeSlots, BRIDGE_SLOTS, 'snapshot.bridgeSlots'),
    unitRate: choice(value.unitRate, UNIT_RATES, 'snapshot.unitRate'),
    killReward: choice(value.killReward, KILL_REWARDS, 'snapshot.killReward'),
    geyserStock: choice(value.geyserStock, GEYSER_STOCKS, 'snapshot.geyserStock'),
    anyCapture: boolean(value.anyCapture, 'snapshot.anyCapture'),
    multiplayer: boolean(value.multiplayer, 'snapshot.multiplayer'),
    spells: choice(value.spells, SPELL_OPTIONS, 'snapshot.spells'),
    obelisks: parseObelisks(value.obelisks),
    geysers: parseGeysers(value.geysers),
    terrain: grid(value.terrain, 'terrain', Terrain.HardBridge),
    owner: grid(value.owner, 'owner', MAX_PLAYERS),
    links: grid(value.links, 'links', LINK_ALL),
    wear: grid(value.wear, 'wear', WEAR_FULL),
    occupant: grid(value.occupant, 'occupant', MAX_ID),
    defs,
    entities,
    shots,
    residences,
    players,
  };
}
