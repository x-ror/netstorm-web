import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, loadDefs, TPS, type Flyer } from '../src/index.js';

import { shotInterval } from '../src/rules/combat.js';
import { ScanWorld } from './reference-world.js';

const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8')),
);
const mk = () => new World(defs, 42);
const seconds = (id: string) => shotInterval(defs.get(id)!) / TPS;
const to = (x: number, y: number) => (cell: [number, number]) => cell[0] === x && cell[1] === y;

test('stacked transports keep entity order after an earlier transport moves into their cell', () => {
  const world = mk();
  world.addIsland(0, 0, 100, 100, 2);
  const first = world.spawnTransport('sunwalker', 2, 59, 40);
  const second = world.spawnTransport('sunwalker', 2, 60, 40);
  first.path = [[60, 40]];
  first.move = 100;
  world.spawnBuilding('suncannon', 1, 48, 39, 1);
  world.step();
  assert.equal(first.x, 60);
  assert.ok(first.hp < first.hpMax);
  assert.equal(second.hp, second.hpMax);
});

test('a transport moves out of the firing line before a later cannon updates', () => {
  const world = mk();
  world.addIsland(0, 0, 100, 100, 2);
  const target = world.spawnTransport('sunwalker', 2, 60, 40);
  target.path = [[60, 41]];
  target.move = 100;
  world.spawnBuilding('suncannon', 1, 48, 39, 1);
  world.step();
  assert.equal(target.hp, target.hpMax);
});

test('dead transports cannot hide the next target in the same tick', () => {
  const world = mk();
  world.spawnBuilding('suncannon', 1, 48, 39, 1);
  world.spawnBuilding('suncannon', 1, 59, 28, 2);
  const first = world.spawnTransport('sunwalker', 2, 60, 40);
  const second = world.spawnTransport('sunwalker', 2, 60, 40);
  first.hp = 0.1;
  world.step();
  assert.ok(!world.entities.has(first.id));
  assert.ok(second.hp < second.hpMax);
});

test('tick rebuild includes externally moved, removed and newly spawned transports', () => {
  const world = mk();
  const cannon = world.spawnBuilding('suncannon', 1, 48, 39, 1);
  const target = world.spawnTransport('sunwalker', 2, 60, 41);
  world.step();
  target.y = 40;
  world.step();
  assert.ok(target.hp < target.hpMax);
  world.entities.delete(target.id);
  const replacement = world.spawnTransport('sunwalker', 2, 60, 40);
  cannon.cooldown = 0; // skip the reload so the next tick shows whether the newcomer is seen
  world.step();
  assert.ok(replacement.hp < replacement.hpMax);
});

test('indexed combat matches full scans through moving, stacked, blocked and destroyed targets', () => {
  const indexed = mk();
  const scanned = new ScanWorld(defs);

  for (const world of [indexed, scanned]) {
    world.addIsland(0, 0, 256, 256, 2);

    for (let row = 0; row < 8; row++) {
      world.spawnBuilding(row % 2 ? 'sunarcher' : 'suncannon', 1, 30, 20 + row * 10, 1);

      for (let i = 0; i < 10; i++) {
        const transport = world.spawnTransport('sunwalker', i % 3 === 0 ? 1 : 2, 35 + i,
          21 + row * 10);
        transport.path = [
          [transport.x, transport.y + 1],
          [transport.x + 1, transport.y + 1],
          [transport.x + 1, transport.y],
        ];
      }

      if (row % 3 === 0) {
        world.spawnBuilding('sunblocker', 2, 38, 19 + row * 10);
      }
    }
  }

  for (let tick = 0; tick < 120; tick++) {
    indexed.step();
    scanned.step();
    assert.equal(indexed.hash(), scanned.hash(), `state diverged at tick ${tick}`);
    assert.deepEqual(indexed.drainEvents(), scanned.drainEvents());
  }
});

test('radius targeting keeps row-major tie breaking near a map edge', () => {
  const world = mk();
  world.spawnBuilding('sunarcher', 1, 0, 0);
  // Both targets are four cells from the building centre; the east cell's row is first.
  const south = world.spawnTransport('sunwalker', 2, 1, 5);
  const east = world.spawnTransport('sunwalker', 2, 5, 1);
  world.step();
  assert.ok(east.hp < east.hpMax);
  assert.equal(south.hp, south.hpMax);
});

test('an enemy occupant has priority over stacked transports', () => {
  const world = mk();
  world.spawnBuilding('suncannon', 1, 48, 39, 1);
  const blocker = world.spawnBuilding('sunblocker', 2, 60, 39);
  const transport = world.spawnTransport('sunwalker', 2, 60, 40);
  world.step();
  assert.ok(blocker.hp < blocker.hpMax);
  assert.equal(transport.hp, transport.hpMax);
});

