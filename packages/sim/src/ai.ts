/**
 * A simple computer opponent. It reads the world through the read-only view and returns commands,
 * which the caller submits like a player's: the commands, not this code, go into a replay, so
 * changing the AI never breaks recorded matches. It keeps no state and draws no random numbers.
 *
 * Invented behaviour, not the original's AI: the mission files only name its options
 * (COLLECT_STORM_POWER, ATTACH_TO_ENEMY_ISLAND, aiTimeBetweenMoves, …), not how it plays. Each move
 * it does the first of: send idle transports to geysers; carry off a downed enemy priest; walk its
 * priest to a captive on its altar; lay a bridge toward the nearest free geyser, or toward the enemy
 * Temple once none is left; put a shooter near the bridge head or a Generator when energy runs out.
 */
import type { Command } from './commands.js';
import type { UnitDef } from './defs.js';
import {
  DIRS,
  MAX_FACING,
  PIECES,
  Terrain,
  W,
  H,
  isBridge,
  pieceEnds,
  rotatePiece,
  type Facing,
} from './state.js';
import { joins } from './rules/bridges.js';
import type { DeepReadonly, WorldView } from './view.js';
import type { Building, Entity, Geyser, Priest, Transport } from './state.js';

type View<T> = DeepReadonly<T>;

/** How far around the bridge head the AI looks for a spot to lay a piece, and for a unit. */
const SEARCH_RADIUS = 5;
const UNIT_RADIUS = 9;
const ROTATIONS = 4;
/** Shooters the AI keeps while it still expands toward geysers (invented). */
const DEFENCE_SHOOTERS = 3;
/** Cells from the enemy Temple within which the bridge head grows a shooter every move (invented). */
const ATTACK_REACH = 30;
/** Transports the AI keeps collecting, and the Storm Power it keeps back when buying one (invented). */
const TRANSPORTS = 3;
const TRANSPORT_SAVINGS = 600;
/** Geysers with stock on own ground after which the AI bridges toward the enemy (invented). */
const ENOUGH_GEYSERS = 3;
/** Storm Power at which the AI attacks even with fewer geysers (invented). */
const ATTACK_STORM = 4000;
/** How close to a geyser, and to an enemy priest, the bridge has to come (invented). The second
 * keeps a Disc Thrower laid off the bridge's end within its range of 8. */
const GEYSER_REACH = 2;
const ENEMY_REACH = 6;
const MAX_REACH = 32;
/** Cells from the nearest own Energy source past which the AI puts a Generator by the bridge head,
 * well inside ENERGY_RANGE so the Generator itself can still be built (invented). */
const GENERATOR_SPACING = 18;

export interface AiOptions {
  player: number;
}

/** Commands for one move of an AI player. Call it every few seconds of game time. */
export function aiMove(world: WorldView, options: AiOptions): Command[] {
  const me = options.player;
  const player = world.players.get(me);

  if (!player?.alive || world.winner !== null) {
    return [];
  }

  // The commands of one move are checked against the same world, so this move's own spending and
  // cells are tracked here: later commands must not count on Storm Power or ground already used.
  const move: Move = { me, budget: player.storm, planned: new Set(), commands: [] };
  const transports = owned<Transport>(world, me, 'transport');
  const geysers = reachableGeysers(world, me);
  collect(world, move, transports, geysers);
  capture(world, move, transports);
  const ward = wardSpot(world, me);

  if (ward) {
    move.commands.push({ t: 'movePriest', player: me, ...ward });
  }

  const attack = geysers.length >= ENOUGH_GEYSERS || player.storm >= ATTACK_STORM;
  const bounds = ownBounds(world, me);
  let target: Target | undefined;
  let head: Head | null = null;
  let piece: Extract<Command, { t: 'dropPiece'; }> | null = null;

  // Grow toward the first target a piece can be laid toward. When none can, the last target, the
  // enemy, still decides where units go.
  for (const candidate of bridgeTargets(world, me, attack)) {
    const field = skyField(world, candidate);
    target = candidate;
    head = bounds ? bridgeHead(world, me, field, bounds) : null;
    piece = head ? bestPiece(world, me, head, field) : null;

    if (piece) {
      break;
    }
  }

  if (piece) {
    const shape = rotatePiece(PIECES[player.hand[piece.hand]!.piece]!, piece.rot);

    for (const [dx, dy] of shape) {
      move.planned.add(world.at(piece.x + dx, piece.y + dy));
    }

    move.commands.push(piece);
  }

  if (target && head && bounds) {
    const shooters = world.buildingsOf(me).filter((b) => world.def(b.type).dps > 0).length;

    if (target.enemy && !powered(world, me, head, GENERATOR_SPACING)) {
      // Carry Energy along the bridge: a Generator at the own ground nearest the target that is
      // still inside a circle to build in.
      const site = poweredHead(world, me, target, bounds);

      if (site) {
        generator(world, move, site);
      }
    } else if (
      (target.enemy && distance(head.x, head.y, target.x, target.y) <= ATTACK_REACH)
      || shooters < DEFENCE_SHOOTERS
    ) {
      bestUnit(world, move, head, target);
    }
  }

  if (transports.length < TRANSPORTS) {
    newTransport(world, move);
  }

  return move.commands;
}

