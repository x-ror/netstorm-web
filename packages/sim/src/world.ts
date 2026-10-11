/**
 * NetStorm simulation core — deterministic, fixed-tick, engine-agnostic.
 *
 * Rules reproduced from the original (see project doc "Ядро механіки"):
 *  - the world is a 256×256 cell grid of sky; players own islands; everything else is reached by bridges
 *  - the temple hands out random bridge pieces (tetromino-like); a piece may only be dropped on sky cells
 *    touching the player's own island or bridges
 *  - combat units are buildings: placed on own island/bridge cells, never move; cannons fire along a line
 *    in their facing direction, disc throwers / anti-air in a radius; blockers absorb line fire
 *  - transports walk over own island/bridge cells to Storm Geysers, pick up crystals and bring them home
 *  - the High Priest builds, can be shot down to ≤50 % HP (incapacitated), carried by an enemy priest to the
 *    enemy altar and sacrificed → that player is defeated
 *
 * Approximations still to verify against the original (marked TODO):
 *  - energy: generators give 1 energy of their theme, a temple 2; a unit needs energy per its level but does
 *    not consume it permanently (original: "once built units don't consume energy")
 *  - shooters deal continuous dps while the target is in the line/radius
 */
import { CellIndex } from './cell-index.js';
import { Rng } from './rng.js';
import { DefTable, UnitDef, Theme, energyNeed } from './defs.js';

export const TPS = 10;                 // simulation ticks per second
export const W = 256, H = 256;         // world size in cells
export const PIECE_INTERVAL = 6 * TPS; // temple emits a bridge piece every 6 s      TODO verify
export const HAND_SIZE = 3;            // pieces a player can hold                   TODO verify
export const CRYSTAL_INTERVAL = 20 * TPS; // geyser spawns a crystal every 20 s     TODO verify
export const CRYSTAL_VALUE = 200;      // Storm Power per crystal (nugget cost=200)
export const PRIEST_HP = 100;

export const enum Terrain { Sky = 0, Island = 1, Bridge = 2 }
export type Facing = 0 | 1 | 2 | 3; // N, E, S, W
export const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Bridge pieces: 7 tetrominoes + a 2-cell domino, as cell offsets. Rotations are generated. */
export const PIECES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0], [1, 0], [2, 0], [3, 0]],             // I
  [[0, 0], [1, 0], [0, 1], [1, 1]],             // O
  [[0, 0], [1, 0], [2, 0], [1, 1]],             // T
  [[0, 0], [1, 0], [2, 0], [2, 1]],             // L
  [[0, 0], [1, 0], [2, 0], [0, 1]],             // J
  [[1, 0], [2, 0], [0, 1], [1, 1]],             // S
  [[0, 0], [1, 0], [1, 1], [2, 1]],             // Z
  [[0, 0], [1, 0]],                             // domino
];

export function rotatePiece(cells: ReadonlyArray<readonly [number, number]>, rot: number): [number, number][] {
  let out: [number, number][] = cells.map(c => [c[0], c[1]]);
  for (let r = 0; r < (rot & 3); r++) out = out.map(([x, y]) => [-y, x]);
  const mx = Math.min(...out.map(c => c[0])), my = Math.min(...out.map(c => c[1]));
  return out.map(([x, y]) => [x - mx, y - my]);
}

export interface Player {
  id: number;            // 1..8 (0 = neutral)
  name: string;
  theme: Theme;
  storm: number;         // Storm Power
  tech: Set<string>;     // unit ids the player knows
  hand: number[];        // bridge piece indices
  pieceTimer: number;
  alive: boolean;
}

export interface Building {
  id: number; kind: 'building'; type: string; owner: number;
  x: number; y: number; fx: number; fy: number;   // anchor (top-left) and footprint
  hp: number; hpMax: number; facing: Facing;
}
export interface Transport {
  id: number; kind: 'transport'; type: string; owner: number;
  x: number; y: number; hp: number; hpMax: number;
  carrying: number | null;   // crystal id
  path: [number, number][];  // remaining cells to walk
  move: number;              // movement accumulator (×100)
  goal: 'idle' | 'collect' | 'home';
}
export interface Priest {
  id: number; kind: 'priest'; owner: number;
  x: number; y: number; hp: number; hpMax: number;
  state: 'normal' | 'down' | 'carried';
  carriedBy: number | null;  // id of the enemy priest carrying this one
  carrying: number | null;   // id of the priest being carried
  path: [number, number][]; move: number;
}
export interface Crystal { id: number; kind: 'crystal'; x: number; y: number; geyser: number; carriedBy: number | null }
export interface Geyser { id: number; kind: 'geyser'; x: number; y: number; timer: number; crystal: number | null }
export type Entity = Building | Transport | Priest | Crystal | Geyser;

