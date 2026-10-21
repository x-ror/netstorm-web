/**
 * Spells, from bomb.cpp of netstorm.game 10.82 and the bomb*.type files. A transport acquires one
 * at an Obelisk and casts it around itself for Storm Power. See "Заклинання" in docs/game-rules.md.
 */
import type { Command, CommandError } from '../commands.js';
import type { World } from '../world.js';
import { flies } from '../defs.js';
import type { WorldView } from '../view.js';
import {
  DEVASTATION,
  TPS,
  Terrain,
  W,
  WEAR_CRACKED,
  isBridge,
  type Living,
  type Priest,
  type Transport,
} from '../state.js';
import { damage } from './combat.js';
import { BATTLE, feed } from './geysers.js';
import { collapse } from './bridges.js';
import { dropCargo } from './movement.js';

const DUST_DEVIL = 'windflyer';
const MAN_O_WAR = 'rainflyer';
/** Temples and Workshops: a blast takes a third of their hit points. */
const VAST: ReadonlySet<string> = new Set(['Energy', 'Production']);
/** With Altars, the buildings that are not "emplacements": several Spells pass them by. */
const NOT_EMPLACED: ReadonlySet<string> = new Set(['Energy', 'Production', 'Altar']);

/** A transport, or a Priest with the Spell his prayer gave him. */
type Caster = Transport | Priest;
type Spell = (world: World, t: Caster, range: number) => void;

function near(a: { x: number; y: number; }, b: { x: number; y: number; }): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1;
}

/** Squared distance from the caster to the nearest cell of a footprint. Whether the original
 * measures a circle or a square is not established (`?`); the range it draws is a circle. */
function gap(t: Caster, x: number, y: number, fx = 1, fy = 1): number {
  const dx = Math.max(x - t.x, 0, t.x - (x + fx - 1));
  const dy = Math.max(y - t.y, 0, t.y - (y + fy - 1));
  return dx * dx + dy * dy;
}

/** "Spells do not affect the caster": everything else in range that is alive and on the map. */
function around(world: World, t: Caster, range: number): Living[] {
  const found: Living[] = [];

  for (const e of world.entities.values()) {
    if (!('hp' in e) || e.id === t.id || e.hp <= 0) {
      continue;
    }

    const held = e.kind === 'priest' && (e.state === 'carried' || e.state === 'chained');
    const [fx, fy] = e.kind === 'building' ? [e.fx, e.fy] : [1, 1];

    if (!held && gap(t, e.x, e.y, fx, fy) <= range * range) {
      found.push(e);
    }
  }

  return found;
}

/** Bridge cells in range, each with its squared distance from the caster. */
function bridges(world: World, t: Caster, range: number, f: (i: number, far: number) => void) {
  for (let y = t.y - range; y <= t.y + range; y++) {
    for (let x = t.x - range; x <= t.x + range; x++) {
      const far = gap(t, x, y);

      if (world.inside(x, y) && far <= range * range && isBridge(world.terrain[world.at(x, y)])) {
        f(world.at(x, y), far);
      }
    }
  }

  world.invalidateTerrain();
}

function airborne(world: World, e: Living): boolean {
  return e.kind === 'flyer' || (e.kind === 'transport' && flies(world.def(e.type)));
}

/** A building that is not a Temple, a Workshop or an Altar, and anything that moves. */
function emplacedOrMoving(world: World, e: Living): boolean {
  return e.kind !== 'building' || !NOT_EMPLACED.has(world.def(e.type).cls);
}

/** Damage of a Spell. It has no allies; the reward is paid for enemy units only. */
function hurt(world: World, t: Caster, e: Living, amount: number): void {
  damage(world, world.hostile(t.owner, e.owner) ? t.owner : 0, e, amount);
}

/** A whole number from `low` to `high`. Whether the original's ends are both included: `?`. */
function between(world: World, low: number, high: number): number {
  return low + world.rng.int(high - low + 1);
}

