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
 * Its Priest raises a Workshop for each Fury it knows units of, it fills their Production Slots,
 * shooters first, and Upgrades a full Workshop once Storm Power is plenty. Between builds the
 * Priest carries crystals from a geyser out of the enemy's fire. Its guns face the
 * enemy: they stand at its bridge heads nearest him, never by a geyser he is not at.
 */
import type { Command, CommandError } from './commands.js';
import { ALARM_DISTANCE, defendScore, pushing, type Pressure } from './ai/goals.js';
import { LOSS_MOVES, random, remember, type AiMemory } from './ai/memory.js';
import { hoarding, useful, wantedTransports, worth } from './ai/economy.js';
import { DIFFICULTY, type AiParams, type Difficulty } from './ai/params.js';
import { skyCosts, threatMap, type ThreatMap } from './ai/threat.js';
import { flies, upgradeCost, type UnitDef, type UnitGroup } from './defs.js';
import {
  DIRS,
  ENERGY_RANGE,
  MAX_FACING,
  MAX_UPGRADES,
  OUTPOST,
  PIECES,
  PIECE_HARDEN,
  Terrain,
  TPS,
  W,
  WORKSHOP_SLOTS,
  H,
  isBridge,
  oppositeDir,
  pieceEnds,
  rotatePiece,
  type Facing,
} from './state.js';
import { joins } from './rules/bridges.js';
import { takesSlot } from './rules/building.js';
import { facesWhenLaid } from './rules/combat.js';
import type { DeepReadonly, WorldView } from './view.js';
import type { Building, Crystal, Entity, Geyser, Living, Priest, Transport } from './state.js';

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
/** Cells of sky a new siege point may save for each cell it lies from the last one: the arm
 * already built toward the last one is worth that much (invented). */
const SIEGE_DRIFT = 2;
/** Storm Power the AI keeps back when buying a transport (invented). */
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
/** Cells between the Generators that carry Energy along a bridge: a Generator is laid within
 * UNIT_RADIUS of the head and must itself stand within ENERGY_RANGE of the last Energy; 20 would
 * do by that count, but 18 is what carries the chain to the end on the test map (invented). */
const GENERATOR_SPACING = 18;
/** Air bases the AI keeps, and fence posts: two barriers' worth (invented). */
const AIR_BASES = 2;
const FENCE_POSTS = 4;
/** How far apart the AI sets the two posts of a barrier: the widest that fits, down to posts that
 * nearly touch (invented). */
const POST_GAP_MAX = 12;
const POST_GAP_MIN = 4;
/** Storm Power the AI keeps after paying for a Workshop Upgrade (invented). */
const UPGRADE_SAVINGS = 1000;
/** Classes the Priest builds: one at a time, or the second order calls him off the first. */
const PRIEST_BUILT: ReadonlySet<string> = new Set(['Energy', 'Production', 'Altar']);

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
  /** The level chosen for a skirmish; a campaign side plays at `normal`. */
  difficulty?: Difficulty;
  /** `aiSalvageChance`, 0 to 1: how readily it salvages a gun that has nothing to shoot at. */
  salvageChance?: number;
  /** `!CONCENTRATE_FIRE`: false has it content with one gun on the enemy's Priest. */
  concentrate?: boolean;
  /** `!ENCIRCLE_ENEMY_ISLAND`: false has it grow one bridge a move. */
  encircle?: boolean;
  /** `!STOP_COLLECTING_FROM_DANGEROUS_GEYSERS`: false sends transports to geysers under fire. */
  avoidDanger?: boolean;
  /** `!USE_PRIEST_TO_COLLECT`: false keeps its Priest from carrying crystals between builds. */
  priestCollects?: boolean;
}

/** Takes the AI's reasons, a line at a time, for a person who reads why it did what it did. */
export type AiExplain = (line: string) => void;

/**
 * Commands for one move of an AI player. Call it every `DIFFICULTY[level].moveSeconds` of game
 * time, with the same `memory` each time: the move reads it and writes this move into it.
 * `explain`, when given, is told what the move saw, what it weighed and why each command was
 * chosen; the commands are the same with it or without.
 */
export function aiMove(
  world: WorldView,
  options: AiOptions,
  memory?: AiMemory,
  explain?: AiExplain,
): Command[] {
  return aiMoveOn(withBuildingsCached(world), options, memory, explain);
}

/**
 * The world as the move reads it, with `buildingsOf` answered once per side and group: a move
 * asks for a side's buildings hundreds of times (every `canBuild` looks for a Workshop and for
 * Energy) and changes nothing meanwhile, so the answer stays the same. The arrays are shared:
 * nothing here may sort or splice them.
 */
function withBuildingsCached(world: WorldView): WorldView {
  const cache = new Map<string, ReturnType<WorldView['buildingsOf']>>();
  return Object.create(world, {
    buildingsOf: {
      value(p: number, group?: UnitGroup) {
        const key = `${p}:${group ?? ''}`;
        let found = cache.get(key);

        if (!found) {
          found = world.buildingsOf(p, group);
          cache.set(key, found);
        }

        return found;
      },
    },
  });
}

