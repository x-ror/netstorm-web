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
  rotatePiece,
  type Facing,
} from './state.js';
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

  const commands: Command[] = [];
  const transports = owned<Transport>(world, me, 'transport');
  const idle = transports.filter((t) => t.goal === 'idle' && t.carrying === null);
  const geysers = reachableGeysers(world, me);

  for (const transport of idle) {
    const geyser = geysers[0];

    if (geyser) {
      commands.push({ t: 'collect', player: me, transport: transport.id, geyser: geyser.id });
    }
  }

  const captive = enemyPriest(world, me, 'down');
  const free = transports.find((t) => t.carrying === null && t.goal !== 'capture');

  if (captive && free) {
    commands.push({ t: 'capturePriest', player: me, transport: free.id, target: captive.id });
  }

  const ward = wardSpot(world, me);

  if (ward) {
    commands.push({ t: 'movePriest', player: me, ...ward });
  }

  const attack = geysers.length >= ENOUGH_GEYSERS || player.storm >= ATTACK_STORM;
  const targets = bridgeTargets(world, me, attack);
  // Grow toward the first target a piece can be laid toward; units go by the last one, the enemy.
  let target = targets.at(-1);
  let head = target ? bridgeHead(world, me, skyField(world, target)) : null;
  let piece: Command | null = null;

  for (const candidate of targets) {
    const field = skyField(world, candidate);
    const from = bridgeHead(world, me, field);
    piece = from ? bestPiece(world, me, from, field) : null;

    if (piece) {
      target = candidate;
      head = from;
      break;
    }
  }

  if (target && head) {
    // Cells the piece will cover count as bridge when placing a unit in the same move.
    const planned = new Set<number>();

    if (piece?.t === 'dropPiece') {
      const shape = rotatePiece(PIECES[world.players.get(me)!.hand[piece.hand]!.piece]!, piece.rot);

      for (const [dx, dy] of shape) {
        planned.add(world.at(piece.x + dx, piece.y + dy));
      }

      commands.push(piece);
    }

    const shooters = world.buildingsOf(me).filter((b) => world.def(b.type).dps > 0).length;
    let unit: Command | null = null;

    if (target.enemy && energyGap(world, me, head) > GENERATOR_SPACING) {
      // Carry Energy along the bridge: a Generator at the own ground nearest the target that is
      // still inside a circle to build in.
      const powered = poweredHead(world, me, target);
      unit = powered ? generator(world, me, powered, planned) : null;
    } else if (
      (target.enemy && distance(head.x, head.y, target.x, target.y) <= ATTACK_REACH)
      || shooters < DEFENCE_SHOOTERS
    ) {
      unit = bestUnit(world, me, head, target, planned);
    }

    if (unit) {
      commands.push(unit);
    }
  }

  const transport = transports.length < TRANSPORTS ? newTransport(world, me) : null;

  if (transport) {
    commands.push(transport);
  }

  return commands;
}