test('shooters fire separate shots, lock on the closest target and the Sun Cannon turns itself', () => {
  const world = mk();
  world.addIsland(0, 100, 256, 60, 0);
  // Fixed orientation: a Thunder Cannon facing east ignores an enemy to its north.
  const thunder = world.spawnBuilding('thundercannon', 1, 100, 120, 1);
  const north = world.spawnBuilding('sunblocker', 2, 100, 110);
  // Self-aiming: a Sun Cannon built facing east turns north to the only enemy in its lines.
  const sun = world.spawnBuilding('suncannon', 1, 140, 120, 1);
  const far = world.spawnBuilding('sunblocker', 2, 140, 101);
  world.step();
  assert.equal(thunder.target, null);
  assert.equal(north.hp, north.hpMax);
  assert.equal(sun.facing, 0);
  assert.equal(sun.target, far.id);
  // One shot carries a whole interval of the per-second damage, then the cannon reloads.
  const interval = 5 * TPS;
  assert.equal(far.hp, far.hpMax - 16 * 5);
  assert.equal(sun.cooldown, interval);

  for (let index = 0; index < interval - 1; index++) {
    world.step();
  }

  assert.equal(far.hp, far.hpMax - 16 * 5);
  // A closer enemy appears in another direction: the lock holds while the first target can be hit.
  const near = world.spawnBuilding('sunblocker', 2, 153, 120);
  world.step();
  assert.equal(far.hp, far.hpMax - 2 * 16 * 5);
  assert.equal(near.hp, near.hpMax);
  assert.equal(sun.target, far.id);
  // A tower interposed in the line of fire, closer than anything else, takes over as the target.
  const tower = world.spawnBuilding('sunblocker', 2, 140, 110);
  sun.cooldown = 0;
  world.step();
  assert.equal(sun.target, tower.id);
  assert.equal(tower.hp, tower.hpMax - 16 * 5);
  // Once the target is destroyed the cannon picks the closest one, in any of its four directions.
  tower.hp = 0;
  far.hp = 0;
  world.step();
  sun.cooldown = 0;
  world.step();
  assert.equal(sun.target, near.id);
  assert.equal(sun.facing, 1);
});

test('destroying an enemy unit pays a quarter of its cost, once, to the shooter', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'wind', 0, []);
  world.addPlayer(2, 'Red', 'rain', 0, []);
  world.addIsland(0, 100, 256, 60, 0);
  // Two cannons aimed at the same weak target must not both be paid.
  world.spawnBuilding('suncannon', 1, 100, 120, 1);
  world.spawnBuilding('suncannon', 1, 116, 130, 0);
  const victim = world.spawnBuilding('sunarcher', 2, 116, 120);
  victim.hp = 60;
  world.step();
  assert.equal(victim.hp, 0);
  assert.equal(world.players.get(1)!.storm, Math.floor(defs.get('sunarcher')!.cost / 4));
  world.step();
  assert.ok(!world.entities.has(victim.id));
  assert.equal(world.players.get(1)!.storm, Math.floor(defs.get('sunarcher')!.cost / 4));
  assert.equal(world.players.get(2)!.storm, 0);
});

test('salvage refunds a quarter scaled by health and nothing below half health', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'wind', 0, []);
  world.addPlayer(2, 'Red', 'rain', 0, []);
  world.addIsland(0, 100, 256, 60, 1);
  const cost = defs.get('suncannon')!.cost;
  assert.equal(cost, 400);
  const intact = world.spawnBuilding('suncannon', 1, 100, 120);
  const dented = world.spawnBuilding('suncannon', 1, 110, 120);
  const wrecked = world.spawnBuilding('suncannon', 1, 120, 120);
  dented.hp = (dented.hpMax * 2) / 3; // the help's example: a third gone → 66
  wrecked.hp = wrecked.hpMax / 2 - 1;
  assert.deepEqual(world.execute({ t: 'salvage', player: 2, target: intact.id }), {
    ok: false,
    error: 'bad target',
  });
  assert.deepEqual(world.execute({ t: 'salvage', player: 1, target: intact.id }), { ok: true });
  assert.equal(world.players.get(1)!.storm, 100);
  assert.ok(!world.entities.has(intact.id));
  assert.equal(world.occupant[world.at(101, 121)], 0);
  world.execute({ t: 'salvage', player: 1, target: dented.id });
  assert.equal(world.players.get(1)!.storm, 100 + 66);
  world.execute({ t: 'salvage', player: 1, target: wrecked.id });
  assert.equal(world.players.get(1)!.storm, 100 + 66);
  assert.ok(!world.entities.has(wrecked.id));
});