interface Move {
  me: number;
  /** Storm Power left after the builds already chosen this move. */
  budget: number;
  /** Cells taken by the piece and units already chosen this move. */
  planned: Set<number>;
  commands: Command[];
}

type Head = { x: number; y: number; need: number; };
type Bounds = { x0: number; y0: number; x1: number; y1: number; };

/** Send each idle transport to the reachable geyser the fewest transports work, nearest first. */
function collect(
  world: WorldView,
  move: Move,
  transports: View<Transport>[],
  geysers: View<Geyser>[],
): void {
  if (!geysers.length) {
    return;
  }

  const crews = new Map(geysers.map((g) => [g.id, 0]));

  for (const t of transports) {
    if (t.target !== null && crews.has(t.target) && (t.goal === 'collect' || t.goal === 'home')) {
      crews.set(t.target, crews.get(t.target)! + 1);
    }
  }

  for (const t of transports) {
    if (t.goal !== 'idle' || t.carrying !== null) {
      continue;
    }

    // Stable: geysers are already ordered nearest first, so a tie goes to the nearer one.
    const geyser = geysers.reduce((best, g) => (crews.get(g.id)! < crews.get(best.id)! ? g : best));
    crews.set(geyser.id, crews.get(geyser.id)! + 1);
    move.commands.push({ t: 'collect', player: move.me, transport: t.id, geyser: geyser.id });
  }
}

/** Send one transport for a downed enemy priest, unless one is already on its way to him. */
function capture(world: WorldView, move: Move, transports: View<Transport>[]): void {
  const captive = enemyPriest(world, move.me, 'down');

  if (!captive || transports.some((t) => t.goal === 'capture' && t.target === captive.id)) {
    return;
  }

  const free = transports.find((t) => t.carrying === null && t.goal === 'idle')
    ?? transports.find((t) => t.carrying === null);

  if (free) {
    move.commands.push({
      t: 'capturePriest',
      player: move.me,
      transport: free.id,
      target: captive.id,
    });
  }
}

/** A transport of the AI's Fury, or a Golem, laid by its Temple when it can spare the cost. */
function newTransport(world: WorldView, move: Move): void {
  const player = world.players.get(move.me)!;
  const home = world.templeOf(move.me);

  if (!home) {
    return;
  }

  const kinds = [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> =>
      def?.cls === 'Ground Transport' && move.budget >= def.cost + TRANSPORT_SAVINGS
    )
    .sort((a, b) => b.speed - a.speed || a.id.localeCompare(b.id));
  const around = { x: home.x + home.fx, y: home.y + home.fy };

  for (const def of kinds) {
    if (place(world, move, def, around).placed) {
      return;
    }
  }
}

function owned<T extends Entity>(world: WorldView, me: number, kind: T['kind']): View<T>[] {
  const out: View<T>[] = [];

  for (const entity of world.entities.values()) {
    if (entity.kind === kind && 'owner' in entity && entity.owner === me) {
      out.push(entity as View<T>);
    }
  }

  return out;
}

function centre(b: View<Building>): { x: number; y: number; } {
  return { x: b.x + (b.fx >> 1), y: b.y + (b.fy >> 1) };
}

const distance = (ax: number, ay: number, bx: number, by: number) =>
  Math.abs(ax - bx) + Math.abs(ay - by);

/** Geysers with stock on the AI's own ground that a transport can walk to from the Temple,
 * nearest to the Temple first. */
