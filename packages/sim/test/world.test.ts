import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  loadDefs,
  createSkirmish,
  growIslands,
  islandChunks,
  TPS,
  PIECE_INTERVAL,
  GEYSER_STOCK,
  PIECE_HARDEN,
  PIECE_HARD,
  BRIDGE_SCAN,
  PIECES,
  PIECE_WEIGHTS,
  BRIDGE_SETS,
  BRIDGE_SET_WEIGHTS,
  World,
  HAND_SIZE,
  CRYSTAL_VALUE,
  type Transport,
  UNIT_REFRESH,
} from '../src/index.js';

const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8')),
);
const players = [
  { id: 1, name: 'Blue', theme: 'wind' as const, x: 40, y: 40 },
  { id: 2, name: 'Red', theme: 'rain' as const, x: 120, y: 40 },
];
const mk = (seed = 1) => createSkirmish(defs, seed, players, [[80, 40]]);

test('defs loaded with original numbers', () => {
  const c = defs.get('suncannon')!;
  assert.equal(c.cost, 400);
  assert.equal(c.hp, 600);
  assert.equal(c.range, 22);
  assert.equal(c.dps, 16);
  assert.equal(defs.get('thundercannon')!.dps, 40);
});

test('deterministic: same seed and commands give the same hash', () => {
  const run = () => {
    const w = mk(7);

    for (let i = 0; i < 400; i++) {
      w.step(i === 100 ? [{ t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 }] : []);
    }

    return w.hash();
  };
  assert.equal(run(), run());
  const w2 = mk(8);

  for (let i = 0; i < 400; i++) {
    w2.step();
  }

  assert.notEqual(run(), w2.hash());
});

test('temple hands out bridge pieces; pieces must touch own ground', () => {
  const w = mk();

  for (let i = 0; i < PIECE_INTERVAL; i++) {
    w.step();
  }

  const p = w.players.get(1)!;
  assert.equal(p.hand.length, 1);
  // The preview check agrees with the command and changes nothing.
  assert.equal(w.canDropPiece({ player: 1, hand: 0, x: 60, y: 60, rot: 0 }), 'not connected');
  assert.equal(w.canDropPiece({ player: 1, hand: 0, x: 50, y: 40, rot: 0 }), 'blocked');
  assert.equal(w.canDropPiece({ player: 1, hand: 1, x: 51, y: 40, rot: 0 }), 'no piece');
  // The first piece is a single block. It joins on two opposite sides only, so side-on to the
  // island it does not attach, and turned a quarter it does.
  assert.equal(w.canDropPiece({ player: 1, hand: 0, x: 51, y: 40, rot: 0 }), 'not connected');
  assert.equal(w.canDropPiece({ player: 1, hand: 0, x: 51, y: 40, rot: 1 }), null);
  assert.equal(p.hand.length, 1);
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 60, y: 60, rot: 1 }),
    'not connected');
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y: 40, rot: 1 }), null); // right edge of island is x=50
  assert.equal(p.hand.length, 0);
  const cells = w.events.at(-1)!.data as [number, number][];
  // the piece spent no time in the window, so it is laid as cracked bridge
  assert.ok(cells.every(([x, y]) => w.terrain[y * 256 + x] === 3 && w.owner[y * 256 + x] === 1));
});

test('build: needs tech, storm power, energy and own ground', () => {
  const w = mk();
  const p = w.players.get(1)!;
  assert.equal(w.apply({ t: 'build', player: 1, type: 'thundercannon', x: 32, y: 36 }),
    'unknown tech');
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 90, y: 90 }),
    'not connected'); // open sky, not off a bridge
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 }), null);
  assert.equal(p.storm, 2000 - 400);
  // Unit Rate: the same unit stays dimmed for UNIT_REFRESH ticks after it is laid.
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 36, y: 44 }), 'not ready');

  for (let i = 0; i < UNIT_REFRESH; i++) {
    w.step();
  }

  assert.deepEqual(p.refresh, []);
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 32, y: 36 }), 'blocked'); // occupied
});

test('transport loops between geyser and temple, moving stock into storm power', () => {
  const w = mk();
  const p = w.players.get(1)!;
  const t = [...w.entities.values()].find((e) => e.kind === 'transport' && e.owner === 1)!;
  const g = [...w.entities.values()].find((e) => e.kind === 'geyser')!;

  // bridge straight from the island edge (x=50) to the geyser islet (x=79)
  for (let x = 51; x < 79; x++) {
    w.terrain[40 * 256 + x] = 2;
    w.owner[40 * 256 + x] = 1;
  }

  assert.equal(w.apply({ t: 'collect', player: 1, transport: t.id, geyser: g.id }), null);

  for (let i = 0; i < 80 * TPS; i++) {
    w.step();
  }

  const gained = p.storm - 2000;
  assert.ok(gained >= 2 * CRYSTAL_VALUE, 'several round trips without a new command');
  assert.equal(gained % CRYSTAL_VALUE, 0);
  assert.ok(g.kind === 'geyser' && t.kind === 'transport');
  // Storm Power is conserved: what left the geyser is either banked or in the transport's hands.
  assert.equal(g.stock + gained + (t.carrying === null ? 0 : CRYSTAL_VALUE), GEYSER_STOCK);
});

