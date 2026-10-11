import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  World,
  ReplayRecorder,
  playReplay,
  parseCommand,
  assertWorldInvariants,
  loadDefs,
  createSkirmish,
  type Command,
  type WorldSnapshot,
  type Geyser,
} from '../src/index.js';

const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8')),
);
const mk = () =>
  createSkirmish(defs, 7, [
    { id: 1, name: 'Blue', theme: 'wind', x: 40, y: 40 },
    { id: 2, name: 'Red', theme: 'rain', x: 120, y: 40 },
  ], [[80, 40]]);
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

// Re-pinned when Transport gained `target` and when Crystal Crab's level followed the official help.
// With both reverted these equal the pre-refactor hashes.
test('authoritative hashes stay stable at reference ticks', () => {
  const world = mk();
  const hashes = new Map([
    [1, 4211769341],
    [60, 2167157105],
    [101, 2969459431],
    [200, 2053809426],
    [400, 3856690405],
  ]);

  for (let index = 0; index < 400; index++) {
    world.step(index === 100 ? [{ t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 }] : []);
    const expected = hashes.get(world.tick);

    if (expected !== undefined) {
      assert.equal(world.hash(), expected, `tick ${world.tick}`);
    }
  }
});

test('construction preview and execution share validation without preview mutations', () => {
  const world = mk();
  const command: Command = { t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 };
  const hash = world.hash();
  assert.equal(world.view().canBuild(command), null);
  assert.equal(world.hash(), hash);
  assert.deepEqual(world.execute(command), { ok: true });
  assert.equal(world.view().canBuild(command), 'blocked');
  assert.deepEqual(world.execute(command), { ok: false, error: 'blocked' });
  const invalid: Command = { ...command, x: -1 };
  assert.equal(world.canBuild(invalid), 'bad coordinates');
  assert.deepEqual(world.execute(invalid), { ok: false, error: 'bad coordinates' });
});

test('commands retain submission order and rejection events have typed payloads', () => {
  const world = mk();
  const command: Command = { t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 };
  world.step([command, command]);
  const events = world.drainEvents();
  assert.deepEqual(events.map((event) => event.what), ['build', 'rejected']);
  const rejected = events.find((event) => event.what === 'rejected');
  assert.deepEqual(rejected?.data, { cmd: 'build', err: 'blocked' });
  assert.equal(world.players.get(1)!.storm, 1600);
});

test('entities spawned during an update wait until the next tick', () => {
  class SpawningWorld extends World {
    override spawnCrystal(geyser: Geyser) {
      const transport = this.spawnTransport('sunwalker', 1, 10, 10);
      transport.path = [[11, 10]];
      transport.move = 100;
      return super.spawnCrystal(geyser);
    }
  }

  const world = new SpawningWorld(defs, 1);
  world.addIsland(0, 0, 20, 20, 1);
  const geyser = world.addGeyser(15, 15);
  geyser.timer = 1;
  world.step();
  const transport = [...world.entities.values()].find((entity) => entity.kind === 'transport')!;
  assert.equal(transport.x, 10);
  world.step();
  assert.equal(transport.x, 11);
});

test('snapshots detach mutable arrays, entities, definitions and technologies', () => {
  const world = mk();
  const hash = world.hash();
  const snapshot = world.snapshot();
  snapshot.terrain[0] = 1;
  snapshot.entities[0]!.x++;
  snapshot.defs[0]!.cost++;
  snapshot.players[0]!.tech.length = 0;
  assert.equal(world.hash(), hash);
  const restored = World.fromSnapshot(json(world.snapshot()));
  restored.players.get(1)!.tech.clear();
  assert.equal(world.hash(), hash);
});

test('JSON snapshots preserve hash, PRNG, ids, order and future ticks', () => {
  const world = mk();

  for (let index = 0; index < 175; index++) {
    world.step();
  }

  world.events.push({ tick: world.tick, what: 'victory', who: 1 });
  world.invalidateTerrain();
  const restored = World.fromSnapshot(json(world.snapshot()));
  assert.equal(restored.hash(), world.hash());
  assert.deepEqual(restored.drainEvents(), []);
  world.drainEvents();

  for (let index = 0; index < 250; index++) {
    const commands: Command[] = index === 0
      ? [{ t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 }]
      : [];
    world.step(commands);
    restored.step(commands);
    assert.equal(restored.hash(), world.hash(), `continued tick ${world.tick}`);
    assert.deepEqual(restored.drainEvents(), world.drainEvents());
  }
});