function reachableGeysers(world: WorldView, me: number): View<Geyser>[] {
  const home = world.templeOf(me);

  if (!home) {
    return [];
  }

  const reached = walkableFrom(world, me, home);
  const { x, y } = centre(home);
  return [...world.entities.values()]
    .filter((e): e is View<Geyser> =>
      e.kind === 'geyser' && e.stock > 0 && world.owner[world.at(e.x, e.y)] === me
      && DIRS.some(([dx, dy]) =>
        world.inside(e.x + dx, e.y + dy) && reached[world.at(e.x + dx, e.y + dy)] === 1
      )
    )
    .sort((a, b) => distance(a.x, a.y, x, y) - distance(b.x, b.y, x, y) || a.id - b.id);
}

/** Cells a transport can walk to from beside a building, marked 1 in a scratch grid. */
function walkableFrom(world: WorldView, me: number, from: View<Building>): Uint8Array {
  const reached = scratch.reached.fill(0);
  const queue = scratch.queue;
  let tail = 0;

  for (let y = from.y - 1; y <= from.y + from.fy; y++) {
    for (let x = from.x - 1; x <= from.x + from.fx; x++) {
      if (world.walkable(me, x, y) && !reached[world.at(x, y)]) {
        reached[world.at(x, y)] = 1;
        queue[tail++] = world.at(x, y);
      }
    }
  }

  for (let head = 0; head < tail; head++) {
    const i = queue[head]!;
    const x = i % W;
    const y = (i / W) | 0;

    for (const [dx, dy] of DIRS) {
      if (world.walkable(me, x + dx, y + dy) && !reached[world.at(x + dx, y + dy)]) {
        reached[world.at(x + dx, y + dy)] = 1;
        queue[tail++] = world.at(x + dx, y + dy);
      }
    }
  }

  return reached;
}

/** Work grids reused between moves so a move allocates no 256×256 arrays. They carry nothing
 * from one move to the next: each use overwrites them first. */
const scratch = {
  field: new Int32Array(W * H),
  queue: new Int32Array(W * H),
  reached: new Uint8Array(W * H),
};

/** The rectangle around the AI's own ground, which bounds where its bridge can grow from. */
function ownBounds(world: WorldView, me: number): Bounds | null {
  let bounds: Bounds | null = null;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (world.owner[y * W + x] !== me) {
        continue;
      }

      bounds = bounds
        ? {
          x0: Math.min(bounds.x0, x),
          y0: Math.min(bounds.y0, y),
          x1: Math.max(bounds.x1, x),
          y1: Math.max(bounds.y1, y),
        }
        : { x0: x, y0: y, x1: x, y1: y };
    }
  }

  return bounds;
}

function enemyPriest(
  world: WorldView,
  me: number,
  state: Priest['state'],
): View<Priest> | undefined {
  for (const entity of world.entities.values()) {
    if (entity.kind === 'priest' && entity.owner !== me && entity.state === state) {
      return entity;
    }
  }

  return undefined;
}

/** A free cell beside the altar a captive is chained on, if the AI's priest is not there yet. */
function wardSpot(world: WorldView, me: number): { x: number; y: number; } | null {
  const chained = enemyPriest(world, me, 'chained');
  const altar = chained && chained.chainedAt !== null
    ? world.entities.get(chained.chainedAt)
    : undefined;
  const priest = world.priestOf(me);

  if (!altar || altar.kind !== 'building' || altar.owner !== me || priest?.state !== 'normal') {
    return null;
  }

  const beside = (x: number, y: number) =>
    x >= altar.x - 1 && x <= altar.x + altar.fx && y >= altar.y - 1 && y <= altar.y + altar.fy
    && !(x >= altar.x && x < altar.x + altar.fx && y >= altar.y && y < altar.y + altar.fy);

  if (beside(priest.x, priest.y)) {
    return null;
  }

  for (let y = altar.y - 1; y <= altar.y + altar.fy; y++) {
    for (let x = altar.x - 1; x <= altar.x + altar.fx; x++) {
      if (beside(x, y) && world.walkable(me, x, y) && !world.occupant[world.at(x, y)]) {
        return { x, y };
      }
    }
  }

  return null;
}

type Target = { x: number; y: number; enemy: boolean; };

/** Where the bridge may grow, best first: free geysers nearest the Temple (unless the AI is
 * attacking), then the nearest enemy's High Priest — knocking him down is how a battle is won —
 * or his Temple while the priest is carried. */