export type Command =
  | { t: 'dropPiece'; player: number; hand: number; x: number; y: number; rot: number }
  | { t: 'build'; player: number; type: string; x: number; y: number; facing?: Facing }
  | { t: 'collect'; player: number; transport: number; geyser: number }
  | { t: 'movePriest'; player: number; x: number; y: number }
  | { t: 'pickupPriest'; player: number; target: number }
  | { t: 'sacrifice'; player: number };

export interface Event { tick: number; what: string; who?: number; data?: unknown }

export class World {
  tick = 0;
  /** Derived presentation counter, excluded from the authoritative hash. */
  terrainRevision = 0;
  readonly terrain = new Uint8Array(W * H);
  readonly owner = new Uint8Array(W * H);       // island/bridge owner
  readonly occupant = new Int32Array(W * H);    // entity id occupying the cell, 0 = none
  readonly entities = new Map<number, Entity>();
  readonly players = new Map<number, Player>();
  readonly events: Event[] = [];
  private nextId = 1;
  private readonly transports = new CellIndex<Transport>(W, H);
  private readonly pathPrevious = new Int32Array(W * H);
  private readonly pathVisited = new Uint32Array(W * H);
  private readonly pathQueue = new Int32Array(W * H);
  private pathSearch = 0;
  readonly rng: Rng;
  winner: number | null = null;

  constructor(public readonly defs: DefTable, seed: number) { this.rng = new Rng(seed); }

  // ---------- setup ----------
  addPlayer(id: number, name: string, theme: Theme, storm: number, tech: string[]): Player {
    const p: Player = { id, name, theme, storm, tech: new Set(tech.map(t => t.toLowerCase())), hand: [], pieceTimer: PIECE_INTERVAL, alive: true };
    this.players.set(id, p); return p;
  }
  /** Fill a rectangle with island cells owned by `owner` (0 = neutral geyser islet). */
  addIsland(x0: number, y0: number, w: number, h: number, owner: number): void {
    this.invalidateTerrain();
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (this.inside(x, y)) {
      this.terrain[y * W + x] = Terrain.Island; this.owner[y * W + x] = owner;
    }
  }
  addGeyser(x: number, y: number): Geyser {
    this.addIsland(x - 1, y - 1, 3, 3, 0);
    const g: Geyser = { id: this.nextId++, kind: 'geyser', x, y, timer: CRYSTAL_INTERVAL / 2, crystal: null };
    this.entities.set(g.id, g); this.occupant[y * W + x] = g.id; return g;
  }
  addPriest(owner: number, x: number, y: number): Priest {
    const p: Priest = { id: this.nextId++, kind: 'priest', owner, x, y, hp: PRIEST_HP, hpMax: PRIEST_HP, state: 'normal', carriedBy: null, carrying: null, path: [], move: 0 };
    this.entities.set(p.id, p); this.occupant[y * W + x] = p.id; return p;
  }
  /** Place a building ignoring rules (scenario setup). */
  spawnBuilding(type: string, owner: number, x: number, y: number, facing: Facing = 0): Building {
    const def = this.def(type);
    const b: Building = { id: this.nextId++, kind: 'building', type: def.id, owner, x, y, fx: def.footX, fy: def.footY, hp: def.hp, hpMax: def.hp, facing };
    this.entities.set(b.id, b); this.forFoot(b, i => { this.occupant[i] = b.id; }); return b;
  }
  spawnTransport(type: string, owner: number, x: number, y: number): Transport {
    const def = this.def(type);
    const t: Transport = { id: this.nextId++, kind: 'transport', type: def.id, owner, x, y, hp: def.hp, hpMax: def.hp, carrying: null, path: [], move: 0, goal: 'idle' };
    this.entities.set(t.id, t); return t; // transports do not block cells
  }