test('shot timing follows the fire animations of the original', () => {
  assert.equal(seconds('suncannon'), 5); // delayBetweenShots alone: it fires on the first frame
  assert.equal(seconds('thunderarcher'), 1);
  assert.equal(seconds('thundercannon'), 4);
  assert.equal(seconds('windarcher'), 0.8);
  assert.equal(seconds('raincannon'), 0.2); // 0.24 s, on a 0.1 s tick
  assert.equal(seconds('sunarcher'), 7);
  // A Thunder Cannon shot carries four seconds of its 40 per second.
  const world = mk();
  world.addIsland(0, 0, 100, 100, 2);
  const tower = world.spawnBuilding('suncannon', 2, 60, 39, 1);
  world.spawnBuilding('thundercannon', 1, 48, 39, 1);
  world.step();
  assert.equal(tower.hpMax - tower.hp, 160);
  // The Vander Tower shoots at flyers only: a unit on the ground beside it is left alone.
  const other = mk();
  other.addIsland(0, 0, 100, 100, 2);
  const near = other.spawnBuilding('suncannon', 2, 54, 39, 1);
  other.spawnBuilding('thunderarcher', 1, 48, 39, 1);
  other.step();
  assert.equal(near.hp, near.hpMax);
});

test('a destroyed shooter hurts everything next to it and can set off a chain', () => {
  const world = mk();
  world.addIsland(0, 0, 100, 100, 1);
  const first = world.spawnBuilding('suncannon', 1, 40, 40, 1);
  const second = world.spawnBuilding('suncannon', 1, 43, 40, 1); // touches the first
  const third = world.spawnBuilding('suncannon', 1, 46, 40, 1); // touches only the second
  const apart = world.spawnBuilding('suncannon', 1, 40, 44, 1); // a cell of gap below the first
  const walker = world.spawnTransport('sunwalker', 1, 39, 39); // diagonal to the first
  second.hp = 301;
  first.hp = 0;
  first.killer = 2;
  world.step();
  // Half of its 600 hit points plus one, to friend and foe alike.
  assert.ok(!world.entities.has(first.id));
  assert.equal(second.hp, 0);
  assert.equal(second.killer, 2);
  assert.equal(apart.hp, apart.hpMax);
  assert.equal(walker.hp, 0);
  // One link a tick: the second cannon is down but has not gone up yet.
  assert.ok(world.entities.has(second.id));
  assert.equal(third.hp, third.hpMax);
  // Then it goes up in turn and reaches the third, which the first could not.
  world.step();
  assert.ok(!world.entities.has(second.id));
  assert.equal(third.hpMax - third.hp, 301);
});

test('a destroyed Temple deals 400 around it; a generator does not explode', () => {
  const world = mk();
  world.addIsland(0, 0, 100, 100, 1);
  const temple = world.spawnBuilding('windvortex', 1, 40, 40, 1);
  const near = world.spawnBuilding('suncannon', 1, 40 + temple.fx, 40, 1);
  temple.hp = 0;
  world.step();
  assert.equal(near.hpMax - near.hp, 400);
  const battery = world.spawnBuilding('windbattery', 1, 60, 60, 1);
  const beside = world.spawnBuilding('suncannon', 1, 60 + battery.fx, 60, 1);
  battery.hp = 0;
  world.step();
  assert.equal(beside.hp, beside.hpMax);
});

test('transports cut across island ground diagonally, but step onto bridge straight', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'wind', 0, []);
  world.addIsland(0, 0, 20, 20, 1);
  // Three diagonal steps instead of six straight ones.
  assert.deepEqual(world.findPath(1, 2, 2, to(5, 5)), [[3, 3], [4, 4], [5, 5]]);
  // A bridge off the east shore (x = 19) is entered straight on, never across its corner.
  world.terrain[5 * 256 + 20] = 2;
  world.owner[5 * 256 + 20] = 1;
  assert.deepEqual(world.findPath(1, 19, 4, to(20, 5)), [[19, 5], [20, 5]]);
  // A building in the way of one of the straight steps closes the diagonal past its corner.
  world.spawnBuilding('suncannon', 1, 10, 9);
  assert.equal(world.findPath(1, 9, 9, to(10, 8))!.length, 2);
});

