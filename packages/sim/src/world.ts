/**
 * NetStorm simulation core — deterministic, fixed-tick, engine-agnostic.
 *
 * Rules reproduced from the original (see project doc "Ядро механіки"):
 *  - the world is a 256×256 cell grid of sky; players own islands; everything else is reached by bridges
 *  - the temple hands out the original's bridge pieces, drawn by weight; a piece may only be dropped on sky cells
 *    touching the player's own island or bridges
 *  - combat units are buildings: placed on own island/bridge cells, never move. They fire separate shots at
 *    the closest target and stay locked on it. Cannons fire along a line (the Sun Cannon turns itself to
 *    one of four directions), disc throwers / anti-air in a radius; buildings in the way stop line fire
 *  - transports loop between a Storm Geyser and the Temple, carrying crystals until the geyser is depleted,
 *    then move on to the non-depleted geyser closest to the Temple
 *  - the High Priest cannot be killed by units, only immobilized at ≤50 % HP; an enemy transport then
 *    carries him to its altar, where the enemy priest wards five runes to sacrifice him → that
 *    player is defeated
 *
 * docs/game-rules.md lists every rule of the original with its source and how this code differs.
 *
 * Approximations still to verify against the original (marked TODO):
 *  - energy: generators give 1 energy of their theme, a temple 2; a unit needs energy per its level but does
 *    not consume it permanently (original: "once built units don't consume energy")
 */
import { hashWorld } from './checksum.js';
import { dropPiece, pieceSite, type PieceCommand } from './rules/bridges.js';
import { tickBuilding } from './rules/combat.js';
import { tickPlayer } from './rules/economy.js';
import { energy, canBuild, build, salvage } from './rules/building.js';
import { tickTransport, collect, pickupCrystal } from './rules/movement.js';
import { tickPriest, movePriest } from './rules/priest.js';
import { capturePriest } from './rules/capture.js';
import { Pathfinder } from './spatial/pathfinding.js';
import { CellIndex } from './cell-index.js';
import { Rng } from './rng.js';
import { type DefTable, type UnitDef, type UnitGroup, type Theme } from './defs.js';
import {
  W,
  H,
  PIECE_INTERVAL,
  GEYSER_STOCK,
  PRIEST_HP,
  MAX_FACING,
  Terrain,
  type Player,
  type Building,
  type Transport,
  type Priest,
  type Crystal,
  type Geyser,
  type Entity,
  type Facing,
} from './state.js';
import type { Command, CommandError, CommandResult } from './commands.js';
import type { Event, EventInput } from './events.js';
import type { WorldView } from './view.js';
import { parseSnapshot, SNAPSHOT_VERSION, RULES_VERSION, type WorldSnapshot } from './snapshot.js';
import { assertWorldInvariants } from './invariants.js';
export * from './state.js';

export const GEYSER_ISLAND_SIZE = 3; // neutral island a geyser sits on
export * from './commands.js';
export * from './events.js';

export class World {
  tick = 0;
  /** Derived presentation counter, excluded from the authoritative hash. */
  terrainRevision = 0;
  readonly terrain = new Uint8Array(W * H);
  readonly owner = new Uint8Array(W * H); // island/bridge owner
  readonly occupant = new Int32Array(W * H); // entity id occupying the cell, 0 = none
  readonly entities = new Map<number, Entity>();
  readonly players = new Map<number, Player>();
  readonly events: Event[] = [];
  private nextId = 1;
  private readonly transports = new CellIndex<Transport>(W, H);
  private readonly pathfinder = new Pathfinder();
  readonly rng: Rng;
  winner: number | null = null;

  constructor(
    public readonly defs: DefTable,
    seed: number,
  ) {
    this.rng = new Rng(seed);
  }