/* oxlint-disable no-magic-numbers -- amounts and odds read from bomb.cpp */
/** Point Blast, Devastation, Decimation: "destroys anything destructible in its range". */
const blast: Spell = (world, t, range) => {
  for (const e of around(world, t, range)) {
    // An allied Priest is spared, and nothing in the air is touched.
    if (airborne(world, e) || (e.kind === 'priest' && !world.hostile(t.owner, e.owner))) {
      continue;
    }

    const vast = e.kind === 'building' && VAST.has(world.def(e.type).cls);
    hurt(world, t, e, vast ? Math.floor(e.hpMax / 3) + 1 : e.hp);
  }

  // Bridge falls, and on the rim of the blast it cracks. Hard bridge is taken to stand, and the
  // cell under the caster too (`?`).
  const inner = (range - 1) * (range - 1);
  bridges(world, t, range, (i, far) => {
    if (far === 0 || world.terrain[i] === Terrain.HardBridge) {
      return;
    }

    if (far <= inner || world.terrain[i] === Terrain.CrackedBridge) {
      collapse(world, i % W, Math.floor(i / W));
    } else {
      world.terrain[i] = Terrain.CrackedBridge;
      world.wear[i] = WEAR_CRACKED;
    }
  });
};

/** Graviton: "destroys all air units in its range". */
const graviton: Spell = (world, t, range) => {
  for (const e of around(world, t, range).filter((a) => airborne(world, a))) {
    hurt(world, t, e, 2000);

    // The Dust Devil has no hit points; that it is blown out as well is assumed (`?`).
    if (e.kind === 'flyer' && world.def(e.type).hp === 0) {
      e.life = 0;
    }
  }
};

/** Bridge Harden: "makes bridges indestructible in its range". For how long is not read (`?`). */
const harden: Spell = (world, t, range) => {
  bridges(world, t, range, (i) => {
    world.terrain[i] = Terrain.HardBridge;
    world.wear[i] = 0;
  });
};

/** Heal: whoever's it is. The code restores all hit points where the help says "some" (`?`). It
 * "also heals Paralysis, and ... negates Invisibility". */
const heal: Spell = (world, t, range) => {
  for (const e of around(world, t, range)) {
    if (e.kind !== 'building' || (e.rising === 0 && e.regrow === 0)) {
      e.hp = e.hpMax;
    }

    e.paralyzed = 0;
    e.invisible = 0;
  }

  bridges(world, t, range, (i) => {
    if (world.terrain[i] === Terrain.CrackedBridge) {
      world.terrain[i] = Terrain.Bridge;
      world.wear[i] = 0;
    }
  });
};

/** Invisibility and Paralysis last the `effecttime` of their type: 40 s and 120 s. */
const invisibility: Spell = (world, t, range) => {
  for (const e of around(world, t, range).filter((a) => emplacedOrMoving(world, a))) {
    e.invisible = world.def(t.spell!).effectTime * TPS;
  }
};

const paralysis: Spell = (world, t, range) => {
  for (const e of around(world, t, range).filter((a) => emplacedOrMoving(world, a))) {
    // It spares the Priests of the caster's side and stops everything else, friend or foe.
    if (e.kind !== 'priest' || world.hostile(t.owner, e.owner)) {
      e.paralyzed = world.def(t.spell!).effectTime * TPS;

      if (e.kind === 'priest') {
        breakPrayer(e);
      }
    }
  }
};

/** Treason: "gives you the ownership of all units in its range, including bridges and all
 * non-Priest Transports". Temples, Workshops and Altars stay with their owner. */
const treason: Spell = (world, t, range) => {
  for (const e of around(world, t, range).filter((a) => emplacedOrMoving(world, a))) {
    if (e.kind === 'priest' || e.owner === t.owner) {
      continue;
    }

    if (e.kind === 'transport') {
      dropCargo(world, e);
      e.path = [];
      e.goal = 'idle';
    } else if (e.kind === 'flyer') {
      e.home = null;
    } else if (e.islet) {
      for (let y = e.y; y < e.y + e.fy; y++) {
        world.owner.fill(t.owner, world.at(e.x, y), world.at(e.x + e.fx, y));
      }
    }

    e.owner = t.owner;
    e.target = null;
  }

  bridges(world, t, range, (i) => {
    world.owner[i] = t.owner;
  });
};