test('snapshot continuation preserves movement and crystal ownership through delivery', () => {
  const world = mk();

  for (let x = 51; x < 79; x++) {
    world.terrain[40 * 256 + x] = 2;
    world.owner[40 * 256 + x] = 1;
  }

  const transport = [...world.entities.values()].find((entity) =>
    entity.kind === 'transport' && entity.owner === 1
  )!;
  const geyser = [...world.entities.values()].find((entity) => entity.kind === 'geyser')!;
  world.step([{ t: 'collect', player: 1, transport: transport.id, geyser: geyser.id }]);

  for (let index = 0; index < 250; index++) {
    world.step();
  }

  const restored = World.fromSnapshot(json(world.snapshot()));

  for (let index = 0; index < 600; index++) {
    world.step();
    restored.step();
    assertWorldInvariants(world);
    assert.equal(restored.hash(), world.hash());
  }

  assert.equal(world.players.get(1)!.storm, 2200);
});

test('snapshots preserve a captured priest through sacrifice and victory', () => {
  const world = mk();
  const victim = world.priestOf(2)!;
  const carrier = world.priestOf(1)!;
  victim.hp = 40;
  world.step();
  world.occupant[world.at(carrier.x, carrier.y)] = 0;
  carrier.x = victim.x + 1;
  carrier.y = victim.y;
  world.occupant[world.at(carrier.x, carrier.y)] = carrier.id;
  assert.deepEqual(world.execute({ t: 'pickupPriest', player: 1, target: victim.id }), {
    ok: true,
  });
  const altar = world.buildingsOf(1).find((building) => building.type === 'altar')!;
  world.occupant[world.at(carrier.x, carrier.y)] = 0;
  carrier.x = altar.x - 1;
  carrier.y = altar.y;
  world.occupant[world.at(carrier.x, carrier.y)] = carrier.id;
  const restored = World.fromSnapshot(json(world.snapshot()));

  for (const match of [world, restored]) {
    match.step([{ t: 'sacrifice', player: 1 }]);
  }

  assert.equal(restored.hash(), world.hash());
  assert.equal(restored.winner, 1);
  assertWorldInvariants(restored);
});

test('malformed snapshots fail explicitly instead of silently normalizing state', () => {
  const mutations: Array<(snapshot: WorldSnapshot) => void> = [
    (snapshot) => {
      snapshot.formatVersion++;
    },
    (snapshot) => {
      snapshot.rulesVersion++;
    },
    (snapshot) => {
      snapshot.terrain.pop();
    },
    (snapshot) => {
      snapshot.terrain[0] = 3;
    },
    (snapshot) => {
      snapshot.owner[0] = 7;
    },
    (snapshot) => {
      snapshot.occupant[0] = 123456;
    },
    (snapshot) => {
      snapshot.entities.push(snapshot.entities[0]!);
    },
    (snapshot) => {
      snapshot.players.push(snapshot.players[0]!);
    },
    (snapshot) => {
      snapshot.defs.push(snapshot.defs[0]!);
    },
    (snapshot) => {
      snapshot.nextId = 1;
    },
    (snapshot) => {
      snapshot.rngState = -1;
    },
    (snapshot) => {
      snapshot.tick = 0.5;
    },
    (snapshot) => {
      snapshot.entities[0]!.x = NaN;
    },
    (snapshot) => {
      snapshot.winner = 7;
    },
    (snapshot) => {
      snapshot.players[0]!.tech.push(snapshot.players[0]!.tech[0]!);
    },
  ];
  const world = mk();
  const hash = world.hash();

  for (const mutate of mutations) {
    const snapshot = world.snapshot();
    mutate(snapshot);
    assert.throws(() => World.fromSnapshot(snapshot));
    assert.equal(world.hash(), hash);
  }

  assert.throws(() => World.fromSnapshot({ ...world.snapshot(), secretField: 1 }), /Unknown/);
});

test('invariant checks identify broken cargo references and nonblocking occupants', () => {
  const world = mk();
  const transport = [...world.entities.values()].find((entity) => entity.kind === 'transport')!;

  if (transport.kind !== 'transport') {
    throw new Error('Missing transport');
  }

  transport.carrying = 999;
  assert.throws(() => world.snapshot(), /cargo/);
  transport.carrying = null;
  world.occupant[0] = transport.id;
  assert.throws(() => world.snapshot(), /non-blocking occupant/);
});

test('recorded commands and exports are detached and replay checkpoints verify continuation', () => {
  const world = mk();

  for (let index = 0; index < 20; index++) {
    world.step();
  }

  const recorder = new ReplayRecorder(world);
  const command: Command = { t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 };
  recorder.step([command, command]);
  command.x = 100;

  for (let index = 0; index < 110; index++) {
    recorder.step(index === 5 ? [{ t: 'movePriest', player: 1, x: -1, y: 40 }] : []);
    recorder.drainEvents();
  }

  const exported = recorder.export();
  assert.equal(exported.frames[0]!.commands[0]!.t, 'build');
  assert.equal(exported.frames.filter((frame) => frame.hash !== null).length, 3);
  const replayed = playReplay(json(exported));
  assert.equal(replayed.hash(), world.hash());
  exported.frames.length = 0;
  assert.equal(recorder.export().frames.length, 111);

  for (let index = 0; index < 100; index++) {
    replayed.step();
    recorder.step();
  }

  assert.equal(replayed.hash(), world.hash());
});