  // ---------- queries ----------
  def(type: string): UnitDef { const d = this.defs.get(type.toLowerCase()); if (!d) throw new Error('unknown unit ' + type); return d; }
  inside(x: number, y: number): boolean { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < W && y < H; }
  at(x: number, y: number): number { return y * W + x; }
  isOwnGround(p: number, x: number, y: number): boolean { return this.inside(x, y) && this.terrain[this.at(x, y)] !== Terrain.Sky && this.owner[this.at(x, y)] === p; }
  /** Walkable for a transport/priest of player p: own ground, neutral islands, and any bridge. */
  walkable(p: number, x: number, y: number): boolean {
    if (!this.inside(x, y)) return false;
    const i = this.at(x, y), t = this.terrain[i];
    if (t === Terrain.Sky) return false;
    const occ = this.entities.get(this.occupant[i] ?? 0);
    if (occ && occ.kind === 'building') return false;
    return this.owner[i] === p || this.owner[i] === 0 || t === Terrain.Bridge;
  }
  private forFoot(b: Building, f: (i: number) => void): void { for (let y = b.y; y < b.y + b.fy; y++) for (let x = b.x; x < b.x + b.fx; x++) f(this.at(x, y)); }
  building(id: number): Building | undefined { const e = this.entities.get(id); return e?.kind === 'building' ? e : undefined; }
  priestOf(p: number): Priest | undefined { for (const e of this.entities.values()) if (e.kind === 'priest' && e.owner === p) return e; return undefined; }
  buildingsOf(p: number, group?: string): Building[] { const r: Building[] = []; for (const e of this.entities.values()) if (e.kind === 'building' && e.owner === p && (!group || this.def(e.type).group === group)) r.push(e); return r; }
  energy(p: number): { own: number; any: number } {
    const pl = this.players.get(p)!; let own = 0, any = 0;
    for (const b of this.buildingsOf(p)) {
      const d = this.def(b.type);
      const n = d.cls === 'Energy' ? 2 : d.group === 'battery' ? 1 : 0;
      if (!n) continue;
      if (d.theme === pl.theme || d.theme === 'sun') own += n; else any += n;
    }
    return { own, any: any + own };
  }

  // ---------- commands ----------
  apply(c: Command): string | null {
    const pl = this.players.get(c.player); if (!pl || !pl.alive) return 'no player';
    if (this.winner !== null) return 'game over';
    if ('x' in c && !this.inside(c.x, c.y)) return 'bad coordinates';
    if (c.t === 'build' && c.facing !== undefined && (!Number.isInteger(c.facing) || c.facing < 0 || c.facing > 3)) return 'bad facing';
    if (c.t === 'dropPiece' && (!Number.isInteger(c.hand) || !Number.isInteger(c.rot))) return 'bad piece';
    switch (c.t) {
      case 'dropPiece': {
        const piece = pl.hand[c.hand]; if (piece === undefined) return 'no piece';
        const cells = rotatePiece(PIECES[piece]!, c.rot).map(([dx, dy]) => [c.x + dx, c.y + dy] as [number, number]);
        let touches = false;
        for (const [x, y] of cells) {
          if (!this.inside(x, y) || this.terrain[this.at(x, y)] !== Terrain.Sky) return 'blocked';
          for (const [ddx, ddy] of DIRS) if (this.isOwnGround(c.player, x + ddx, y + ddy)) touches = true;
        }
        if (!touches) return 'not connected';
        for (const [x, y] of cells) { this.terrain[this.at(x, y)] = Terrain.Bridge; this.owner[this.at(x, y)] = c.player; }
        this.invalidateTerrain();
        pl.hand.splice(c.hand, 1); this.log('bridge', c.player, cells); return null;
      }
      case 'build': {
        const def = this.defs.get(c.type.toLowerCase()); if (!def) return 'unknown unit';
        if (!pl.tech.has(def.id) && def.level > 0) return 'unknown tech';
        if (pl.storm < def.cost) return 'no storm power';
        if (def.level > 0) { const need = energyNeed(def), have = this.energy(c.player); if (have.own < need.own || have.any < need.own + need.any) return 'no energy'; }
        for (let y = c.y; y < c.y + def.footY; y++) for (let x = c.x; x < c.x + def.footX; x++) {
          if (!this.isOwnGround(c.player, x, y) || this.occupant[this.at(x, y)]) return 'blocked';
        }
        pl.storm -= def.cost; const b = this.spawnBuilding(def.id, c.player, c.x, c.y, c.facing ?? 0);
        this.log('build', c.player, { id: b.id, type: def.id }); return null;
      }
      case 'collect': {
        const t = this.entities.get(c.transport), g = this.entities.get(c.geyser);
        if (!t || t.kind !== 'transport' || t.owner !== c.player || !g || g.kind !== 'geyser') return 'bad target';
        const path = this.findPath(c.player, t.x, t.y, cell => Math.abs(cell[0] - g.x) + Math.abs(cell[1] - g.y) === 1);
        if (!path) return 'no path';
        t.path = path; t.goal = 'collect'; return null;
      }
      case 'movePriest': {
        const p = this.priestOf(c.player); if (!p || p.state !== 'normal') return 'priest unavailable';
        const path = this.findPath(c.player, p.x, p.y, cell => cell[0] === c.x && cell[1] === c.y);
        if (!path) return 'no path'; p.path = path; return null;
      }
      case 'pickupPriest': {
        const me = this.priestOf(c.player), tgt = this.entities.get(c.target);
        if (!me || me.state !== 'normal' || !tgt || tgt.kind !== 'priest' || tgt.owner === c.player) return 'bad target';
        if (tgt.state !== 'down') return 'target not incapacitated';
        if (Math.abs(me.x - tgt.x) + Math.abs(me.y - tgt.y) > 1) return 'too far';
        tgt.state = 'carried'; tgt.carriedBy = me.id; me.carrying = tgt.id; this.occupant[this.at(tgt.x, tgt.y)] = 0;
        this.log('captured', c.player, { priest: tgt.id }); return null;
      }
      case 'sacrifice': {
        const me = this.priestOf(c.player); if (!me || me.carrying === null) return 'nothing to sacrifice';
        const altar = this.buildingsOf(c.player).find(b => this.def(b.type).cls === 'Altar');
        if (!altar || !this.adjacentTo(me.x, me.y, altar)) return 'not at altar';
        const victim = this.entities.get(me.carrying) as Priest; const loser = this.players.get(victim.owner)!;
        loser.alive = false; this.entities.delete(victim.id); me.carrying = null;
        this.log('sacrifice', c.player, { victim: victim.owner });
        const alive = [...this.players.values()].filter(p => p.alive);
        if (alive.length === 1) { this.winner = alive[0]!.id; this.log('victory', this.winner); }
        return null;
      }
    }
  }