test('cannon destroys an enemy transport in its line of fire; blocker shields it', () => {
  const w = mk();
  w.spawnBuilding('suncannon', 1, 48, 39, 1); // facing east, muzzle at x=51
  const victim = w.spawnTransport('sunwalker', 2, 60, 40); // hp 50, in line (row 40 = centre of the 3×3 footprint)

  for (let i = 0; i < 4 * TPS; i++) {
    w.step();
  } // 16 dps → dead in ~3.2 s

  assert.ok(!w.entities.has(victim.id));
  const victim2 = w.spawnTransport('sunwalker', 2, 60, 40);
  w.terrain[40 * 256 + 55] = 1;
  w.owner[40 * 256 + 55] = 2;
  w.terrain[40 * 256 + 56] = 1;
  w.owner[40 * 256 + 56] = 2;
  w.terrain[40 * 256 + 57] = 1;
  w.owner[40 * 256 + 57] = 2;
  w.spawnBuilding('sunblocker', 2, 55, 39);

  for (let i = 0; i < 10 * TPS; i++) {
    w.step();
  }

  const v2 = w.entities.get(victim2.id);
  assert.ok(v2 && 'hp' in v2 && v2.hp === 50);
});

test('priest: immobilized at half HP, carried by a transport, sacrificed with five runes → victory', () => {
  const w = mk();
  const red = w.priestOf(2)!;
  const blue = w.priestOf(1)!;
  const t = [...w.entities.values()].find((e) => e.kind === 'transport' && e.owner === 1)!;
  const altar = w.buildingsOf(1).find((b) => b.type === 'altar')!;
  assert.ok(t.kind === 'transport');

  // bridge between the two home islands so the transport can walk over and back
  for (let x = 51; x < 110; x++) {
    w.terrain[40 * 256 + x] = 2;
    w.owner[40 * 256 + x] = 1;
  }

  assert.equal(w.apply({ t: 'capturePriest', player: 1, transport: t.id, target: red.id }),
    'target not incapacitated');
  red.hp = 40;
  w.step();
  assert.equal(red.state, 'down');
  assert.equal(w.apply({ t: 'capturePriest', player: 1, transport: t.id, target: blue.id }),
    'bad target'); // never your own priest
  assert.equal(w.apply({ t: 'capturePriest', player: 1, transport: t.id, target: red.id }), null);

  for (let i = 0; i < 100 * TPS && w.priestOf(2)?.state !== 'chained'; i++) {
    red.hp = 40; // keep him down: he regenerates while his temple stands
    w.step();
  }

  assert.equal(w.priestOf(2)?.state, 'chained');
  assert.equal(red.chainedAt, altar.id);
  assert.equal(t.carrying, null);

  // nothing happens until the altar owner's priest comes to the altar
  for (let i = 0; i < 10 * TPS; i++) {
    w.step();
  }

  assert.equal(red.runes, 0);
  assert.equal(w.winner, null);
  assert.equal(w.apply({ t: 'movePriest', player: 1, x: altar.x - 1, y: altar.y }), null);
  w.drainEvents();

  const started = w.tick;

  for (let i = 0; i < 100 * TPS && w.winner === null; i++) {
    w.step();
  }

  assert.equal(w.winner, 1);
  // five runes of 15 s each, plus the priest's walk to the altar
  assert.ok(w.tick - started >= 75 * TPS && w.tick - started < 95 * TPS);
  assert.equal(w.drainEvents().filter((e) => e.what === 'rune').length, 5);
  assert.ok(!w.entities.has(altar.id), 'the altar is consumed by the sacrifice');
  assert.ok(!w.entities.has(red.id));
});

const bridge = (w: ReturnType<typeof mk>, from: number, to: number) => {
  for (let x = from; x <= to; x++) {
    w.terrain[40 * 256 + x] = 2;
    w.owner[40 * 256 + x] = 1;
  }
};

test('units go off a bridge onto their own island, never on the bridge itself', () => {
  const w = mk();
  bridge(w, 51, 60);
  const cannon = { t: 'build', player: 1, type: 'suncannon' } as const;
  assert.equal(w.apply({ ...cannon, x: 55, y: 39 }), 'blocked'); // footprint covers bridge cells
  assert.equal(w.apply({ ...cannon, x: 55, y: 42 }), 'not connected'); // a gap from the bridge
  assert.equal(w.apply({ ...cannon, x: 49, y: 47 }), 'blocked'); // half island, half sky
  assert.equal(w.apply({ ...cannon, x: 49, y: 41 }), 'blocked'); // island edge plus sky
  assert.equal(w.apply({ ...cannon, x: 51, y: 41 }), null); // sky cells touching the bridge
  // The unit stands on an island of its own, and bridge can continue from it.
  assert.equal(w.terrain[42 * 256 + 53], 1);
  assert.equal(w.owner[42 * 256 + 53], 1);
  w.players.get(1)!.hand.push({ piece: 1, age: PIECE_HARDEN });
  // Lying flat under the islet the domino has no end towards it; standing up it attaches.
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 52, y: 44, rot: 1 }),
    'not connected');
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 52, y: 44, rot: 0 }), null);
});