function aiMoveOn(
  world: WorldView,
  options: AiOptions,
  memory: AiMemory | undefined,
  explain: AiExplain | undefined,
): Command[] {
  const me = options.player;
  const player = world.players.get(me);

  if (!player?.alive || world.winner !== null) {
    return [];
  }

  // The level's knobs, turned down where the mission denies an ability.
  const params: Readonly<AiParams> = {
    ...DIFFICULTY[options.difficulty ?? 'normal'],
    ...(options.concentrate === false ? { concentrate: 1 } : {}),
    ...(options.encircle === false ? { bridgeHeads: 1 } : {}),
  };
  const seen = noticed(world, memory, params.reactionMoves * params.moveSeconds);
  // The commands of one move are checked against the same world, so this move's own spending and
  // cells are tracked here: later commands must not count on Storm Power or ground already used.
  const move: Move = {
    me,
    budget: player.storm,
    planned: new Set(),
    laid: new Set(),
    commands: [],
    threat: threatMap(world, me, seen),
    weight: params.threatWeight,
    fleeing: false,
    ritual: false,
    params,
    guns: enemyGuns(world, me, seen),
    actions: 0,
    energized: false,
    usedHands: new Set(),
  };
  const transports = owned<Transport>(world, me, 'transport');
  // Ground the transports can walk to now; joining anything else is what a bridge is for.
  const home = world.templeOf(me);
  const reached = home ? walkableFrom(world, me, home) : null;
  const geysers = home && reached ? reachableGeysers(world, me, home, reached) : [];
  const bounds = ownBounds(world, me);
  const pressure = sense(world, move, memory, bounds);
  const defend = defendScore(pressure);
  const prices = knownShooters(world, me).map((def) => def.cost);
  const cheapest = prices.length ? Math.min(...prices) : 0;
  // An enemy Priest down within a step of walkable ground and no Altar to take him to: its price
  // is held from everything but a defence under fire, the defence reserve too, until the Altar
  // takes it.
  const captive = options.capture === false ? undefined : enemyPriest(world, me, 'down');
  const within = captive !== undefined && reached !== null
    && [[0, 0] as const, ...DIRS].some(([dx, dy]) =>
      world.inside(captive.x + dx, captive.y + dy)
      && reached[world.at(captive.x + dx, captive.y + dy)] === 1
    );
  const altar = world.defs.get(ALTAR);
  const altarCost = within && altar && !world.buildingsOf(me).some((b) => b.type === ALTAR)
    ? altar.cost
    : 0;
  let altarHeld = 0;
  const holdAltar = () => {
    const more = Math.min(move.budget, altarCost - altarHeld);
    altarHeld += more;
    move.budget -= more;
  };

  if (!pressure.fired) {
    holdAltar();
  }

  // Storm Power for a defence is held back from everything else, until a defence is called for.
  let reserve = defend === 0 ? Math.min(move.budget, params.reserveShooters * cheapest) : 0;
  move.budget -= reserve;
  let told = 0;
  /** Tell the commands chosen since the last call, each with why it was chosen. */
  const because = (why: string) => {
    for (const command of explain ? move.commands.slice(told) : []) {
      explain!(`  ${why} → ${describeCommand(command)}`);
    }

    told = move.commands.length;
  };
  explain?.(`[${(world.tick / TPS).toFixed(1)}s] side ${me} (${params.moveSeconds}s moves): `
    + `Storm Power ${player.storm}, ${reserve} held back for a defence; `
    + `defence wanted ${defend.toFixed(2)} (under fire: ${pressure.fired}, `
    + `losses: ${pressure.losses}, enemy ground ${pressure.approach ?? 'none'} cells near of `
    + `${ALARM_DISTANCE}); geysers reached: ${geysers.length}; transports: ${transports.length}`);

  shelter(world, move);
  because('the Priest stands under enemy guns: he walks out of their reach');
  // With a captive chained on the own Altar, or carried toward it, the Priest is for the ritual
  // alone: nothing is raised by him meanwhile, nor does he go collecting.
  move.ritual = captiveComing(world, me);

  if (defend > 0) {
    defendGround(world, move, pressure, bounds);
    because(`defence (wanted ${defend.toFixed(2)}): a gun where the enemy presses`);
  }

  if (memory && params.breaches) {
    breach(world, move, memory, pressure, bounds, reached);
    because('an enemy bridge comes near: a cheap unit beside it, salvaged for its blast');
  }

  // Without a transport the side earns only by its Priest's walks: the first one comes before
  // everything but a defence, with nothing kept back, not even the reserve for a defence, and its
  // price is saved until it can be paid.
  let saving = 0;
  const firstTransport = options.collect !== false && transports.length === 0;

  if (firstTransport) {
    const before = move.commands.length;
    move.budget += reserve;
    newTransport(world, move, geysers.length === 0, 0);
    because('no transport yet: the first is bought before anything but a defence');
    reserve = Math.min(move.budget, reserve);
    move.budget -= reserve;

    if (move.commands.length === before) {
      const fares = transportKinds(world, me).map((def) => def.cost);
      saving = fares.length ? Math.min(move.budget, Math.min(...fares)) : 0;
      move.budget -= saving;
      explain?.(`  no transport yet: ${saving} kept toward the first`);
    }
  }

  if (memory) {
    salvageIdle(world, move, memory, options.salvageChance ?? params.salvageChance, defend);
    because('a gun has had nothing to shoot at for long: salvaged');
  }

  if (options.collect !== false) {
    collect(world, move, transports, geysers, options.avoidDanger !== false);
    because('an idle transport: to a loose crystal, or the geyser fewest transports work');
  }

  // Transports for the geysers in reach, on foot or in the air, unless the mission says how many:
  // before Workshops and guns, because every transport short is 200 Storm Power a trip not earned,
  // and nothing is kept back for them but the defence reserve.
  const mined = transports.some((t) => flies(world.def(t.type)))
    ? geysersFor(world, me).length
    : geysers.length;
  const wanted = options.transports ?? wantedTransports(mined, params.maxTransports);

  if (options.collect !== false && !firstTransport && transports.length < wanted) {
    newTransport(world, move, geysers.length === 0, 0);
    because(`${transports.length} transports, ${wanted} wanted for ${mined} geysers`);
  }

  // A captive to be had and no transport to carry him or no Altar to take him to, nor the Storm
  // Power for them: what stands out of the fight is salvaged for it, since the capture is the game.
  if (within) {
    const fares = options.collect !== false && transports.length === 0
      ? transportKinds(world, me).map((def) => def.cost)
      : [];
    const fare = (fares.length ? Math.min(...fares) : 0) + altarCost;

    if (fare > move.budget + altarHeld) {
      fundCapture(world, move);
      because('an enemy Priest is down and no transport or Altar for him: salvaged for the fare');
    }

    holdAltar();
  }

  guardAltar(world, move);
  because('a captive on the Altar: guns kept about it');

  fetchSpell(world, move, transports, reached);
  because('a Spell on an Obelisk in reach: a transport fetches it');
  castSpells(world, move, transports);
  because('enough enemies in range of a carried Spell: cast');
  equip(world, move, geysers.length === 0);
  because('Workshops: a Workshop for a Fury it knows, filled slots, an Upgrade');
  // Toward the enemy once the economy is up, and the AI's guns outweigh his for the level.
  const ownDps = world.buildingsOf(me).reduce((sum, b) => sum + groundDps(world.def(b.type)), 0);
  const enemyDps = move.guns.reduce((sum, b) => sum + groundDps(world.def(b.type)), 0);
  const attack = (geysers.length >= (options.geysers ?? ENOUGH_GEYSERS)
    || player.storm >= ATTACK_STORM)
    && pushing(ownDps, enemyDps, params.pushRatio, memory?.pushing ?? false);

  if (memory) {
    memory.pushing = attack;
  }

  explain?.(`  push for the enemy: ${attack} (geysers ${geysers.length} of `
    + `${options.geysers ?? ENOUGH_GEYSERS} or Storm Power ${ATTACK_STORM}; ground guns `
    + `${ownDps.toFixed(1)} against his ${enemyDps.toFixed(1)}, ${params.pushRatio}× wanted)`);

  // The Altar is for a captive alone: it is raised once the push for the enemy begins, or his
  // Priest is already down, which leaves its ten seconds to rise before a carrier comes with him.
  // Raised at once, it would take the Storm Power the first transports and guns are wanted for.
  move.budget += altarHeld;

  if (options.capture !== false && (attack || enemyPriest(world, me, 'down'))) {
    const before = move.commands.length;
    buildAltar(world, move);
    because('no Altar yet and a captive in sight: the Priest builds one near the Temple');

    if (move.commands.length === before) {
      move.budget -= altarHeld;
      saving += altarHeld;
    }
  }

  buildOutpost(world, move, reached);
  because('unowned ground in reach: the Priest raises an Outpost');

  if (options.capture !== false) {
    capture(world, move, transports);
    because('an enemy Priest is down: the nearest transports carry him off');
  }

  const ward = move.fleeing ? null : wardSpot(world, me, move.threat);

  if (ward) {
    move.commands.push({ t: 'movePriest', player: me, ...ward });
    because('a captive is chained to the Altar: the Priest goes beside it for the ritual');
  }

  const priest = world.priestOf(me);

  // "Like the Golem, your Priest also serves as a Transport": between his builds he carries
  // crystals, from the geyser nearest home that no enemy gun reaches, unless the mission denies it.
  // Not during a ritual, even once he stands by the Altar: a rune waits while he is away.
  if (priest?.state === 'normal' && !ward && !move.ritual && !priestBusy(world, move)) {
    const allowed = options.collect !== false && options.priestCollects !== false;
    const sent = allowed && priestCollect(world, move, priest, geysers, home);
    because('the Priest has nothing to build: he carries crystals from a geyser out of fire');

    if (explain && !sent) {
      let why = 'the mission keeps him from collecting';

      if (allowed) {
        why = priest.goal === 'idle'
          ? 'no geyser he can walk to is out of enemy fire'
          : `he goes on with his ${priest.goal}`;
      }

      explain(`  the Priest (at ${priest.x},${priest.y}) has no order this move: ${why}`);
    }
  }

  let target: Target | undefined;
  let head: Head | null = null;
  let first: { target: Target; head: Head | null; heads: Head[]; } | null = null;
  let unitHeads: Head[] = [];
  let laidPieces = 0;
  /** A geyser the bridge has come up to with no piece in hand to join it: the hand is cycled. */
  let joinWanted: Target | undefined;
  const reach = bounds && reached ? reachField(world, move, reached, bounds) : null;

  // Grow toward each target a piece can be laid toward, as many bridges as the level grows in a
  // move, each from another piece in hand. The first target a piece goes toward decides where
  // units go; when none can be laid, the first target, the one most wanted, does.
  const targets = bridgeTargets(world, move, memory, attack, options.enemy, reach, reached);
  const candidates = targets.slice(0, params.bridgeHeads + SPARE_TARGETS);
  explain?.(`  bridge targets, best first: ${candidates.map(describeTarget).join('; ') || 'none'}`);

  for (const candidate of candidates) {
    if (laidPieces >= params.bridgeHeads) {
      break;
    }

    const field = skyField(world, move, candidate);
    const heads = bounds && reached ? bridgeHeads(world, me, field, bounds, reached) : [];
    first ??= { target: candidate, head: heads[0] ?? null, heads };
    let piece: Extract<Command, { t: 'dropPiece'; }> | null = null;

    // A bridge that has come up to the enemy grows no further toward him: a piece into the sky
    // about him would only take the room the guns need. But a gun stands only off an open end of
    // the bridge; when no end faces room from which a gun reaches him or his Temple, one piece
    // turns an end that way. A geyser is still joined from a cell away.
    if (candidate.enemy && heads[0] && heads[0].need <= ARRIVED) {
      const marks: Mark[] = [candidate, ...enemyTemples(world, me, candidate)];

      if (reached && options.attack !== false && !anyFit(world, move, heads[0], marks)) {
        piece = slotPiece(world, move, memory, heads, move.usedHands, marks);

        // Come up to the point and no piece makes room for a gun there: another point next move.
        if (!piece && memory && memory.slotLook === world.tick && candidate.exact) {
          memory.badSieges.add(world.at(candidate.x, candidate.y));
          memory.siege = null;
        }
      }
    } else {
      // Near enough to the enemy's Temple that a piece could end where a gun reaches it: such a
      // piece before any that merely comes nearer: the shore by his Temple may lie in a notch
      // that no bridge end can face straight on.
      const temples = candidate.enemy && options.attack !== false
        ? enemyTemples(world, me, candidate)
        : [];
      const longest = knownShooters(world, me).reduce((most, def) => Math.max(most, def.range), 0);
      const near = heads.slice(0, SLOT_HEADS).filter((from) =>
        temples.some((temple) => nearRect(from, temple) <= longest + SEARCH_RADIUS)
      );

      if (near.length && !anyFit(world, move, near[0]!, temples)) {
        piece = slotPiece(world, move, memory, near, move.usedHands, temples);
      }

      // The nearest head may sit in a pocket of the AI's own bridge, where every piece only leads
      // further from the target; then the bridge goes on from the next head whose piece comes
      // nearer than the nearest head already is.
      // Come up to a geyser's islet, the bridge joins it from there and nowhere else: growing on
      // from farther heads would only wind around it. A hand without a piece whose end meets the
      // islet is cycled, so that one comes.
      const arrived = !candidate.enemy && heads[0] && heads[0].need <= ARRIVED;
      const froms = arrived ? heads.filter((h) => h.need <= ARRIVED) : heads;

      for (const from of piece ? [] : froms) {
        // Told to keep off the enemy's island, it lays no bridge toward him; he still decides
        // where its units go.
        piece = reached && !(candidate.enemy && options.attack === false)
          ? bestPiece(world, move, from, field, reached, move.usedHands, Infinity)
          : null;

        if (piece) {
          break;
        }
      }

      if (!piece && arrived) {
        joinWanted ??= candidate;
      }
    }

    if (!piece) {
      continue;
    }

    drop(world, move, piece);
    because(`a bridge toward ${describeTarget(candidate)}`);
    laidPieces++;

    if (!target) {
      target = candidate;
      head = heads[0] ?? null;
      unitHeads = heads;
    }
  }

  // The Temple draws a piece only into a free slot: a full hand of pieces that come nearer to no
  // target would stop the bridge for good. The one that fits worst goes to the back of the island,
  // where it is in nobody's way, and the next second a new one comes.
  const grows = joinWanted
    ?? (first && !(first.target.enemy && options.attack === false) ? first.target : null);

  if (
    (laidPieces === 0 || joinWanted) && grows && bounds && reached
    && player.hand.length - move.usedHands.size >= world.bridgeSlots - 1
  ) {
    const dump = dumpPiece(world, move, skyField(world, move, grows), grows, bounds, reached);

    if (dump) {
      drop(world, move, dump);
      because('a full hand and no piece comes nearer: the worst goes to the back of the island');
    }
  }

  // Units go where the bridge is most wanted: to the enemy, when attacking, even in a move whose
  // only piece went on toward a geyser because none could be laid nearer to him.
  if (first && (!target || (attack && first.target.enemy))) {
    target = first.target;
    head = first.head;
    unitHeads = first.heads;
  }

  // Guns face the enemy. When the bridge of this move went toward a geyser, they go to the own
  // bridge head nearest him, where he would come from: a gun by a geyser far from him has
  // nothing to shoot at. A geyser takes guns only in a defence, once the enemy is at it.
  if (target && !target.enemy) {
    const foe = targets.find((t) => t.enemy);
    const heads = foe && bounds && reached
      ? bridgeHeads(world, me, skyField(world, move, foe), bounds, reached)
      : [];
    target = foe;
    head = heads[0] ?? null;
    unitHeads = heads;
  }

  // The arm toward the enemy carries its Energy as it grows, ahead of the guns that will want it:
  // a Generator for every stretch of bridge, laid while the pieces are still going down.
  if (attack && first?.target.enemy && first.head && options.attack !== false) {
    carryEnergy(world, move, first.head, first.target);
    because('the arm toward the enemy carries Energy with it: a Generator along the way');
  }

  // Guns at the enemy go from whatever own ground is nearest his Temple and his Priest, which is
  // not always the head the bridge grows from.
  if (target?.enemy && bounds && reached && home) {
    const marks = enemyMarks(world, me, target);
    // Only ground on the enemy's side of the Temple: a gun behind it faces nothing.
    const ownFar = marks.reduce((least, mark) => Math.min(least, farRect(centre(home), mark)),
      Infinity);
    const gunHeads = headsNear(world, me, bounds, reached, marks).filter((h) => h.need < ownFar);

    if (gunHeads.length) {
      head = gunHeads[0]!;
      unitHeads = gunHeads;
    }
  }

  if (target && head && bounds) {
    const shooters = world.buildingsOf(me).filter((b) => world.def(b.type).dps > 0).length;
    const hoards = hoarding(move.budget, knownShooters(world, me));

    // Guns at the enemy until the level's number have his Priest in reach, or his Temple: a Priest
    // who keeps out of the fire is still brought down once his Temple, which heals him past half,
    // is gone. Then the Storm Power waits for the capture.
    const marks: Mark[] = target.enemy ? enemyMarks(world, me, target) : [];
    const covering = world.buildingsOf(me).filter((b) =>
      reachesAny(world.def(b.type), b.x, b.y, marks) !== false
    ).length;
    // The bridge has come up to the enemy once a gun by its head would reach his Temple or his
    // Priest: the longest-ranged gun it knows, laid within the radius guns go from a head.
    const longest = knownShooters(world, me).reduce((most, def) => Math.max(most, def.range), 0);
    const atPriest = target.enemy
      && marks.some((mark) => nearRect(head, mark) <= longest + UNIT_RADIUS);

    // His Temple heals him and has thousands of hit points: once the guns reach it, more come
    // until they bring it down within the level's siegeSeconds, whatever its number on the
    // Priest. Not while his Priest is already taken: then the Temple is beside the point.
    const taken = enemyPriest(world, me, 'carried') ?? enemyPriest(world, me, 'chained');
    const temple = target.enemy && !taken ? enemyTempleAt(world, me, target) : undefined;
    const templeMark = temple ? [{ x: temple.x, y: temple.y, fx: temple.fx, fy: temple.fy }] : [];
    const templeDps = world.buildingsOf(me).reduce((sum, b) => {
      const def = world.def(b.type);
      return sum + (reachesAny(def, b.x, b.y, templeMark) !== false ? groundDps(def) : 0);
    }, 0);
    const siege = atPriest && temple !== undefined && temple.hp > templeDps * params.siegeSeconds;
    const reasons = [
      ...(atPriest && covering < params.concentrate
        ? [`the enemy Priest is in reach and ${covering} of ${params.concentrate} guns cover him`]
        : []),
      ...(siege
        ? [`his Temple has ${temple.hp} hit points against ${templeDps.toFixed(1)} a second`]
        : []),
      ...(shooters < DEFENCE_SHOOTERS
        ? [`it has ${shooters} shooters, fewer than the ${DEFENCE_SHOOTERS} it keeps facing him`]
        : []),
      ...(hoards ? [`Storm Power ${move.budget} is more than it can use otherwise`] : []),
    ];
    const at = `the head at ${head.x},${head.y} toward ${describeTarget(target)}`;
    explain?.(reasons.length
      ? `  wants guns at ${at}: ${reasons.join('; ')}`
      : `  no guns at ${at}: ${shooters} shooters, no hoard, the enemy Priest not in reach`);

    if (reasons.length) {
      // As many as the level lays in a move, each of another type: the refresh after a unit
      // keeps the same type from coming twice, as it keeps a player. Guns aimed at the Priest go
      // where they reach him; a hoard buys guns by the head wherever they stand.
      // Guns for the siege go where they reach the Temple; the first of them may reach the Priest
      // instead, since either is a start.
      let aims: readonly Mark[] | undefined;

      if (atPriest && !hoards) {
        aims = siege && templeDps > 0 ? templeMark : marks;
      }

      while (move.actions < params.actionsPerMove && bestUnit(world, move, head, target, aims)) {
        // each pass lays one more
      }

      // The sky about the nearest head may be full; the farther heads along the bridge take the
      // guns then, and a hoard buys guns about the Temple when the whole bridge is full.
      for (const other of unitHeads.slice(1)) {
        while (move.actions < params.actionsPerMove && bestUnit(world, move, other, target, aims)) {
          // each pass lays one more
        }
      }

      if (hoards && home && move.actions < params.actionsPerMove) {
        while (
          move.actions < params.actionsPerMove
          && bestUnit(world, move, centre(home), target, undefined, ALTAR_RADIUS)
        ) {
          // each pass lays one more
        }
      }
    }

    because(`guns at ${at}`);

    if (target.enemy && shooters >= DEFENCE_SHOOTERS) {
      barrier(world, move, head);
      because('the bridge comes up to the enemy: a barrier or anti-air at its head');
    }
  }

  if (explain && !move.commands.length) {
    explain('  nothing to do this move');
  }

  if (memory) {
    remember(memory, player.storm, player.storm - move.budget - reserve - saving);
  }

  return move.commands;
}