test('the Crossbow shoots into an arc of thirty degrees either side of its facing', () => {
  const world = mk();
  world.addIsland(0, 0, 100, 100, 2);
  // Facing east from (40..42, 40..42); its centre cell is (41, 41).
  world.spawnBuilding('windarcher', 1, 40, 40, 1);
  const behind = world.spawnBuilding('sunblocker', 2, 30, 40);
  const abeam = world.spawnBuilding('sunblocker', 2, 40, 50);
  const wide = world.spawnBuilding('sunblocker', 2, 46, 47); // 5 east, 6 south: outside 30°
  world.step();
  assert.deepEqual([behind.hp, abeam.hp, wide.hp], [behind.hpMax, abeam.hpMax, wide.hpMax]);
  const ahead = world.spawnBuilding('sunblocker', 2, 50, 43); // 9 east, 2 south: inside
  world.step();
  assert.ok(ahead.hp < ahead.hpMax);
  assert.deepEqual([behind.hp, abeam.hp, wide.hp], [behind.hpMax, abeam.hpMax, wide.hpMax]);
});

test('the Wind Tower takes nothing from the side its back is turned to', () => {
  const world = mk();
  world.addIsland(0, 0, 100, 100, 2);
  // Two towers in a row, each with a Sun Cannon firing at it from the west.
  const turned = world.spawnBuilding('windblocker', 2, 50, 40, 3); // back to the west
  const open = world.spawnBuilding('windblocker', 2, 50, 50, 1); // back to the east
  world.spawnBuilding('suncannon', 1, 40, 40, 1);
  world.spawnBuilding('suncannon', 1, 40, 50, 1);
  world.step();
  assert.equal(turned.hp, turned.hpMax);
  assert.ok(open.hp < open.hpMax);
  // An explosion beside it is no shot from a side: it hurts either way.
  const bomb = world.spawnBuilding('suncannon', 2, 47, 40, 1);
  bomb.hp = 0;
  world.step();
  assert.equal(turned.hpMax - turned.hp, 301);
});

test('a destroyed Ice Tower grows back in forty seconds, and nothing is paid for it', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'wind', 0, []);
  world.addPlayer(2, 'Red', 'rain', 0, []);
  world.addIsland(0, 0, 100, 100, 2);
  const tower = world.spawnBuilding('rainblocker', 2, 50, 40);
  const cannon = world.spawnBuilding('suncannon', 1, 40, 40, 1);
  tower.hp = 1;
  world.step();
  world.step();
  // It is down but still stands there, and the cannon has let go of it.
  assert.ok(world.entities.has(tower.id));
  assert.equal(tower.hp, 0);
  assert.equal(tower.regrow > 0, true);
  assert.equal(world.players.get(1)!.storm, 0);
  assert.equal(cannon.target, null);

  for (let i = 0; i < 40 * TPS - 2; i++) {
    world.step();
  }

  assert.equal(tower.hp, 0);
  // Hold the cannon's fire, or it greets the new tower with a shot at once.
  cannon.cooldown = 10 * TPS;
  world.step();
  world.step();
  assert.equal(tower.regrow, 0);
  assert.equal(tower.hp, tower.hpMax);
});

test('two Arc Spires pulse once a second at every enemy unit in the band between them', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'thunder', 0, []);
  world.addPlayer(2, 'Red', 'rain', 0, []);
  world.addIsland(0, 0, 120, 100, 2);
  const lone = world.spawnBuilding('thunderfence', 1, 20, 80);
  const near = world.spawnTransport('sunwalker', 2, 24, 81);
  world.spawnBuilding('thunderfence', 1, 20, 40);
  world.spawnBuilding('thunderfence', 1, 60, 40);
  const inside = world.spawnTransport('sunwalker', 2, 40, 42); // the band is three cells wide
  const outside = world.spawnTransport('sunwalker', 2, 40, 43);
  const own = world.spawnTransport('sunwalker', 1, 41, 41);
  const temple = world.spawnBuilding('rainvortex', 2, 30, 35); // its bottom row is in the band
  const tower = world.spawnBuilding('rainblocker', 2, 50, 41);
  world.step();
  assert.equal(inside.hpMax - inside.hp, 50);
  assert.equal(tower.hpMax - tower.hp, 50);
  assert.equal(temple.hpMax - temple.hp, 100); // twice as much to a large structure
  assert.equal(outside.hp, outside.hpMax);
  assert.equal(own.hp, own.hpMax);
  // A post alone does nothing, however near the enemy stands.
  assert.equal(near.hp, near.hpMax);
  assert.equal(lone.target, null);

  for (let i = 0; i < TPS - 1; i++) {
    world.step();
  }

  assert.equal(tower.hpMax - tower.hp, 50);
  world.step();
  assert.equal(tower.hpMax - tower.hp, 100);
});

