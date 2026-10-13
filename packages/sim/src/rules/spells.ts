/**
 * Spells, from bomb.cpp of netstorm.game 10.82 and the bomb*.type files. A transport acquires one
 * at an Obelisk and casts it around itself for Storm Power. See "Заклинання" in docs/game-rules.md.
 */
import type { Command, CommandError } from '../commands.js';
import type { World } from '../world.js';
import { flies } from '../defs.js';
import { TPS, Terrain, W, WEAR_CRACKED, isBridge, type Living, type Transport } from '../state.js';
import { damage } from './combat.js';
import { collapse } from './bridges.js';
import { dropCargo } from './movement.js';

const DUST_DEVIL = 'windflyer';
const MAN_O_WAR = 'rainflyer';
/** Temples and Workshops: a blast takes a third of their hit points. */
const VAST: ReadonlySet<string> = new Set(['Energy', 'Production']);
/** With Altars, the buildings that are not "emplacements": several Spells pass them by. */
const NOT_EMPLACED: ReadonlySet<string> = new Set(['Energy', 'Production', 'Altar']);

type Spell = (world: World, t: Transport, range: number) => void;

function near(a: { x: number; y: number; }, b: { x: number; y: number; }): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1;
}

/** Squared distance from the caster to the nearest cell of a footprint. Whether the original
 * measures a circle or a square is not established (`?`); the range it draws is a circle. */
function gap(t: Transport, x: number, y: number, fx = 1, fy = 1): number {
  const dx = Math.max(x - t.x, 0, t.x - (x + fx - 1));
  const dy = Math.max(y - t.y, 0, t.y - (y + fy - 1));
  return dx * dx + dy * dy;
}

/** "Spells do not affect the caster": everything else in range that is alive and on the map. */
function around(world: World, t: Transport, range: number): Living[] {
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
function bridges(world: World, t: Transport, range: number, f: (i: number, far: number) => void) {
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
function hurt(world: World, t: Transport, e: Living, amount: number): void {
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
function struck(world: World, t: Transport, range: number): Living[] {
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
  t: Transport,
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

/** One tick of a transport that is casting; the Spell goes off when the time is up. */
export function cast(world: World, t: Transport): void {
  t.casting--;

  if (t.casting === 0 && t.spell) {
    SPELLS[t.spell]!(world, t, world.def(t.spell).range);
    world.emit({ what: 'cast', who: t.owner, data: { transport: t.id, spell: t.spell } });
  }
}

/** The transport has come to the Obelisk: the Spell is its own, "displacing the previous one".
 * The Obelisk is left standing; whether the original uses it up is not established (`?`). */
export function arriveAtObelisk(world: World, t: Transport): void {
  const o = t.target === null ? undefined : world.entities.get(t.target);
  t.goal = 'idle';
  t.target = null;

  if (o?.kind === 'obelisk' && near(o, t)) {
    t.spell = o.spell;
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
  const t = ownTransport(world, c.player, c.transport);

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
