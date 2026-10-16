import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aiMove,
  createAiMemory,
  createSkirmish,
  H,
  loadDefs,
  MEMORY_MOVES,
  parseCommand,
  playReplay,
  ReplayRecorder,
  Terrain,
  threatMap,
  TPS,
  upgradeCost,
  W,
  WORKSHOP_SLOTS,
  World,
} from '../src/index.js';
import { skyCosts } from '../src/ai/threat.js';
import { wantedTransports } from '../src/ai/economy.js';
import { defendScore, pushing } from '../src/ai/goals.js';
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
  const memory = createAiMemory();

  for (let i = 0; i < LIMIT && match.view().winner === null; i++) {
    const commands = i % MOVE === 0 ? aiMove(match.view(), { player: 2 }, memory) : [];

    for (const command of commands) {
      assert.deepEqual(parseCommand(JSON.parse(JSON.stringify(command))), command);
      seen.add(command.t);
    }

    // A move never spends more Storm Power than the AI has.
    const cost = commands.reduce(
      (sum, command) =>
        sum + (command.t === 'build' ? defs.get(command.type)!.cost : 0)
        + (command.t === 'upgradeWorkshop'
          ? upgradeCost(
            defs.get((match.view().entities.get(command.workshop) as { type: string; }).type)!,
          )
          : 0),
      0,
    );
    assert.ok(cost <= match.view().players.get(2)!.storm);

    // The move wrote what it started with and what it spent into its memory.
    if (i % MOVE === 0) {
      assert.equal(memory.storm.at(-1), match.view().players.get(2)!.storm);
      assert.equal(memory.spent.at(-1), cost);
    }

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
  assert.equal(memory.storm.length, MEMORY_MOVES);

  // It collected, bridged, built, filled its Workshops, captured and warded the runes on its own.
  for (const kind of ['build', 'capturePriest', 'collect', 'dropPiece', 'movePriest', 'produce']) {
    assert.ok(seen.has(kind), kind);
  }

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

test("under the enemy's guns the Priest walks out of their reach and builds nothing", () => {
  const world = equipWorkshops(mk());
  world.players.get(2)!.storm = 5000;
  const priest = world.priestOf(2)!;
  // A Disc Thrower of the idle side right beside him: his cell is in its square.
  world.spawnBuilding('sunarcher', 1, priest.x + 2, priest.y + 2);
  const orders = aiMove(world.view(), { player: 2 });
  const walk = orders.find((c) => c.t === 'movePriest');
  assert.ok(walk && walk.t === 'movePriest');
  assert.equal(threatMap(world.view(), 2)[world.at(walk.x, walk.y)], 0);
  assert.ok(!orders.some((c) => c.t === 'build' && c.type === 'altar'));
  // Easy takes three moves to notice a gun; with a memory, the first move still sees nothing.
  const memory = createAiMemory();
  const easy = aiMove(world.view(), { player: 2, difficulty: 'easy' }, memory);
  assert.ok(!easy.some((c) => c.t === 'movePriest'));
  world.step([]);
  assert.ok(
    aiMove(world.view(), { player: 2, difficulty: 'hard' }, memory).some((c) =>
      c.t === 'movePriest'
    ),
  );
});

test("the threat map covers a cannon's line and a Disc Thrower's square, not an invisible gun", () => {
  const world = mk();
  const cannon = world.spawnBuilding('raincannon', 1, 60, 140, 1); // Ice Cannon facing east
  const archer = world.spawnBuilding('sunarcher', 1, 80, 160);
  const threat = threatMap(world.view(), 2);
  const row = cannon.y + (cannon.fy >> 1);
  assert.equal(threat[world.at(cannon.x + cannon.fx, row)], defs.get('raincannon')!.dps);
  assert.equal(threat[world.at(cannon.x + cannon.fx, row + 1)], 0);
  assert.equal(threat[world.at(archer.x + 1 + 8, archer.y + 1 + 8)], defs.get('sunarcher')!.dps);
  assert.equal(threat[world.at(archer.x + 1 + 9, archer.y + 1)], 0);
  archer.invisible = 100;
  assert.equal(threatMap(world.view(), 2)[world.at(archer.x + 1, archer.y + 1)], 0);
});

test("a bridge goes around the enemy's fire when the detour is cheaper than crossing it", () => {
  // Open sky, a seed at (10, 10) and a wall of fire down column 15 from the top to row 14: the
  // straight way to (20, 10) crosses one cell of it, the way around its foot takes ten more.
  const world = new World(defs, 1);
  const threat = new Int32Array(W * H);

  for (let y = 0; y <= 14; y++) {
    threat[world.at(15, y)] = 100;
  }

  const cost = (weight: number) => {
    const field = new Int32Array(W * H).fill(-1);
    const queue = new Int32Array(1);
    field[world.at(10, 10)] = 0;
    queue[0] = world.at(10, 10);
    skyCosts(world.view(), field, queue, 1, threat, weight);
    return field[world.at(20, 10)];
  };

  assert.equal(cost(0), 10); // the breadth-first length
  assert.equal(cost(1), 20); // crossing costs 10 more: as cheap as the way around, which wins
  assert.equal(cost(2), 20); // crossing would cost 20 more: the way around
});

test('a Production Slot never goes to a blocker, and an Aerial Transport only when stranded', () => {
  const world = mk();
  world.players.get(2)!.storm = 5000;
  world.players.get(2)!.tech.add('rainblocker');
  world.spawnBuilding('rainfactory', 2, 141, 83);
  const made = aiMove(world.view(), { player: 2 }).flatMap((
    c,
  ) => (c.t === 'produce' ? [c.type] : []));
  assert.ok(made.length > 0);
  assert.ok(!made.includes('rainblocker'));
  assert.ok(!made.includes('rainballoon'));
});

test('hoarded Storm Power buys several shooters a move, each of another type', () => {
  const world = equipWorkshops(mk());
  world.players.get(2)!.storm = 50_000;
  // Open ground west of the Temple, toward the enemy, with room for a row of guns.
  world.addIsland(126, 84, 14, 20, 2);
  world.spawnBuilding('rainbattery', 2, 127, 86);
  world.spawnBuilding('rainbattery', 2, 127, 98);
  const guns = (difficulty: 'easy' | 'hard') =>
    aiMove(world.view(), { player: 2, difficulty }).flatMap((c) =>
      c.t === 'build' && defs.get(c.type)!.dps > 0 ? [c.type] : []
    );
  const hard = guns('hard');
  assert.ok(hard.length >= 2,
    `hard laid ${JSON.stringify(aiMove(world.view(), { player: 2, difficulty: 'hard' }))}`);
  assert.equal(new Set(hard).size, hard.length);
  assert.ok(guns('easy').length <= 2);
});

test("transports follow the geysers in reach: one each and a spare, within the level's most", () => {
  assert.equal(wantedTransports(0, 3), 1);
  assert.equal(wantedTransports(1, 3), 2);
  assert.equal(wantedTransports(5, 3), 3);
  assert.equal(wantedTransports(5, 4), 4);
});

test('an idle transport fetches a crystal lying on the ground before it goes mining', () => {
  const world = mk();
  const temple = world.templeOf(2)!;
  const t = world.spawnTransport('rainwalker', 2, temple.x - 2, temple.y + 2);
  const crystal = world.spawnCrystal(t, 200);
  crystal.carriedBy = null;
  crystal.x = temple.x - 4;
  crystal.y = temple.y + 2;
  const order = aiMove(world.view(), { player: 2 }).find((c) => c.t === 'pickupCrystal');
  assert.ok(order && order.t === 'pickupCrystal' && order.crystal === crystal.id);
  world.step([order]);
  const sent = world.entities.get(order.transport);
  assert.equal(sent?.kind === 'transport' && sent.goal, 'pickup');
});

test('an enemy bridge coming within the alarm of its island gets a gun on that shore', () => {
  const world = equipWorkshops(mk());
  world.players.get(2)!.storm = 1500;
  // Guns enough that it would otherwise build none this far from the enemy.
  world.spawnBuilding('suncannon', 2, 141, 83);
  world.spawnBuilding('suncannon', 2, 145, 83);
  world.spawnBuilding('suncannon', 2, 149, 83);
  const quiet = aiMove(world.view(), { player: 2 }).filter((c) =>
    c.t === 'build' && defs.get(c.type)!.dps > 0
  );
  assert.equal(quiet.length, 0);

  // A bridge of the idle side a few cells east of the AI's island.
  for (let x = 162; x < 170; x++) {
    world.terrain[world.at(x, 88)] = Terrain.Bridge;
    world.owner[world.at(x, 88)] = 1;
  }

  world.invalidateTerrain();
  const guns = aiMove(world.view(), { player: 2 }).filter((c) =>
    c.t === 'build' && defs.get(c.type)!.dps > 0
  );
  assert.ok(guns.length >= 1);
  assert.ok(guns.every((c) => c.t === 'build' && c.x >= 150), JSON.stringify(guns));
  assert.equal(defendScore({ fired: false, losses: 0, approach: null }), 0);
  assert.ok(defendScore({ fired: false, losses: 0, approach: 6 }) > 0.5);
  assert.equal(defendScore({ fired: true, losses: 0, approach: null }), 1);
});

test('a building under fire gets a gun beside it that reaches the gun firing', () => {
  const world = equipWorkshops(mk());
  world.players.get(2)!.storm = 1500;
  world.spawnBuilding('rainbattery', 2, 141, 83);
  // An Ice Cannon of the idle side, out in the sky, firing west along the battery's row.
  world.spawnBuilding('raincannon', 1, 170, 83, 3);
  const guns = aiMove(world.view(), { player: 2 }).filter((c) =>
    c.t === 'build' && defs.get(c.type)!.dps > 0
  );
  assert.ok(guns.length >= 1, 'a gun is laid');
  // Its guns reach 8, 22 and 32 cells; the first laid is of the kind that reaches the cannon, by
  // the battery.
  const first = guns[0]!;
  assert.ok(first.t === 'build' && defs.get(first.type)!.range >= 32, JSON.stringify(guns));
  assert.ok(first.t === 'build' && Math.abs(first.x - 141) <= 9 && Math.abs(first.y - 83) <= 9);
});

const buyer = () => {
  const world = mk();
  world.spawnBuilding('rainfactory', 2, 141, 86);
  world.spawnBuilding('rainbattery', 2, 155, 84); // Rain Energy for a Rain Walker
  equipWorkshops(world);
  world.spawnBuilding('altar', 2, 150, 94);
  world.spawnBuilding('suncannon', 2, 141, 83);
  world.spawnBuilding('suncannon', 2, 145, 83);
  world.spawnBuilding('suncannon', 2, 149, 83);
  // A Rain Walker costs 600, the savings kept with it 600; the reserve is one Disc Thrower, 250.
  world.players.get(2)!.storm = 1449;
  return world;
};

/** Storm Power a move spends on transports. */
const spent = (difficulty: 'easy' | 'normal') =>
  aiMove(buyer().view(), { player: 2, difficulty, transports: 2 }).reduce(
    (sum, c) => sum + (c.t === 'build' ? defs.get(c.type)!.cost : 0),
    0,
  );

test('a reserve for a defence is kept from a transport on Normal, not on Easy', () => {
  // Easy buys a transport for 600 with the 600 of savings; Normal, keeping 250 more for a Disc
  // Thrower, is short of that and makes do with a Golem for 400.
  assert.equal(spent('easy'), 600);
  assert.ok(spent('normal') <= 1449 - 250 - 600);
});

const idle = () => {
  const world = equipWorkshops(mk());
  world.players.get(2)!.storm = 100;

  // Five Disc Throwers on the island, far from anything of the enemy.
  for (let i = 0; i < 5; i++) {
    world.spawnBuilding('sunarcher', 2, 141 + i * 3, 83);
  }

  return world;
};

const salvaged = (difficulty: 'easy' | 'hard') => {
  const world = idle();
  const memory = createAiMemory(7);
  aiMove(world.view(), { player: 2, difficulty }, memory);

  for (let i = 0; i < 91 * TPS; i++) {
    world.step();
  }

  return aiMove(world.view(), { player: 2, difficulty }, memory).filter((c) => c.t === 'salvage');
};

test('Hard salvages a gun that has stood idle for long, Easy keeps it', () => {
  assert.equal(salvaged('hard').length, 1);
  assert.equal(salvaged('easy').length, 0);
});

test("a push waits for the guns to outweigh the enemy's, and holds on once begun", () => {
  assert.ok(pushing(0, 0, 1.2, false));
  assert.ok(!pushing(100, 100, 1.2, false));
  assert.ok(pushing(120, 100, 1.2, false));
  assert.ok(pushing(90, 100, 1.2, true));
  assert.ok(!pushing(80, 100, 1.2, true));
});

test('the bridge goes for the geyser nearest by the sky, not by the map', () => {
  // An island of the AI's at (100, 100), a geyser 12 cells east of it behind a wall of neutral
  // island that runs the whole way across, and one 20 cells south in open sky.
  const world = createSkirmish(defs, 1, [
    { id: 1, name: 'Idle', theme: 'wind', x: 200, y: 200 },
    { id: 2, name: 'AI', theme: 'rain', x: 100, y: 100 },
  ], [[120, 100], [100, 128]]);
  world.addIsland(112, 60, 3, 80, 0);

  for (let i = 0; i < 20 * TPS; i++) {
    world.step();
  }

  const pieces = aiMove(world.view(), { player: 2, difficulty: 'hard' }).filter((c) =>
    c.t === 'dropPiece'
  );
  assert.ok(pieces.length >= 1);
  const south = pieces[0]!;
  assert.ok(south.t === 'dropPiece' && south.y > 105, JSON.stringify(pieces));
});

test('Hard grows two bridges a move, from two pieces of its hand, and the drops both land', () => {
  const world = createSkirmish(defs, 1, [
    { id: 1, name: 'Idle', theme: 'wind', x: 200, y: 200 },
    { id: 2, name: 'AI', theme: 'rain', x: 100, y: 100 },
  ], [[100, 130], [130, 100]]);

  for (let i = 0; i < 20 * TPS; i++) {
    world.step();
  }

  const drops = (difficulty: 'easy' | 'hard') =>
    aiMove(world.view(), { player: 2, difficulty }).filter((c) => c.t === 'dropPiece');
  assert.equal(drops('easy').length, 1);
  // Two geysers and the enemy: Hard grows toward up to three targets at once.
  const several = drops('hard');
  assert.ok(several.length >= 2, JSON.stringify(several));
  world.step(several);
  assert.ok(world.drainEvents().every((e) => !(e.what === 'rejected' && e.who === 2)),
    'both drops land');
});

test("the bridge keeps heading for where the enemy's Priest was until he strays", () => {
  const world = mk();
  world.players.get(2)!.storm = 9000; // attacking from the start
  const memory = createAiMemory();
  aiMove(world.view(), { player: 2 }, memory);
  const mark = { ...memory.mark! };
  const priest = world.priestOf(1)!;
  priest.x += 3;
  aiMove(world.view(), { player: 2 }, memory);
  assert.deepEqual(memory.mark, mark);
  priest.x += 9;
  aiMove(world.view(), { player: 2 }, memory);
  assert.deepEqual(memory.mark, { x: priest.x, y: priest.y });
});

test('a full Workshop is Upgraded for a shooter it has no slot for, once Storm Power is plenty', () => {
  const world = mk();
  world.spawnBuilding('sunfactory', 2, 150, 94); // a Workshop for each Fury it knows comes first
  const shop = world.spawnBuilding('rainfactory', 2, 141, 86);
  shop.slots = ['rainwalker', 'rainfence', 'rainaviary', 'rainballoon'].slice(0, WORKSHOP_SLOTS);
  world.players.get(2)!.storm = 600;
  assert.ok(!aiMove(world.view(), { player: 2 }).some((c) => c.t === 'upgradeWorkshop'));
  world.players.get(2)!.storm = 5000;
  assert.ok(aiMove(world.view(), { player: 2 }).some((c) => c.t === 'upgradeWorkshop'));
});
