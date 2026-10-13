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
 * It also sends Aerial Transports to geysers no bridge reaches, lays an air base within reach of
 * the enemy, answers enemy air with anti-air guns, and closes its bridge head with a barrier.
 * One of its transports fetches a Spell from an Obelisk it can reach and casts it when enough
 * stands in range, and its Priest raises an Outpost on unowned ground its transports can walk to.
 */
import type { Command } from './commands.js';
import { flies, type UnitDef } from './defs.js';
import {
  DIRS,
  MAX_FACING,
  OUTPOST,
  PIECES,
  PIECE_HARD,
  Terrain,
  W,
  H,
  isBridge,
  oppositeDir,
  pieceEnds,
  rotatePiece,
  type Facing,
} from './state.js';
import { joins } from './rules/bridges.js';
import { facesWhenLaid } from './rules/combat.js';
import type { DeepReadonly, WorldView } from './view.js';
import type { Building, Entity, Geyser, Living, Priest, Transport } from './state.js';

type View<T> = DeepReadonly<T>;

/** How far around the bridge head the AI looks for a spot to lay a piece, and for a unit. */
const SEARCH_RADIUS = 5;
const UNIT_RADIUS = 9;
const ALTAR = 'altar';
// How far from its Temple the AI looks for room for an Altar, which is seven cells a side.
const ALTAR_RADIUS = 24;
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
/** Air bases the AI keeps, and fence posts: two barriers' worth (invented). */
const AIR_BASES = 2;
const FENCE_POSTS = 4;
/** How far apart the AI sets the two posts of a barrier: the widest that fits, down to posts that
 * nearly touch (invented). */
const POST_GAP_MAX = 12;
const POST_GAP_MIN = 4;

/**
 * How a mission sets its computer sides up, from the keys of its header. The original's AI is not
 * read; these are the keys this one can honour.
 */
export interface AiOptions {
  player: number;
  /** `!COLLECT_STORM_POWER`: false keeps it from mining geysers and buying transports. */
  collect?: boolean;
  /** `!ATTACH_TO_ENEMY_ISLAND`: false keeps its bridge away from the enemy. */
  attack?: boolean;
  /** `!SACRIFICE_ENEMY_PRIEST`: false keeps its transports from a fallen enemy Priest. */
  capture?: boolean;
  /** `aiCollectors`: transports it keeps. */
  transports?: number;
  /** `aiGeyserAttachments`: geysers it joins to its ground before it turns to the enemy. */
  geysers?: number;
  /** `aiNEnemy`: the side it goes for while that side stands. */
  enemy?: number;
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
  // Ground the transports can walk to now; joining anything else is what a bridge is for.
  const home = world.templeOf(me);
  const reached = home ? walkableFrom(world, me, home) : null;

  if (options.collect !== false) {
    collect(world, move, transports, geysers);
  }

  fetchSpell(world, move, transports, reached);
  castSpells(world, move, transports);
  buildAltar(world, move);
  buildOutpost(world, move, reached);

  if (options.capture !== false) {
    capture(world, move, transports);
  }

  const ward = wardSpot(world, me);

  if (ward) {
    move.commands.push({ t: 'movePriest', player: me, ...ward });
  }

  const attack = geysers.length >= (options.geysers ?? ENOUGH_GEYSERS)
    || player.storm >= ATTACK_STORM;
  const bounds = ownBounds(world, me);
  let target: Target | undefined;
  let head: Head | null = null;
  let piece: Extract<Command, { t: 'dropPiece'; }> | null = null;

