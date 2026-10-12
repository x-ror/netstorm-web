import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, loadDefs, TPS } from '../src/index.js';

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