/** What lightning and falling rock strike: buildings and whatever walks. */
function struck(world: World, t: Caster, range: number): Living[] {
  return around(world, t, range).filter((e) => !airborne(world, e));
}

/** Thunderstorm: 500 to everything in range. */
const thunderstorm: Spell = (world, t, range) => {
  for (const e of struck(world, t, range)) {
    hurt(world, t, e, 500);
  }
};

/** A run of `tries` chances out of `odds[1]`, each a hit of `low` to `high`, until it is dead. */
function pelt(
  world: World,
  t: Caster,
  range: number,
  tries: number,
  odds: readonly [number, number],
  [low, high]: readonly [number, number],
): void {
  for (const e of struck(world, t, range)) {
    for (let n = between(world, 1, tries); n > 0 && e.hp > 0; n--) {
      if (world.rng.int(odds[1]) < odds[0]) {
        hurt(world, t, e, between(world, low, high));
      }
    }
  }
}

/** Thunder Strike: one to five bolts at each unit, half of them hitting for 100 to 500. */
const thunderStrike: Spell = (world, t, range) => pelt(world, t, range, 5, [2, 4], [100, 500]);
/** Bombardment: "a random amount of damage to everything": up to fifty rocks at each unit, two in
 * three of them hitting for 20 to 50. */
const bombardment: Spell = (world, t, range) => pelt(world, t, range, 50, [2, 3], [20, 50]);
/* oxlint-enable no-magic-numbers */

/** The Summons Spells call up as many flyers as `spawns` of their type says. They rise over the
 * caster here; the original sets them in a ring around it. */
function summon(type: string): Spell {
  return (world, t) => {
    for (let n = world.def(t.spell!).spawns; n > 0; n--) {
      world.spawnFlyer(type, t.owner, t);
    }
  };
}

const SPELLS: Readonly<Record<string, Spell>> = {
  bombexplodesmall: blast,
  bombexplodemedium: blast,
  bombexplodelarge: blast,
  // The Devastation a Priest prays for: bombspecialone.type is Devastation's range at 100.
  bombspecialone: blast,
  bombgraviton: graviton,
  bombhardener: harden,
  bombheal: heal,
  bombinvisible: invisibility,
  bombparalyze: paralysis,
  bombtreason: treason,
  bomblightingwave: thunderstorm,
  bomblightingzap: thunderStrike,
  bombmeteor: bombardment,
  bombtwister: summon(DUST_DEVIL),
  bombiitwister: summon(DUST_DEVIL),
  bombiiitwister: summon(DUST_DEVIL),
  bombimano: summon(MAN_O_WAR),
  bombiimano: summon(MAN_O_WAR),
  bombiiimano: summon(MAN_O_WAR),
};

/** Whether a unit type is a Spell this code can cast. */
export function isSpell(type: string): boolean {
  return type in SPELLS;
}

/** Run down the Spells on a unit; true while Paralysis keeps it from doing anything. */
export function spellbound(e: Living): boolean {
  if (e.invisible > 0) {
    e.invisible--;
  }

  if (e.paralyzed > 0) {
    e.paralyzed--;
    return e.hp > 0;
  }

  return false;
}

/** One tick of a caster that is casting; the Spell goes off when the time is up. */
export function cast(world: World, t: Caster): void {
  t.casting--;

  if (t.casting === 0 && t.spell) {
    SPELLS[t.spell]!(world, t, world.def(t.spell).range);
    // The Spell's cost goes to new geysers (FUN_0041f4d0).
    feed(world, world.def(t.spell).cost);
    world.emit({ what: 'cast', who: t.owner, data: { transport: t.id, spell: t.spell } });
  }
}