/** A command as a line of the AI's reasons: its kind and its fields but the player. */
function describeCommand(command: Command): string {
  const fields = Object.entries(command).filter(([key]) => key !== 't' && key !== 'player')
    .map(([key, value]) => `${key} ${String(value)}`);
  return `${command.t} ${fields.join(', ')}`;
}

function describeTarget(target: Target): string {
  return `${target.enemy ? 'the enemy' : 'a geyser'} at ${target.x},${target.y}`;
}

interface Move {
  me: number;
  /** Storm Power left after the builds already chosen this move. */
  budget: number;
  /** Cells taken by the piece and units already chosen this move. */
  planned: Set<number>;
  /** Types laid this move: a second of the same would find the type refreshing. */
  laid: Set<string>;
  commands: Command[];
  /** Enemy damage per second on each cell, as far as this move has noticed the enemy's guns. */
  threat: ThreatMap;
  /** How much a cell under fire lengthens a bridge for the level played. */
  weight: number;
  /** The Priest is sent out of the enemy's fire this move, and is free for nothing else. */
  fleeing: boolean;
  /** A captive is on the way to the Altar or chained on it: the Priest is for the ritual alone. */
  ritual: boolean;
  params: Readonly<AiParams>;
  /** The enemy's guns this move takes into account. */
  guns: View<Building>[];
  /** Shooters laid this move, against the level's actions. */
  actions: number;
  /** A Generator laid this move: one a move, since its Energy comes only once it stands. */
  energized: boolean;
  /** Pieces of the hand dropped this move, by their index before any left: a later drop names
   * its piece by where it will be once the earlier ones are gone. */
  usedHands: Set<number>;
}

/**
 * Which enemy buildings this move takes into account: with a memory, those seen for at least the
 * level's reaction time; the memory notes the new ones. Without a memory, every one.
 */
function noticed(
  world: WorldView,
  memory: AiMemory | undefined,
  reactionSeconds: number,
): (b: View<Building>) => boolean {
  if (!memory) {
    return () => true;
  }

  for (const id of memory.firstSeen.keys()) {
    if (!world.entities.has(id)) {
      memory.firstSeen.delete(id);
    }
  }

  for (const e of world.entities.values()) {
    if (e.kind === 'building' && !memory.firstSeen.has(e.id)) {
      memory.firstSeen.set(e.id, world.tick);
    }
  }

  return (b) => world.tick - memory.firstSeen.get(b.id)! >= reactionSeconds * TPS;
}

/** "Lest the Priest fall": standing under the enemy's guns, he walks to the nearest cell out of
 * their reach, and does nothing else this move. */
function shelter(world: WorldView, move: Move): void {
  const priest = world.priestOf(move.me);

  if (!priest || priest.state !== 'normal' || move.threat[world.at(priest.x, priest.y)] === 0) {
    return;
  }

  const safe = world.findPath(move.me, priest.x, priest.y,
    ([x, y]) =>
      move.threat[world.at(x, y)] === 0 && !world.occupant[world.at(x, y)]
      && !world.priestAt(x, y));
  const end = safe?.at(-1);

  if (end) {
    move.fleeing = true;
    move.commands.push({ t: 'movePriest', player: move.me, x: end[0], y: end[1] });
  }
}

type Head = { x: number; y: number; need: number; };
type Bounds = { x0: number; y0: number; x1: number; y1: number; };