  // ---------- simulation ----------
  step(cmds: Command[] = []): void {
    for (const c of cmds) { const err = this.apply(c); if (err) this.log('rejected', c.player, { cmd: c.t, err }); }
    this.transports.reset();
    for (const entity of this.entities.values()) if (entity.kind === 'transport') this.transports.add(entity);
    this.tick++;
    for (const pl of this.players.values()) if (pl.alive) {
      // bridge pieces from the temple
      if (this.buildingsOf(pl.id).some(b => this.def(b.type).cls === 'Energy') && --pl.pieceTimer <= 0) {
        pl.pieceTimer = PIECE_INTERVAL; if (pl.hand.length < HAND_SIZE) pl.hand.push(this.rng.int(PIECES.length));
      }
    }
    for (const e of [...this.entities.values()]) {
      if (!this.entities.has(e.id)) continue;
      if (e.kind === 'geyser') this.tickGeyser(e);
      else if (e.kind === 'transport') this.tickTransport(e);
      else if (e.kind === 'priest') this.tickPriest(e);
      else if (e.kind === 'building') this.tickBuilding(e);
    }
  }

  private tickGeyser(g: Geyser): void {
    if (g.crystal !== null || --g.timer > 0) return;
    g.timer = CRYSTAL_INTERVAL;
    const c: Crystal = { id: this.nextId++, kind: 'crystal', x: g.x, y: g.y, geyser: g.id, carriedBy: null };
    this.entities.set(c.id, c); g.crystal = c.id;
  }

  private advance(e: Transport | Priest, speed: number): boolean {
    if (!e.path.length) return false;
    e.move += Math.round(speed * 100 / TPS);
    while (e.move >= 100 && e.path.length) {
      e.move -= 100; const [x, y] = e.path.shift()!;
      if (!this.walkable(e.owner, x, y)) { e.path = []; return false; }
      if (e.kind === 'priest') { this.occupant[this.at(e.x, e.y)] = 0; this.occupant[this.at(x, y)] = e.id; }
      const previousX = e.x, previousY = e.y;
      e.x = x; e.y = y;
      if (e.kind === 'transport') this.transports.move(e, previousX, previousY);
    }
    return true;
  }