test('the Temple fills the window with the original pieces, small ones guaranteed', () => {
  // 46 pieces of one to seven cells; the single block has no weight of its own.
  assert.equal(PIECES.length, 46);
  assert.deepEqual(PIECES[0], [[0, 0]]);
  assert.deepEqual(PIECES[1], [[0, 0], [0, 1]]);
  assert.equal(Math.max(...PIECES.map((cells) => cells.length)), 7);
  assert.equal(PIECE_WEIGHTS[0], 0);
  assert.equal(PIECE_WEIGHTS[5], 1950); // the T of four cells is the commonest piece
  const w = mk();
  const p = w.players.get(1)!;

  for (let i = 0; i < PIECE_INTERVAL * HAND_SIZE; i++) {
    w.step();
  }

  // One piece a second until every slot is taken. The very first draw is a single block, and the
  // window is never left without one for long.
  assert.equal(p.hand.length, HAND_SIZE);
  assert.equal(p.hand[0]!.piece, 0);
  assert.equal(p.piecesDrawn, HAND_SIZE);
  // Draws 6 and 7 go into the last free slot: a single block, then a domino.
  p.hand = p.hand.filter((entry) => entry.piece > 1).slice(0, HAND_SIZE - 1);

  while (p.hand.length < HAND_SIZE - 1) {
    p.hand.push({ piece: 5, age: 0 });
  }

  for (let i = 0; i < PIECE_INTERVAL; i++) {
    w.step();
  }

  assert.equal(p.hand.at(-1)!.piece, 0);
  p.hand.pop();
  p.hand.push({ piece: 0, age: 0 });
  p.hand.shift();

  for (let i = 0; i < PIECE_INTERVAL; i++) {
    w.step();
  }

  assert.equal(p.hand.at(-1)!.piece, 1);
});

test('the Bridges option picks the set of pieces the Temple draws from', () => {
  assert.deepEqual(BRIDGE_SETS, ['standard', 'traditional', 'simplified', 'crazy']);
  const drawn = (bridges: (typeof BRIDGE_SETS)[number]) => {
    const w = createSkirmish(defs, 3, players, [[80, 40]], { bridges });
    const p = w.players.get(1)!;
    const seen = new Set<number>();

    for (let i = 0; i < 3000; i++) {
      w.step();
      p.hand.forEach((entry) => seen.add(entry.piece));
      p.hand = [];
    }

    return seen;
  };
  // Simplified has nine pieces with a weight; the single block comes on its schedule besides.
  const simplified = drawn('simplified');
  assert.ok([...simplified].every((piece) => piece === 0 || BRIDGE_SET_WEIGHTS[2]![piece]! > 0));
  assert.ok(simplified.size <= 10);
  // Crazy gives every piece the same weight, so far more of the 46 turn up.
  assert.ok(drawn('crazy').size > 40);
  // The choice is part of the saved state.
  const w = createSkirmish(defs, 3, players, [[80, 40]], { bridges: 'traditional' });
  assert.equal(w.bridgeSet, 1);
  assert.equal(World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot()))).bridgeSet, 1);
});

test('the Bridge Slots option sets how many pieces the window holds', () => {
  for (const slots of [2, 4, 6]) {
    const w = createSkirmish(defs, 5, players, [[80, 40]], { slots });
    const p = w.players.get(1)!;

    for (let i = 0; i < PIECE_INTERVAL * 10; i++) {
      w.step();
    }

    assert.equal(p.hand.length, slots);
    // The single block still comes on its schedule into the last free slot.
    assert.ok(p.hand.some((entry) => entry.piece === 0));
    assert.equal(World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot()))).bridgeSlots, slots);
  }

  // Anything else falls back to six.
  assert.equal(createSkirmish(defs, 5, players, [[80, 40]], { slots: 3 }).bridgeSlots, 6);
});