test('Arc Spires join only on one row or column and within their range', () => {
  const world = mk();
  world.addIsland(0, 0, 200, 100, 2);
  world.spawnBuilding('thunderfence', 1, 20, 40);
  world.spawnBuilding('thunderfence', 1, 71, 40); // 51 cells away, range is 50
  world.spawnBuilding('thunderfence', 1, 40, 61); // a row lower than the next one
  world.spawnBuilding('thunderfence', 1, 60, 60);
  const far = world.spawnTransport('sunwalker', 2, 40, 41);
  const skew = world.spawnTransport('sunwalker', 2, 50, 61);
  world.step();
  assert.equal(far.hp, far.hpMax);
  assert.equal(skew.hp, skew.hpMax);
});

test('Acid Barricades dissolve enemy units on the line between them, but not a Priest', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'rain', 0, []);
  world.addPlayer(2, 'Red', 'wind', 0, []);
  world.addIsland(0, 0, 100, 100, 2);
  world.spawnBuilding('rainfence', 1, 40, 20);
  world.spawnBuilding('rainfence', 1, 40, 50);
  const walker = world.spawnTransport('sunwalker', 2, 41, 35);
  const beside = world.spawnTransport('sunwalker', 2, 42, 35); // the line is one cell wide
  const priest = world.addPriest(2, 41, 40);
  world.step();
  world.step();
  assert.ok(!world.entities.has(walker.id));
  assert.equal(beside.hp, beside.hpMax);
  assert.equal(priest.hp, 1);
});

test('a Sun Barricade field stops enemy shots and lets its owner fire through', () => {
  const world = mk();
  world.addIsland(0, 0, 100, 100, 2);
  world.spawnBuilding('sunfence', 2, 50, 20);
  const post = world.spawnBuilding('sunfence', 2, 50, 60);
  world.spawnBuilding('suncannon', 1, 40, 40, 1);
  const behind = world.spawnBuilding('rainblocker', 2, 60, 40);
  world.spawnBuilding('suncannon', 2, 60, 50, 3);
  const attacker = world.spawnBuilding('rainblocker', 1, 40, 50);
  world.step();
  assert.equal(behind.hp, behind.hpMax);
  assert.ok(attacker.hp < attacker.hpMax);
  // With one post gone the field is gone too.
  world.entities.delete(post.id);

  for (let i = 0; i <= seconds('suncannon') * TPS; i++) {
    world.step();
  }

  assert.ok(behind.hp < behind.hpMax);
});

test('a hostile Sun Barricade between two posts disables their field', () => {
  const world = mk();
  world.addIsland(0, 0, 100, 100, 2);
  world.spawnBuilding('sunfence', 2, 50, 20);
  world.spawnBuilding('sunfence', 2, 50, 60);
  world.spawnBuilding('sunfence', 1, 50, 30);
  world.spawnBuilding('suncannon', 1, 40, 40, 1);
  const behind = world.spawnBuilding('rainblocker', 2, 60, 40);
  world.step();
  assert.ok(behind.hp < behind.hpMax);
});

test('a Bulf takes two crystals from a geyser at once', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'thunder', 0, []);
  world.addIsland(0, 0, 100, 100, 1);
  world.spawnBuilding('thundervortex', 1, 20, 20);
  const bulf = world.spawnTransport('bulf', 1, 30, 30);
  const geyser = world.addGeyser(60, 40);
  const stock = geyser.stock;
  assert.equal(world.apply({ t: 'collect', player: 1, transport: bulf.id, geyser: geyser.id }),
    null);

  while (bulf.carrying === null) {
    world.step();
  }

  assert.equal(stock - geyser.stock, 400);

  while (bulf.carrying !== null) {
    world.step();
  }

  assert.equal(world.players.get(1)!.storm, 400);
});

test('a Crystal Crab robs an enemy transport on its cell, but not a fellow Crab', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'rain', 0, []);
  world.addPlayer(2, 'Red', 'thunder', 0, []);
  world.addIsland(0, 0, 100, 100, 1);
  world.spawnBuilding('rainvortex', 1, 20, 20);
  const load = (type: string, x: number, value: number) => {
    const victim = world.spawnTransport(type, 2, x, 50);
    victim.carrying = world.spawnCrystal(victim, value).id;
    victim.path = [[x, 51]];
    return victim;
  };
  const golem = load('sunwalker', 50, 200);
  const bulf = load('bulf', 60, 400);
  const fellow = load('rainwalker', 70, 200);
  const crabs = [50, 60, 70].map((x) => world.spawnTransport('rainwalker', 1, x, 50));
  world.step();
  // The Golem is left with nothing and stands still.
  assert.equal(golem.carrying, null);
  assert.deepEqual([golem.goal, golem.path.length], ['idle', 0]);
  assert.equal(crabs[0]!.goal, 'home');
  // A Crab carries one crystal, so the Bulf keeps the other of its two.
  const kept = world.entities.get(bulf.carrying!)!;
  const taken = world.entities.get(crabs[1]!.carrying!)!;
  assert.ok(kept.kind === 'crystal' && taken.kind === 'crystal');
  assert.deepEqual([kept.value, taken.value], [200, 200]);
  assert.notEqual(fellow.carrying, null);
  assert.equal(crabs[2]!.carrying, null);
});