/** The transport has come to the Obelisk: the Spell is its own, "displacing the previous one".
 * The help has transports "pick up Storm Crystals, High Priests, and Spells in the form of
 * Obelisks", cargo like the rest, so the Obelisk is taken off the map with its Spell. */
export function arriveAtObelisk(world: World, t: Transport): void {
  const o = t.target === null ? undefined : world.entities.get(t.target);
  t.goal = 'idle';
  t.target = null;

  if (o?.kind === 'obelisk' && near(o, t)) {
    loseSpell(world, t.spell);
    t.spell = o.spell;
    world.occupant[world.at(o.x, o.y)] = 0;
    world.entities.delete(o.id);
    world.emit({ what: 'spell', who: t.owner, data: { transport: t.id, spell: o.spell } });
  }
}

function ownTransport(world: World, player: number, id: number): Transport | null {
  const t = world.entities.get(id);
  return t?.kind === 'transport' && t.owner === player ? t : null;
}

export function takeSpell(
  world: World,
  c: Extract<Command, { t: 'takeSpell'; }>,
): CommandError | null {
  const t = ownTransport(world, c.player, c.transport);
  const o = world.entities.get(c.obelisk);

  if (!t || o?.kind !== 'obelisk') {
    return 'bad target';
  }

  const path = world.wayOf(t, (cell) => near(o, { x: cell[0], y: cell[1] }));

  if (!path) {
    return 'no path';
  }

  t.path = path;
  t.goal = 'obelisk';
  t.target = o.id;
  return null;
}

/** "It can cast the Spell an unlimited number of times, provided the player has sufficient Storm
 * Power." The Storm Power is taken when the order is given (`?`). */
export function castSpell(
  world: World,
  c: Extract<Command, { t: 'castSpell'; }>,
): CommandError | null {
  const caster = world.entities.get(c.transport);
  const priest = caster?.kind === 'priest' && caster.owner === c.player && caster.state === 'normal'
      && caster.praying === 0
    ? caster
    : null;
  const t = ownTransport(world, c.player, c.transport) ?? priest;

  if (!t?.spell) {
    return 'bad target';
  }

  if (t.casting > 0) {
    return 'casting';
  }

  const def = world.def(t.spell);
  const player = world.players.get(c.player)!;

  if (player.storm < def.cost) {
    return 'no storm power';
  }

  player.storm -= def.cost;
  t.casting = Math.max(1, Math.round(def.castTime * TPS));
  return null;
}

/**
 * "Priests are also able to 'Pray' in order to acquire the Devastation Spell" (help 1015). From the
 * Priest's menu in netstorm.game: he stands on his feet and holds nothing; he prays `praytime`
 * seconds (the unit of the original's counter is `?`), then holds the Spell as cargo and casts it
 * like a transport. The original offers it in multiplayer only: here to a side whose Knowledge
 * has the Spell, which a skirmish gives.
 */
export function pray(world: World, c: Extract<Command, { t: 'pray'; }>): CommandError | null {
  const p = world.priestOf(c.player);

  if (!prayable(world).includes(c.spell)) {
    return 'unknown unit';
  }

  // He may hold a crystal or another Spell, but not a Devastation prayed for (FUN_004bdf20).
  if (
    !p || p.state !== 'normal' || p.casting > 0 || p.spell === DEVASTATION
    || world.terrain[world.at(p.x, p.y)] === Terrain.Sky
  ) {
    return 'priest unavailable';
  }

  p.path = [];
  p.goal = 'idle';
  p.target = null;
  p.prayer = c.spell;
  p.praying = Math.max(1, Math.round(world.def(c.spell).prayTime * TPS));
  return null;
}

/** Thunder Strike and Thunderstorm are never prayed for (FUN_004bdf20). */
const NOT_PRAYED: ReadonlySet<string> = new Set(['bomblightingzap', 'bomblightingwave']);