  private tickTransport(t: Transport): void {
    if (t.hp <= 0) { this.dropCargo(t); this.entities.delete(t.id); this.log('destroyed', t.owner, { id: t.id, type: t.type }); return; }
    this.advance(t, this.def(t.type).speed);
    if (t.path.length) return;
    if (t.goal === 'collect') {
      const g = [...this.entities.values()].find(e => e.kind === 'geyser' && Math.abs(e.x - t.x) + Math.abs(e.y - t.y) === 1) as Geyser | undefined;
      if (g?.crystal !== null && g?.crystal !== undefined) {
        const c = this.entities.get(g.crystal) as Crystal; c.carriedBy = t.id; t.carrying = c.id; g.crystal = null;
        const home = this.buildingsOf(t.owner).find(b => this.def(b.type).cls === 'Energy');
        const path = home ? this.findPath(t.owner, t.x, t.y, cell => this.adjacentTo(cell[0], cell[1], home)) : null;
        if (path) { t.path = path; t.goal = 'home'; } else t.goal = 'idle';
      } else t.goal = 'idle';
    } else if (t.goal === 'home' && t.carrying !== null) {
      const home = this.buildingsOf(t.owner).find(b => this.def(b.type).cls === 'Energy');
      if (!home || !this.adjacentTo(t.x, t.y, home)) { t.goal = 'idle'; return; }
      const pl = this.players.get(t.owner)!; pl.storm += CRYSTAL_VALUE; this.entities.delete(t.carrying); t.carrying = null; t.goal = 'idle';
      this.log('delivered', t.owner, { transport: t.id });
    }
  }
  private dropCargo(t: Transport): void {
    if (t.carrying === null) return; const c = this.entities.get(t.carrying) as Crystal | undefined;
    if (c) { c.carriedBy = null; c.x = t.x; c.y = t.y; } t.carrying = null;
  }

  private tickPriest(p: Priest): void {
    if (p.state === 'carried') { const by = this.entities.get(p.carriedBy!) as Priest; p.x = by.x; p.y = by.y; return; }
    if (p.state === 'down') {
      // regenerates while the player still has a temple
      if (this.buildingsOf(p.owner).some(b => this.def(b.type).cls === 'Energy') && this.tick % TPS === 0) p.hp = Math.min(p.hpMax, p.hp + 2);
      if (p.hp > p.hpMax / 2) { p.state = 'normal'; this.log('priest up', p.owner); }
      return;
    }
    if (p.hp <= p.hpMax / 2) { p.state = 'down'; p.path = []; this.log('priest down', p.owner); return; }
    this.advance(p, 1.8);
  }

  private tickBuilding(b: Building): void {
    if (b.hp <= 0) { this.forFoot(b, i => { this.occupant[i] = 0; }); this.entities.delete(b.id); this.log('destroyed', b.owner, { id: b.id, type: b.type }); return; }
    const def = this.def(b.type); if (!def.dps) return;
    const target = def.group === 'cannon' ? this.lineTarget(b, def) : this.radiusTarget(b, def);
    if (target) this.damage(target, def.dps / TPS);
  }
  private damage(e: Entity, d: number): void { if ('hp' in e) e.hp = Math.max(0, +(e.hp - d).toFixed(4)); }

  /** First enemy along the facing line, up to `range` cells; any building (own or enemy) stops the shot. */
  private lineTarget(b: Building, def: UnitDef): Entity | null {
    const [dx, dy] = DIRS[b.facing]!;
    let x = b.facing === 1 ? b.x + b.fx : b.facing === 3 ? b.x - 1 : b.x + (b.fx >> 1);
    let y = b.facing === 2 ? b.y + b.fy : b.facing === 0 ? b.y - 1 : b.y + (b.fy >> 1);
    for (let r = 0; r < def.range && this.inside(x, y); r++, x += dx, y += dy) {
      const hit = this.enemyAt(b.owner, x, y); if (hit) return hit;
      const occ = this.entities.get(this.occupant[this.at(x, y)] ?? 0); if (occ?.kind === 'building') return null;
    }
    return null;
  }
  private radiusTarget(b: Building, def: UnitDef): Entity | null {
    const cx = b.x + (b.fx >> 1), cy = b.y + (b.fy >> 1);
    // Same row-major ring order as before, without visiting the ring's interior.
    for (let r = 1; r <= def.range; r++) {
      const left = cx - r, right = cx + r, top = cy - r, bottom = cy + r;
      for (let x = left; x <= right; x++) { const hit = this.enemyAt(b.owner, x, top); if (hit) return hit; }
      for (let y = top + 1; y < bottom; y++) {
        const first = this.enemyAt(b.owner, left, y); if (first) return first;
        const last = this.enemyAt(b.owner, right, y); if (last) return last;
      }
      for (let x = left; x <= right; x++) { const hit = this.enemyAt(b.owner, x, bottom); if (hit) return hit; }
    }
    return null;
  }
  private enemyAt(me: number, x: number, y: number): Entity | null {
    if (!this.inside(x, y)) return null;
    const occ = this.entities.get(this.occupant[this.at(x, y)] ?? 0);
    if (occ && (occ.kind === 'building' || occ.kind === 'priest') && occ.owner !== me && occ.owner !== 0) return occ;
    const transports = this.transports.at(x, y);
    if (transports) for (const transport of transports) {
      if (transport.owner !== me && transport.hp > 0 && this.entities.has(transport.id)) return transport;
    }
    return null;
  }

