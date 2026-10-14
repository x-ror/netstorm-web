import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, loadDefs, TPS, Terrain, createMission, type Transport } from '../src/index.js';

const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8')),
);
const CAST = 5 * TPS;

function mk(storm = 10_000) {
  const world = new World(defs, 42);
  world.addPlayer(1, 'Blue', 'wind', storm, []);
  world.addPlayer(2, 'Red', 'rain', 0, []);
  world.addIsland(0, 0, 120, 100, 1);
  return world;
}

function run(world: World, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    world.step();
  }
}

/** A Golem of player 1 that already has the Spell, and the order to cast it. */
function caster(world: World, spell: string, x = 50, y = 50): [Transport, () => unknown] {
  const t = world.spawnTransport('sunwalker', 1, x, y);
  t.spell = spell;
  return [t, () => world.apply({ t: 'castSpell', player: 1, transport: t.id })];
}

test('a transport takes a Spell at an Obelisk and pays Storm Power for every cast', () => {
  const world = mk(900);
  const obelisk = world.addObelisk(60, 50, 'bombExplodeLarge');
  const golem = world.spawnTransport('sunwalker', 1, 50, 50);
  const cast = () => world.apply({ t: 'castSpell', player: 1, transport: golem.id });
  assert.equal(cast(), 'bad target');
  assert.equal(world.apply({ t: 'takeSpell', player: 1, transport: golem.id, obelisk: obelisk.id }),
    null);
  run(world, 20 * TPS);
  assert.equal(golem.spell, 'bombexplodelarge');
  // The Obelisk is picked up with its Spell: it is gone from the map.
  assert.ok(!world.entities.has(obelisk.id));
  assert.equal(world.occupant[world.at(60, 50)], 0);
  assert.equal(cast(), null);
  assert.equal(world.players.get(1)!.storm, 100);
  // It halts until the Spell is cast, and cannot start another meanwhile.
  golem.path = [[golem.x, golem.y + 1]];
  assert.equal(cast(), 'casting');
  run(world, CAST);
  assert.equal(golem.path.length, 1);
  assert.equal(golem.casting, 0);
  assert.equal(cast(), 'no storm power');
});

test('Decimation destroys what stands in range, friend or foe, and spares the caster', () => {
  const world = mk();
  const [golem, cast] = caster(world, 'bombexplodelarge');
  const foe = world.spawnBuilding('sunblocker', 2, 54, 50);
  const own = world.spawnBuilding('sunblocker', 1, 46, 50);
  const far = world.spawnBuilding('sunblocker', 2, 60, 50);
  const temple = world.spawnBuilding('rainvortex', 2, 50, 54);
  const priest = world.addPriest(2, 50, 47);
  const mine = world.addPriest(1, 49, 47);
  world.terrain[world.at(52, 52)] = Terrain.Bridge;
  world.terrain[world.at(50, 43)] = Terrain.Bridge;
  cast();
  run(world, CAST - 1);
  assert.equal(foe.hp, foe.hpMax);
  run(world, 2);
  assert.ok(!world.entities.has(foe.id) && !world.entities.has(own.id));
  assert.equal(far.hp, far.hpMax);
  assert.equal(golem.hp, golem.hpMax);
  assert.equal(temple.hpMax - temple.hp, Math.floor(temple.hpMax / 3) + 1);
  // A Priest cannot be destroyed, and an allied one is not touched.
  assert.equal(priest.hp, 1);
  assert.equal(mine.hp, mine.hpMax);
  assert.equal(world.terrain[world.at(52, 52)], Terrain.Sky);
  assert.equal(world.terrain[world.at(50, 43)], Terrain.CrackedBridge); // on the rim
  // The reward is paid for the enemy unit only.
  const reward = Math.floor(defs.get('sunblocker')!.cost / 4);
  assert.equal(world.players.get(1)!.storm, 10_000 - defs.get('bombexplodelarge')!.cost + reward);
});