/** A transport of the AI's Fury, or a Golem, laid by its Temple when it can spare the cost. */
function newTransport(world: WorldView, me: number): Command | null {
  const player = world.players.get(me)!;
  const home = temple(world, me);

  if (!home) {
    return null;
  }

  const kinds = [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> =>
      def?.cls === 'Ground Transport' && player.storm >= def.cost + TRANSPORT_SAVINGS
    )
    .sort((a, b) => b.speed - a.speed || a.id.localeCompare(b.id));
  const around = { x: home.x + home.fx, y: home.y + home.fy };

  for (const def of kinds) {
    const spot = findSpot(world, me, def, around, new Set());

    if (spot.command) {
      return spot.command;
    }
  }

  return null;
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

function temple(world: WorldView, me: number): View<Building> | undefined {
  return world.buildingsOf(me).find((b) => world.def(b.type).cls === 'Energy');
}

function centre(b: View<Building>): { x: number; y: number; } {
  return { x: b.x + (b.fx >> 1), y: b.y + (b.fy >> 1) };
}

const distance = (ax: number, ay: number, bx: number, by: number) =>
  Math.abs(ax - bx) + Math.abs(ay - by);

/** Geysers with stock standing on the AI's own ground, nearest to its Temple first. */
function reachableGeysers(world: WorldView, me: number): View<Geyser>[] {
  const home = temple(world, me);

  if (!home) {
    return [];
  }

  const { x, y } = centre(home);
  return [...world.entities.values()]
    .filter((e): e is View<Geyser> =>
      e.kind === 'geyser' && e.stock > 0 && world.owner[world.at(e.x, e.y)] === me
    )
    .sort((a, b) => distance(a.x, a.y, x, y) - distance(b.x, b.y, x, y) || a.id - b.id);
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
  const home = temple(world, me);

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

  for (const [id] of world.players) {
    const enemy = id === me ? undefined : temple(world, id);
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
 * the target cannot be reached through the sky, and on every cell that is not sky.
 */
function skyField(world: WorldView, target: Target): Int32Array {
  const radius = target.enemy ? ENEMY_REACH : GEYSER_REACH;
  const field = new Int32Array(W * H).fill(-1);
  const queue: number[] = [];

  for (let y = target.y - radius; y <= target.y + radius; y++) {
    for (let x = target.x - radius; x <= target.x + radius; x++) {
      if (world.inside(x, y) && world.terrain[world.at(x, y)] === Terrain.Sky) {
        field[world.at(x, y)] = 0;
        queue.push(world.at(x, y));
      }
    }
  }

  for (let head = 0; head < queue.length; head++) {
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
        queue.push(world.at(nx, ny));
      }
    }
  }

  return field;
}

/** The own walkable ground cell that borders the sky closest (along the field) to the target:
 * the head the bridge grows from, with the bridge it still needs. */
function bridgeHead(
  world: WorldView,
  me: number,
  field: Int32Array,
): { x: number; y: number; need: number; } | null {
  let best: { x: number; y: number; need: number; } | null = null;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Only ground a transport can walk on: bridging off a unit's islet would leave a bridge
      // that cannot be reached past the unit.
      if (world.owner[y * W + x] !== me || !world.walkable(me, x, y)) {
        continue;
      }

      for (const [dx, dy] of DIRS) {
        const step = world.inside(x + dx, y + dy) ? field[world.at(x + dx, y + dy)]! : -1;

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
  head: { x: number; y: number; need: number; },
  field: Int32Array,
): Command | null {
  const hand = world.players.get(me)!.hand;
  let best: Command | null = null;
  let bestNeed = head.need;

  for (let index = 0; index < hand.length; index++) {
    for (let rot = 0; rot < ROTATIONS; rot++) {
      const cells = rotatePiece(PIECES[hand[index]!.piece]!, rot);

      for (const [x, y] of nearby(head, SEARCH_RADIUS)) {
        const need = Math.min(
          ...cells.map(([dx, dy]) =>
            world.inside(x + dx, y + dy) && field[world.at(x + dx, y + dy)]! >= 0
              ? field[world.at(x + dx, y + dy)]!
              : Infinity
          ),
        );

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
  me: number,
  head: { x: number; y: number; },
  target: { x: number; y: number; },
  planned: ReadonlySet<number>,
): Command | null {
  const player = world.players.get(me)!;
  const known = [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> => def !== undefined && def.level > 0);
  // Alternate cannons, which fire along a line, with shooters that cover a square around them, so
  // a priest standing off the cannons' lines is still hit.
  const built = world.buildingsOf(me).map((b) => world.def(b.type)).filter((def) => def.dps > 0);
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
    const spot = findSpot(world, me, def, head, planned,
      def.group === 'cannon' ? facing : undefined);

    if (spot.command) {
      return spot.command;
    }

    short ||= spot.noEnergy;
  }

  return short ? generator(world, me, head, planned) : null;
}

/** A Generator by the head, of the AI's own Fury first. */
function generator(
  world: WorldView,
  me: number,
  head: { x: number; y: number; },
  planned: ReadonlySet<number>,
): Command | null {
  const player = world.players.get(me)!;
  const generators = [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> => def?.group === 'battery')
    .sort((a, b) =>
      Number(b.theme === player.theme) - Number(a.theme === player.theme)
      || a.id.localeCompare(b.id)
    );

  for (const def of generators) {
    const spot = findSpot(world, me, def, head, planned);

    if (spot.command) {
      return spot.command;
    }
  }

  return null;
}

/** The own ground nearest the target that lies within GENERATOR_SPACING of an Energy source. */
function poweredHead(
  world: WorldView,
  me: number,
  target: { x: number; y: number; },
): { x: number; y: number; } | null {
  let best: { x: number; y: number; } | null = null;
  let bestDistance = Infinity;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = distance(x, y, target.x, target.y);

      if (
        d < bestDistance && world.owner[y * W + x] === me && world.walkable(me, x, y)
        && energyGap(world, me, { x, y }) <= GENERATOR_SPACING
      ) {
        best = { x, y };
        bestDistance = d;
      }
    }
  }

  return best;
}

/** Distance from a cell to the centre of the nearest own Temple or Generator. */
function energyGap(world: WorldView, me: number, at: { x: number; y: number; }): number {
  let best = Infinity;

  for (const b of world.buildingsOf(me)) {
    const def = world.def(b.type);

    if (def.cls === 'Energy' || def.group === 'battery') {
      best = Math.min(best, Math.hypot(b.x + b.fx / 2 - at.x, b.y + b.fy / 2 - at.y));
    }
  }

  return best;
}

function findSpot(
  world: WorldView,
  me: number,
  def: Readonly<UnitDef>,
  head: { x: number; y: number; },
  planned: ReadonlySet<number>,
  facing?: Facing,
): { command: Command | null; noEnergy: boolean; } {
  let noEnergy = false;

  for (const [x, y] of nearby(head, UNIT_RADIUS)) {
    if (!clearOfBridges(world, def, x, y, planned)) {
      continue;
    }

    const command = {
      t: 'build',
      player: me,
      type: def.id,
      x,
      y,
      ...(facing === undefined ? {} : { facing }),
    } as const;
    const error = world.canBuild(command);

    if (error === null) {
      return { command, noEnergy };
    }

    noEnergy ||= error === 'no energy';

    if (error === 'no storm power' || error === 'not ready' || error === 'no workshop') {
      return { command: null, noEnergy };
    }
  }

  return { command: null, noEnergy };
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
