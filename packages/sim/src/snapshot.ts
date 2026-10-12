import { UNIT_CLASSES, UNIT_GROUPS, type UnitDef } from './defs.js';
import type { Entity, Player } from './state.js';
import {
  LINK_ALL,
  W,
  H,
  PIECES,
  PIECE_HARD,
  FACINGS,
  MAX_ID,
  MAX_PLAYERS,
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

export const SNAPSHOT_VERSION = 11;
export const RULES_VERSION = 21;

export type SnapshotPlayer = Omit<Player, 'tech'> & { tech: string[]; };

/** JSON-safe authoritative state. Array order preserves Map insertion order. */
export interface WorldSnapshot {
  formatVersion: number;
  rulesVersion: number;
  tick: number;
  rngState: number;
  nextId: number;
  winner: number | null;
  terrain: number[];
  owner: number[];
  links: number[];
  occupant: number[];
  defs: UnitDef[];
  entities: Entity[];
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
  const kind = choice(value.kind, ['building', 'transport', 'priest', 'crystal', 'geyser'],
    'entity.kind');
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

  const owner = integer(value.owner, 'entity.owner', 0, MAX_PLAYERS);
  const hp = finite(value.hp, 'entity.hp');
  const hpMax = finite(value.hpMax, 'entity.hpMax');

  if (hp > hpMax) {
    throw new TypeError('Entity HP exceeds maximum');
  }

  const living = [...common, 'owner', 'hp', 'hpMax'];

  if (kind === 'building') {
    keys(value, [...living, 'type', 'fx', 'fy', 'facing', 'target', 'cooldown', 'killer'],
      'building');
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
      killer: integer(value.killer, 'building.killer', 0, MAX_PLAYERS),
    };
  }

  if (kind === 'transport') {
    keys(value, [...living, 'type', 'carrying', 'path', 'move', 'goal', 'target'], 'transport');
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
      goal: choice(value.goal, ['idle', 'collect', 'pickup', 'home', 'capture', 'altar'],
        'transport.goal'),
      target: nullableId(value.target, 'transport.target'),
    };
  }

  keys(value, [...living, 'state', 'carriedBy', 'chainedAt', 'runes', 'runeTimer', 'path', 'move'],
    'priest');
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
  };
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
        age: integer(entry.age, 'piece.age', 0, PIECE_HARD),
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
    'terrain',
    'owner',
    'links',
    'occupant',
    'defs',
    'entities',
    'players',
  ], 'snapshot');

  if (value.formatVersion !== SNAPSHOT_VERSION || value.rulesVersion !== RULES_VERSION) {
    throw new TypeError('Unsupported snapshot or rules version');
  }

  const defs = list(value.defs, 'snapshot.defs').map(parseDef);
  const entities = list(value.entities, 'snapshot.entities').map(parseEntity);
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
    terrain: grid(value.terrain, 'terrain', Terrain.HardBridge),
    owner: grid(value.owner, 'owner', MAX_PLAYERS),
    links: grid(value.links, 'links', LINK_ALL),
    occupant: grid(value.occupant, 'occupant', MAX_ID),
    defs,
    entities,
    players,
  };
}