test('replays reject gaps, duplicate ticks, incompatible versions, bad commands and divergence', () => {
  const recorder = new ReplayRecorder(mk());
  recorder.step([{ t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 }]);
  recorder.step();

  for (
    const change of [
      (replay: ReturnType<ReplayRecorder['export']>) => {
        replay.formatVersion++;
      },
      (replay: ReturnType<ReplayRecorder['export']>) => {
        replay.rulesVersion++;
      },
      (replay: ReturnType<ReplayRecorder['export']>) => {
        replay.frames[0]!.tick++;
      },
      (replay: ReturnType<ReplayRecorder['export']>) => {
        replay.frames[1]!.tick--;
      },
      (replay: ReturnType<ReplayRecorder['export']>) => {
        replay.frames[0]!.commands = [];
      },
      (replay: ReturnType<ReplayRecorder['export']>) => {
        replay.frames[1]!.hash = 0;
      },
    ]
  ) {
    const replay = recorder.export();
    change(replay);
    assert.throws(() => playReplay(replay));
  }

  const invalid = recorder.export();
  Object.assign(invalid.frames[0]!.commands[0]!, { t: 'teleport' });
  assert.throws(() => playReplay(invalid), /command type/);
});

test('external commands validate shape while retaining domain-rejected coordinates', () => {
  assert.deepEqual(parseCommand({ t: 'movePriest', player: 1, x: -1, y: 40 }), {
    t: 'movePriest',
    player: 1,
    x: -1,
    y: 40,
  });
  assert.throws(() => parseCommand({ t: 'build', player: 1, type: 'suncannon', x: 1.5, y: 2 }),
    /integer/);
  assert.throws(
    () => parseCommand({ t: 'build', player: 1, type: 'suncannon', x: 1, y: 2, facing: 7 }),
    /facing/,
  );
  assert.throws(() => parseCommand({ t: 'sacrifice', player: 1, x: 10 }), /Unknown/);
  assert.throws(() => parseCommand(null), /object/);
});

test('recorder rejects external tick advancement', () => {
  const world = mk();
  const recorder = new ReplayRecorder(world);
  world.step();
  assert.throws(() => recorder.step(), /outside replay recorder/);
  assert.throws(() => recorder.export(), /outside replay recorder/);
});

test('a loaded transport rejects another collect and drops linked cargo on destruction', () => {
  const world = mk();
  const transport = [...world.entities.values()].find((entity) =>
    entity.kind === 'transport' && entity.owner === 1
  );
  const geyser = [...world.entities.values()].find((entity) => entity.kind === 'geyser');
  assert.ok(transport?.kind === 'transport' && geyser?.kind === 'geyser');
  geyser.timer = 1;
  world.step();
  transport.x = geyser.x + 1;
  transport.y = geyser.y;
  const command: Command = { t: 'collect', player: 1, transport: transport.id, geyser: geyser.id };
  assert.deepEqual(world.execute(command), { ok: true });
  world.step();
  const cargoId = transport.carrying;
  assert.ok(cargoId !== null);
  const beforeRejection = world.hash();
  assert.deepEqual(world.execute(command), { ok: false, error: 'bad target' });
  assert.equal(world.hash(), beforeRejection);
  transport.hp = 0;
  world.step();
  assert.ok(!world.entities.has(transport.id));
  const crystal = world.entities.get(cargoId);
  assert.ok(crystal?.kind === 'crystal');
  assert.equal(crystal.carriedBy, null);
  assert.equal(crystal.x, transport.x);
  assert.equal(crystal.y, transport.y);
  assertWorldInvariants(world);
});

test('priest capture prevents overwriting cargo or nesting carrier chains', () => {
  const world = mk();
  world.addPlayer(3, 'Third', 'thunder', 0, []);
  const third = world.addPriest(3, 121, 47);
  const victim = world.priestOf(2)!;
  const carrier = world.priestOf(1)!;
  victim.hp = 40;
  third.hp = 40;
  world.step();
  world.occupant[world.at(carrier.x, carrier.y)] = 0;
  carrier.x = 121;
  carrier.y = 46;
  world.occupant[world.at(carrier.x, carrier.y)] = carrier.id;
  assert.deepEqual(world.execute({ t: 'pickupPriest', player: 1, target: victim.id }), {
    ok: true,
  });
  const hash = world.hash();
  assert.deepEqual(world.execute({ t: 'pickupPriest', player: 1, target: third.id }), {
    ok: false,
    error: 'bad target',
  });
  assert.equal(world.hash(), hash);
  carrier.hp = 40;
  third.hp = 100;
  world.step();
  assert.deepEqual(world.execute({ t: 'pickupPriest', player: 3, target: carrier.id }), {
    ok: false,
    error: 'bad target',
  });
  assertWorldInvariants(world);
});