test('Unit Rate, Kill Reward and Money per Geyser follow the battle options', () => {
  const w = createSkirmish(defs, 5, players, [[80, 40]], {
    unitRate: 15,
    killReward: 150,
    geyserStock: 5000,
  });
  assert.deepEqual([w.unitRate, w.killReward, w.geyserStock], [15, 150, 5000]);
  const geyser = [...w.entities.values()].find((e) => e.kind === 'geyser')!;
  assert.equal(geyser.kind === 'geyser' && geyser.stock, 5000);
  // Unit Rate: the cannon's type stays dimmed for fifteen seconds.
  const cannon = { t: 'build', player: 1, type: 'suncannon' } as const;
  assert.equal(w.apply({ ...cannon, x: 32, y: 36 }), null);
  assert.equal(w.players.get(1)!.refresh[0]!.ticks, 15 * TPS);
  // Kill Reward: one and a half times the cost of what was destroyed.
  w.addIsland(190, 190, 40, 12, 2);
  w.spawnBuilding('suncannon', 1, 192, 194, 1);
  const victim = w.spawnBuilding('sunarcher', 2, 205, 194);
  victim.hp = 1;
  const before = w.players.get(1)!.storm;
  w.step();
  assert.equal(w.players.get(1)!.storm - before, (defs.get('sunarcher')!.cost * 150) / 100);
  // The options are part of the saved state.
  const again = World.fromSnapshot(JSON.parse(JSON.stringify(w.snapshot())));
  assert.deepEqual([again.unitRate, again.killReward, again.geyserStock], [15, 150, 5000]);
  // Left alone, or given a value the option does not have, they are the campaign's.
  const plain = createSkirmish(defs, 5, players, [[80, 40]], { unitRate: 7, killReward: 33 });
  assert.deepEqual([plain.unitRate, plain.killReward, plain.geyserStock], [4, 25, 2000]);
});

test("energy must come from a nearby source of the unit's own alignment", () => {
  const w = mk();
  const p = w.players.get(1)!;
  p.tech.add('thundercannon');
  w.spawnBuilding('thunderfactory', 1, 100, 100); // so only energy can be missing
  bridge(w, 51, 90);
  const far = { player: 1, x: 70, y: 41 } as const;
  // More than 30 cells from the centre of the Wind Temple: too far for anything.
  assert.equal(w.apply({ t: 'build', type: 'suncannon', ...far }), 'no energy');
  // A Sun Generator feeds only Sun units. One source is enough for a level 1 unit (Sun Cannon)
  // but not for a level 2 one (Whirlibase shows two Sun icons in the game).
  w.spawnBuilding('sunbattery', 1, 64, 41);
  assert.equal(w.apply({ t: 'build', type: 'windarcher', ...far }), 'no energy');
  assert.equal(w.canBuild({ type: 'suncannon', ...far }), null);
  assert.equal(w.canBuild({ type: 'sunaviary', ...far }), 'no energy');
  // A Wind Generator feeds Wind and Sun units, not Thunder ones.
  w.spawnBuilding('windbattery', 1, 64, 36);
  assert.equal(w.canBuild({ type: 'sunaviary', ...far }), null);
  assert.equal(w.apply({ t: 'build', type: 'thundercannon', ...far }), 'no energy');
  // The Crossbow is level 2: one Wind energy plus one more that is not sun-only.
  assert.equal(w.apply({ t: 'build', type: 'windarcher', ...far }), 'no energy');
  w.spawnBuilding('windbattery', 1, 60, 36);
  assert.equal(w.apply({ t: 'build', type: 'windarcher', ...far }), null);
});

test('bridge needs an unbroken attachment to the Temple; attaching to a geyser claims its island', () => {
  const w = mk();
  const p = w.players.get(1)!;
  bridge(w, 51, 76);
  p.hand.push({ piece: 1, age: PIECE_HARDEN }, { piece: 1, age: PIECE_HARDEN }); // dominoes, laid flat with rot 1
  w.terrain[40 * 256 + 55] = 0; // cut the bridge
  w.owner[40 * 256 + 55] = 0;
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 77, y: 40, rot: 1 }),
    'not connected');
  bridge(w, 55, 55);
  assert.equal(w.owner[39 * 256 + 80], 0);
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 77, y: 40, rot: 1 }), null);
  // The geyser islet (79..81 × 39..41) now belongs to the player and carries the connection on.
  assert.equal(w.owner[39 * 256 + 80], 1);
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 82, y: 40, rot: 1 }), null);
});

test('pieces join end to end, never side to side', () => {
  const w = mk();
  const p = w.players.get(1)!;
  const flat = { t: 'dropPiece', player: 1, hand: 0, rot: 1 } as const;
  // A domino along the edge of the island (x = 50): its ends point east and west.
  p.hand = [{ piece: 1, age: 0 }];
  assert.equal(w.apply({ ...flat, x: 51, y: 40 }), null);
  // A second one beside it, a row below, touches it only with its long side.
  p.hand = [{ piece: 1, age: 0 }];
  assert.equal(w.apply({ ...flat, x: 53, y: 41 }), 'not connected');
  assert.equal(w.apply({ ...flat, x: 52, y: 41 }), 'not connected');
  // Standing up against the side of the first it has an end towards it, but the first has none.
  assert.equal(w.apply({ ...flat, x: 52, y: 41, rot: 0 }), 'not connected');
  // End to end it attaches, and the attachment carries on from there.
  assert.equal(w.apply({ ...flat, x: 53, y: 40 }), null);
  // A corner piece (east and south) turns the bridge: its west end meets the east end.
  p.hand = [{ piece: 4, age: 0 }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 55, y: 40, rot: 0 }), null);
  p.hand = [{ piece: 1, age: 0 }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 56, y: 42, rot: 0 }), null);
});