  // Grow toward the first target a piece can be laid toward. When none can, the last target, the
  // enemy, still decides where units go.
  for (const candidate of bridgeTargets(world, me, attack, options.enemy)) {
    const field = skyField(world, candidate);
    target = candidate;
    const heads = bounds && reached ? bridgeHeads(world, me, field, bounds, reached) : [];
    head = heads[0] ?? null;
    piece = null;

    // The nearest head may sit in a pocket of the AI's own bridge, where every piece only leads
    // further from the target; then the bridge goes on from the next head that a piece improves.
    for (const from of heads) {
      // Told to keep off the enemy's island, it lays no bridge toward him; he still decides
      // where its units go.
      piece = reached && !(candidate.enemy && options.attack === false)
        ? bestPiece(world, me, from, field, reached)
        : null;

      if (piece) {
        break;
      }
    }

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

    if (target.enemy && shooters >= DEFENCE_SHOOTERS) {
      barrier(world, move, head);
    }
  }

  if (options.collect !== false && transports.length < (options.transports ?? TRANSPORTS)) {
    newTransport(world, move, geysers.length === 0);
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
  walked: View<Geyser>[],
): void {
  // An Aerial Transport needs no bridge: any geyser with stock will do for it.
  const flown = transports.some((t) => flies(world.def(t.type))) ? geysersFor(world, move.me) : [];
  const crews = new Map([...walked, ...flown].map((g) => [g.id, 0]));

  for (const t of transports) {
    if (t.target !== null && crews.has(t.target) && (t.goal === 'collect' || t.goal === 'home')) {
      crews.set(t.target, crews.get(t.target)! + 1);
    }
  }

  for (const t of transports) {
    if (t.goal !== 'idle' || t.carrying !== null) {
      continue;
    }

    // "Reachable from the Temple" is not "reachable by this transport": buildings can wall off a
    // part of the island. One on foot is offered only the geysers it has a way to.
    const geysers = flies(world.def(t.type))
      ? flown
      : walked.filter((g) =>
        world.findPath(move.me, t.x, t.y, ([x, y]) => distance(x, y, g.x, g.y) === 1) !== null
      );

    if (!geysers.length) {
      continue;
    }

    // Stable: geysers are already ordered nearest first, so a tie goes to the nearer one.
    const geyser = geysers.reduce((best, g) => (crews.get(g.id)! < crews.get(best.id)! ? g : best));
    crews.set(geyser.id, crews.get(geyser.id)! + 1);
    move.commands.push({ t: 'collect', player: move.me, transport: t.id, geyser: geyser.id });
  }
}

/**
 * "To begin the sacrificial process, you must build an Altar": nobody starts a battle with one,
 * the Priest builds it. The AI has him build one near its Temple as soon as it can pay for it.
 */
function buildAltar(world: WorldView, move: Move): void {
  const def = world.defs.get(ALTAR);
  const priest = world.priestOf(move.me);
  const home = world.templeOf(move.me);

  if (!def || !priest || world.buildingsOf(move.me).some((b) => b.type === ALTAR)) {
    return;
  }

  place(world, move, def, home ? centre(home) : priest, undefined, ALTAR_RADIUS);
}

/* oxlint-disable no-magic-numbers -- thresholds of an invented opponent */
/**
 * When a Spell is worth its Storm Power to the AI, given what stands in its range: enemies and
 * friends on the ground and in the air, and friends with less than half of their hit points. All
 * invented. Spells that are missing here (Invisibility, Bridge Harden) the AI does not use.
 */
type Reach = { foes: number; friends: number; foesAir: number; friendsAir: number; hurt: number; };
const STRIKE = (r: Reach) => r.foes >= 2 && r.foes > r.friends * 2;
const SUMMON = (r: Reach) => r.foes >= 1;
const SPELL_USE: Readonly<Record<string, (r: Reach) => boolean>> = {
  bombexplodesmall: STRIKE,
  bombexplodemedium: STRIKE,
  bombexplodelarge: STRIKE,
  bomblightingwave: STRIKE,
  bomblightingzap: STRIKE,
  bombmeteor: STRIKE,
  bombgraviton: (r) => r.foesAir >= 1 && r.friendsAir === 0,
  bombheal: (r) => r.hurt >= 2 && r.foes + r.foesAir === 0,
  bombparalyze: (r) => r.foes + r.foesAir >= 2 && r.friends + r.friendsAir === 0,
  bombtreason: (r) => r.foes >= 2,
  bombtwister: SUMMON,
  bombiitwister: SUMMON,
  bombiiitwister: SUMMON,
  bombimano: SUMMON,
  bombiimano: SUMMON,
  bombiiimano: SUMMON,
};
/* oxlint-enable no-magic-numbers */

/** Whether a unit stands within `range` cells of a caster, as rules/spells.ts measures it. */
function inReach(t: View<Transport>, e: View<Living>, range: number): boolean {
  const [fx, fy] = e.kind === 'building' ? [e.fx, e.fy] : [1, 1];
  const dx = Math.max(e.x - t.x, 0, t.x - (e.x + fx - 1));
  const dy = Math.max(e.y - t.y, 0, t.y - (e.y + fy - 1));
  return dx * dx + dy * dy <= range * range;
}

/** What stands around a caster within the range of its Spell. */
function inRange(world: WorldView, t: View<Transport>, range: number): Reach {
  const reach: Reach = { foes: 0, friends: 0, foesAir: 0, friendsAir: 0, hurt: 0 };

  for (const e of world.entities.values()) {
    if (!('hp' in e) || e.id === t.id || e.hp <= 0 || !inReach(t, e, range)) {
      continue;
    }

    const air = e.kind === 'flyer' || (e.kind === 'transport' && flies(world.def(e.type)));

    if (world.hostile(t.owner, e.owner)) {
      reach[air ? 'foesAir' : 'foes']++;
    } else {
      reach[air ? 'friendsAir' : 'friends']++;
      reach.hurt += e.hp * 2 < e.hpMax ? 1 : 0;
    }
  }

  return reach;
}

/** Cast the Spell of each transport that has one, where it stands, when it is worth it. */
function castSpells(world: WorldView, move: Move, transports: View<Transport>[]): void {
  for (const t of transports) {
    const def = t.spell === null ? undefined : world.defs.get(t.spell);
    const worth = t.spell === null ? undefined : SPELL_USE[t.spell];

    if (!def || !worth || t.casting > 0 || t.paralyzed > 0 || def.cost > move.budget) {
      continue;
    }

    if (worth(inRange(world, t, def.range))) {
      move.budget -= def.cost;
      move.commands.push({ t: 'castSpell', player: move.me, transport: t.id });
    }
  }
}

/** Send one idle transport to an Obelisk it can get to, while none of them has a Spell. */
function fetchSpell(
  world: WorldView,
  move: Move,
  transports: View<Transport>[],
  reached: Uint8Array | null,
): void {
  const free = transports.find((t) => t.goal === 'idle' && t.carrying === null);

  if (!free || transports.some((t) => t.spell !== null || t.goal === 'obelisk')) {
    return;
  }

  const walked = (x: number, y: number): boolean =>
    world.inside(x, y) && reached?.[world.at(x, y)] === 1;

  for (const o of world.entities.values()) {
    const usable = o.kind === 'obelisk' && o.spell in SPELL_USE;

    if (
      usable
      && (flies(world.def(free.type)) || DIRS.some(([dx, dy]) => walked(o.x + dx, o.y + dy)))
    ) {
      move.commands.push({ t: 'takeSpell', player: move.me, transport: free.id, obelisk: o.id });
      return;
    }
  }
}

/**
 * "Neutral Islands can also be claimed as your own with an Outpost." A side that has the Outpost
 * (in the original, in multiplayer only) has its Priest raise one on the first unowned island
 * ground its transports can walk to, one at a time.
 */
function buildOutpost(world: WorldView, move: Move, reached: Uint8Array | null): void {
  const def = world.defs.get(OUTPOST);
  const mine = world.buildingsOf(move.me);

  if (
    !def || !reached || !world.players.get(move.me)!.tech.has(OUTPOST)
    || move.budget < def.cost + TRANSPORT_SAVINGS
    || mine.some((b) => b.type === OUTPOST && b.rising > 0)
  ) {
    return;
  }

  const free = reached.findIndex((walked, i) =>
    walked === 1 && world.terrain[i] === Terrain.Island && world.owner[i] === 0
  );

  if (free >= 0) {
    place(world, move, def, { x: free % W, y: Math.floor(free / W) });
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
  const home = world.templeOf(move.me);

  // He has to be within a step of ground the transports can walk to: a bridge that merely lies
  // beside his island does not lead onto it.
  if (!home) {
    return;
  }

  const reached = walkableFrom(world, move.me, home);
  const near = (x: number, y: number): boolean =>
    world.inside(x, y) && reached[world.at(x, y)] === 1;

  if (
    !near(captive.x, captive.y)
    && !DIRS.some(([dx, dy]) => near(captive.x + dx, captive.y + dy))
  ) {
    return;
  }

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
// An Aerial Transport is bought first when no geyser can be walked to.
function newTransport(world: WorldView, move: Move, stranded: boolean): void {
  const player = world.players.get(move.me)!;
  const home = world.templeOf(move.me);

  if (!home) {
    return;
  }

  const kinds = [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> =>
      (def?.cls === 'Ground Transport' || def?.cls === 'Aerial Transport')
      && move.budget >= def.cost + TRANSPORT_SAVINGS
    )
    // With no geyser to walk to, one that flies comes first; otherwise the fastest on foot.
    .sort((a, b) =>
      Number(flies(b) === stranded) - Number(flies(a) === stranded)
      || b.speed - a.speed || a.id.localeCompare(b.id)
    );
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

/** Every geyser with stock, nearest to the Temple first: what an Aerial Transport can work. */
function geysersFor(world: WorldView, me: number): View<Geyser>[] {
  const home = world.templeOf(me);

  if (!home) {
    return [];
  }

  const { x, y } = centre(home);
  return [...world.entities.values()]
    .filter((e): e is View<Geyser> => e.kind === 'geyser' && e.stock > 0)
    .sort((a, b) => distance(a.x, a.y, x, y) - distance(b.x, b.y, x, y) || a.id - b.id);
}

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

    for (const [dir, [dx, dy]] of DIRS.entries()) {
      if (
        world.walkable(me, x + dx, y + dy) && world.joined(x, y, dir)
        && !reached[world.at(x + dx, y + dy)]
      ) {
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
    if (entity.kind === 'priest' && world.hostile(entity.owner, me) && entity.state === state) {
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
function bridgeTargets(
  world: WorldView,
  me: number,
  attack: boolean,
  prefer?: number,
): Target[] {
  // The side a mission names as this one's enemy comes first while it stands.
  const chosen = prefer !== undefined && world.players.get(prefer)?.alive
      && world.hostile(prefer, me) && world.templeOf(prefer)
    ? prefer
    : undefined;
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
    const foe = world.hostile(id, me) && other.alive && (chosen === undefined || chosen === id);
    const enemy = foe ? world.templeOf(id) : undefined;
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

/** The own ground cells the bridge can grow from, each with the bridge it still needs: ground a
 * transport can walk to that borders the sky on a side it joins on. */
/** How many heads a move tries, the nearest to the target first (invented). */
const HEADS = 8;

function bridgeHeads(
  world: WorldView,
  me: number,
  field: Int32Array,
  bounds: Bounds,
  reached: Uint8Array,
): Head[] {
  const all: Head[] = [];

  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      // Only ground a transport can walk to from the Temple: a bridge carried on from behind a
      // unit's islet, or from a stretch that is not joined to the rest, could not be used.
      if (world.owner[y * W + x] !== me || reached[y * W + x] !== 1) {
        continue;
      }

      // Bridge goes on only from a side the cell joins on: any side of island ground, the open
      // ends of a bridge cell.
      for (const [dir, [dx, dy]] of DIRS.entries()) {
        const step = world.inside(x + dx, y + dy) && joins(world, world.at(x, y), dir)
          ? field[world.at(x + dx, y + dy)]!
          : -1;

        if (step >= 0) {
          all.push({ x, y, need: step + 1 });
        }
      }
    }
  }

  // Nearest first, and no two within reach of the same search for a piece.
  all.sort((a, b) => a.need - b.need || a.y - b.y || a.x - b.x);
  const heads: Head[] = [];

  for (const head of all) {
    if (heads.length === HEADS) {
      break;
    }

    if (
      heads.every((kept) =>
        Math.max(Math.abs(kept.x - head.x), Math.abs(kept.y - head.y)) > SEARCH_RADIUS
      )
    ) {
      heads.push(head);
    }
  }

  return heads;
}

/** The piece placement near the head that shortens the bridge still needed the most. */
function bestPiece(
  world: WorldView,
  me: number,
  head: Head,
  field: Int32Array,
  reached: Uint8Array,
): Extract<Command, { t: 'dropPiece'; }> | null {
  const hand = world.players.get(me)!.hand;
  let best: Extract<Command, { t: 'dropPiece'; }> | null = null;
  let bestNeed = head.need;

  for (let index = 0; index < hand.length; index++) {
    // Only pieces that have turned hard in the window: a loose end of anything softer wears away
    // within a minute and a half, and the bridge would have to be laid again.
    if (hand[index]!.age < PIECE_HARD) {
      continue;
    }

    for (let rot = 0; rot < ROTATIONS; rot++) {
      const cells = rotatePiece(PIECES[hand[index]!.piece]!, rot);
      const ends = pieceEnds(hand[index]!.piece, rot);

      for (const [x, y] of nearby(head, SEARCH_RADIUS)) {
        const need = needAfter(world, me, field, reached, cells, ends, x, y);

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

/** Better than reaching the target's surroundings: an open end joined to new ground. */
const JOINED = -1;

/** Bridge still needed once the piece lies at (x, y): none if it reaches the target's surroundings,
 * otherwise the least from the sky beyond one of its open ends, where the next piece can attach.
 * A piece whose open end meets ground the transports cannot walk to yet counts for more than
 * either: only a joined bridge claims a geyser's islet or lets a transport onto an island, and a
 * bridge that stops a cell short of the shore does neither. */
function needAfter(
  world: WorldView,
  me: number,
  field: Int32Array,
  reached: Uint8Array,
  cells: [number, number][],
  ends: [number, number, number][],
  x: number,
  y: number,
): number {
  const at = (cx: number, cy: number): number =>
    world.inside(cx, cy) ? field[world.at(cx, cy)]! : -1;

  const joinsNewGround = ends.some(([ex, ey, dir]) => {
    const cx = x + ex + DIRS[dir]![0];
    const cy = y + ey + DIRS[dir]![1];
    // Ground a transport could stand on and that takes the join from this side: not a unit's
    // islet, and not the flank of someone's bridge.
    return world.walkable(me, cx, cy) && reached[world.at(cx, cy)] !== 1
      && joins(world, world.at(cx, cy), oppositeDir(dir));
  });

  if (joinsNewGround) {
    return JOINED;
  }

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
  target: Target,
): void {
  const player = world.players.get(move.me)!;
  const known = [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> => def !== undefined && def.level > 0);
  const mine = world.buildingsOf(move.me);
  // An air base where its flyers reach the enemy from: they hunt around the place they start.
  const bases = known.filter((def) => def.group === 'aviary')
    .sort((a, b) => b.range - a.range || a.id.localeCompare(b.id));
  const near = Math.max(Math.abs(head.x - target.x), Math.abs(head.y - target.y));

  for (const def of bases) {
    const have = mine.filter((b) => world.def(b.type).group === 'aviary').length;

    if (
      target.enemy && have < AIR_BASES && near <= def.range && place(world, move, def, head).placed
    ) {
      return;
    }
  }

  // A gun that hits only the air is worth its price once the enemy flies.
  const air = enemyFlies(world, move.me);
  // Alternate cannons, which fire along a line, with shooters that cover a square around them, so
  // a priest standing off the cannons' lines is still hit.
  const built = world.buildingsOf(move.me).map((b) => world.def(b.type)).filter((def) =>
    def.dps > 0
  );
  const lines = built.filter((def) => def.group === 'cannon').length;
  const preferLine = lines < built.length - lines;
  const shooters = known
    .filter((def) =>
      def.dps > 0 && def.range > 0 && def.group !== 'fence' && (air || def.group !== 'anti-air')
    )
    .sort((a, b) =>
      Number(air && b.group === 'anti-air') - Number(air && a.group === 'anti-air')
      || Number((b.group === 'cannon') === preferLine)
        - Number((a.group === 'cannon') === preferLine)
      || b.cost - a.cost || a.id.localeCompare(b.id)
    );
  const facing = toward(head, target);
  let short = false;

  for (const def of shooters) {
    const spot = place(world, move, def, head, facesWhenLaid(def) ? facing : undefined);

    if (spot.placed) {
      return;
    }

    short ||= spot.noEnergy;
  }

  if (short) {
    generator(world, move, head);
  }
}

/** Whether some other side has an air base, a flyer or an Aerial Transport. */
function enemyFlies(world: WorldView, me: number): boolean {
  for (const e of world.entities.values()) {
    if ('type' in e && world.hostile(e.owner, me)) {
      const def = world.def(e.type);

      if (flies(def) || def.group === 'aviary') {
        return true;
      }
    }
  }

  return false;
}

/**
 * Close the bridge head with a barrier: a second post in line with one that stands alone, or a
 * first post by the head. Posts of the AI's own Fury come first, the Sun Barricade after them.
 */
function barrier(world: WorldView, move: Move, head: { x: number; y: number; }): void {
  const player = world.players.get(move.me)!;
  const posts = world.buildingsOf(move.me).filter((b) => world.def(b.type).group === 'fence');
  const kinds = [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> => def?.group === 'fence')
    .sort((a, b) =>
      Number(b.theme === player.theme) - Number(a.theme === player.theme)
      || a.id.localeCompare(b.id)
    );

  // Two posts of one kind on one row or column, in range of each other, make a barrier.
  const paired = (post: View<Building>) =>
    posts.some((other) =>
      other !== post && other.type === post.type
      && (other.x === post.x || other.y === post.y)
      && distance(other.x, other.y, post.x, post.y) <= world.def(post.type).range
    );
  const alone = posts.find((post) => !paired(post));

  if (alone) {
    const def = world.def(alone.type);

    for (let gap = Math.min(POST_GAP_MAX, def.range); gap >= POST_GAP_MIN; gap--) {
      for (const [dx, dy] of DIRS) {
        if (lay(world, move, def, alone.x + dx * gap, alone.y + dy * gap)) {
          return;
        }
      }
    }

    return;
  }

  if (posts.length < FENCE_POSTS && kinds[0]) {
    place(world, move, kinds[0], head);
  }
}

/** Lay a unit at exactly this cell, if the move can afford it and the cell is fit. */
function lay(world: WorldView, move: Move, def: Readonly<UnitDef>, x: number, y: number): boolean {
  const command = { t: 'build', player: move.me, type: def.id, x, y } as const;

  if (def.cost > move.budget || world.canBuild(command) !== null) {
    return false;
  }

  move.commands.push(command);
  move.budget -= def.cost;

  for (let fy = y; fy < y + def.footY; fy++) {
    for (let fx = x; fx < x + def.footX; fx++) {
      move.planned.add(world.at(fx, fy));
    }
  }

  return true;
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
  radius = UNIT_RADIUS,
): { placed: boolean; noEnergy: boolean; } {
  let noEnergy = false;

  if (def.cost > move.budget) {
    return { placed: false, noEnergy };
  }

  for (const [x, y] of nearby(head, radius)) {
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