test('every nonempty replay requires a final checkpoint', () => {
  const recorder = new ReplayRecorder(mk());
  recorder.step();
  const replay = recorder.export();
  replay.frames[0]!.hash = null;
  assert.throws(() => playReplay(replay), /final checkpoint/);
});

test('snapshot boundaries reject sparse grids and unsupported setup fields', () => {
  const world = mk();
  const snapshot = world.snapshot();
  Reflect.deleteProperty(snapshot.terrain, 0);
  assert.throws(() => World.fromSnapshot(snapshot), /sparse/);
  Object.assign(world.entities.values().next().value!, { unsupported: true });
  assert.throws(() => world.snapshot(), /Unknown/);
  const other = mk();
  const alteredDefs = new Map(other.defs);
  alteredDefs.set('wrong-key', other.def('suncannon'));
  const invalid = new World(alteredDefs, 1);
  assert.throws(() => invalid.snapshot(), /definition key mismatch/);
});

test('a transport only collects from the geyser it was sent to', () => {
  const world = mk();
  const transport = [...world.entities.values()].find((entity) =>
    entity.kind === 'transport' && entity.owner === 1
  );
  const full = [...world.entities.values()].find((entity) => entity.kind === 'geyser');
  assert.ok(transport?.kind === 'transport' && full?.kind === 'geyser');
  const empty = world.addGeyser(full.x, full.y + 2);
  full.timer = 1;
  world.step();
  assert.ok(full.crystal !== null && empty.crystal === null);
  // Adjacent to both geysers.
  transport.x = full.x;
  transport.y = full.y + 1;
  assert.deepEqual(
    world.execute({ t: 'collect', player: 1, transport: transport.id, geyser: empty.id }),
    { ok: true },
  );
  assert.equal(transport.target, empty.id);
  world.step();
  assert.equal(transport.carrying, null);
  assert.equal(transport.goal, 'idle');
  assert.equal(transport.target, null);
  assert.ok(full.crystal !== null);
  assertWorldInvariants(world);
});

test('a priest cannot enter or path through a geyser or another priest', () => {
  const world = mk();
  const priest = world.priestOf(1)!;
  const geyser = world.addGeyser(priest.x + 3, priest.y);
  const cell = world.at(geyser.x, geyser.y);
  assert.deepEqual(world.execute({ t: 'movePriest', player: 1, x: geyser.x, y: geyser.y }), {
    ok: false,
    error: 'no path',
  });
  assert.deepEqual(world.execute({ t: 'movePriest', player: 1, x: geyser.x + 2, y: geyser.y }), {
    ok: true,
  });

  for (let index = 0; index < 100; index++) {
    world.step();
    assert.equal(world.occupant[cell], geyser.id);
  }

  assert.deepEqual([priest.x, priest.y], [geyser.x + 2, geyser.y]);
  // A stale path straight into an occupied cell stops the priest in front of it.
  priest.path = [[geyser.x + 1, geyser.y], [geyser.x, geyser.y]];

  for (let index = 0; index < 50; index++) {
    world.step();
  }

  assert.deepEqual([priest.x, priest.y], [geyser.x + 1, geyser.y]);
  assert.equal(world.occupant[cell], geyser.id);
  const other = world.addPlayer(3, 'Third', 'thunder', 0, []);
  const blocker = world.addPriest(other.id, geyser.x + 2, geyser.y);
  priest.path = [[blocker.x, blocker.y]];

  for (let index = 0; index < 50; index++) {
    world.step();
  }

  assert.deepEqual([priest.x, priest.y], [geyser.x + 1, geyser.y]);
  assert.equal(world.occupant[world.at(blocker.x, blocker.y)], blocker.id);
  assertWorldInvariants(world);
});

test('unit definitions reject unknown classes and groups', () => {
  assert.throws(() => loadDefs([{ id: 'x', class: 'Enrgy' }]), /Unknown unit class/);
  assert.throws(() => loadDefs([{ id: 'x', group: 'canon' }]), /Unknown unit group/);
  assert.equal(loadDefs([{ id: 'x', class: 'Energy', group: 'battery' }]).get('x')?.cls, 'Energy');
});