test('Paralysis stops a gun, Invisibility hides its target, and Heal undoes both', () => {
  const world = mk();
  // Off the cannon's lines of fire.
  const [stunner, stun] = caster(world, 'bombparalyze', 50, 52);
  const cannon = world.spawnBuilding('suncannon', 2, 53, 49, 1);
  const target = world.spawnBuilding('sunblocker', 1, 57, 49);
  stun();
  run(world, CAST);
  const hurt = target.hp;
  assert.equal(cannon.paralyzed, 120 * TPS - 1);
  run(world, 10 * TPS);
  assert.equal(target.hp, hurt);

  const worn = world.spawnBuilding('sunblocker', 1, 48, 56);
  worn.hp = 5;
  stunner.spell = 'bombheal';
  stun();
  run(world, 2 * TPS + 1);
  assert.equal(cannon.paralyzed, 0);
  assert.equal(worn.hp, worn.hpMax);
  run(world, 5 * TPS);
  assert.ok(target.hp < target.hpMax);

  stunner.spell = 'bombinvisible';
  stunner.x = 62; // by the target now, the cannon out of range
  stun();
  run(world, CAST);
  assert.equal(target.invisible, 40 * TPS - 1);
  const hidden = target.hp;
  run(world, 39 * TPS);
  assert.equal(target.hp, hidden);
  run(world, 10 * TPS);
  assert.ok(target.hp < hidden);
});

test('Treason takes units, transports and bridge, but no Priest and no Temple', () => {
  const world = mk();
  const [, cast] = caster(world, 'bombtreason', 50, 52);
  const gun = world.spawnBuilding('suncannon', 2, 53, 49, 1);
  const temple = world.spawnBuilding('rainvortex', 2, 46, 52);
  const walker = world.spawnTransport('sunwalker', 2, 51, 53);
  const priest = world.addPriest(2, 52, 53);
  world.terrain[world.at(50, 46)] = Terrain.Bridge;
  world.owner[world.at(50, 46)] = 2;
  cast();
  run(world, CAST);
  assert.deepEqual([gun.owner, walker.owner, world.owner[world.at(50, 46)]], [1, 1, 1]);
  assert.deepEqual([temple.owner, priest.owner], [2, 2]);
});

test('Graviton brings down what flies; the Summons Spells call up flyers', () => {
  const world = mk();
  const [golem, cast] = caster(world, 'bombgraviton');
  const floater = world.spawnTransport('rainballoon', 2, 52, 50);
  const walker = world.spawnTransport('sunwalker', 2, 52, 51);
  const base = world.spawnBuilding('windaviary', 2, 70, 70);
  const devil = world.spawnFlyer('windflyer', 2, base);
  devil.px = 5100;
  devil.py = 5200;
  devil.x = 51;
  devil.y = 52;
  cast();
  run(world, TPS + 1);
  assert.ok(!world.entities.has(floater.id) && !world.entities.has(devil.id));
  assert.equal(walker.hp, walker.hpMax);

  golem.spell = 'bombiiitwister';
  cast();
  run(world, CAST);
  const mine = [...world.entities.values()].filter((e) => e.kind === 'flyer' && e.owner === 1);
  assert.deepEqual(mine.map((f) => f.kind === 'flyer' && f.type), Array(6).fill('windflyer'));
});

test('lightning and falling rock are drawn from the world rng, and Bridge Harden hardens', () => {
  const world = mk();
  const [golem, cast] = caster(world, 'bomblightingwave');
  const tower = world.spawnBuilding('thunderblocker', 2, 55, 50);
  cast();
  run(world, CAST);
  assert.equal(tower.hpMax - tower.hp, 500);

  for (const spell of ['bombmeteor', 'bomblightingzap']) {
    tower.hp = tower.hpMax;
    const state = world.rng.state();
    golem.spell = spell;
    cast();
    run(world, CAST);
    assert.notEqual(world.rng.state(), state);
    assert.ok(tower.hp <= tower.hpMax);
  }

  world.terrain[world.at(50, 47)] = Terrain.CrackedBridge;
  golem.spell = 'bombhardener';
  cast();
  run(world, CAST);
  assert.equal(world.terrain[world.at(50, 47)], Terrain.HardBridge);
});

test('a map sets up its Obelisks, and a snapshot keeps the Spell of a transport', () => {
  const map = {
    islands: [],
    geysers: [],
    bridges: [],
    units: [['windvortex', 1, 40, 40, 0], ['bombheal', 0, 60, 60, 0]] as [
      string,
      number,
      number,
      number,
      number,
    ][],
  };
  const world = createMission(defs, 1, map, () => ({ name: 'A', theme: 'wind', storm: 0 }));
  const obelisk = [...world.entities.values()].find((e) => e.kind === 'obelisk');
  assert.deepEqual(obelisk && [obelisk.x, obelisk.y, obelisk.spell], [60, 60, 'bombheal']);
  world.spawnTransport('sunwalker', 1, 39, 42).spell = 'bombheal';
  const copy = World.fromSnapshot(JSON.parse(JSON.stringify(world.snapshot())));
  assert.equal(copy.hash(), world.hash());
});