test('a loose end of bridge wears away; bridge joined at both ends and hard bridge stay', () => {
  const w = mk();
  const p = w.players.get(1)!;
  const at = (x: number, y: number) => w.terrain[y * 256 + x];
  const lay = (age: number, y: number) => {
    p.hand = [{ piece: 1, age }];
    assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y, rot: 1 }), null);
  };
  const until = (tick: number) => {
    while (w.tick < tick) {
      w.step();
    }
  };
  // Four dominoes off the east shore (x = 50), rows apart: cracked, normal, hard, and a normal one
  // with a cannon at its end.
  lay(0, 33);
  lay(PIECE_HARDEN, 36);
  lay(PIECE_HARD, 39);
  lay(PIECE_HARDEN, 45);
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 53, y: 44 }), null);
  assert.deepEqual([at(52, 33), at(52, 36), at(52, 39), at(52, 45)], [3, 2, 4, 2]);
  // The look comes every ten seconds. Cracked bridge starts with four steps left.
  until(4 * BRIDGE_SCAN);
  assert.equal(at(52, 33), 0); // the cracked end is gone
  assert.equal(at(51, 33), 3); // and the cell behind it is the loose end now
  assert.equal(at(52, 36), 3); // the normal end has begun to look cracked
  until(8 * BRIDGE_SCAN);
  assert.equal(at(51, 33), 0);
  assert.equal(at(52, 36), 0); // eighty seconds for normal bridge
  assert.equal(at(51, 36), 2);
  until(20 * BRIDGE_SCAN);
  assert.deepEqual([at(51, 36), at(52, 36)], [0, 0]);
  // Hard bridge never starts to wear, and neither does bridge with a unit at its end.
  assert.deepEqual([at(51, 39), at(52, 39)], [4, 4]);
  assert.deepEqual([at(51, 45), at(52, 45)], [2, 2]);
});

test('the islet of a destroyed unit falls and leaves the bridge a jagged end', () => {
  const w = mk();
  const p = w.players.get(1)!;
  const at = (x: number, y: number) => w.terrain[y * 256 + x];
  // A normal domino off the east shore (x = 50) with a cannon at its end, and a hard single block
  // laid off the far side of the cannon's islet.
  p.hand = [{ piece: 1, age: PIECE_HARDEN }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y: 40, rot: 1 }), null);
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 53, y: 39 }), null);
  p.hand = [{ piece: 0, age: PIECE_HARD }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 56, y: 40, rot: 1 }), null);
  const cannon = w.buildingsOf(1).find((b) => b.type === 'suncannon')!;
  assert.equal(cannon.islet, true);
  assert.deepEqual([at(52, 40), at(53, 40), at(56, 40)], [2, 1, 4]);
  cannon.hp = 0;
  w.step();
  // The islet is gone. The cell that led to it is cracked and ends there: it joins on its west
  // side only now.
  assert.deepEqual([at(53, 39), at(54, 40), at(55, 41)], [0, 0, 0]);
  assert.equal(at(52, 40), 3);
  assert.equal(w.links[40 * 256 + 52], 8);
  assert.equal(at(51, 40), 2);
  // The block hung on the islet alone, and being hard did not save it.
  assert.equal(at(56, 40), 0);
  // Nothing can be laid where the islet stood without an end to attach to.
  p.hand = [{ piece: 1, age: 0 }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 53, y: 39, rot: 1 }),
    'not connected');
  // The jagged end is a loose end with four steps left.

  while (w.tick < 4 * BRIDGE_SCAN) {
    w.step();
  }

  assert.equal(at(52, 40), 0);
});

test('the Priest and the Crystal Crab step off bridge that is about to fall; a Golem does not', () => {
  const w = mk();
  const p = w.players.get(1)!;
  const priest = w.priestOf(1)!;

  // Three normal dominoes off the east shore (x = 50), each with a loose end at x = 52.
  for (const y of [34, 38, 42]) {
    p.hand = [{ piece: 1, age: PIECE_HARDEN }];
    assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y, rot: 1 }), null);
  }

  w.occupant[w.at(priest.x, priest.y)] = 0;
  priest.x = 52;
  priest.y = 34;
  w.occupant[w.at(52, 34)] = priest.id;
  const crab = w.spawnTransport('rainwalker', 1, 52, 38);
  const golem = w.spawnTransport('sunwalker', 1, 52, 42);

  // The end has seven steps at the first look and five at the third: time to go.
  while (w.tick < 3 * BRIDGE_SCAN - 1) {
    w.step();
  }

  assert.deepEqual([priest.x, crab.x, golem.x], [52, 52, 52]);

  while (w.tick < 4 * BRIDGE_SCAN) {
    w.step();
  }

  // One cell back is enough: that cell does not wear yet.
  assert.deepEqual([priest.x, priest.y], [51, 34]);
  assert.deepEqual([crab.x, crab.y], [51, 38]);
  assert.deepEqual([golem.x, golem.y], [52, 42]);

  while (w.tick < 8 * BRIDGE_SCAN + 1) {
    w.step();
  }

  // The ends fell; the Golem went down with his.
  assert.equal(w.terrain[34 * 256 + 52], 0);
  assert.ok(!w.entities.has(golem.id));
  assert.ok(w.entities.has(crab.id));

  // Then the cells they stand on are the loose ends, and they move on to the island.
  while (w.tick < 12 * BRIDGE_SCAN) {
    w.step();
  }

  assert.deepEqual([priest.x, priest.y], [50, 34]);
  assert.deepEqual([crab.x, crab.y], [50, 38]);
});

