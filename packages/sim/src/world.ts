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
import {
  BRIDGE_SCAN,
  ageBridges,
  dropPiece,
  joins,
  pieceSite,
  type PieceCommand,
} from './rules/bridges.js';
import { tickBuilding } from './rules/combat.js';
import { FLYER_SCALE, flightTicks, tickAirBase, tickFlyer } from './rules/flyers.js';
import { tickPlayer } from './rules/economy.js';
import { energy, canBuild, build, meltdown, salvage } from './rules/building.js';
import { tickTransport, collect, pickupCrystal } from './rules/movement.js';
import { tickPriest, movePriest } from './rules/priest.js';
import { capturePriest } from './rules/capture.js';
import { castSpell, spellbound, takeSpell } from './rules/spells.js';
import { Pathfinder, airPath } from './spatial/pathfinding.js';
import { CellIndex } from './cell-index.js';
import { Rng } from './rng.js';
import { flies, type DefTable, type UnitDef, type UnitGroup, type Theme } from './defs.js';
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
  type Obelisk,
  type Flyer,
  type Entity,
  type Facing,
  DIRS,
  oppositeDir,
  HAND_SIZE,
  DEFAULT_UNIT_RATE,
  DEFAULT_KILL_REWARD,
  OUTPOST,
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
  /** Sides each bridge cell joins on (bits as in DIRS). 0 on bridge means it was laid without a
   * piece and joins on every side. */
  readonly links = new Uint8Array(W * H);
  /** Time a bridge cell has left, 1 to 7, once it has begun to wear; 0 while it has not. */
  readonly wear = new Uint8Array(W * H);
  readonly occupant = new Int32Array(W * H); // entity id occupying the cell, 0 = none
  readonly entities = new Map<number, Entity>();
  readonly players = new Map<number, Player>();
  /** Buildings an explosion brought down during the current step. They go up on the next one, so a
   * chain reaction advances one link a tick whatever the order of the entities. Not saved: it is
   * empty between steps. */
  readonly blasted = new Set<number>();
  readonly events: Event[] = [];
  private nextId = 1;
  private readonly transports = new CellIndex<Transport>(W, H);
  private readonly pathfinder = new Pathfinder();
  readonly rng: Rng;
  winner: number | null = null;
  /** Bridge set the Temples draw pieces from, an index into BRIDGE_SETS. */
  bridgeSet = 0;
  /** Bridge pieces a player's Production Window holds: 2, 4 or 6. */
  bridgeSlots: number = HAND_SIZE;
  /** Seconds a unit type cannot be laid again after one is laid (the Unit Rate option). */
  unitRate: number = DEFAULT_UNIT_RATE;
  /** Per cent of an enemy unit's cost paid for destroying it (the Kill Reward option). */
  killReward: number = DEFAULT_KILL_REWARD;
  /** Storm Power a new geyser holds (the Money per Geyser option). */
  geyserStock: number = GEYSER_STOCK;

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
    world.bridgeSet = snapshot.bridgeSet;
    world.bridgeSlots = snapshot.bridgeSlots;
    world.unitRate = snapshot.unitRate;
    world.killReward = snapshot.killReward;
    world.geyserStock = snapshot.geyserStock;
    world.terrain.set(snapshot.terrain);
    world.owner.set(snapshot.owner);
    world.links.set(snapshot.links);
    world.wear.set(snapshot.wear);
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
      bridgeSet: this.bridgeSet,
      bridgeSlots: this.bridgeSlots,
      unitRate: this.unitRate,
      killReward: this.killReward,
      geyserStock: this.geyserStock,
      terrain: Array.from(this.terrain),
      owner: Array.from(this.owner),
      links: Array.from(this.links),
      wear: Array.from(this.wear),
      occupant: Array.from(this.occupant),
      defs: [...this.defs.values()],
      entities: [...this.entities.values()],
      players: [...this.players.values()].map((player) => ({ ...player, tech: [...player.tech] })),
    });
  }

  // ---------- setup ----------
  addPlayer(
    id: number,
    name: string,
    theme: Theme,
    storm: number,
    tech: string[],
    allies: number[] = [],
  ): Player {
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
      allies: [...allies].sort((a, b) => a - b),
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

  /** `islet` false leaves the ground as it is: the geyser stands on an island. */
  addGeyser(x: number, y: number, stock = this.geyserStock, islet = true): Geyser {
    if (islet) {
      this.addIsland(x - 1, y - 1, GEYSER_ISLAND_SIZE, GEYSER_ISLAND_SIZE, 0);
    }

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

  /** An Obelisk holding a Spell. It stands on the ground that is there. */
  addObelisk(x: number, y: number, spell: string): Obelisk {
    const o: Obelisk = { id: this.nextId++, kind: 'obelisk', x, y, spell: this.def(spell).id };
    this.entities.set(o.id, o);
    this.occupant[y * W + x] = o.id;
    return o;
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
      carrying: null,
      goal: 'idle',
      target: null,
      paralyzed: 0,
      invisible: 0,
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
      islet: false,
      regrow: 0,
      rising: 0,
      builder: null,
      paralyzed: 0,
      invisible: 0,
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
      spell: null,
      casting: 0,
      paralyzed: 0,
      invisible: 0,
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

  /** Whether the ground at (x, y) carries on into its neighbour on the side `dir`, an index into
   * DIRS: both cells are ground and each joins on the side that faces the other. Island joins on
   * every side, bridge only where its piece does, so two bridges lying side by side are not
   * joined. The original's pathfinder asks the same of every step. */
  joined(x: number, y: number, dir: number): boolean {
    const [dx, dy] = DIRS[dir]!;
    const nx = x + dx;
    const ny = y + dy;

    if (!this.inside(x, y) || !this.inside(nx, ny)) {
      return false;
    }

    const from = this.at(x, y);
    const to = this.at(nx, ny);
    return this.terrain[from] !== Terrain.Sky && this.terrain[to] !== Terrain.Sky
      && joins(this, from, dir) && joins(this, to, oppositeDir(dir));
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

  /** Whether two sides fight each other: two different players, neither of whom names the other
   * an ally. Things of nobody (owner 0) are nobody's enemy. */
  hostile(a: number, b: number): boolean {
    if (a === b || a === 0 || b === 0) {
      return false;
    }

    return !this.players.get(a)?.allies.includes(b) && !this.players.get(b)?.allies.includes(a);
  }

  /** The player's Temple: the building of class Energy. */
  templeOf(p: number): Building | undefined {
    return this.buildingsOf(p).find((b) => this.def(b.type).cls === 'Energy' && b.rising === 0);
  }

  /** Where the player's ground hangs together and his crystals go: his Temple and his Outposts,
   * once built. An Outpost gives what a Temple gives its island. */
  depotsOf(p: number): Building[] {
    return this.buildingsOf(p).filter((b) =>
      b.rising === 0 && (this.def(b.type).cls === 'Energy' || b.type === OUTPOST)
    );
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
  /** Transports standing on a cell, in entity order. */
  transportsAt(x: number, y: number): readonly Transport[] {
    return this.transports.at(x, y) ?? [];
  }

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
      case 'meltdown':
        return meltdown(this, c);
      case 'takeSpell':
        return takeSpell(this, c);
      case 'castSpell':
        return castSpell(this, c);
    }
  }

  // ---------- simulation ----------
  step(cmds: Command[] = []): void {
    this.blasted.clear();

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

    if (this.tick % BRIDGE_SCAN === 0) {
      ageBridges(this);
    }

    const tickEntities = [...this.entities.values()];

    for (const e of tickEntities) {
      if (!this.entities.has(e.id)) {
        continue;
      }

      if ('hp' in e && spellbound(e)) {
        continue;
      }

      if (e.kind === 'transport') {
        this.tickTransport(e);
      } else if (e.kind === 'priest') {
        this.tickPriest(e);
      } else if (e.kind === 'building') {
        this.tickBuilding(e);
      } else if (e.kind === 'flyer') {
        tickFlyer(this, e);
      }
    }
  }

  /** Internal rule hook: a flyer goes up over the middle of what sent it, an air base or the
   * transport whose Spell summoned it. Only a base is a home to go back to. */
  spawnFlyer(type: string, owner: number, from: Building | Transport): Flyer {
    const def = this.def(type);
    const [fx, fy] = from.kind === 'building' ? [from.fx, from.fy] : [1, 1];
    const px = from.x * FLYER_SCALE + (fx * FLYER_SCALE) / 2;
    const py = from.y * FLYER_SCALE + (fy * FLYER_SCALE) / 2;
    const f: Flyer = {
      id: this.nextId++,
      kind: 'flyer',
      type: def.id,
      owner,
      x: Math.floor(px / FLYER_SCALE),
      y: Math.floor(py / FLYER_SCALE),
      px,
      py,
      // The Dust Devil has no hit points in its data: nothing can shoot it down.
      hp: def.hp || 1,
      hpMax: def.hp || 1,
      home: from.kind === 'building' ? from.id : null,
      hx: px,
      hy: py,
      target: null,
      life: flightTicks(def),
      cooldown: 0,
      returning: false,
      paralyzed: 0,
      invisible: 0,
    };
    this.entities.set(f.id, f);
    return f;
  }

  /** Internal rule hook; a crystal only forms in the hands of the transport mining a geyser. */
  spawnCrystal(carrier: Transport | Priest, value: number): Crystal {
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

    if (this.entities.has(building.id)) {
      tickAirBase(this, building);
    }
  }

  private enemyAt(me: number, x: number, y: number): Entity | null {
    if (!this.inside(x, y)) {
      return null;
    }

    const occ = this.entities.get(this.occupant[this.at(x, y)] ?? 0);

    if (
      occ
      && (occ.kind === 'building' || occ.kind === 'priest')
      && this.hostile(me, occ.owner)
      && occ.invisible === 0
      && !(occ.kind === 'building' && occ.regrow > 0)
    ) {
      return occ;
    }

    const transports = this.transports.at(x, y);

    if (transports) {
      for (const transport of transports) {
        // An Aerial Transport is not found on the ground: only what shoots at the air sees it.
        if (
          this.hostile(me, transport.owner) && transport.hp > 0 && transport.invisible === 0
          && this.entities.has(transport.id)
          && !flies(this.def(transport.type))
        ) {
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

  /** The way of a transport or a Priest to the nearest cell that meets `goal`: over ground and
   * joined bridge for those on foot, over anything for an Aerial Transport. */
  wayOf(
    e: Transport | Priest,
    goal: (c: [number, number]) => boolean,
  ): [number, number][] | null {
    return e.kind === 'transport' && flies(this.def(e.type))
      ? airPath(e.x, e.y, goal)
      : this.findPath(e.owner, e.x, e.y, goal, e.kind === 'priest');
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