function bridgeTargets(world: WorldView, me: number, attack: boolean): Target[] {
  const home = world.templeOf(me);

  if (!home) {
    return [];
  }

  const from = centre(home);
  const byDistance = (a: Target, b: Target) =>
    distance(a.x, a.y, from.x, from.y) - distance(b.x, b.y, from.x, from.y);
  const geysers: Target[] = [];
  const enemies: Target[] = [];

  for (const entity of world.entities.values()) {
    if (
      !attack && entity.kind === 'geyser' && entity.stock > 0
      && !world.owner[world.at(entity.x, entity.y)]
    ) {
      geysers.push({ x: entity.x, y: entity.y, enemy: false });
    }
  }

  for (const [id, other] of world.players) {
    const enemy = id === me || !other.alive ? undefined : world.templeOf(id);
    const priest = world.priestOf(id);

    if (enemy) {
      enemies.push(priest && priest.state !== 'carried'
        ? { x: priest.x, y: priest.y, enemy: true }
        : { ...centre(enemy), enemy: true });
    }
  }

  return [...geysers.sort(byDistance), ...enemies.sort(byDistance).slice(0, 1)];
}

/**
 * Steps through open sky from each cell to the target's surroundings: the cells within `radius`
 * of the target (Chebyshev). Bridge can only be laid in the sky, so this is the length of bridge
 * still needed from there, going around islands rather than straight at the target. -1 where
 * the target cannot be reached through the sky, and on every cell that is not sky. The grid is
 * scratch, valid until the next call.
 */
function skyField(world: WorldView, target: Target): Int32Array {
  const field = scratch.field.fill(-1);
  const queue = scratch.queue;
  let tail = 0;

  // A target deep inside an island (a Temple's centre) has no sky that close: widen the ring until
  // there is some, so the bridge still heads for the island's nearest shore.
  for (
    let radius = target.enemy ? ENEMY_REACH : GEYSER_REACH;
    tail === 0 && radius <= MAX_REACH;
    radius++
  ) {
    for (let y = target.y - radius; y <= target.y + radius; y++) {
      for (let x = target.x - radius; x <= target.x + radius; x++) {
        if (
          world.inside(x, y) && field[world.at(x, y)] === -1
          && world.terrain[world.at(x, y)] === Terrain.Sky
        ) {
          field[world.at(x, y)] = 0;
          queue[tail++] = world.at(x, y);
        }
      }
    }
  }

  for (let head = 0; head < tail; head++) {
    const i = queue[head]!;
    const x = i % W;
    const y = (i / W) | 0;

    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;

      if (
        world.inside(nx, ny) && field[world.at(nx, ny)] === -1
        && world.terrain[world.at(nx, ny)] === Terrain.Sky
      ) {
        field[world.at(nx, ny)] = field[i]! + 1;
        queue[tail++] = world.at(nx, ny);
      }
    }
  }

  return field;
}

/** The own walkable ground cell that borders the sky closest (along the field) to the target:
 * the head the bridge grows from, with the bridge it still needs. */
function bridgeHead(world: WorldView, me: number, field: Int32Array, bounds: Bounds): Head | null {
  let best: Head | null = null;

  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      // Only ground a transport can walk on: bridging off a unit's islet would leave a bridge
      // that cannot be reached past the unit.
      if (world.owner[y * W + x] !== me || !world.walkable(me, x, y)) {
        continue;
      }

      // Bridge goes on only from a side the cell joins on: any side of island ground, the open
      // ends of a bridge cell.
      for (const [dir, [dx, dy]] of DIRS.entries()) {
        const step = world.inside(x + dx, y + dy) && joins(world, world.at(x, y), dir)
          ? field[world.at(x + dx, y + dy)]!
          : -1;

        if (step >= 0 && (!best || step + 1 < best.need)) {
          best = { x, y, need: step + 1 };
        }
      }
    }
  }

  return best;
}