test('a short stretch of bridge left hanging in the sky falls at the next look', () => {
  const w = mk();
  const p = w.players.get(1)!;
  const at = (x: number, y: number) => w.terrain[y * 256 + x];

  for (const x of [51, 53, 55]) {
    p.hand = [{ piece: 1, age: PIECE_HARD }];
    assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x, y: 40, rot: 1 }), null);
  }

  // Cut the first two cells out: four cells hang, joined to nothing. They are hard, which does
  // not save them.
  for (const x of [51, 52]) {
    w.terrain[40 * 256 + x] = 0;
    w.owner[40 * 256 + x] = 0;
    w.links[40 * 256 + x] = 0;
  }

  while (w.tick < BRIDGE_SCAN) {
    w.step();
  }

  assert.deepEqual([at(53, 40), at(54, 40), at(55, 40), at(56, 40)], [0, 0, 0, 0]);
});

test('transports walk across joins only: bridges lying side by side are not a way across', () => {
  const w = mk();
  const p = w.players.get(1)!;
  const flat = { t: 'dropPiece', player: 1, hand: 0, rot: 1 } as const;
  // Two dominoes off the east shore (x = 50), one right under the other. Each is joined to the
  // island by its west end; their long sides only touch.
  p.hand = [{ piece: 1, age: 0 }];
  assert.equal(w.apply({ ...flat, x: 51, y: 40 }), null);
  p.hand = [{ piece: 1, age: 0 }];
  assert.equal(w.apply({ ...flat, x: 51, y: 41 }), null);
  assert.equal(w.joined(51, 40, 3), true); // west, onto the island
  assert.equal(w.joined(51, 40, 1), true); // east, along the piece
  assert.equal(w.joined(52, 40, 2), false); // south, onto the other bridge
  // From the far cell of one to the far cell of the other is one step as the crow flies, and five
  // by the only way there is: back to the island and out again.
  const path = w.findPath(1, 52, 40, (cell) => cell[0] === 52 && cell[1] === 41);
  assert.deepEqual(path, [[51, 40], [50, 40], [50, 41], [51, 41], [52, 41]]);
});

test('a unit goes at an open end of a bridge, not beside it', () => {
  const w = mk();
  const p = w.players.get(1)!;
  // A domino lying east of the island (x = 50): cells 51 and 52 of row 40, open end to the east.
  p.hand = [{ piece: 1, age: 0 }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y: 40, rot: 1 }), null);
  const cannon = { t: 'build', player: 1, type: 'suncannon' } as const;
  // Under the bridge the cannon touches only its long side.
  assert.equal(w.canBuild({ ...cannon, x: 51, y: 41 }), 'not connected');
  assert.equal(w.canBuild({ ...cannon, x: 51, y: 37 }), 'not connected');
  // Past its east end it stands at the open end.
  assert.equal(w.apply({ ...cannon, x: 53, y: 39 }), null);
});

test('a piece hardens in the window; explosions and salvage crack solid bridge and collapse cracked', () => {
  const w = mk();
  const p = w.players.get(1)!;
  const at = (x: number, y: number) => w.terrain[y * 256 + x];

  for (let i = 0; i < PIECE_INTERVAL; i++) {
    w.step();
  }

  assert.equal(p.hand[0]!.age, 0);

  for (let i = 0; i < PIECE_HARDEN; i++) {
    w.step();
  }

  assert.equal(p.hand[0]!.age, PIECE_HARDEN);
  p.hand = [{ piece: 1, age: PIECE_HARDEN }, { piece: 1, age: 0 }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y: 40, rot: 1 }), null);
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 53, y: 40, rot: 1 }), null);
  assert.deepEqual([at(51, 40), at(52, 40), at(53, 40), at(54, 40)], [2, 2, 3, 3]);
  // A cannon off the bridge, touching one solid cell (52) and two cracked cells (53, 54).
  // Put there directly: beside a bridge is not a place a player could build on.
  const cannon = w.spawnBuilding('suncannon', 1, 52, 41);
  const rider = w.spawnTransport('sunwalker', 1, 53, 40);
  const stander = w.spawnTransport('sunwalker', 1, 52, 40);
  const revision = w.terrainRevision;
  assert.equal(w.apply({ t: 'salvage', player: 1, target: cannon.id }), null);
  // Solid cracks, the cell at the cannon's corner too; cracked falls, and so does whatever stood
  // on it.
  assert.deepEqual([at(51, 40), at(52, 40), at(53, 40), at(54, 40)], [3, 3, 0, 0]);
  assert.equal(w.owner[40 * 256 + 53], 0);
  assert.ok(w.terrainRevision > revision);
  w.step();
  assert.ok(!w.entities.has(rider.id));
  assert.ok(w.entities.has(stander.id));
  // Nothing can be laid beyond the gap: it would not be attached to the Temple.
  p.hand = [{ piece: 1, age: PIECE_HARDEN }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 55, y: 40, rot: 1 }),
    'not connected');
});