  static fromSnapshot(raw: unknown): World {
    const snapshot = parseSnapshot(raw);
    const world = new World(new Map(snapshot.defs.map((def) => [def.id, def])), snapshot.rngState);
    world.tick = snapshot.tick;
    world.nextId = snapshot.nextId;
    world.winner = snapshot.winner;
    world.terrain.set(snapshot.terrain);
    world.owner.set(snapshot.owner);
    world.occupant.set(snapshot.occupant);

    for (const entity of snapshot.entities) {
      world.entities.set(entity.id, entity);
    }

    for (const player of snapshot.players) {
      world.players.set(player.id, { ...player, tech: new Set(player.tech) });
    }

    assertWorldInvariants(world);
    return world;
  }

  snapshot(): WorldSnapshot {
    assertWorldInvariants(this);
    return parseSnapshot({
      formatVersion: SNAPSHOT_VERSION,
      rulesVersion: RULES_VERSION,
      tick: this.tick,
      rngState: this.rng.state(),
      nextId: this.nextId,
      winner: this.winner,
      terrain: Array.from(this.terrain),
      owner: Array.from(this.owner),
      occupant: Array.from(this.occupant),
      defs: [...this.defs.values()],
      entities: [...this.entities.values()],
      players: [...this.players.values()].map((player) => ({ ...player, tech: [...player.tech] })),
    });
  }

  // ---------- setup ----------
  addPlayer(id: number, name: string, theme: Theme, storm: number, tech: string[]): Player {
    const p: Player = {
      id,
      name,
      theme,
      storm,
      tech: new Set(tech.map((t) => t.toLowerCase())),
      hand: [],
      pieceTimer: PIECE_INTERVAL,
      piecesDrawn: 0,
      refresh: [],
      alive: true,
    };
    this.players.set(id, p);
    return p;
  }

