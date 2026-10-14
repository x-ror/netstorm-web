import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aiMove,
  createSkirmish,
  loadDefs,
  parseCommand,
  playReplay,
  ReplayRecorder,
  TPS,
  UPGRADE_COST,
  World,
} from '../src/index.js';
import { equipWorkshops } from './workshops.js';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../data/${name}.json`, import.meta.url), 'utf8'));
const defs = loadDefs(read('units'));
const forts = read('forts') as Record<string, { geysers: [number, number][]; }>;
// The geysers of The War Begins! that do not fall on the two rectangular home islands.
const geysers = forts.thewarbegins!.geysers.filter(([x, y]) =>
  [[70, 150], [150, 90]].every(([hx, hy]) => Math.abs(x - hx!) > 13 || Math.abs(y - hy!) > 11)
);
const MOVE = 6 * TPS;
const LIMIT = 30 * 60 * TPS;

const mk = () =>
  createSkirmish(defs, 42, [
    { id: 1, name: 'Idle', theme: 'wind', x: 70, y: 150 },
    { id: 2, name: 'AI', theme: 'rain', x: 150, y: 90 },
  ], geysers);

test('the AI wins against an idle player, and its recorded commands replay exactly', () => {
  const match = new ReplayRecorder(mk());
  const seen = new Set<string>();
  const refused: unknown[] = [];

  for (let i = 0; i < LIMIT && match.view().winner === null; i++) {
    const commands = i % MOVE === 0 ? aiMove(match.view(), { player: 2 }) : [];

    for (const command of commands) {
      assert.deepEqual(parseCommand(JSON.parse(JSON.stringify(command))), command);
      seen.add(command.t);
    }

    // A move never spends more Storm Power than the AI has.
    const cost = commands.reduce(
      (sum, command) =>
        sum + (command.t === 'build' ? defs.get(command.type)!.cost : 0)
        + (command.t === 'upgradeWorkshop' ? UPGRADE_COST : 0),
      0,
    );
    assert.ok(cost <= match.view().players.get(2)!.storm);
    match.step(commands);

    for (const event of match.drainEvents()) {
      if (event.what === 'rejected' && event.who === 2) {
        refused.push(event.data);
      }
    }
  }

  // Each command of a move holds against the others: none is refused.
  assert.deepEqual(refused, []);

  const world = match.view();
  assert.equal(world.winner, 2);
  assert.equal(world.players.get(1)!.alive, false);
  // It collected, bridged, built, filled and Upgraded its Workshops, captured and warded the
  // runes on its own.
  assert.deepEqual([...seen].sort(), [
    'build',
    'capturePriest',
    'collect',
    'dropPiece',
    'movePriest',
    'produce',
    'upgradeWorkshop',
  ]);
  const replayed = playReplay(JSON.parse(JSON.stringify(match.export())));
  assert.equal(replayed.tick, world.tick);
  assert.equal(replayed.winner, 2);
});

test('the AI has nothing to do for a missing or beaten player', () => {
  const world = mk();
  assert.deepEqual(aiMove(world.view(), { player: 5 }), []);
  world.players.get(2)!.alive = false;
  assert.deepEqual(aiMove(world.view(), { player: 2 }), []);
});

test('an AI move reads the world without changing it', () => {
  const world = mk();

  for (let i = 0; i < 2 * MOVE; i++) {
    world.step();
  }

  const hash = world.hash();
  const first = aiMove(world.view(), { player: 2 });
  assert.equal(world.hash(), hash);
  assert.deepEqual(aiMove(world.view(), { player: 2 }), first);
  assert.ok(first.length > 0);
});

test('one transport goes for a downed priest, and the others keep working', () => {
  const world = mk();
  world.spawnTransport('rainwalker', 2, 151, 97);
  const priest = world.priestOf(1)!;
  priest.state = 'down';
  priest.hp = 1; // stays down while the transports walk over
  // A strip of the AI's ground from under its home island to the idle player's, past the Workshop.
  world.addIsland(70, 99, 85, 1, 2);
  world.addIsland(70, 99, 5, 45, 2);
  world.invalidateTerrain();
  const sent = () =>
    aiMove(world.view(), { player: 2 }).filter((command) => command.t === 'capturePriest');
  assert.equal(sent().length, 1);
  world.step(sent());
  assert.ok(world.drainEvents().every((event) => event.what !== 'rejected'));
  assert.deepEqual(sent(), []);
});

test('a beaten player is no target', () => {
  const world = mk();
  const ai = world.players.get(2)!;
  ai.storm = 100_000; // rich enough to attack at once
  world.players.get(1)!.alive = false;
  world.entities.delete(world.priestOf(1)!.id);

  for (let i = 0; i < 2 * MOVE; i++) {
    world.step();
  }

  // With no free geyser worth taking and no live enemy, no bridge heads for the beaten Temple.
  for (const geyser of world.entities.values()) {
    if (geyser.kind === 'geyser') {
      world.entities.delete(geyser.id);
    }
  }

  assert.deepEqual(
    aiMove(world.view(), { player: 2 }).filter((command) => command.t === 'dropPiece'),
    [],
  );
});

test('without an Altar the AI has its Priest build one', () => {
  const world = equipWorkshops(mk());
  const altar = world.buildingsOf(2).find((b) => b.type === 'altar')!;
  world.apply({ t: 'salvage', player: 2, target: altar.id });
  const order = aiMove(world, { player: 2 }).find((c) => c.t === 'build' && c.type === 'altar');
  assert.ok(order);
  world.step([order]);

  // The Priest walks over, the Altar rises in ten seconds, and no second one is ordered.
  for (let i = 0; i < 40 * TPS; i++) {
    world.step();
  }

  const built = world.buildingsOf(2).filter((b) => b.type === 'altar');
  assert.deepEqual(built.map((b) => b.rising), [0]);
  assert.ok(!aiMove(world, { player: 2 }).some((c) => c.t === 'build' && c.type === 'altar'));
});

test('with no geyser to walk to, the AI buys a transport that flies and sends it out', () => {
  const world = equipWorkshops(mk());
  world.players.get(2)!.storm = 5000;

  // Deleting from a Map while walking it is safe.
  for (const e of world.entities.values()) {
    if (e.kind === 'transport' && e.owner === 2) {
      world.entities.delete(e.id);
    }
  }

  // A Cloud Floater takes Energy of three sources: the Temple and two Generators.
  world.spawnBuilding('rainbattery', 2, 141, 83);
  world.spawnBuilding('rainbattery', 2, 145, 83);
  const order = aiMove(world, { player: 2 }).find((c) =>
    c.t === 'build' && c.type === 'rainballoon'
  );
  assert.ok(order);
  world.step([order]);
  const sent = aiMove(world, { player: 2 }).find((c) => c.t === 'collect');
  assert.ok(sent);
  world.step([sent]);
  const balloon = [...world.entities.values()].find((e) => e.kind === 'transport' && e.owner === 2);
  assert.equal(balloon?.kind === 'transport' && balloon.goal, 'collect');
});

test('the AI sets a second fence post in line with one that stands alone', () => {
  const world = equipWorkshops(mk());
  world.players.get(2)!.storm = 5000;
  const temple = world.templeOf(2)!;
  // Enough shooters for it to think of a barrier, and one post on its island.
  world.spawnBuilding('suncannon', 2, 141, 83);
  world.spawnBuilding('suncannon', 2, 145, 83);
  world.spawnBuilding('suncannon', 2, 149, 83);
  const post = world.spawnBuilding('rainfence', 2, temple.x - 5, temple.y + 8);
  const orders = aiMove(world, { player: 2 }).filter((c) =>
    c.t === 'build' && c.type === 'rainfence'
  );
  assert.equal(orders.length, 1);
  const second = orders[0]!;
  assert.ok(second.t === 'build' && (second.x === post.x || second.y === post.y));
});

// A Thunder side with Energy enough for a Vander Tower by its Temple.
const thunder = () => {
  const world = createSkirmish(defs, 42, [
    { id: 1, name: 'Idle', theme: 'wind', x: 70, y: 150 },
    { id: 2, name: 'AI', theme: 'thunder', x: 150, y: 90, storm: 9000 },
  ], geysers);
  world.spawnBuilding('thunderbattery', 2, 141, 83);
  world.spawnBuilding('thunderbattery', 2, 145, 83);
  return equipWorkshops(world);
};

test('the AI answers enemy air with anti-air guns, and does not buy them otherwise', () => {
  const buys = (world: ReturnType<typeof thunder>) =>
    aiMove(world, { player: 2 }).flatMap((c) => (c.t === 'build' ? [c.type] : []));
  assert.ok(!buys(thunder()).includes('thunderarcher'));
  const flown = thunder();
  flown.spawnBuilding('sunaviary', 1, 62, 143);
  assert.ok(buys(flown).includes('thunderarcher'));
});

test('the AI fetches a Spell it can walk to, casts it at the enemy, and raises an Outpost', () => {
  const world = mk();
  const ai = world.players.get(2)!;
  ai.storm = 5000;
  const golem = [...world.entities.values()].find((e) => e.kind === 'transport' && e.owner === 2)!;
  const obelisk = world.addObelisk(152, 96, 'bombIIMano');
  const orders = () => aiMove(world.view(), { player: 2 });
  assert.deepEqual(orders().find((c) => c.t === 'takeSpell'), {
    t: 'takeSpell',
    player: 2,
    transport: golem.id,
    obelisk: obelisk.id,
  });
  assert.ok(!orders().some((c) => c.t === 'castSpell'));

  // With the Spell and an enemy unit within its range of 28, it casts; with nothing there, not.
  if (golem.kind === 'transport') {
    golem.spell = 'bombiimano';
  }

  assert.ok(!orders().some((c) => c.t === 'takeSpell' || c.t === 'castSpell'));
  world.spawnBuilding('sunblocker', 1, 165, 105);
  assert.deepEqual(orders().find((c) => c.t === 'castSpell'), {
    t: 'castSpell',
    player: 2,
    transport: golem.id,
  });
  ai.storm = 900; // a Wave costs 1000
  assert.ok(!orders().some((c) => c.t === 'castSpell'));

  // Unowned island ground its transports can walk to: the Priest is told to raise an Outpost.
  ai.storm = 5000;
  assert.ok(!orders().some((c) => c.t === 'build' && c.type === 'outpost'));
  world.addIsland(161, 82, 12, 12, 0);
  world.invalidateTerrain();
  const outpost = orders().find((c) => c.t === 'build' && c.type === 'outpost');
  assert.ok(outpost && world.execute(outpost).ok);
  assert.ok(!orders().some((c) => c.t === 'build' && c.type === 'outpost')); // one at a time
});

test('a mission can keep its AI from collecting, capturing and bridging to the enemy', () => {
  const world = mk();
  world.players.get(2)!.storm = 5000;
  world.addGeyser(156, 96, undefined, false); // one on its own island, to walk to

  for (let i = 0; i < 6 * TPS; i++) {
    world.step(); // until its Temple has handed out bridge pieces
  }

  const kinds = (options: object) =>
    new Set(aiMove(world.view(), { player: 2, ...options }).map((c) => c.t));
  assert.ok(kinds({}).has('collect'));
  assert.ok(!kinds({ collect: false }).has('collect'));
  const priest = world.priestOf(1)!;
  priest.hp = 10;
  priest.state = 'down';
  world.spawnBuilding('altar', 2, 142, 84);
  // The fallen Priest stands on the AI's own island here, so a transport can walk to him.
  world.occupant[world.at(priest.x, priest.y)] = 0;
  priest.x = 152;
  priest.y = 98;
  world.occupant[world.at(priest.x, priest.y)] = priest.id;
  assert.ok(kinds({}).has('capturePriest'));
  assert.ok(!kinds({ capture: false }).has('capturePriest'));
});

test('a side with an income is given its Storm Power every second', () => {
  const world = mk();
  world.addPlayer(3, 'Paid', 'thunder', 100, [], [], 8);
  const copy = World.fromSnapshot(JSON.parse(JSON.stringify(world.snapshot())));

  for (let i = 0; i < 3 * TPS; i++) {
    copy.step();
  }

  assert.equal(copy.players.get(3)!.storm, 100 + 3 * 8);
});

test('with the geysers it is asked for, the AI bridges to the enemy, unless told to keep off him', () => {
  // Two islands close enough for a bridge to be worth starting.
  const world = createSkirmish(defs, 42, [
    { id: 1, name: 'Idle', theme: 'wind', x: 70, y: 150 },
    { id: 2, name: 'AI', theme: 'rain', x: 100, y: 150 },
  ], []);

  // The AI lays a piece once it has hardened in the window.
  for (let i = 0; i < 20 * TPS; i++) {
    world.step();
  }

  const lays = (options: object) =>
    aiMove(world.view(), { player: 2, ...options }).some((c) => c.t === 'dropPiece');
  assert.ok(lays({ geysers: 0 }));
  assert.ok(!lays({ geysers: 0, attack: false }));
});