test('a piece turns hard in the window; hard bridge survives an explosion next to it', () => {
  const w = mk();
  const p = w.players.get(1)!;
  const at = (x: number, y: number) => w.terrain[y * 256 + x];

  for (let i = 0; i < PIECE_INTERVAL + PIECE_HARD + 1; i++) {
    w.step();
  }

  // Cracked, then normal after PIECE_HARDEN, then hard: the age stops there.
  assert.equal(p.hand[0]!.age, PIECE_HARD);
  p.hand = [{ piece: 1, age: PIECE_HARD }, { piece: 1, age: PIECE_HARDEN }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y: 40, rot: 1 }), null);
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 53, y: 40, rot: 1 }), null);
  assert.deepEqual([at(51, 40), at(52, 40), at(53, 40), at(54, 40)], [4, 4, 2, 2]);
  // A cannon touching one hard cell (52) and two normal cells (53, 54).
  // Put there directly: beside a bridge is not a place a player could build on.
  const cannon = w.spawnBuilding('suncannon', 1, 52, 41);
  assert.equal(w.apply({ t: 'salvage', player: 1, target: cannon.id }), null);
  assert.deepEqual([at(51, 40), at(52, 40), at(53, 40), at(54, 40)], [4, 4, 3, 3]);
  // Hard bridge is still bridge: it carries the connection to the Temple.
  p.hand = [{ piece: 1, age: 0 }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 55, y: 40, rot: 1 }), null);
});

test('a priest left without ground hangs in place until bridge is laid under him', () => {
  const w = mk();
  const p = w.players.get(1)!;
  const priest = w.priestOf(1)!;
  p.hand = [{ piece: 1, age: 0 }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y: 40, rot: 1 }), null);
  w.occupant[w.at(priest.x, priest.y)] = 0;
  priest.x = 51;
  priest.y = 40;
  w.occupant[w.at(51, 40)] = priest.id;
  // The islet of a destroyed unit next to the cracked bridge takes the bridge with it.
  const tower = w.spawnBuilding('sunblocker', 2, 51, 41);
  tower.hp = 0;
  w.step();
  assert.equal(w.terrain[40 * 256 + 51], 0);
  assert.equal(priest.hp, priest.hpMax);
  assert.equal(w.apply({ t: 'movePriest', player: 1, x: 45, y: 40 }), 'priest unavailable');
  w.step();
  assert.deepEqual([priest.x, priest.y], [51, 40]);
  p.hand = [{ piece: 1, age: PIECE_HARDEN }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y: 40, rot: 1 }), null);
  assert.equal(w.apply({ t: 'movePriest', player: 1, x: 45, y: 40 }), null);
});

test('the Priest heals a sixth of his hit points every eight seconds and needs a Temple to rise', () => {
  const w = mk();
  const priest = w.priestOf(1)!;
  const beat = 8 * TPS;
  const toBeat = () => {
    do {
      w.step();
    } while (w.tick % beat !== 0);
  };
  priest.hp = 20;
  w.step();
  assert.equal(priest.state, 'down');
  toBeat();
  assert.equal(priest.hp, 36);
  assert.equal(priest.state, 'down');
  // Half of his hit points is enough to stand up.
  toBeat();
  assert.equal(priest.hp, 52);
  assert.equal(priest.state, 'normal');
  // He heals on his feet too, up to the full hundred.
  priest.hp = 90;
  toBeat();
  assert.equal(priest.hp, 100);
  // Damage cannot take him below one hit point: a cannon blowing up beside him deals 301.
  const cannon = w.spawnBuilding('suncannon', 2, priest.x + 1, priest.y - 1);
  cannon.hp = 0;
  w.step();
  assert.equal(priest.hp, 1);
  // Without a Temple he still heals, but not back to half.
  w.entities.delete(w.templeOf(1)!.id);
  toBeat();
  toBeat();
  toBeat();
  assert.equal(priest.hp, 49);
  toBeat();
  assert.equal(priest.hp, 49);
  assert.equal(priest.state, 'down');
});