test('a Golem walks off a broken bridge; other transports stop at the gap', () => {
  const world = mk();
  world.addIsland(0, 30, 50, 20, 1);
  const send = (type: string, y: number) => {
    for (let x = 50; x < 56; x++) {
      world.terrain[world.at(x, y)] = 2;
    }

    const t = world.spawnTransport(type, 1, 49, y);
    t.path = [50, 51, 52, 53, 54].map((x) => [x, y] as [number, number]);
    world.terrain[world.at(53, y)] = 0;
    return t;
  };
  const golem = send('sunwalker', 40);
  const bulf = send('bulf', 44);

  for (let i = 0; i < 5 * TPS; i++) {
    world.step();
  }

  assert.ok(!world.entities.has(golem.id));
  assert.deepEqual([bulf.x, bulf.hp], [52, bulf.hpMax]);
});

test('the Priest carries crystals like a transport, and drops his load when he goes down', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'wind', 0, []);
  world.addIsland(0, 0, 100, 100, 1);
  world.spawnBuilding('windvortex', 1, 20, 20);
  const priest = world.addPriest(1, 30, 30);
  const geyser = world.addGeyser(40, 30);
  assert.equal(world.apply({ t: 'collect', player: 1, transport: priest.id, geyser: geyser.id }),
    null);

  while (world.players.get(1)!.storm === 0) {
    world.step();
  }

  assert.equal(world.players.get(1)!.storm, 200);
  // He goes back for more, as a transport does.
  assert.equal(priest.goal, 'collect');

  while (priest.carrying === null) {
    world.step();
  }

  const crystal = world.entities.get(priest.carrying!)!;
  priest.hp = 10;
  world.step();
  assert.equal(priest.state, 'down');
  assert.equal(priest.carrying, null);
  assert.ok(crystal.kind === 'crystal' && crystal.carriedBy === null);
  assert.deepEqual([crystal.x, crystal.y], [priest.x, priest.y]);
});

test('a unit takes ten seconds to build, gains hit points evenly and does nothing until then', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'wind', 5000, ['suncannon']);
  world.addIsland(0, 0, 100, 100, 1);
  world.spawnBuilding('windvortex', 1, 20, 36);
  const target = world.spawnTransport('sunwalker', 2, 60, 40);
  assert.equal(world.apply({ t: 'build', player: 1, type: 'suncannon', x: 40, y: 39, facing: 1 }),
    null);
  const cannon = world.buildingsOf(1).find((b) => b.type === 'suncannon')!;
  assert.equal(cannon.hp, 1);

  for (let i = 0; i < 5 * TPS; i++) {
    world.step();
  }

  assert.equal(cannon.hp, cannon.hpMax / 2);
  assert.equal(target.hp, target.hpMax);

  for (let i = 0; i <= 5 * TPS; i++) {
    world.step();
  }

  assert.equal(cannon.hp, cannon.hpMax);
  assert.ok(target.hp < target.hpMax);
});

test('the Priest walks to an Altar he was told to build, and only then it rises', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'wind', 5000, []);
  world.addIsland(0, 0, 100, 100, 1);
  const priest = world.addPriest(1, 30, 33);
  const altar = { t: 'build', player: 1, type: 'altar' } as const;
  priest.state = 'down';
  assert.equal(world.apply({ ...altar, x: 50, y: 30 }), 'priest unavailable');
  priest.state = 'normal';
  assert.equal(world.apply({ ...altar, x: 50, y: 30 }), null);
  assert.equal(world.players.get(1)!.storm, 4500);
  const site = world.buildingsOf(1)[0]!;
  world.step();
  assert.deepEqual([site.hp, site.rising, priest.goal], [1, 10 * TPS, 'build']);

  while (site.builder !== null) {
    world.step();
  }

  assert.ok(world.adjacentTo(priest.x, priest.y, site));
  // An unfinished Altar is no Altar yet.
  const crab = world.spawnTransport('rainwalker', 1, 40, 40);
  const captive = world.addPriest(2, 41, 40);
  captive.hp = 10;
  world.step();
  assert.equal(
    world.apply({ t: 'capturePriest', player: 1, transport: crab.id, target: captive.id }),
    'no altar',
  );

  for (let i = 0; i < 10 * TPS; i++) {
    world.step();
  }

  assert.deepEqual([site.hp, site.rising], [site.hpMax, 0]);
  assert.equal(
    world.apply({ t: 'capturePriest', player: 1, transport: crab.id, target: captive.id }),
    null,
  );
});