/** Send each idle transport to the reachable geyser the fewest transports work, nearest first. */
function collect(
  world: WorldView,
  move: Move,
  transports: View<Transport>[],
  reachable: View<Geyser>[],
  avoidDanger: boolean,
): void {
  // A geyser under the enemy's guns costs transports: it is left alone while others remain,
  // unless the mission says to keep collecting from dangerous geysers.
  const calm = (g: View<Geyser>) => !avoidDanger || move.threat[world.at(g.x, g.y)] === 0;
  const walked = reachable.some(calm) ? reachable.filter(calm) : reachable;
  // An Aerial Transport needs no bridge: any geyser with stock will do for it.
  const flownAll = transports.some((t) => flies(world.def(t.type)))
    ? geysersFor(world, move.me)
    : [];
  const flown = flownAll.some(calm) ? flownAll.filter(calm) : flownAll;
  const crews = new Map([...walked, ...flown].map((g) => [g.id, 0]));

  for (const t of transports) {
    if (t.target !== null && crews.has(t.target) && (t.goal === 'collect' || t.goal === 'home')) {
      crews.set(t.target, crews.get(t.target)! + 1);
    }
  }

  // A crystal lying on the ground is Storm Power for the taking: the nearest idle transport that
  // can walk to it fetches it before it goes mining.
  const loose = [...world.entities.values()].filter((e): e is View<Crystal> =>
    e.kind === 'crystal' && e.carriedBy === null
  );

  // One on its way to a geyser, with guns now on the way that would kill it before it is there:
  // it turns for another geyser it can survive the way to, or does without. A fast or tough one
  // takes a little fire; the sum of the damage per second along its way, at its pace, is the
  // measure, against its hit points.
  const fire = (t: View<Transport>, path: readonly (readonly [number, number])[]): number =>
    path.reduce((sum, [x, y]) => sum + move.threat[world.at(x, y)]!, 0)
    / world.def(t.type).speed;

  for (const t of transports) {
    if (
      !avoidDanger || t.goal !== 'collect' || t.carrying !== null || flies(world.def(t.type))
      || fire(t, t.path) < t.hp
    ) {
      continue;
    }

    for (const g of walked) {
      if (g.id === t.target) {
        continue;
      }

      const way = world.findPath(move.me, t.x, t.y, ([x, y]) => distance(x, y, g.x, g.y) === 1);

      if (way && fire(t, way) < t.hp) {
        crews.set(t.target!, Math.max(0, (crews.get(t.target!) ?? 1) - 1));
        crews.set(g.id, (crews.get(g.id) ?? 0) + 1);
        move.commands.push({ t: 'collect', player: move.me, transport: t.id, geyser: g.id });
        break;
      }
    }
  }

  for (const t of transports) {
    if (t.goal !== 'idle' || t.carrying !== null) {
      continue;
    }

    const crystal = loose.find((c) =>
      world.findPath(move.me, t.x, t.y, ([x, y]) => distance(x, y, c.x, c.y) <= 1) !== null
    );

    if (crystal) {
      loose.splice(loose.indexOf(crystal), 1);
      move.commands.push({
        t: 'pickupCrystal',
        player: move.me,
        transport: t.id,
        crystal: crystal.id,
      });
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

  if (
    !def || !priest || world.buildingsOf(move.me).some((b) => b.type === ALTAR)
    || priestBusy(world, move)
  ) {
    return;
  }

  place(world, move, def, home ? centre(home) : priest, undefined, ALTAR_RADIUS);
}

/**
 * Send the Priest to mine the geyser nearest home that he can walk to and the enemy's guns do not
 * reach; false when there is none. Far from home is no bar: a side that has spent its Storm Power
 * before buying a transport has only him to earn more, and he walks out of fire as he comes under
 * it.
 */
function priestCollect(
  world: WorldView,
  move: Move,
  priest: View<Priest>,
  reachable: View<Geyser>[],
  home: View<Building> | undefined,
): boolean {
  if (!home) {
    return false;
  }

  // A crystal in his hands goes to the Temple first: he hands it in where his walk ends beside it.
  if (priest.carrying !== null) {
    if (priest.goal === 'home') {
      return true;
    }

    const beside = (x: number, y: number) =>
      x >= home.x - 1 && x <= home.x + home.fx && y >= home.y - 1 && y <= home.y + home.fy;
    const end = world.findPath(move.me, priest.x, priest.y, ([x, y]) => beside(x, y))?.at(-1);

    if (end) {
      move.commands.push({ t: 'movePriest', player: move.me, x: end[0], y: end[1] });
    }

    return end !== undefined;
  }

  const calm = reachable.filter((g) => move.threat[world.at(g.x, g.y)] === 0);

  // Already mining one of them, or bringing its crystal home: left to it.
  if (
    (priest.goal === 'collect' || priest.goal === 'home')
    && calm.some((g) => g.id === priest.target)
  ) {
    return true;
  }

  // Stable: the geysers are ordered nearest the Temple first.
  const geyser = calm.find((g) =>
    world.findPath(move.me, priest.x, priest.y, ([x, y]) => distance(x, y, g.x, g.y) === 1)
      !== null
  );

  if (!geyser) {
    return false;
  }

  move.commands.push({ t: 'collect', player: move.me, transport: priest.id, geyser: geyser.id });
  return true;
}

/** Whether the Priest is on his way to a site, or is sent to one this move. */
function priestBusy(world: WorldView, move: Move): boolean {
  return move.fleeing || world.buildingsOf(move.me).some((b) => b.builder !== null)
    || move.commands.some((c) =>
      c.t === 'build' && PRIEST_BUILT.has(world.defs.get(c.type)?.cls ?? '')
    );
}

/** Units the AI puts into Production Slots first: shooters that hit the ground, then air bases,
 * then the rest; lower levels and cheaper ones first. */
function slotOrder(a: Readonly<UnitDef>, b: Readonly<UnitDef>): number {
  return slotRank(a) - slotRank(b) || a.level - b.level || a.cost - b.cost
    || a.id.localeCompare(b.id);
}

const FIGHTS = 1; // slot ranks up to this one are worth an Upgrade

function slotRank(def: Readonly<UnitDef>): number {
  if (def.dps > 0 && def.range > 0 && def.group !== 'fence' && def.group !== 'anti-air') {
    return 0;
  }

  return def.group === 'aviary' ? FIGHTS : FIGHTS + 1;
}

/**
 * Workshops: the Priest raises one near the Temple for a Fury the AI knows units of but has no
 * Workshop for, the free slots are filled with what no Workshop makes yet, and a Workshop whose
 * slots are all taken is Upgraded once Storm Power is plenty.
 */
function equip(world: WorldView, move: Move, stranded: boolean): void {
  const player = world.players.get(move.me)!;
  const mine = world.buildingsOf(move.me);
  // Only what it lays goes into a slot: a slot given to a blocker is a slot lost.
  const known = [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> =>
      def !== undefined && takesSlot(def) && useful(def, stranded)
    );
  const workshops = mine.filter((b) => world.def(b.type).cls === 'Production');
  const missing = [...new Set(known.map((def) => def.theme ?? 'sun'))]
    .sort()
    .map((fury) => world.defs.get(`${fury}factory`))
    .find((def) => def && !workshops.some((b) => b.type === def.id));
  const priest = world.priestOf(move.me);
  const home = world.templeOf(move.me);

  // A Workshop is worth raising when there is Storm Power left for the cheapest unit it is for:
  // a Workshop with nothing to make from it would only stand there.
  const cheapest = known
    .filter((def) => (def.theme ?? 'sun') === (missing?.theme ?? 'sun'))
    .reduce((least, def) => Math.min(least, def.cost), Infinity);

  if (
    missing && priest && !priestBusy(world, move) && !move.ritual
    && move.budget >= missing.cost + cheapest
  ) {
    place(world, move, missing, home ? centre(home) : priest, undefined, ALTAR_RADIUS);
  }

  const made = new Set(workshops.flatMap((b) => b.slots));
  // Storm Power goes to a missing Workshop before any Upgrade.
  let upgraded = missing !== undefined || workshops.some((b) => b.rising > 0);

  for (const b of workshops) {
    if (b.rising > 0) {
      continue;
    }

    const fury = world.def(b.type).theme;
    const wanted = known
      .filter((def) => (def.theme ?? 'sun') === fury && !made.has(def.id))
      .sort(slotOrder);
    let free = WORKSHOP_SLOTS + b.upgrades - b.slots.length;

    for (const def of wanted) {
      if (free === 0) {
        break;
      }

      move.commands.push({ t: 'produce', player: move.me, workshop: b.id, type: def.id });
      made.add(def.id);
      free--;
    }

    if (
      !upgraded && free === 0
      && wanted.some((def) => !made.has(def.id) && slotRank(def) <= FIGHTS)
      && b.upgrades < MAX_UPGRADES
      && move.budget >= upgradeCost(world.def(b.type)) + UPGRADE_SAVINGS
    ) {
      move.commands.push({ t: 'upgradeWorkshop', player: move.me, workshop: b.id });
      move.budget -= upgradeCost(world.def(b.type));
      upgraded = true;
    }
  }
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
    if (!('hp' in e) || e.id === t.id || e.hp <= 0 || e.invisible > 0 || !inReach(t, e, range)) {
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
    const wanted = t.spell === null ? undefined : SPELL_USE[t.spell];

    if (!def || !wanted || t.casting > 0 || t.paralyzed > 0 || def.cost > move.budget) {
      continue;
    }

    if (wanted(inRange(world, t, def.range))) {
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
    !def || !reached || !world.players.get(move.me)!.tech.has(OUTPOST) || move.ritual
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
  // A captive held by a transport that stands (a Crab took him, or it was too early for the
  // Sacrifice) goes on to the Altar.
  for (const t of transports) {
    const held = t.carrying === null ? undefined : world.entities.get(t.carrying);

    if (t.goal === 'idle' && held?.kind === 'priest' && world.hostile(held.owner, move.me)) {
      move.commands.push({ t: 'capturePriest', player: move.me, transport: t.id, target: held.id });
    }
  }

  const captive = enemyPriest(world, move.me, 'down');

  if (!captive) {
    return;
  }

  const going = transports.filter((t) => t.goal === 'capture' && t.target === captive.id).length;

  if (going >= CATCHERS) {
    return;
  }

  const home = world.templeOf(move.me);
  // Without an Altar that stands, the world refuses the capture: the Altar comes first.
  const altar = world.buildingsOf(move.me).some((b) => b.type === ALTAR && b.rising === 0);

  // He has to be within a step of ground the transports can walk to: a bridge that merely lies
  // beside his island does not lead onto it.
  if (!home || !altar) {
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

  // He is up again within seconds: the transports with the shortest way to him go, idle or not,
  // and more than one, in case the first is shot down on the way.
  const runners = transports
    .filter((t) => t.carrying === null && t.goal !== 'capture')
    .map((t) => ({
      t,
      way: world.findPath(move.me, t.x, t.y, ([x, y]) => distance(x, y, captive.x, captive.y) <= 1)
        ?.length ?? Infinity,
    }))
    .filter((r) => r.way < Infinity)
    .sort((a, b) => a.way - b.way || a.t.id - b.t.id)
    .slice(0, CATCHERS - going);

  for (const { t } of runners) {
    move.commands.push({
      t: 'capturePriest',
      player: move.me,
      transport: t.id,
      target: captive.id,
    });
  }
}

/** Transports sent for a downed Priest at once (invented). */
const CATCHERS = 2;

/**
 * Guns about the Altar while a captive is carried home or chained on it: destroying the carrier
 * or the Altar sets him free whole, so the level's guard stands within reach of the Altar.
 */
function guardAltar(world: WorldView, move: Move): void {
  const altar = world.buildingsOf(move.me).find((b) => b.type === ALTAR && b.rising === 0);
  const captive = enemyPriest(world, move.me, 'chained') ?? enemyPriest(world, move.me, 'carried');

  if (!altar || !captive || move.params.altarGuards === 0) {
    return;
  }

  const at = centre(altar);
  const guards =
    world.buildingsOf(move.me).filter((b) =>
      groundDps(world.def(b.type)) > 0 && reaches(world.def(b.type), b.x, b.y, at) !== false
    ).length;

  for (let have = guards; have < move.params.altarGuards; have++) {
    if (
      move.actions >= move.params.actionsPerMove
      || !bestUnit(world, move, at, { ...at, enemy: false })
    ) {
      return;
    }
  }
}

/** A transport of the AI's Fury, or a Golem, laid by its Temple when it can spare the cost. */
// An Aerial Transport is bought first when no geyser can be walked to.
function newTransport(
  world: WorldView,
  move: Move,
  stranded: boolean,
  savings = TRANSPORT_SAVINGS,
): void {
  const home = world.templeOf(move.me);

  if (!home) {
    return;
  }

  const kinds = transportKinds(world, move.me)
    .filter((def) => move.budget >= def.cost + savings)
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

/** The transports a side knows how to make. */
function transportKinds(world: WorldView, me: number): Readonly<UnitDef>[] {
  return [...world.players.get(me)!.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> =>
      def?.cls === 'Ground Transport' || def?.cls === 'Aerial Transport'
    );
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
/** The side's geysers with a walkable cell beside them, nearest the Temple first. `reached` is
 * `walkableFrom(world, me, home)`, found once for the move. */
function reachableGeysers(
  world: WorldView,
  me: number,
  home: View<Building>,
  reached: Uint8Array,
): View<Geyser>[] {
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
/** Targets tried beyond the bridges a move grows, in case the first are boxed in (invented). Each
 * costs a walk of the whole sky. */
const SPARE_TARGETS = 2;

const scratch = {
  field: new Int32Array(W * H),
  reach: new Int32Array(W * H),
  queue: new Int32Array(W * H),
  order: new Int32Array(W * H),
  reached: new Uint8Array(W * H),
  /** The open sky (openSky), and the terrain revision it was found for. */
  open: new Uint8Array(W * H),
  openRevision: -1,
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
    if (
      entity.kind === 'priest' && world.hostile(entity.owner, me) && entity.state === state
      && entity.invisible === 0
    ) {
      return entity;
    }
  }

  return undefined;
}

/** A free cell beside the altar a captive is chained on, if the AI's priest is not there yet. */
/**
 * Salvage one own building that takes no part in the fight, the dearest first, for the Storm
 * Power it gives back: a Generator with nothing of level above the Sun's within its circle, or a
 * gun with no enemy within twice its range; only one standing on the island clear of any bridge,
 * since salvaged off a bridge it would bring the bridge down. Never the Temple, an Altar or a
 * Workshop, which the capture and what follows still need.
 */
function fundCapture(world: WorldView, move: Move): void {
  const mine = world.buildingsOf(move.me);
  const hostile = [...world.entities.values()].filter((e) =>
    'owner' in e && world.hostile(e.owner, move.me)
  );
  const idle = (b: View<Building>): boolean => {
    const def = world.def(b.type);

    if (def.group === 'battery') {
      return !mine.some((other) => {
        const kind = world.def(other.type);
        return other.id !== b.id && kind.group !== 'battery' && kind.level > 0
          && Math.hypot(other.x + other.fx / 2 - b.x - b.fx / 2,
              other.y + other.fy / 2 - b.y - b.fy / 2)
            <= ENERGY_RANGE;
      });
    }

    const reach = IDLE_REACH * def.range;
    return groundDps(def) > 0
      && !hostile.some((e) => Math.max(Math.abs(e.x - b.x), Math.abs(e.y - b.y)) <= reach);
  };
  const spare = mine
    .filter((b) => b.rising === 0 && landlocked(world, b) && idle(b))
    .sort((a, b) => world.def(b.type).cost - world.def(a.type).cost || a.id - b.id);

  if (spare[0]) {
    move.commands.push({ t: 'salvage', player: move.me, target: spare[0].id });
  }
}

/** Whether an enemy Priest is chained on an own Altar, or carried toward one by an own transport. */
function captiveComing(world: WorldView, me: number): boolean {
  const chained = enemyPriest(world, me, 'chained');
  const onOwn = chained?.chainedAt !== null && chained !== undefined
    ? world.entities.get(chained.chainedAt)
    : undefined;

  if (onOwn?.kind === 'building' && onOwn.owner === me) {
    return true;
  }

  const carried = enemyPriest(world, me, 'carried');
  const carrier = carried?.carriedBy !== null && carried !== undefined
    ? world.entities.get(carried.carriedBy)
    : undefined;
  return carrier?.kind === 'transport' && carrier.owner === me
    && world.buildingsOf(me).some((b) => b.type === ALTAR && b.rising === 0);
}

function wardSpot(
  world: WorldView,
  me: number,
  threat: ThreatMap,
): { x: number; y: number; } | null {
  const chained = enemyPriest(world, me, 'chained');
  const carried = enemyPriest(world, me, 'carried');
  const carrier = carried?.carriedBy === null || carried === undefined
    ? undefined
    : world.entities.get(carried.carriedBy);
  // The Altar he is chained on, or the own Altar a carrier of his is bound for: the Priest is
  // there before the captive, so no second of the ritual is lost to his walk.
  const altar = chained && chained.chainedAt !== null
    ? world.entities.get(chained.chainedAt)
    : (carrier?.kind === 'transport' && carrier.owner === me
      ? world.buildingsOf(me).find((b) => b.type === ALTAR && b.rising === 0)
      : undefined);
  const priest = world.priestOf(me);

  // Nor while the Altar is under fire: the ritual waits until the ground around it is held.
  if (
    !altar || altar.kind !== 'building' || altar.owner !== me || priest?.state !== 'normal'
    || threat[world.at(altar.x, altar.y)]! > 0
  ) {
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
      if (
        beside(x, y) && world.walkable(me, x, y) && !world.occupant[world.at(x, y)]
        && !world.priestAt(x, y)
      ) {
        return { x, y };
      }
    }
  }

  return null;
}

/** `exact`: the bridge is to end beside this very cell, for a gun to stand there. */
type Target = { x: number; y: number; enemy: boolean; temple?: boolean; exact?: boolean; };

/** Cells of the Temple's distance that weigh as much as one cell of bridge in a geyser's worth: a
 * transport walks there and back for every crystal (invented). */
const WALK_PER_BRIDGE = 4;
/** Cells the enemy's Priest may stray from where the bridge is headed before it is headed anew
 * (invented). */
const MARK_DRIFT = 8;

/**
 * Where to bring the bridge to for the guns to reach the enemy's Temple: a cell of open sky on one
 * of the Temple's rows or columns, within the range of the longest cannon the side knows, so a
 * cannon laid there fires down the line into it; without a cannon, a cell within a square gun's
 * range of it. The nearest such cell to the side's own Temple, so the bridge is shortest. A gun
 * stands only beside an open end of the bridge, which is why the end must come to this very cell.
 */
function siegePoint(
  world: WorldView,
  me: number,
  home: View<Building>,
  temple: View<Building>,
  reached: Uint8Array | null,
  reach: Int32Array | null,
  memory: AiMemory | undefined,
): Target | null {
  const guns = knownShooters(world, me).filter((def) => def.group !== 'anti-air');
  const cannons = guns.filter((def) => def.group === 'cannon');
  const chosen = cannons.length ? cannons : guns;
  const range = chosen.reduce((most, def) => Math.max(most, def.range), 0);
  // The gun's footprint must fit somewhere over the point: a point in a channel of the shore too
  // narrow for it is no point at all.
  const foot = chosen.reduce((most, def) => Math.max(most, def.footX, def.footY), 1);
  const skyBlock = (ax: number, ay: number): boolean => {
    for (let fy = ay; fy < ay + foot; fy++) {
      for (let fx = ax; fx < ax + foot; fx++) {
        if (!world.inside(fx, fy) || world.terrain[world.at(fx, fy)] !== Terrain.Sky) {
          return false;
        }
      }
    }

    return true;
  };
  const roomFor = (x: number, y: number): boolean => {
    for (let ay = y - foot + 1; ay <= y; ay++) {
      for (let ax = x - foot + 1; ax <= x; ax++) {
        if (skyBlock(ax, ay)) {
          return true;
        }
      }
    }

    return false;
  };

  if (range === 0) {
    return null;
  }

  const open = openSky(world);
  const x1 = temple.x + temple.fx - 1;
  const y1 = temple.y + temple.fy - 1;
  // The point of the last move still serves while it is sky on the Temple's line within reach.
  const kept = memory?.siege;

  // A cell beside own ground that joins toward it takes a gun at once, whatever sky it lies in:
  // the own bridge may have walled the shore off from the open sky. Such a cell comes first.
  const besideOwn = (x: number, y: number): boolean =>
    reached !== null && DIRS.some(([dx, dy], dir) => {
      const nx = x + dx;
      const ny = y + dy;
      return world.inside(nx, ny) && world.owner[world.at(nx, ny)] === me
        && reached[world.at(nx, ny)] === 1 && joins(world, world.at(nx, ny), oppositeDir(dir));
    });
  /** Sky a bridge can still come to: in the open, or beside own ground already. */
  const reachable = (x: number, y: number): boolean =>
    world.terrain[world.at(x, y)] === Terrain.Sky
    && (open[world.at(x, y)] === 1 || besideOwn(x, y));

  if (
    kept && reachable(kept.x, kept.y) && !memory.badSieges.has(world.at(kept.x, kept.y))
    && ((kept.x >= temple.x && kept.x <= x1) || (kept.y >= temple.y && kept.y <= y1))
    && nearRect(kept, { x: temple.x, y: temple.y, fx: temple.fx, fy: temple.fy }) <= range - 1
  ) {
    return { ...kept, enemy: true, temple: true, exact: true };
  }

  let best: Target | null = null;
  let bestFar = Infinity;
  // The point with the shortest way through the sky from own ground (`reach`), one beside own
  // ground before all; a point with sky beyond it (`dx`, `dy`: away from the Temple) before one
  // wedged in a notch of the shore, which no bridge end can come onto straight.
  const consider = (x: number, y: number, dx: number, dy: number) => {
    if (!world.inside(x, y) || !reachable(x, y) || memory?.badSieges.has(world.at(x, y))) {
      return;
    }

    const beside = besideOwn(x, y);
    const way = reach?.[world.at(x, y)] ?? -1;

    if (!beside && way < 0) {
      return;
    }

    if (!roomFor(x, y)) {
      return;
    }

    const notch = !(world.inside(x + dx, y + dy) && reachable(x + dx, y + dy));
    // The arm already built counts: a point near the last one keeps the arm and its Generators,
    // where one across the island would start both over.
    const drift = kept ? SIEGE_DRIFT * Math.max(Math.abs(x - kept.x), Math.abs(y - kept.y)) : 0;
    const far = (beside ? 0 : way) + drift + (notch ? W + H : 0);

    if (far < bestFar) {
      best = { x, y, enemy: true, temple: true, exact: true };
      bestFar = far;
    }
  };

  if (cannons.length) {
    for (let x = temple.x; x <= x1; x++) {
      for (let d = 1; d <= range - 1; d++) {
        consider(x, temple.y - d, 0, -1);
        consider(x, y1 + d, 0, 1);
      }
    }

    for (let y = temple.y; y <= y1; y++) {
      for (let d = 1; d <= range - 1; d++) {
        consider(temple.x - d, y, -1, 0);
        consider(x1 + d, y, 1, 0);
      }
    }
  } else {
    const mid = centre(temple);

    for (let y = temple.y - (range - 1); y <= y1 + range - 1; y++) {
      for (let x = temple.x - (range - 1); x <= x1 + range - 1; x++) {
        consider(x, y, Math.sign(x - mid.x), Math.sign(y - mid.y));
      }
    }
  }

  if (memory) {
    memory.siege = best ? { x: (best as Target).x, y: (best as Target).y } : null;
  }

  return best;
}

/**
 * Where the bridge may grow, best first. Free geysers by their worth, the stock over the bridge
 * it takes (by the sky, around islands and the enemy's fire) and the walk from the Temple, as
 * many as the level weighs; and the nearest enemy's High Priest, where he was last headed for
 * while he stays near it, or his Temple while he is carried. Attacking, the enemy comes first,
 * and the geysers follow only for the levels that grow more than one bridge a move.
 */
function bridgeTargets(
  world: WorldView,
  move: Move,
  memory: AiMemory | undefined,
  attack: boolean,
  prefer: number | undefined,
  reach: Int32Array | null,
  reached: Uint8Array | null,
): Target[] {
  const me = move.me;
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
  const geysers: { target: Target; worth: number; }[] = [];
  const enemies: Target[] = [];

  if (!attack || move.params.bridgeHeads > 1) {
    for (const entity of world.entities.values()) {
      if (
        entity.kind !== 'geyser' || entity.stock <= 0
        || world.owner[world.at(entity.x, entity.y)]
      ) {
        continue;
      }

      const bridge = reach ? bridgeTo(world, reach, entity) : 0;

      if (bridge < 0) {
        continue; // no way there through the sky
      }

      geysers.push({
        target: { x: entity.x, y: entity.y, enemy: false },
        worth: entity.stock
          / (bridge + 1 + distance(entity.x, entity.y, from.x, from.y) / WALK_PER_BRIDGE),
      });
    }
  }

  geysers.sort((a, b) => b.worth - a.worth || a.target.y - b.target.y || a.target.x - b.target.x);

  for (const [id, other] of world.players) {
    const foe = world.hostile(id, me) && other.alive && (chosen === undefined || chosen === id);
    const enemy = foe ? world.templeOf(id) : undefined;
    const priest = foe ? world.priestOf(id) : undefined;

    // His Temple: it stands still, heals his Priest past half and is where the Priest keeps to, so
    // the bridge goes for the shore nearest it and the guns reach both. A side whose Temple fell
    // still has its Priest to be taken.
    if (enemy) {
      enemies.push(siegePoint(world, me, home, enemy, reached, reach, memory)
        ?? { ...centre(enemy), enemy: true, temple: true });
    } else if (priest && priest.state !== 'carried') {
      enemies.push({ x: priest.x, y: priest.y, enemy: true });
    }
  }

  const nearest = enemies.sort(byDistance).slice(0, 1);

  // A Priest who paces about his island would have the bridge turn after him every move: it is
  // headed for where he was, until he strays.
  if (memory && nearest[0] && !nearest[0].temple) {
    const mark = memory.mark;
    const near = mark && Math.max(Math.abs(mark.x - nearest[0].x), Math.abs(mark.y - nearest[0].y))
        <= MARK_DRIFT;
    memory.mark = near ? mark : { x: nearest[0].x, y: nearest[0].y };
    nearest[0] = { ...memory.mark, enemy: true };
  }

  const wanted = geysers.slice(0, move.params.planningGeysers).map((g) => g.target);
  return attack ? [...nearest, ...wanted] : [...wanted, ...nearest];
}

/** The bridge it takes to come within GEYSER_REACH of a geyser, from the field of bridge costs
 * out from own ground; -1 when the sky does not lead there. */
function bridgeTo(world: WorldView, reach: Int32Array, g: { x: number; y: number; }): number {
  let least = -1;

  for (let y = g.y - GEYSER_REACH; y <= g.y + GEYSER_REACH; y++) {
    for (let x = g.x - GEYSER_REACH; x <= g.x + GEYSER_REACH; x++) {
      const cost = world.inside(x, y) ? reach[world.at(x, y)]! : -1;

      if (cost >= 0 && (least < 0 || cost < least)) {
        least = cost;
      }
    }
  }

  return least;
}

/**
 * The cost of bridging out from own ground to every sky cell: seeded with the sky beside own
 * walkable ground on a side it joins on, then the same walk as skyField. The grid is scratch,
 * valid until the next call.
 */
function reachField(
  world: WorldView,
  move: Move,
  reached: Uint8Array,
  bounds: Bounds,
): Int32Array {
  const field = scratch.reach.fill(-1);
  const queue = scratch.queue;
  let tail = 0;

  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      if (world.owner[y * W + x] !== move.me || reached[y * W + x] !== 1) {
        continue;
      }

      for (const [dir, [dx, dy]] of DIRS.entries()) {
        const nx = x + dx;
        const ny = y + dy;

        if (
          world.inside(nx, ny) && world.terrain[world.at(nx, ny)] === Terrain.Sky
          && field[world.at(nx, ny)] === -1 && joins(world, world.at(x, y), dir)
        ) {
          field[world.at(nx, ny)] = 0;
          queue[tail++] = world.at(nx, ny);
        }
      }
    }
  }

  skyCosts(world, field, queue, tail, move.threat, move.weight);
  return field;
}

/**
 * The cells of the largest stretch of sky, which is the sky a bridge can cross: 1 where a cell is
 * in it. Found once per state of the terrain and kept.
 */
function openSky(world: WorldView): Uint8Array {
  if (scratch.openRevision === world.terrainRevision) {
    return scratch.open;
  }

  const seen = scratch.open.fill(0);
  const queue = scratch.queue;
  let largest = 0;
  let largestStart = -1;
  /** Flood the stretch of sky from `start`, marking its cells `mark` where they are `was`. */
  const flood = (start: number, was: number, mark: number): number => {
    let tail = 0;
    queue[tail++] = start;
    seen[start] = mark;

    for (let head = 0; head < tail; head++) {
      const i = queue[head]!;
      const x = i % W;
      const y = (i / W) | 0;

      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * W + nx;

        if (
          nx >= 0 && ny >= 0 && nx < W && ny < H && world.terrain[j] === Terrain.Sky
          && seen[j] === was
        ) {
          seen[j] = mark;
          queue[tail++] = j;
        }
      }
    }

    return tail;
  };

  for (let start = 0; start < W * H; start++) {
    if (world.terrain[start] === Terrain.Sky && seen[start] === 0) {
      const size = flood(start, 0, 2);

      if (size > largest) {
        largest = size;
        largestStart = start;
      }
    }
  }

  if (largestStart >= 0) {
    flood(largestStart, 2, 1);
  }

  for (let i = 0; i < W * H; i++) {
    if (seen[i] === 2) {
      seen[i] = 0;
    }
  }

  scratch.openRevision = world.terrainRevision;
  return seen;
}

/**
 * The cost of bridging through open sky from each cell to the target's surroundings: the cells
 * within `radius` of the target (Chebyshev). Bridge can only be laid in the sky, so this is the
 * bridge still needed from there, going around islands rather than straight at the target, and
 * around the enemy's fire when the level weighs it (ai/threat.ts). -1 where the target cannot be
 * reached through the sky, and on every cell that is not sky. The grid is scratch, valid until
 * the next call.
 */
function skyField(world: WorldView, move: Move, target: Target): Int32Array {
  const field = scratch.field.fill(-1);
  const queue = scratch.queue;
  let tail = 0;

  // A target deep inside an island (a Temple's centre) has no sky that close: widen the ring until
  // there is some, so the bridge still heads for the island's nearest shore.
  // Only the open sky counts: an island may hold a pond of sky within it, nearer the target than
  // its shore, and a bridge from that pond leads nowhere.
  const open = openSky(world);

  for (
    let radius = target.exact ? 0 : (target.enemy ? ENEMY_REACH : GEYSER_REACH);
    tail === 0 && radius <= MAX_REACH;
    radius++
  ) {
    for (let y = target.y - radius; y <= target.y + radius; y++) {
      for (let x = target.x - radius; x <= target.x + radius; x++) {
        if (
          world.inside(x, y) && field[world.at(x, y)] === -1
          && open[world.at(x, y)] === 1
        ) {
          field[world.at(x, y)] = 0;
          queue[tail++] = world.at(x, y);
        }
      }
    }
  }

  skyCosts(world, field, queue, tail, move.threat, move.weight);
  return field;
}

/** The own ground cells the bridge can grow from, each with the bridge it still needs: ground a
 * transport can walk to that borders the sky on a side it joins on. */
/** How many heads a move tries, the nearest to the target first (invented). */
const HEADS = 8;
/** Bridge still needed at which a bridge counts as arrived: then no other head grows toward the
 * same target, so the sky about it stays free for the guns. Farther off, a boxed-in nearest head
 * lets the bridge go on from another. */
const ARRIVED = 1;

function bridgeHeads(
  world: WorldView,
  me: number,
  field: Int32Array,
  bounds: Bounds,
  reached: Uint8Array,
  order: 'nearest' | 'farthest' = 'nearest',
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

  // Nearest first (or farthest, for a piece to be rid of), and no two within reach of the same
  // search for a piece.
  const sign = order === 'nearest' ? 1 : -1;
  all.sort((a, b) => sign * (a.need - b.need) || a.y - b.y || a.x - b.x);
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
  move: Move,
  head: Head,
  field: Int32Array,
  reached: Uint8Array,
  used: ReadonlySet<number>,
  bar: number,
): Extract<Command, { t: 'dropPiece'; }> | null {
  const me = move.me;
  const hand = world.players.get(me)!.hand;
  let best: Extract<Command, { t: 'dropPiece'; }> | null = null;
  // A piece must bring the bridge nearer than its nearest head is now, wherever it is laid from.
  let bestNeed = Math.min(head.need, bar);

  for (let index = 0; index < hand.length; index++) {
    // Only pieces that are no longer cracked: a cracked loose end soon falls, and the bridge
    // would have to be laid again. Nor a piece another bridge of this move already takes.
    if (hand[index]!.age < PIECE_HARDEN || used.has(index)) {
      continue;
    }

    for (let rot = 0; rot < ROTATIONS; rot++) {
      const cells = rotatePiece(PIECES[hand[index]!.piece]!, rot);
      const ends = pieceEnds(hand[index]!.piece, rot);

      for (const [x, y] of nearby(head, SEARCH_RADIUS)) {
        const need = needAfter(world, me, field, reached, cells, ends, x, y);

        // Not where a unit of this move is to stand, which canDropPiece does not see yet.
        if (
          need < bestNeed
          && touchesWalkable(world, me, cells, x, y)
          && cells.every(([dx, dy]) => !move.planned.has(world.at(x + dx, y + dy)))
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
/** How far from the nearest heads a piece to be rid of is laid: out of the way of the bridge. */
const DUMP_CLEARANCE = SEARCH_RADIUS * 2;
const DUMP_RADIUS = 2;

/**
 * Of a full hand that laid nothing, the piece that comes nearest to no target, laid at the back of
 * the island: off the own shore farthest from the target, clear of the nearest heads, where the
 * drop is allowed. The shore is any cell of own ground a transport can reach with sky on a side it
 * joins on, whether or not the sky there leads anywhere: the own bridge may have cut the sky in
 * two. Null when no piece can be laid anywhere there.
 */
function dumpPiece(
  world: WorldView,
  move: Move,
  field: Int32Array,
  target: { x: number; y: number; },
  bounds: Bounds,
  reached: Uint8Array,
): Extract<Command, { t: 'dropPiece'; }> | null {
  const me = move.me;
  const hand = world.players.get(me)!.hand;
  const heads = bridgeHeads(world, me, field, bounds, reached);

  // The best each piece could do at any head: the worst of them goes. A piece still cracked is
  // kept: it may fit once it has hardened.
  const bestNeedOf = (index: number): number => {
    let best = Infinity;

    for (let rot = 0; rot < ROTATIONS; rot++) {
      const cells = rotatePiece(PIECES[hand[index]!.piece]!, rot);
      const ends = pieceEnds(hand[index]!.piece, rot);
      const spots = heads.flatMap((head) => nearby(head, SEARCH_RADIUS));

      for (const [x, y] of spots) {
        const need = needAfter(world, me, field, reached, cells, ends, x, y);

        if (need < best && world.canDropPiece({ player: me, hand: index, x, y, rot }) === null) {
          best = need;
        }
      }
    }

    return best;
  };
  let worst = -1;
  let worstNeed = -Infinity;

  for (let index = 0; index < hand.length; index++) {
    const best = hand[index]!.age < PIECE_HARDEN ? -Infinity : bestNeedOf(index);

    if (best > worstNeed) {
      worst = index;
      worstNeed = best;
    }
  }

  if (worst < 0) {
    return null;
  }

  const clear = (x: number, y: number) =>
    heads.slice(0, 2).every((head) =>
      Math.max(Math.abs(head.x - x), Math.abs(head.y - y)) >= DUMP_CLEARANCE
    );
  const backs: { x: number; y: number; far: number; }[] = [];

  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const i = y * W + x;
      const shore = world.owner[i] === me && reached[i] === 1 && clear(x, y)
        && DIRS.some(([dx, dy], dir) =>
          world.inside(x + dx, y + dy) && world.terrain[world.at(x + dx, y + dy)] === Terrain.Sky
          && joins(world, i, dir)
        );

      if (shore) {
        backs.push({ x, y, far: distance(x, y, target.x, target.y) });
      }
    }
  }

  backs.sort((a, b) => b.far - a.far || a.y - b.y || a.x - b.x);

  for (const back of backs) {
    for (let rot = 0; rot < ROTATIONS; rot++) {
      const cells = rotatePiece(PIECES[hand[worst]!.piece]!, rot);

      for (const [x, y] of nearby(back, DUMP_RADIUS)) {
        if (
          cells.every(([dx, dy]) => !move.planned.has(world.at(x + dx, y + dy)))
          && world.canDropPiece({ player: me, hand: worst, x, y, rot }) === null
        ) {
          return { t: 'dropPiece', player: me, hand: worst, x, y, rot };
        }
      }
    }
  }

  return null;
}

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
  aims?: readonly Mark[],
  radius = UNIT_RADIUS,
): boolean {
  const player = world.players.get(move.me)!;
  const known = [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> => def !== undefined && def.level > 0);
  const mine = world.buildingsOf(move.me);
  // An air base where its flyers reach the enemy from: they hunt around the place they start.
  const bases = known.filter((def) => def.group === 'aviary')
    .sort((a, b) => b.range - a.range || a.id.localeCompare(b.id));
  const near = Math.max(Math.abs(head.x - target.x), Math.abs(head.y - target.y));
  // An air base comes after the guns: its flyers harass, a gun that reaches the Priest wins.
  const airBase = () =>
    bases.some((def) => {
      const have = mine.filter((b) => world.def(b.type).group === 'aviary').length;
      return target.enemy && have < AIR_BASES && near <= def.range
        && place(world, move, def, head).placed;
    });

  // A gun that hits only the air is worth its price once the enemy flies.
  const air = enemyFlies(world, move.me);
  // Alternate cannons, which fire along a line, with shooters that cover a square around them, so
  // a priest standing off the cannons' lines is still hit.
  const built = world.buildingsOf(move.me).map((b) => world.def(b.type)).filter((def) =>
    def.dps > 0
  );
  const lines = built.filter((def) => def.group === 'cannon').length;
  const preferLine = lines < built.length - lines;
  const outranged = move.guns.reduce((most, b) => Math.max(most, world.def(b.type).range), 0);
  // A gun of the side's own Fury needs a Generator of that Fury, which the Sun's guns do not: where
  // none stands within reach of the head, the Sun's guns come first, so no Generator is raised for
  // a gun that the Energy already there would not feed anyway.
  const themed = mine.some((b) => {
    const def = world.def(b.type);
    return def.group === 'battery' && def.theme === player.theme
      && Math.max(Math.abs(b.x - head.x), Math.abs(b.y - head.y)) <= GENERATOR_SPACING;
  });
  const unfed = (def: Readonly<UnitDef>) => (def.theme ?? 'sun') !== 'sun' && !themed;
  const shooters = known
    .filter((def) =>
      def.dps > 0 && def.range > 0 && def.group !== 'fence' && (air || def.group !== 'anti-air')
    )
    .sort((a, b) =>
      Number(air && b.group === 'anti-air') - Number(air && a.group === 'anti-air')
      || Number(unfed(a)) - Number(unfed(b))
      // One that reaches as far as the enemy's guns, where there is one: it fires first.
      || Number(b.range >= outranged) - Number(a.range >= outranged)
      || Number((b.group === 'cannon') === preferLine)
        - Number((a.group === 'cannon') === preferLine)
      // The most damage for the Storm Power, not the dearest.
      || worth(b) - worth(a) || a.id.localeCompare(b.id)
    );
  const facing = toward(head, target);
  let short = false;

  for (const def of shooters) {
    // Aimed at the enemy's Priest, a gun goes only where it reaches him: a square gun within its
    // range of him, a cannon on his row or column; otherwise the move keeps the Storm Power and
    // the bridge goes on. A defence, or a gun bought with a hoard, stands wherever there is room.
    const fit = aims ? (x: number, y: number) => reachesAny(def, x, y, aims) : undefined;
    const spot = place(world, move, def, head, facesWhenLaid(def) ? facing : undefined, radius,
      fit);

    if (spot.placed) {
      move.actions++;
      return true;
    }

    short ||= spot.noEnergy;
  }

  if (airBase()) {
    move.actions++;
    return true;
  }

  // No Energy at the head: a Generator there, or, where the head is too far from any Energy for
  // a Generator to be built, at the own ground nearest the target that is still within reach of
  // Energy, so the next one comes nearer. Only ever for a gun that is wanted, never ahead of it,
  // and never beside Energy that is already there: then the want was for a gun of another Fury.
  // One Generator a move at most, and no guns after it: its Energy comes once it stands.
  if (short) {
    carryEnergy(world, move, head, target);
  }

  return false;
}

/**
 * Bring Energy toward `head` for a unit to stand there: a Generator at the head, or, where the
 * head is too far from any Energy for a Generator to be built, at the own ground nearest the
 * target that is still within reach of Energy, so the next one comes nearer; and a stub piece off
 * the bridge where the Energy ends and no site is to be had. One Generator a move, never beside
 * Energy that is already there.
 */
function carryEnergy(
  world: WorldView,
  move: Move,
  head: { x: number; y: number; },
  target: { x: number; y: number; },
): boolean {
  if (move.energized || powered(world, move.me, head, GENERATOR_SPACING)) {
    return false;
  }

  let laid = generator(world, move, head);

  if (!laid) {
    const bounds = ownBounds(world, move.me);
    const site = bounds && poweredHead(world, move.me, target, bounds);
    laid = site ? generator(world, move, site) : false;
    const battery = batteryFor(world, move.me);

    // A stub costs no Storm Power: it is laid even before the Generator can be paid for, so the
    // site is ready when the Storm Power comes.
    if (!laid && site && battery) {
      const stub = stubFor(world, move, site, battery);

      if (stub) {
        drop(world, move, stub);
      }
    }
  }

  move.energized = laid;
  move.actions += laid ? 1 : 0;
  return laid;
}

/**
 * Whether a gun laid at (x, y) hits the mark, and facing which way: false if it does not, the
 * facing to lay it with if it is aimed when laid, undefined if it needs none. A cannon's line runs
 * from the middle of its footprint along its facing, a square gun covers `range` (Chebyshev)
 * around its middle cell, as rules/combat.ts aims them.
 */
function reaches(
  def: Readonly<UnitDef>,
  x: number,
  y: number,
  mark: Mark,
): Facing | undefined | false {
  const cx = x + (def.footX >> 1);
  const cy = y + (def.footY >> 1);
  // The mark's footprint: a cell, or a building's rectangle.
  const x0 = mark.x;
  const y0 = mark.y;
  const x1 = mark.x + (mark.fx ?? 1) - 1;
  const y1 = mark.y + (mark.fy ?? 1) - 1;
  const dx = Math.max(x0 - cx, 0, cx - x1);
  const dy = Math.max(y0 - cy, 0, cy - y1);

  if (def.group !== 'cannon') {
    if (Math.max(dx, dy) > def.range) {
      return false;
    }

    // The Crossbow fires into an arc ahead of it, so it faces the mark; the rest turn or cover all
    // around them.
    return facesWhenLaid(def)
      ? toward({ x: cx, y: cy }, { x: (x0 + x1) >> 1, y: (y0 + y1) >> 1 })
      : undefined;
  }

  // A cannon's line runs along its column or row and must cross the footprint within range.
  if (dx === 0 && dy > 0 && dy <= def.range) {
    return y0 < cy ? 0 : 2; // oxlint-disable-line no-magic-numbers -- N, S
  }

  if (dy === 0 && dx > 0 && dx <= def.range) {
    return x0 > cx ? 1 : 3; // oxlint-disable-line no-magic-numbers -- E, W
  }

  return false;
}

/** What a gun is aimed at: a cell, or a building by its top-left cell and footprint. */
type Mark = { x: number; y: number; fx?: number; fy?: number; };

/** The first of the marks a gun laid here reaches, with the facing for it; false if none. */
function reachesAny(
  def: Readonly<UnitDef>,
  x: number,
  y: number,
  marks: readonly Mark[],
): Facing | undefined | false {
  for (const mark of marks) {
    const aim = reaches(def, x, y, mark);

    if (aim !== false) {
      return aim;
    }
  }

  return false;
}

/** Whether some shooter the AI knows could be laid about the head now, or once it has the Storm
 * Power and Energy, where it reaches one of the marks. */
function anyFit(
  world: WorldView,
  move: Move,
  head: { x: number; y: number; },
  marks: Mark[],
): boolean {
  const room = new Set<CommandError | null>([null, 'no storm power', 'not ready', 'no energy']);

  for (const def of knownShooters(world, move.me)) {
    for (const [x, y] of nearby(head, UNIT_RADIUS)) {
      if (
        reachesAny(def, x, y, marks) !== false && clearOfBridges(world, def, x, y, move.planned)
        && room.has(world.canBuild({ player: move.me, type: def.id, x, y }))
      ) {
        return true;
      }
    }
  }

  return false;
}

/** Heads a slot is looked for from, and moves between two looks that found none (invented): the
 * look is dear, a walk of every piece in every turn about every head. */
const SLOT_HEADS = 3;
const SLOT_RETRY_MOVES = 3;

/** Add a drop of a piece to the move, naming it by where it will be in the hand by then, and
 * keep its cells from anything else the move lays. */
function drop(world: WorldView, move: Move, piece: Extract<Command, { t: 'dropPiece'; }>): void {
  const shape = rotatePiece(PIECES[world.players.get(move.me)!.hand[piece.hand]!.piece]!,
    piece.rot);

  for (const [dx, dy] of shape) {
    move.planned.add(world.at(piece.x + dx, piece.y + dy));
  }

  const shift = [...move.usedHands].filter((h) => h < piece.hand).length;
  move.commands.push({ ...piece, hand: piece.hand - shift });
  move.usedHands.add(piece.hand);
}

/**
 * A piece laid off the own ground about `site` that leaves an open end with room for `def` beyond
 * it: a Generator stands only off an end of the bridge, and a bridge that runs on without one
 * carries no Energy. Null when no piece in hand does.
 */
function stubFor(
  world: WorldView,
  move: Move,
  site: { x: number; y: number; },
  def: Readonly<UnitDef>,
): Extract<Command, { t: 'dropPiece'; }> | null {
  const hand = world.players.get(move.me)!.hand;

  for (let index = 0; index < hand.length; index++) {
    if (hand[index]!.age >= PIECE_HARDEN && !move.usedHands.has(index)) {
      const found = slotPieceFrom(world, move, { ...site, need: 0 }, index, [def], () => true);

      if (found) {
        return found;
      }
    }
  }

  return null;
}

/**
 * A piece, laid about one of the nearest heads, with an open end that faces free sky where a
 * shooter the AI knows would stand and reach one of the marks: the first such piece. Looked for
 * only every few moves once a look found none.
 */
function slotPiece(
  world: WorldView,
  move: Move,
  memory: AiMemory | undefined,
  heads: Head[],
  used: ReadonlySet<number>,
  marks: Mark[],
): Extract<Command, { t: 'dropPiece'; }> | null {
  const retry = SLOT_RETRY_MOVES * move.params.moveSeconds * TPS;

  if (memory && world.tick - memory.slotLook < retry) {
    return null;
  }

  const me = move.me;
  const hand = world.players.get(me)!.hand;
  // One shooter for each footprint there is: the room is the same for the rest.
  const shapes = [...new Map(knownShooters(world, me).map((d) => [`${d.footX}x${d.footY}`, d]))
    .values()];
  const reachesMarks: SiteOk = (def, ax, ay) => reachesAny(def, ax, ay, marks) !== false;

  for (const head of heads.slice(0, SLOT_HEADS)) {
    for (let index = 0; index < hand.length; index++) {
      if (hand[index]!.age >= PIECE_HARDEN && !used.has(index)) {
        const found = slotPieceFrom(world, move, head, index, shapes, reachesMarks);

        if (found) {
          return found;
        }
      }
    }
  }

  if (memory) {
    memory.slotLook = world.tick;
  }

  return null;
}

/** The slot piece from one hand piece about one head, in any turn, or null. */
/** A site for a unit of `def` at (ax, ay) that serves: a gun that reaches its marks, a Generator
 * anywhere, a breach unit within the blast's reach of the bridge. */
type SiteOk = (def: Readonly<UnitDef>, ax: number, ay: number) => boolean;

function slotPieceFrom(
  world: WorldView,
  move: Move,
  head: Head,
  index: number,
  shapes: readonly Readonly<UnitDef>[],
  ok: SiteOk,
): Extract<Command, { t: 'dropPiece'; }> | null {
  const me = move.me;
  const piece = world.players.get(me)!.hand[index]!.piece;

  for (let rot = 0; rot < ROTATIONS; rot++) {
    const cells = rotatePiece(PIECES[piece]!, rot);
    const ends = pieceEnds(piece, rot);

    for (const [x, y] of nearby(head, SEARCH_RADIUS)) {
      if (
        touchesWalkable(world, me, cells, x, y)
        && cells.every(([dx, dy]) => !move.planned.has(world.at(x + dx, y + dy)))
        && world.canDropPiece({ player: me, hand: index, x, y, rot }) === null
        && slotBeyond(world, move, cells, ends, x, y, shapes, ok)
      ) {
        return { t: 'dropPiece', player: me, hand: index, x, y, rot };
      }
    }
  }

  return null;
}

/** Whether beyond one of the piece's open ends there is free sky for a shooter's whole footprint,
 * from where it reaches one of the marks. */
function slotBeyond(
  world: WorldView,
  move: Move,
  cells: [number, number][],
  ends: [number, number, number][],
  x: number,
  y: number,
  shapes: readonly Readonly<UnitDef>[],
  ok: SiteOk,
): boolean {
  const taken = new Set(cells.map(([dx, dy]) => world.at(x + dx, y + dy)));
  const free = (cx: number, cy: number): boolean =>
    world.inside(cx, cy) && world.terrain[world.at(cx, cy)] === Terrain.Sky
    && !world.occupant[world.at(cx, cy)] && !move.planned.has(world.at(cx, cy))
    && !taken.has(world.at(cx, cy));

  return ends.some(([ex, ey, dir]) => {
    const bx = x + ex + DIRS[dir]![0];
    const by = y + ey + DIRS[dir]![1];
    return shapes.some((def) => slotAt(def, bx, by, free, ok));
  });
}

/** Whether a shooter of this footprint, placed to cover the cell beyond the end, has free sky
 * under all of it and reaches one of the marks. */
function slotAt(
  def: Readonly<UnitDef>,
  bx: number,
  by: number,
  free: (x: number, y: number) => boolean,
  ok: SiteOk,
): boolean {
  for (let ay = by - def.footY + 1; ay <= by; ay++) {
    for (let ax = bx - def.footX + 1; ax <= bx; ax++) {
      if (footprintFree(def, ax, ay, free) && ok(def, ax, ay)) {
        return true;
      }
    }
  }

  return false;
}

function footprintFree(
  def: Readonly<UnitDef>,
  ax: number,
  ay: number,
  free: (x: number, y: number) => boolean,
): boolean {
  for (let fy = ay; fy < ay + def.footY; fy++) {
    for (let fx = ax; fx < ax + def.footX; fx++) {
      if (!free(fx, fy)) {
        return false;
      }
    }
  }

  return true;
}

/** Temples of the enemies near a mark (invented: within the attack's reach of it). */
/** The enemy Temple the target is about, with its hit points. */
function enemyTempleAt(world: WorldView, me: number, mark: { x: number; y: number; }) {
  for (const [id, other] of world.players) {
    const temple = other.alive && world.hostile(id, me) ? world.templeOf(id) : undefined;

    if (temple && distance(centre(temple).x, centre(temple).y, mark.x, mark.y) <= ATTACK_REACH) {
      return temple;
    }
  }

  return undefined;
}

function enemyTemples(world: WorldView, me: number, mark: { x: number; y: number; }): Mark[] {
  const temples: Mark[] = [];

  for (const [id, other] of world.players) {
    const temple = other.alive && world.hostile(id, me) ? world.templeOf(id) : undefined;

    if (temple && distance(centre(temple).x, centre(temple).y, mark.x, mark.y) <= ATTACK_REACH) {
      temples.push({ x: temple.x, y: temple.y, fx: temple.fx, fy: temple.fy });
    }
  }

  return temples;
}

/**
 * Own ground to lay guns from, nearest the marks first: cells a transport can reach with sky on a
 * side they join on, the nearest to any mark, no two within reach of the same search for a site.
 * Like bridgeHeads, but by distance to the marks rather than by the way to the target.
 */
function headsNear(
  world: WorldView,
  me: number,
  bounds: Bounds,
  reached: Uint8Array,
  marks: readonly Mark[],
): Head[] {
  const all: Head[] = [];

  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const i = y * W + x;

      if (world.owner[i] !== me || reached[i] !== 1) {
        continue;
      }

      const shore = DIRS.some(([dx, dy], dir) =>
        world.inside(x + dx, y + dy) && world.terrain[world.at(x + dx, y + dy)] === Terrain.Sky
        && joins(world, i, dir)
      );

      if (shore) {
        const need = marks.reduce((least, mark) => Math.min(least, farRect({ x, y }, mark)),
          Infinity);
        all.push({ x, y, need });
      }
    }
  }

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

/** What the guns at the enemy are for: his Temple about the target, and his Priest where he stands
 * (on his feet or down; not carried off already). */
function enemyMarks(world: WorldView, me: number, target: Target): Mark[] {
  const marks = enemyTemples(world, me, target);

  for (const [id, other] of world.players) {
    const priest = other.alive && world.hostile(id, me) ? world.priestOf(id) : undefined;

    // His Priest wherever he stands: he is what the guns are for.
    if (priest && priest.state !== 'carried' && priest.invisible === 0) {
      marks.push({ x: priest.x, y: priest.y });
    }
  }

  return marks.length ? marks : [target];
}

/** The square of the straight distance from a point to the nearest cell of a mark's footprint:
 * for ordering ground by how near it is, where a square gun's measure would call a whole side of an
 * island equally near. */
function farRect(from: { x: number; y: number; }, mark: Mark): number {
  const x1 = mark.x + (mark.fx ?? 1) - 1;
  const y1 = mark.y + (mark.fy ?? 1) - 1;
  const dx = Math.max(mark.x - from.x, 0, from.x - x1);
  const dy = Math.max(mark.y - from.y, 0, from.y - y1);
  return dx * dx + dy * dy;
}

/** Cells from a point to the nearest cell of a mark's footprint, as a square gun measures. */
function nearRect(from: { x: number; y: number; }, mark: Mark): number {
  const x1 = mark.x + (mark.fx ?? 1) - 1;
  const y1 = mark.y + (mark.fy ?? 1) - 1;
  const dx = Math.max(mark.x - from.x, 0, from.x - x1);
  const dy = Math.max(mark.y - from.y, 0, from.y - y1);
  return Math.max(dx, dy);
}

/** Damage per second a unit of this type brings onto the ground: none for barriers and guns that
 * hit only the air. */
function groundDps(def: Readonly<UnitDef>): number {
  return def.range > 0 && def.group !== 'fence' && def.group !== 'anti-air' ? def.dps : 0;
}

/** The enemy's guns this move knows of, visible and noticed. */
function enemyGuns(
  world: WorldView,
  me: number,
  seen: (b: View<Building>) => boolean,
): View<Building>[] {
  const guns: View<Building>[] = [];

  for (const e of world.entities.values()) {
    if (
      e.kind === 'building' && world.hostile(e.owner, me) && e.invisible === 0 && e.hp > 0
      && groundDps(world.def(e.type)) > 0 && seen(e)
    ) {
      guns.push(e);
    }
  }

  return guns;
}

/** Whether any cell of a building's footprint lies under the enemy's fire. */
function underFire(move: Move, b: View<Building>, world: WorldView): boolean {
  for (let y = b.y; y < b.y + b.fy; y++) {
    for (let x = b.x; x < b.x + b.fx; x++) {
      if (move.threat[world.at(x, y)]! > 0) {
        return true;
      }
    }
  }

  return false;
}

/**
 * How the enemy presses this move: fire on own buildings or the Priest, buildings lost since the
 * last moves (the memory tells them from salvaged ones), and enemy ground coming within the
 * alarm of own ground, found by stepping out from own ground over anything.
 */
/** The pressure, with where to meet it: the own cell to defend and the enemy to face. */
type Press = Pressure & {
  point: { x: number; y: number; } | null;
  source: { x: number; y: number; } | null;
};

function sense(
  world: WorldView,
  move: Move,
  memory: AiMemory | undefined,
  bounds: Bounds | null,
): Press {
  const mine = world.buildingsOf(move.me);
  const priest = world.priestOf(move.me);
  const shot = mine.find((b) => underFire(move, b, world))
    ?? (priest && move.threat[world.at(priest.x, priest.y)]! > 0 ? priest : undefined);
  let losses = 0;

  if (memory) {
    const now = new Map(mine.map((b) => [b.id, { x: b.x, y: b.y }]));

    for (const [id, at] of memory.buildings) {
      if (!now.has(id)) {
        memory.losses.push({ ...at, tick: world.tick });
      }
    }

    memory.buildings = now;
    const horizon = LOSS_MOVES * move.params.moveSeconds * TPS;
    memory.losses = memory.losses.filter((loss) => world.tick - loss.tick <= horizon);
    losses = memory.losses.length;
  }

  const approach = bounds ? nearestEnemyBridge(world, move.me, bounds) : null;
  // What to face: the gun firing on us, else the bridge coming, else the gun nearest the latest
  // loss; and where to stand against it.
  const loss = memory?.losses.at(-1);
  let source: { x: number; y: number; } | null = null;

  if (shot) {
    source = nearestGun(move, shot);
  } else if (approach) {
    source = approach.enemy;
  } else if (loss) {
    source = nearestGun(move, loss);
  }

  const point = shot ?? approach?.own ?? loss ?? null;

  return {
    fired: shot !== undefined,
    losses,
    approach: approach?.distance ?? null,
    point: point ? { x: point.x, y: point.y } : null,
    source,
  };
}

function nearestGun(move: Move, to: { x: number; y: number; }): { x: number; y: number; } | null {
  let best: View<Building> | null = null;
  let least = Infinity;

  for (const gun of move.guns) {
    const d = Math.max(Math.abs(gun.x - to.x), Math.abs(gun.y - to.y));

    if (d < least) {
      best = gun;
      least = d;
    }
  }

  return best ? centre(best) : null;
}

/** The nearest hostile bridge within the alarm of own island ground, stepping out from every own
 * island cell over sky and ground alike, with the own cell the way started from. A bridge is
 * what comes at an island; ground that merely lies near, or the AI's own bridge reaching the
 * enemy's shore, is no alarm. */
function nearestEnemyBridge(
  world: WorldView,
  me: number,
  bounds: Bounds,
): { enemy: { x: number; y: number; }; own: { x: number; y: number; }; distance: number; } | null {
  const steps = scratch.field.fill(-1);
  const from = scratch.queue;
  const queue = scratch.order;
  let tail = 0;

  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      if (world.owner[y * W + x] === me && world.terrain[y * W + x] === Terrain.Island) {
        steps[y * W + x] = 0;
        from[y * W + x] = y * W + x;
        queue[tail++] = y * W + x;
      }
    }
  }

  for (let head = 0; head < tail; head++) {
    const i = queue[head]!;
    const x = i % W;
    const y = (i / W) | 0;

    if (steps[i]! >= ALARM_DISTANCE) {
      break;
    }

    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;

      if (!world.inside(nx, ny) || steps[ny * W + nx] !== -1) {
        continue;
      }

      const j = ny * W + nx;
      steps[j] = steps[i]! + 1;
      from[j] = from[i]!;

      if (world.owner[j] && world.hostile(world.owner[j]!, me) && isBridge(world.terrain[j]!)) {
        return {
          enemy: { x: nx, y: ny },
          own: { x: from[i]! % W, y: (from[i]! / W) | 0 },
          distance: steps[j]!,
        };
      }

      queue[tail++] = j;
    }
  }

  return null;
}

/** Guns by the ground the enemy presses on, facing what presses: as many as the level lays. */
/** Cells from the blast of a salvaged unit within which bridge cracks or crumbles. */
const BLAST_REACH = 2;
/** Moves a breach unit is waited for before the plan is given up (invented). */
const BREACH_MOVES = 10;

/**
 * "You can break through enemy bridge by building an inexpensive unit right next to it, and then
 * Salvaging your unit": with an enemy bridge within the alarm of own ground, the cheapest unit
 * that makes an islet goes up within the blast's reach of the bridge, and is salvaged once it
 * stands. Normal bridge cracks at the first blast and crumbles at the next.
 */
function breach(
  world: WorldView,
  move: Move,
  memory: AiMemory,
  pressure: Press,
  bounds: Bounds | null,
  reached: Uint8Array | null,
): void {
  const me = move.me;

  if (pressure.approach === null || !pressure.source || !pressure.point) {
    memory.breach = null;
    return;
  }

  const bridge = pressure.source;
  const blastReaches = (b: View<Building>) =>
    Math.max(Math.abs(b.x + (b.fx >> 1) - bridge.x), Math.abs(b.y + (b.fy >> 1) - bridge.y))
      <= BLAST_REACH;
  // Whatever own building already stands within the blast's reach, the cheapest, is the charge:
  // a gun the defence laid there serves as well as a unit raised for it.
  const standing = world.buildingsOf(me)
    .filter((b) => b.rising === 0 && blastReaches(b) && world.def(b.type).createsIsland)
    .sort((a, b) => world.def(a.type).cost - world.def(b.type).cost || a.id - b.id);

  if (standing[0]) {
    move.commands.push({ t: 'salvage', player: me, target: standing[0].id });
    memory.breach = null;
    return;
  }

  if (memory.breach) {
    const { cell, since } = memory.breach;
    const unit = world.buildingsOf(me).find((b) => world.at(b.x, b.y) === cell);

    if (unit || world.tick - since <= BREACH_MOVES * move.params.moveSeconds * TPS) {
      return; // still rising, or on its way
    }

    memory.breach = null;
  }

  const cheapest = [...world.players.get(me)!.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> =>
      def !== undefined && def.createsIsland && def.level > 0 && def.group !== 'aviary'
    )
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  // Within reach of the blast: the unit's centre no farther than the blast reaches from the bridge.
  const near = (x: number, y: number, def: Readonly<UnitDef>) =>
    Math.max(Math.abs(x + (def.footX >> 1) - bridge.x), Math.abs(y + (def.footY >> 1) - bridge.y))
        <= BLAST_REACH
      ? undefined
      : false;

  for (const def of cheapest) {
    const before = move.commands.length;

    if (
      place(world, move, def, pressure.point, undefined, UNIT_RADIUS, (x, y) => near(x, y, def))
        .placed
    ) {
      const laid = move.commands[before];

      if (laid?.t === 'build') {
        memory.breach = { cell: world.at(laid.x, laid.y), since: world.tick };
      }

      return;
    }
  }

  // No site within the blast's reach: a piece whose end leaves room for the unit there.
  const def = cheapest[0];

  if (!def || !bounds || !reached || def.cost > move.budget) {
    return;
  }

  const within: SiteOk = (unit, ax, ay) => near(ax, ay, unit) === undefined;
  const hand = world.players.get(me)!.hand;

  for (const head of headsNear(world, me, bounds, reached, [bridge]).slice(0, SLOT_HEADS)) {
    for (let index = 0; index < hand.length; index++) {
      if (hand[index]!.age < PIECE_HARDEN || move.usedHands.has(index)) {
        continue;
      }

      const piece = slotPieceFrom(world, move, head, index, [def], within);

      if (piece) {
        drop(world, move, piece);
        return;
      }
    }
  }
}

function defendGround(world: WorldView, move: Move, pressure: Press, bounds: Bounds | null): void {
  if (!pressure.source || !pressure.point || !bounds) {
    return;
  }

  const target: Target = { ...pressure.source, enemy: true };
  const point = pressure.point;
  // Guns already reaching the pressed ground.
  let covering =
    world.buildingsOf(move.me).filter((b) =>
      groundDps(world.def(b.type)) > 0 && reaches(world.def(b.type), b.x, b.y, point) !== false
    ).length;

  while (
    covering < GUARD && move.actions < move.params.actionsPerMove
    && bestUnit(world, move, point, target)
  ) {
    covering++;
  }
}

/** Guns that cover a pressed place before the defence rests (invented). */
const GUARD = 3;

/** Whether a building stands wholly on island ground with no bridge beside it: taking it away
 * leaves every bridge as it was. */
function landlocked(world: WorldView, b: View<Building>): boolean {
  for (let y = b.y - 1; y <= b.y + b.fy; y++) {
    for (let x = b.x - 1; x <= b.x + b.fx; x++) {
      if (!world.inside(x, y) || isBridge(world.terrain[world.at(x, y)]!)) {
        return false;
      }

      const inside = x >= b.x && x < b.x + b.fx && y >= b.y && y < b.y + b.fy;

      if (inside && world.terrain[world.at(x, y)] !== Terrain.Island) {
        return false;
      }
    }
  }

  return true;
}

/** Seconds a gun stands with nothing within twice its range before it is salvaged (invented). */
const SALVAGE_IDLE_SECONDS = 90;
const IDLE_REACH = 2;

/** Salvage one gun that has had nothing to shoot at for long, when nothing presses and the level
 * or mission is given to it: a quarter of its price back for a gun that only stands there. */
function salvageIdle(
  world: WorldView,
  move: Move,
  memory: AiMemory,
  chance: number,
  defend: number,
): void {
  const guns = world.buildingsOf(move.me).filter((b) => groundDps(world.def(b.type)) > 0);
  const hostile = [...world.entities.values()].filter((e) =>
    'owner' in e && world.hostile(e.owner, move.me)
  );

  for (const id of memory.idle.keys()) {
    if (!guns.some((b) => b.id === id)) {
      memory.idle.delete(id);
    }
  }

  let chosen: View<Building> | null = null;

  for (const gun of guns) {
    const reach = IDLE_REACH * world.def(gun.type).range;

    // Not one that props up a bridge: salvaged, it would crack it. Nor below the guns it keeps.
    if (!landlocked(world, gun) || guns.length <= DEFENCE_SHOOTERS) {
      continue;
    }

    const busy = hostile.some((e) =>
      Math.max(Math.abs(e.x - gun.x), Math.abs(e.y - gun.y)) <= reach
    );

    if (busy || underFire(move, gun, world)) {
      memory.idle.delete(gun.id);
      continue;
    }

    const since = memory.idle.get(gun.id) ?? world.tick;
    memory.idle.set(gun.id, since);

    if (!chosen && world.tick - since >= SALVAGE_IDLE_SECONDS * TPS) {
      chosen = gun;
    }
  }

  if (chosen && defend === 0 && chance > 0 && random(memory) < chance) {
    move.commands.push({ t: 'salvage', player: move.me, target: chosen.id });
    memory.idle.delete(chosen.id);
  }
}

/** The shooters that hit the ground which the AI knows: what its hoard is measured against. */
function knownShooters(world: WorldView, me: number): Readonly<UnitDef>[] {
  return [...world.players.get(me)!.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> =>
      def !== undefined && def.dps > 0 && def.range > 0 && def.group !== 'fence'
      && def.group !== 'anti-air'
    );
}

/** Whether some other side has an air base, a flyer or an Aerial Transport. */
function enemyFlies(world: WorldView, me: number): boolean {
  for (const e of world.entities.values()) {
    if ('type' in e && world.hostile(e.owner, me) && e.invisible === 0) {
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

  // Nor on the cells of the piece laid this move, which canBuild does not see yet.
  if (
    def.cost > move.budget || move.laid.has(def.id) || world.canBuild(command) !== null
    || !clearOfBridges(world, def, x, y, move.planned)
  ) {
    return false;
  }

  move.commands.push(command);
  move.budget -= def.cost;
  move.laid.add(def.id);

  for (let fy = y; fy < y + def.footY; fy++) {
    for (let fx = x; fx < x + def.footX; fx++) {
      move.planned.add(world.at(fx, fy));
    }
  }

  return true;
}

/** A Generator by the head, of the AI's own Fury first. */
/** The Generators the side can build, its own Fury's first. */
function batteries(world: WorldView, me: number): Readonly<UnitDef>[] {
  const player = world.players.get(me)!;
  return [...player.tech]
    .map((id) => world.defs.get(id))
    .filter((def): def is Readonly<UnitDef> => def?.group === 'battery')
    .sort((a, b) =>
      Number(b.theme === player.theme) - Number(a.theme === player.theme)
      || a.id.localeCompare(b.id)
    );
}

function batteryFor(world: WorldView, me: number): Readonly<UnitDef> | undefined {
  return batteries(world, me)[0];
}

function generator(world: WorldView, move: Move, head: { x: number; y: number; }): boolean {
  for (const def of batteries(world, move.me)) {
    if (place(world, move, def, head).placed) {
      return true;
    }
  }

  return false;
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
  fit?: (x: number, y: number) => Facing | undefined | false,
): { placed: boolean; noEnergy: boolean; } {
  let noEnergy = false;

  if (def.cost > move.budget || move.laid.has(def.id)) {
    return { placed: false, noEnergy };
  }

  const byPriest = PRIEST_BUILT.has(def.cls);
  // Out of the enemy's fire first, nearest first within that; under it only when nothing else.
  const cells = nearby(head, radius);
  const safe = (cell: [number, number]) =>
    !world.inside(cell[0], cell[1]) || move.threat[world.at(cell[0], cell[1])] === 0;
  const ordered = [...cells.filter(safe), ...cells.filter((cell) => !safe(cell))];

  for (const [x, y] of ordered) {
    // The Priest is not sent to raise anything under the enemy's guns.
    if (
      !clearOfBridges(world, def, x, y, move.planned)
      || (byPriest && world.inside(x, y) && move.threat[world.at(x, y)]! > 0)
    ) {
      continue;
    }

    // Only a cell the unit is good for, facing the way it says: a gun from where it hits its mark.
    const aimed = fit ? fit(x, y) : facing;

    if (aimed === false) {
      continue;
    }

    const command = {
      t: 'build',
      player: move.me,
      type: def.id,
      x,
      y,
      ...(aimed === undefined ? {} : { facing: aimed }),
    } as const;
    const error = world.canBuild(command);

    if (error === null) {
      move.commands.push(command);
      move.budget -= def.cost;
      move.laid.add(def.id);

      for (let fy = y; fy < y + def.footY; fy++) {
        for (let fx = x; fx < x + def.footX; fx++) {
          move.planned.add(world.at(fx, fy));
        }
      }

      return { placed: true, noEnergy };
    }

    noEnergy ||= error === 'no energy';

    if (
      error === 'no storm power' || error === 'not ready' || error === 'no workshop'
      || error === 'not in production'
    ) {
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