test('Temple makes Golems and a Workshop of their Fury makes other transports', () => {
  const w = mk();
  const p = w.players.get(1)!;
  const golem = { t: 'build', player: 1, type: 'sunwalker' } as const;
  const transports = () =>
    [...w.entities.values()].filter((e): e is Transport => e.kind === 'transport' && e.owner === 1);
  const before = transports().length;
  // A transport stands on a free cell of the player's own island, never on a bridge or in the sky.
  bridge(w, 51, 60);
  assert.equal(w.apply({ ...golem, x: 52, y: 40 }), 'blocked');
  assert.equal(w.apply({ ...golem, x: 52, y: 44 }), 'blocked');
  assert.equal(w.apply({ ...golem, x: 38, y: 38 }), 'blocked'); // under the Temple
  assert.equal(w.apply({ ...golem, x: 46, y: 46 }), null);
  const made = transports().at(-1)!;
  assert.equal(transports().length, before + 1);
  assert.deepEqual([made.kind, made.type, made.x, made.y], ['transport', 'sunwalker', 46, 46]);
  assert.equal(p.storm, 2000 - 400);
  assert.equal(w.occupant[46 * 256 + 46], 0); // transports do not block cells
  // The Sail Skater (level 2) comes from the Wind Workshop and needs a second energy source.
  w.spawnBuilding('windbattery', 1, 44, 43);
  assert.equal(w.apply({ t: 'build', player: 1, type: 'windwalker', x: 47, y: 46 }), null);
  const workshop = w.buildingsOf(1).find((b) => b.type === 'windfactory')!;
  w.entities.delete(workshop.id);
  assert.equal(w.apply({ t: 'build', player: 1, type: 'windwalker', x: 48, y: 46 }), 'no workshop');
  const temple = w.buildingsOf(1).find((b) => b.type === 'windvortex')!;
  w.entities.delete(temple.id);
  assert.equal(w.apply({ ...golem, x: 48, y: 46 }), 'no temple');
});

test('units without rules yet cannot be built', () => {
  const w = mk();
  w.players.get(1)!.storm = 100_000;
  // A flyer comes from its base, not from the Production Window.
  assert.equal(w.apply({ t: 'build', player: 1, type: 'sunflyer', x: 46, y: 46 }), 'cannot build');
  assert.equal(w.apply({ t: 'build', player: 1, type: 'geyser', x: 46, y: 44 }), 'cannot build');
});

test('the island builder grows the same islands from the same descriptions', () => {
  // The two islands of the Raw Power map: a Z of four chunks and a shape of six.
  const specs = [{ shape: 7, cx: 6, cy: 3, seed: 17 }, { shape: 20, cx: 8, cy: 5, seed: 68 }];
  const ground = growIslands(specs);
  const size = (island: number) => ground.reduce((n, of) => n + (of === island ? 1 : 0), 0);
  assert.deepEqual([size(0), size(1)], [732, 1114]);
  assert.deepEqual([...growIslands(specs)], [...ground]);
  // Ground stays inside the chunks of its island.
  const chunks = specs.map((spec) => new Set(islandChunks(spec).map(([cx, cy]) => cx * 16 + cy)));

  for (const [i, island] of ground.entries()) {
    if (island >= 0) {
      assert.ok(chunks[island]!.has(((i % 256) >> 4) * 16 + (i >> 12)));
    }
  }

  // The second chunk of an island holds a square of ten cells for the Temple.
  const [cx, cy] = islandChunks(specs[0]!)[1]!;

  for (let y = cy * 16 + 3; y < cy * 16 + 13; y++) {
    for (let x = cx * 16 + 3; x < cx * 16 + 13; x++) {
      assert.equal(ground[y * 256 + x], 0);
    }
  }
});

test('a skirmish on grown islands settles each player on ground of his own', () => {
  const geysers: [number, number][] = [[128, 53], [144, 65]];
  const w = createSkirmish(defs, 1, [
    {
      id: 1,
      name: 'Blue',
      theme: 'wind',
      x: 0,
      y: 0,
      islands: [{ shape: 7, cx: 6, cy: 3, seed: 17 }],
    },
    {
      id: 2,
      name: 'Red',
      theme: 'rain',
      x: 0,
      y: 0,
      islands: [{ shape: 20, cx: 8, cy: 8, seed: 68 }],
    },
  ], geysers);

  for (const player of [1, 2]) {
    const buildings = w.buildingsOf(player);
    assert.equal(buildings.length, 3);

    for (const b of buildings) {
      for (let y = b.y; y < b.y + b.fy; y++) {
        for (let x = b.x; x < b.x + b.fx; x++) {
          assert.ok(w.isOwnGround(player, x, y), `${b.type} at ${x},${y}`);
        }
      }
    }

    const priest = w.priestOf(player)!;
    assert.ok(w.isOwnGround(player, priest.x, priest.y));
  }

  // The game runs on from there.
  for (let i = 0; i < 5 * TPS; i++) {
    w.step();
  }
});