/** The Spells a Priest may pray for: in multiplayer only, the Devastation of `bombspecialone`; with
 * Spells = Prayer every other Spell instead, the Thunder ones aside. */
export function prayable(world: WorldView): string[] {
  if (!world.multiplayer) {
    return [];
  }

  if (world.spells !== 'prayer') {
    return [DEVASTATION];
  }

  return [...world.defs.values()]
    .filter((def) =>
      isSpell(def.id) && def.id !== DEVASTATION && !NOT_PRAYED.has(def.id)
      && def.prayTime > 0
    )
    .map((def) => def.id);
}

/** A prayer is broken off: by an order to walk, Paralysis or any damage. The Spell he holds he keeps. */
export function breakPrayer(p: Priest): void {
  p.prayer = null;
  p.praying = 0;
}

/** A tick of a Priest who prays or casts; true while it keeps him standing. An order to walk
 * breaks a prayer off. */
export function tickPrayer(world: World, p: Priest): boolean {
  if (p.casting > 0) {
    cast(world, p);
    return true;
  }

  if (p.praying === 0) {
    return false;
  }

  if (p.path.length > 0) {
    breakPrayer(p);
    return false;
  }

  p.praying--;

  if (p.praying === 0) {
    loseSpell(world, p.spell);
    p.spell = p.prayer;
    p.prayer = null;
    world.emit({ what: 'spell', who: p.owner, data: { transport: p.id, spell: p.spell! } });
  }

  return true;
}

/* oxlint-disable no-magic-numbers -- gem.cpp and nugget.cpp */
/** Spells = Obelisks: 3 and one more a player, the first at 180 s, then one every 20 s. */
const OBELISK_BASE = 3;
const OBELISK_FIRST = 180;
const OBELISK_EVERY = 20;
const OBELISK_TRIES = 1000;
/** Chance of a Spell on an Obelisk by its level (FUN_00478760). */
const SPELL_WEIGHTS: Readonly<Record<number, number>> = { 1: 20, 2: 30, 3: 50, 4: 100 };
/* oxlint-enable no-magic-numbers */

/** The Obelisks of a multiplayer battle with Spells = Obelisks (FUN_004a95c0). */
export function startObelisks(world: World): void {
  world.obelisks = { left: OBELISK_BASE + world.players.size, next: OBELISK_FIRST * TPS };
}

export function tickObelisks(world: World): void {
  const o = world.obelisks;

  if (o.left > 0 && world.tick >= o.next) {
    spawnObelisk(world);
    o.left--;
    o.next = world.tick + OBELISK_EVERY * TPS;
  }
}

/** A Spell a carrier held is gone, with it or for another: in multiplayer an Obelisk comes up
 * somewhere instead (FUN_004285e0), but for a Devastation prayed for. */
export function loseSpell(world: World, spell: string | null): void {
  if (spell && spell !== DEVASTATION && world.multiplayer) {
    spawnObelisk(world);
  }
}

/** An Obelisk with a Spell drawn by its level, on a free cell of island anywhere (FUN_004a94b0). */
function spawnObelisk(world: World): void {
  const spells = [...world.defs.values()].filter((def) =>
    isSpell(def.id)
    && SPELL_WEIGHTS[def.level]
  );
  let r = world.rng.int(spells.reduce((sum, def) => sum + SPELL_WEIGHTS[def.level]!, 0));
  const spell = spells.find((def) => (r -= SPELL_WEIGHTS[def.level]!) < 0)!;
  const rect = BATTLE;

  for (let i = 0; i < OBELISK_TRIES; i++) {
    const x = rect.x0 + world.rng.int(rect.x1 - rect.x0);
    const y = rect.y0 + world.rng.int(rect.y1 - rect.y0);
    const cell = world.at(x, y);

    if (
      world.terrain[cell] === Terrain.Island && !world.occupant[cell] && !world.priestAt(x, y)
      && !world.residenceAt(x, y)
    ) {
      world.addObelisk(x, y, spell.id);
      return;
    }
  }
}