/** The piece placement near the head that shortens the bridge still needed the most. */
function bestPiece(
  world: WorldView,
  me: number,
  head: Head,
  field: Int32Array,
): Extract<Command, { t: 'dropPiece'; }> | null {
  const hand = world.players.get(me)!.hand;
  let best: Extract<Command, { t: 'dropPiece'; }> | null = null;
  let bestNeed = head.need;

  for (let index = 0; index < hand.length; index++) {
    for (let rot = 0; rot < ROTATIONS; rot++) {
      const cells = rotatePiece(PIECES[hand[index]!.piece]!, rot);
      const ends = pieceEnds(hand[index]!.piece, rot);

      for (const [x, y] of nearby(head, SEARCH_RADIUS)) {
        const need = needAfter(world, field, cells, ends, x, y);

        if (
          need < bestNeed
          && touchesWalkable(world, me, cells, x, y)
          && world.canDropPiece({ player: me, hand: index, x, y, rot }) === null
        ) {
          best = { t: 'dropPiece', player: me, hand: index, x, y, rot };
          bestNeed = need;
        }
      }
    }
  }

  return best;
}

/** Bridge still needed once the piece lies at (x, y): none if it reaches the target's surroundings,
 * otherwise the least from the sky beyond one of its open ends, where the next piece can attach. */
function needAfter(
  world: WorldView,
  field: Int32Array,
  cells: [number, number][],
  ends: [number, number, number][],
  x: number,
  y: number,
): number {
  const at = (cx: number, cy: number): number =>
    world.inside(cx, cy) ? field[world.at(cx, cy)]! : -1;

  if (cells.some(([dx, dy]) => at(x + dx, y + dy) === 0)) {
    return 0;
  }

  let need = Infinity;

  for (const [ex, ey, dir] of ends) {
    const [dx, dy] = DIRS[dir]!;
    const beyond = at(x + ex + dx, y + ey + dy);

    if (beyond >= 0) {
      need = Math.min(need, beyond + 1);
    }
  }

  return need;
}

function touchesWalkable(
  world: WorldView,
  me: number,
  cells: [number, number][],
  x: number,
  y: number,
): boolean {
  return cells.some(([dx, dy]) =>
    DIRS.some(([nx, ny]) => {
      const cx = x + dx + nx;
      const cy = y + dy + ny;
      return world.isOwnGround(me, cx, cy) && world.walkable(me, cx, cy);
    })
  );
}

/** A shooter by the bridge head, facing the target; or a Generator there when energy is short. */
function bestUnit(
  world: WorldView,
  move: Move,
  head: { x: number; y: number; },
  target: { x: number; y: number; },
): void {
  const player = world.players.get(move.me)!;
  const known = [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> => def !== undefined && def.level > 0);
  // Alternate cannons, which fire along a line, with shooters that cover a square around them, so
  // a priest standing off the cannons' lines is still hit.
  const built = world.buildingsOf(move.me).map((b) => world.def(b.type)).filter((def) =>
    def.dps > 0
  );
  const lines = built.filter((def) => def.group === 'cannon').length;
  const preferLine = lines < built.length - lines;
  const shooters = known.filter((def) => def.dps > 0 && def.range > 0)
    .sort((a, b) =>
      Number((b.group === 'cannon') === preferLine) - Number((a.group === 'cannon') === preferLine)
      || b.cost - a.cost || a.id.localeCompare(b.id)
    );
  const facing = toward(head, target);
  let short = false;

  for (const def of shooters) {
    const spot = place(world, move, def, head, def.group === 'cannon' ? facing : undefined);

    if (spot.placed) {
      return;
    }

    short ||= spot.noEnergy;
  }

  if (short) {
    generator(world, move, head);
  }
}

/** A Generator by the head, of the AI's own Fury first. */
function generator(world: WorldView, move: Move, head: { x: number; y: number; }): void {
  const player = world.players.get(move.me)!;
  const generators = [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> => def?.group === 'battery')
    .sort((a, b) =>
      Number(b.theme === player.theme) - Number(a.theme === player.theme)
      || a.id.localeCompare(b.id)
    );

  for (const def of generators) {
    if (place(world, move, def, head).placed) {
      return;
    }
  }
}

/** The own walkable ground nearest the target that lies within GENERATOR_SPACING of Energy. */
function poweredHead(
  world: WorldView,
  me: number,
  target: { x: number; y: number; },
  bounds: Bounds,
): { x: number; y: number; } | null {
  let best: { x: number; y: number; } | null = null;
  let bestDistance = Infinity;

  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const d = distance(x, y, target.x, target.y);

      if (
        d < bestDistance && world.owner[y * W + x] === me && world.walkable(me, x, y)
        && powered(world, me, { x, y }, GENERATOR_SPACING)
      ) {
        best = { x, y };
        bestDistance = d;
      }
    }
  }

  return best;
}