test('a site the Priest does not reach is taken away and paid back', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'wind', 5000, []);
  world.addIsland(0, 0, 100, 100, 1);
  const priest = world.addPriest(1, 30, 33);
  assert.equal(world.apply({ t: 'build', player: 1, type: 'altar', x: 50, y: 30 }), null);
  world.step();
  assert.equal(world.buildingsOf(1).length, 1);
  // Sent elsewhere, he gives the building up.
  assert.equal(world.apply({ t: 'movePriest', player: 1, x: 30, y: 40 }), null);
  world.step();
  assert.equal(world.buildingsOf(1).length, 0);
  assert.equal(world.players.get(1)!.storm, 5000);
  // Struck down on the way, he does too.
  world.players.get(1)!.refresh = [];
  assert.equal(world.apply({ t: 'build', player: 1, type: 'altar', x: 50, y: 30 }), null);
  world.step();
  priest.hp = 10;
  world.step();
  world.step();
  assert.equal(world.buildingsOf(1).length, 0);
  assert.equal(world.players.get(1)!.storm, 5000);
});

const flyerOf = (world: World, base: { id: number; }) =>
  [...world.entities.values()].find((e): e is Flyer => e.kind === 'flyer' && e.home === base.id);
const run = (world: World, secondsToRun: number) => {
  for (let i = 0; i < secondsToRun * TPS; i++) {
    world.step();
  }
};

test('a Whirlibase sends up a Whirligig that bombs buildings, never transports, and refuels', () => {
  const world = mk();
  world.addIsland(0, 0, 120, 100, 2);
  const base = world.spawnBuilding('sunaviary', 1, 20, 40);
  const golem = world.spawnTransport('sunwalker', 2, 25, 41);
  const tower = world.spawnBuilding('sunblocker', 2, 40, 40);
  const far = world.spawnBuilding('sunblocker', 2, 60, 40); // beyond 35 + 1 cells of the base
  run(world, 4.8);
  assert.equal(flyerOf(world, base), undefined);
  world.step();
  world.step();
  const gig = flyerOf(world, base)!;
  // Twenty cells at two cells a second, then a bomb every two seconds for thirty hit points.
  run(world, 11);
  assert.equal(gig.target, tower.id);
  assert.equal(tower.hpMax - tower.hp, 30);
  run(world, 2);
  assert.equal(tower.hpMax - tower.hp, 60);
  assert.equal(golem.hp, golem.hpMax);
  assert.equal(far.hp, far.hpMax);
  // After 75 s in the air it flies home, and the base sends it up anew.
  run(world, 75);
  assert.ok(!world.entities.has(gig.id));
  run(world, 6);
  assert.ok(flyerOf(world, base));
});

test('no more than three flyers take one building, and one a transport', () => {
  const world = mk();
  world.addIsland(0, 0, 120, 100, 2);
  const tower = world.spawnBuilding('sunblocker', 2, 40, 40);
  const golem = world.spawnTransport('sunwalker', 2, 40, 60);
  const pools = [0, 1, 2, 3, 4, 5].map((n) => world.spawnBuilding('rainaviary', 1, 20, 30 + n * 6));
  run(world, 4);
  const targets = pools.map((pool) => flyerOf(world, pool)!.target);
  // The Man o' War likes a transport best, but only one may have it.
  assert.equal(targets.filter((id) => id === golem.id).length, 1);
  assert.equal(targets.filter((id) => id === tower.id).length, 3);
  assert.equal(targets.filter((id) => id === null).length, 2);
});

test('a Dust Devil hurts what it passes over, cracks bridge and cannot be shot down', () => {
  const world = mk();
  world.addIsland(0, 30, 30, 20, 1);
  world.addIsland(40, 30, 30, 20, 2);

  for (let x = 30; x < 40; x++) {
    world.terrain[world.at(x, 41)] = 2;
  }

  const maker = world.spawnBuilding('windaviary', 1, 20, 40);
  const tower = world.spawnBuilding('sunblocker', 2, 45, 40);
  const thrower = world.spawnBuilding('sunarcher', 2, 50, 40);
  run(world, 7);
  const devil = flyerOf(world, maker)!;
  run(world, 12);
  assert.ok(tower.hp < tower.hpMax);
  assert.equal(world.terrain[world.at(35, 41)], 3);
  assert.equal(devil.hp, devil.hpMax);
  assert.equal(thrower.target, null);
  // It lives 30 s less the 2 s it spins up, and the base makes another.
  run(world, 16);
  assert.ok(!world.entities.has(devil.id));
});