  adjacentTo(x: number, y: number, b: Building): boolean {
    return x >= b.x - 1 && x <= b.x + b.fx && y >= b.y - 1 && y <= b.y + b.fy && !(x >= b.x && x < b.x + b.fx && y >= b.y && y < b.y + b.fy);
  }

  /** BFS over walkable cells; returns the cells to step through (excluding start) or null. */
  findPath(p: number, sx: number, sy: number, goal: (c: [number, number]) => boolean): [number, number][] | null {
    if (!this.inside(sx, sy)) return null;
    // Epoch markers avoid clearing 65,536 cells for each search. No scratch allocations.
    this.pathSearch = (this.pathSearch + 1) >>> 0;
    if (this.pathSearch === 0) { this.pathVisited.fill(0); this.pathSearch = 1; }
    const epoch = this.pathSearch, prev = this.pathPrevious, visited = this.pathVisited, q = this.pathQueue;
    const start = this.at(sx, sy);
    let tail = 1;
    q[0] = start; prev[start] = start; visited[start] = epoch;
    for (let head = 0; head < tail; head++) {
      const i = q[head]!, x = i % W, y = (i / W) | 0;
      if (goal([x, y])) {
        const out: [number, number][] = [];
        for (let cell = i; cell !== start; cell = prev[cell]!) out.push([cell % W, (cell / W) | 0]);
        return out.reverse();
      }
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!this.walkable(p, nx, ny)) continue;
        const j = this.at(nx, ny);
        if (visited[j] !== epoch) { visited[j] = epoch; prev[j] = i; q[tail++] = j; }
      }
    }
    return null;
  }

  /** Call after bulk edits to terrain/owner arrays, e.g. a scenario editor. */
  invalidateTerrain(): void { this.terrainRevision++; }

  /** Consume transient notifications. Events are not simulation state or a replay. */
  drainEvents(): Event[] { return this.events.splice(0); }

  private log(what: string, who?: number, data?: unknown): void { this.events.push({ tick: this.tick, what, who, data }); }

  /** FNV-1a checksum of all state that affects future ticks, plus unit definitions.
   * Map insertion order is included because it defines system update/target order.
   * This detects accidental divergence; it is not a cryptographic checksum.
   */
  hash(): number {
    let h = 0x811c9dc5;
    const byte = (v: number) => { h = Math.imul(h ^ (v & 0xff), 0x01000193); };
    const uint = (v: number) => { byte(v); byte(v >>> 8); byte(v >>> 16); byte(v >>> 24); };
    const text = (v: string) => {
      uint(v.length);
      for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); byte(c); byte(c >>> 8); }
    };
    uint(this.tick); uint(this.rng.state()); uint(this.nextId);
    text(JSON.stringify(this.winner));
    for (let i = 0; i < W * H; i++) {
      byte(this.terrain[i]!); byte(this.owner[i]!); uint(this.occupant[i]!);
    }
    uint(this.defs.size);
    for (const [id, def] of this.defs) { text(id); text(JSON.stringify(def)); }
    uint(this.entities.size);
    for (const [id, entity] of this.entities) { uint(id); text(JSON.stringify(entity)); }
    uint(this.players.size);
    for (const [id, player] of this.players) {
      uint(id); text(JSON.stringify({ ...player, tech: [...player.tech].sort() }));
    }
    return h >>> 0;
  }
}