  /** Fill a rectangle with island cells owned by `owner` (0 = neutral geyser islet). */
  addIsland(x0: number, y0: number, w: number, h: number, owner: number): void {
    this.invalidateTerrain();

    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (this.inside(x, y)) {
          this.terrain[y * W + x] = Terrain.Island;
          this.owner[y * W + x] = owner;
        }
      }
    }
  }

  addGeyser(x: number, y: number, stock = GEYSER_STOCK): Geyser {
    this.addIsland(x - 1, y - 1, GEYSER_ISLAND_SIZE, GEYSER_ISLAND_SIZE, 0);
    const g: Geyser = {
      id: this.nextId++,
      kind: 'geyser',
      x,
      y,
      stock,
    };
    this.entities.set(g.id, g);
    this.occupant[y * W + x] = g.id;
    return g;
  }

  addPriest(owner: number, x: number, y: number): Priest {
    const p: Priest = {
      id: this.nextId++,
      kind: 'priest',
      owner,
      x,
      y,
      hp: PRIEST_HP,
      hpMax: PRIEST_HP,
      state: 'normal',
      carriedBy: null,
      chainedAt: null,
      runes: 0,
      runeTimer: 0,
      path: [],
      move: 0,
    };
    this.entities.set(p.id, p);
    this.occupant[y * W + x] = p.id;
    return p;
  }

  /** Place a building ignoring rules (scenario setup). */
  spawnBuilding(type: string, owner: number, x: number, y: number, facing: Facing = 0): Building {
    const def = this.def(type);
    const b: Building = {
      id: this.nextId++,
      kind: 'building',
      type: def.id,
      owner,
      x,
      y,
      fx: def.footX,
      fy: def.footY,
      hp: def.hp,
      hpMax: def.hp,
      facing,
      target: null,
      cooldown: 0,
      killer: 0,
    };
    this.entities.set(b.id, b);
    this.forFoot(b, (i) => {
      this.occupant[i] = b.id;
    });
    return b;
  }

  spawnTransport(type: string, owner: number, x: number, y: number): Transport {
    const def = this.def(type);
    const t: Transport = {
      id: this.nextId++,
      kind: 'transport',
      type: def.id,
      owner,
      x,
      y,
      hp: def.hp,
      hpMax: def.hp,
      carrying: null,
      path: [],
      move: 0,
      goal: 'idle',
      target: null,
    };
    this.entities.set(t.id, t);
    return t; // transports do not block cells
  }

  // ---------- queries ----------
  def(type: string): UnitDef {
    const d = this.defs.get(type.toLowerCase());

    if (!d) {
      throw new Error('unknown unit ' + type);
    }

    return d;
  }

  inside(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < W && y < H;
  }

  at(x: number, y: number): number {
    return y * W + x;
  }

  isOwnGround(p: number, x: number, y: number): boolean {
    return (
      this.inside(x, y)
      && this.terrain[this.at(x, y)] !== Terrain.Sky
      && this.owner[this.at(x, y)] === p
    );
  }

  /** Walkable for a transport/priest: any island or bridge cell without a building, whoever owns it.
   * The help has transports heading for geysers "even in enemy territory" and fetching enemy
   * priests, so ownership does not restrict movement; the player argument is kept for callers.
   * Priests also occupy a cell, so they additionally avoid geysers and other priests. */
  walkable(_player: number, x: number, y: number): boolean {
    if (!this.inside(x, y)) {
      return false;
    }

    const i = this.at(x, y);
    const t = this.terrain[i];

    if (t === Terrain.Sky) {
      return false;
    }

    const occ = this.entities.get(this.occupant[i] ?? 0);

    return !occ || occ.kind !== 'building';
  }

  private forFoot(b: Building, f: (i: number) => void): void {
    for (let y = b.y; y < b.y + b.fy; y++) {
      for (let x = b.x; x < b.x + b.fx; x++) {
        f(this.at(x, y));
      }
    }
  }

  building(id: number): Building | undefined {
    const e = this.entities.get(id);
    return e?.kind === 'building' ? e : undefined;
  }

  priestOf(p: number): Priest | undefined {
    for (const e of this.entities.values()) {
      if (e.kind === 'priest' && e.owner === p) {
        return e;
      }
    }

    return undefined;
  }

  /** The player's Temple: the building of class Energy. */
  templeOf(p: number): Building | undefined {
    return this.buildingsOf(p).find((b) => this.def(b.type).cls === 'Energy');
  }

  buildingsOf(p: number, group?: UnitGroup): Building[] {
    const r: Building[] = [];

    for (const e of this.entities.values()) {
      if (e.kind === 'building' && e.owner === p && (!group || this.def(e.type).group === group)) {
        r.push(e);
      }
    }

    return r;
  }

  energy(p: number): { own: number; total: number; } {
    return energy(this, p);
  }

  view(): WorldView {
    return this;
  }

  canBuild(command: {
    player: number;
    type: string;
    x: number;
    y: number;
    facing?: number;
  }): CommandError | null {
    return canBuild(this, command);
  }

  canDropPiece(command: PieceCommand): CommandError | null {
    if (!this.players.get(command.player)?.alive) {
      return 'no player';
    }

    if (this.winner !== null) {
      return 'game over';
    }

    const site = pieceSite(this, command);
    return 'error' in site ? site.error : null;
  }

  /** Internal rule hook; gameplay callers must use commands. */
  moveTransportIndex(transport: Transport, previousX: number, previousY: number): void {
    this.transports.move(transport, previousX, previousY);
  }

  // ---------- commands ----------
  execute(command: Command): CommandResult {
    const error = this.apply(command);
    return error === null ? { ok: true } : { ok: false, error };
  }

  /** Legacy setup/debug API. Runtime command submission uses execute/step. */
  apply(c: Command): CommandError | null {
    const pl = this.players.get(c.player);

    if (!pl || !pl.alive) {
      return 'no player';
    }

    if (this.winner !== null) {
      return 'game over';
    }

    if ('x' in c && !this.inside(c.x, c.y)) {
      return 'bad coordinates';
    }

    if (
      c.t === 'build'
      && c.facing !== undefined
      && (!Number.isInteger(c.facing) || c.facing < 0 || c.facing > MAX_FACING)
    ) {
      return 'bad facing';
    }

    if (c.t === 'dropPiece' && (!Number.isInteger(c.hand) || !Number.isInteger(c.rot))) {
      return 'bad piece';
    }

    switch (c.t) {
      case 'dropPiece':
        return dropPiece(this, c);
      case 'build':
        return build(this, c);
      case 'collect':
        return collect(this, c);
      case 'pickupCrystal':
        return pickupCrystal(this, c);
      case 'movePriest':
        return movePriest(this, c);
      case 'capturePriest':
        return capturePriest(this, c);
      case 'salvage':
        return salvage(this, c);
    }
  }

  // ---------- simulation ----------
  step(cmds: Command[] = []): void {
    for (const c of cmds) {
      const result = this.execute(c);

      if (!result.ok) {
        this.emit({ what: 'rejected', who: c.player, data: { cmd: c.t, err: result.error } });
      }
    }

    this.transports.reset();

    for (const entity of this.entities.values()) {
      if (entity.kind === 'transport') {
        this.transports.add(entity);
      }
    }

    this.tick++;

    for (const player of this.players.values()) {
      tickPlayer(this, player);
    }

    const tickEntities = [...this.entities.values()];

    for (const e of tickEntities) {
      if (!this.entities.has(e.id)) {
        continue;
      }

      if (e.kind === 'transport') {
        this.tickTransport(e);
      } else if (e.kind === 'priest') {
        this.tickPriest(e);
      } else if (e.kind === 'building') {
        this.tickBuilding(e);
      }
    }
  }

  /** Internal rule hook; a crystal only forms in the hands of the transport mining a geyser. */
  spawnCrystal(carrier: Transport, value: number): Crystal {
    const c: Crystal = {
      id: this.nextId++,
      kind: 'crystal',
      x: carrier.x,
      y: carrier.y,
      value,
      carriedBy: carrier.id,
    };
    this.entities.set(c.id, c);
    return c;
  }

  private tickTransport(t: Transport): void {
    tickTransport(this, t);
  }

  private tickPriest(p: Priest): void {
    tickPriest(this, p);
  }

  private tickBuilding(building: Building): void {
    tickBuilding(this, building, (owner, x, y) => this.enemyAt(owner, x, y));
  }

  private enemyAt(me: number, x: number, y: number): Entity | null {
    if (!this.inside(x, y)) {
      return null;
    }

    const occ = this.entities.get(this.occupant[this.at(x, y)] ?? 0);

    if (
      occ
      && (occ.kind === 'building' || occ.kind === 'priest')
      && occ.owner !== me
      && occ.owner !== 0
    ) {
      return occ;
    }

    const transports = this.transports.at(x, y);

    if (transports) {
      for (const transport of transports) {
        if (transport.owner !== me && transport.hp > 0 && this.entities.has(transport.id)) {
          return transport;
        }
      }
    }

    return null;
  }

  adjacentTo(x: number, y: number, b: Building): boolean {
    return (
      x >= b.x - 1
      && x <= b.x + b.fx
      && y >= b.y - 1
      && y <= b.y + b.fy
      && !(x >= b.x && x < b.x + b.fx && y >= b.y && y < b.y + b.fy)
    );
  }

  findPath(
    p: number,
    sx: number,
    sy: number,
    goal: (c: [number, number]) => boolean,
    avoidOccupied = false,
  ): [number, number][] | null {
    return this.pathfinder.find(this, p, sx, sy, goal, avoidOccupied);
  }

  /** Call after bulk edits to terrain/owner arrays, e.g. a scenario editor. */
  invalidateTerrain(): void {
    this.terrainRevision++;
  }

  /** Consume transient notifications. Events are not simulation state or a replay. */
  drainEvents(): Event[] {
    return this.events.splice(0);
  }

  /** Internal rule hook; notifications are not authoritative state. */
  emit(event: EventInput): void {
    this.events.push({ tick: this.tick, ...event });
  }

  /** FNV-1a checksum of all state that affects future ticks, plus unit definitions.
   * Map insertion order is included because it defines system update/target order.
   * This detects accidental divergence; it is not a cryptographic checksum.
   */
  hash(): number {
    return hashWorld(this, this.rng.state(), this.nextId);
  }
}