test("a Man o' War lives a minute and gains fifteen seconds for a kill that is no shooter", () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'rain', 0, []);
  world.addIsland(0, 0, 120, 100, 2);
  const pool = world.spawnBuilding('rainaviary', 1, 20, 40);
  const golem = world.spawnTransport('sunwalker', 2, 24, 41);
  run(world, 3);
  const war = flyerOf(world, pool)!;
  run(world, 1);
  assert.ok(war.life < 60 * TPS - TPS);

  while (golem.hp > 0) {
    world.step();
  }

  // Fifty hit points fall in two strikes of 32; the life cannot pass the full minute.
  assert.equal(war.life, 60 * TPS);
});

test('anti-air: the Vander Tower and the Disc Thrower hit flyers, a Bulwark shrugs them off', () => {
  const world = mk();
  world.addIsland(0, 0, 120, 100, 2);
  const base = world.spawnBuilding('sunaviary', 1, 20, 40);
  const bulwark = world.spawnBuilding('thunderblocker', 2, 30, 40);
  run(world, 6);
  const gig = flyerOf(world, base)!;
  run(world, 10);
  assert.equal(bulwark.hp, bulwark.hpMax);
  const crossbow = world.spawnBuilding('windarcher', 2, 30, 46, 0);
  run(world, 3);
  assert.equal(crossbow.target, null);
  assert.equal(gig.hp, gig.hpMax);
  const thrower = world.spawnBuilding('sunarcher', 2, 34, 44);
  thrower.cooldown = 0;
  world.step();
  assert.equal(gig.hpMax - gig.hp, 24);
  const vander = world.spawnBuilding('thunderarcher', 2, 34, 36);
  world.step();
  assert.equal(vander.target, gig.id);
  assert.equal(gig.hpMax - gig.hp, 24 + 21);
});

test('an Aerial Transport flies over the sky to a geyser and back', () => {
  const world = mk();
  world.addPlayer(1, 'Blue', 'wind', 0, []);
  world.addIsland(0, 30, 30, 20, 1);
  world.spawnBuilding('windvortex', 1, 10, 36);
  const balloon = world.spawnTransport('sunballoon', 1, 25, 40);
  const golem = world.spawnTransport('sunwalker', 1, 25, 42);
  const geyser = world.addGeyser(60, 40); // on an islet of its own, no bridge to it
  assert.equal(world.apply({ t: 'collect', player: 1, transport: golem.id, geyser: geyser.id }),
    'no path');
  assert.equal(world.apply({ t: 'collect', player: 1, transport: balloon.id, geyser: geyser.id }),
    null);
  run(world, 40);
  assert.ok(world.players.get(1)!.storm >= 200);
  assert.equal(balloon.hp, balloon.hpMax);
});

test('only archers and anti-air guns can hit an Aerial Transport', () => {
  const world = mk();
  world.addIsland(0, 0, 120, 100, 2);
  const balloon = world.spawnTransport('sunballoon', 1, 50, 40);
  world.spawnBuilding('suncannon', 2, 40, 39, 1);
  world.spawnBuilding('windarcher', 2, 50, 46, 0);
  world.spawnBuilding('thunderfence', 2, 30, 39);
  world.spawnBuilding('thunderfence', 2, 60, 39);
  run(world, 6);
  assert.equal(balloon.hp, balloon.hpMax);
  world.spawnBuilding('thunderarcher', 2, 54, 44);
  world.step();
  assert.equal(balloon.hpMax - balloon.hp, 21);
});

test('half the shots at a Cloud Floater miss, and it mends while it carries a crystal', () => {
  const world = mk();
  world.addIsland(0, 0, 120, 100, 2);
  const cloud = world.spawnTransport('rainballoon', 1, 50, 40);
  world.spawnBuilding('thunderarcher', 2, 54, 44);
  run(world, 10);
  // Ten shots of 21, and neither all nor none of them land.
  const hits = (cloud.hpMax - cloud.hp) / 21;
  assert.ok(Number.isInteger(hits) && hits > 0 && hits < 10, `${hits} hits`);
  const fresh = world.spawnTransport('rainballoon', 1, 10, 10);
  fresh.hp = 100;
  fresh.carrying = world.spawnCrystal(fresh, 200).id;
  run(world, 10);
  assert.equal(fresh.hp, 150);
});