/** Whether the centre of a cell lies within `range` cells of the centre of an own Temple or
 * Generator. Measured as the energy rule measures it, centre to centre with squared distances,
 * and in half cells so that every value is an integer and the result is the same everywhere. */
function powered(
  world: WorldView,
  me: number,
  at: { x: number; y: number; },
  range: number,
): boolean {
  for (const b of world.buildingsOf(me)) {
    const def = world.def(b.type);

    if (def.cls !== 'Energy' && def.group !== 'battery') {
      continue;
    }

    const dx = 2 * b.x + b.fx - (2 * at.x + 1);
    const dy = 2 * b.y + b.fy - (2 * at.y + 1);

    const reach = 2 * range; // in half cells, like dx and dy

    if (dx * dx + dy * dy <= reach * reach) {
      return true;
    }
  }

  return false;
}

/** Lay a unit at the first good spot around a centre, if this move can still afford it. */
function place(
  world: WorldView,
  move: Move,
  def: Readonly<UnitDef>,
  head: { x: number; y: number; },
  facing?: Facing,
): { placed: boolean; noEnergy: boolean; } {
  let noEnergy = false;

  if (def.cost > move.budget) {
    return { placed: false, noEnergy };
  }

  for (const [x, y] of nearby(head, UNIT_RADIUS)) {
    if (!clearOfBridges(world, def, x, y, move.planned)) {
      continue;
    }

    const command = {
      t: 'build',
      player: move.me,
      type: def.id,
      x,
      y,
      ...(facing === undefined ? {} : { facing }),
    } as const;
    const error = world.canBuild(command);

    if (error === null) {
      move.commands.push(command);
      move.budget -= def.cost;

      for (let fy = y; fy < y + def.footY; fy++) {
        for (let fx = x; fx < x + def.footX; fx++) {
          move.planned.add(world.at(fx, fy));
        }
      }

      return { placed: true, noEnergy };
    }

    noEnergy ||= error === 'no energy';

    if (error === 'no storm power' || error === 'not ready' || error === 'no workshop') {
      return { placed: false, noEnergy };
    }
  }

  return { placed: false, noEnergy };
}

/** A unit must not stand next to a bridge on the island it grows from, or it would cut the only
 * way onto the bridge. Off the bridge's end, in open sky, it may: the bridge cells stay free. */
function clearOfBridges(
  world: WorldView,
  def: Readonly<UnitDef>,
  x0: number,
  y0: number,
  planned: ReadonlySet<number>,
): boolean {
  let sky = 0;
  let nearBridge = false;

  for (let y = y0; y < y0 + def.footY; y++) {
    for (let x = x0; x < x0 + def.footX; x++) {
      if (!world.inside(x, y) || planned.has(world.at(x, y))) {
        return false;
      }

      sky += world.terrain[world.at(x, y)] === Terrain.Sky ? 1 : 0;
      nearBridge ||= DIRS.some(([dx, dy]) =>
        world.inside(x + dx, y + dy)
        && (isBridge(world.terrain[world.at(x + dx, y + dy)])
          || planned.has(world.at(x + dx, y + dy)))
      );
    }
  }

  return sky === def.footX * def.footY || !nearBridge;
}

/** Cells around a centre in rings of growing radius, nearest first. */
function nearby(head: { x: number; y: number; }, radius: number): [number, number][] {
  const cells: [number, number][] = [[head.x, head.y]];

  for (let r = 1; r <= radius; r++) {
    for (let y = head.y - r; y <= head.y + r; y++) {
      for (let x = head.x - r; x <= head.x + r; x++) {
        if (Math.max(Math.abs(x - head.x), Math.abs(y - head.y)) === r) {
          cells.push([x, y]);
        }
      }
    }
  }

  return cells;
}

/** The facing (N, E, S, W) that points most directly from one cell to another. */
function toward(from: { x: number; y: number; }, to: { x: number; y: number; }): Facing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let best = 0;
  let bestDot = -Infinity;

  for (let facing = 0; facing <= MAX_FACING; facing++) {
    const [fx, fy] = DIRS[facing]!;
    const dot = fx * dx + fy * dy;

    if (dot > bestDot) {
      best = facing;
      bestDot = dot;
    }
  }

  return best as Facing;
}
