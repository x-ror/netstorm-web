import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  loadDefs,
  createSkirmish,
  TPS,
  PIECE_INTERVAL,
  GEYSER_STOCK,
  PIECE_HARDEN,
  CRYSTAL_VALUE,
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
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 60, y: 60, rot: 0 }),
    'not connected');
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y: 40, rot: 0 }), null); // right edge of island is x=50
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

  for (let i = 0; i < 100 * TPS && w.winner === null; i++) {
    w.step();
  }

  assert.equal(w.winner, 1);
  assert.equal(w.drainEvents().filter((e) => e.what === 'rune').length, 5);
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
  w.players.get(1)!.hand.push({ piece: 7, age: PIECE_HARDEN });
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 52, y: 44, rot: 0 }), null);
});

test("energy must come from a nearby source of the unit's own alignment", () => {
  const w = mk();
  const p = w.players.get(1)!;
  p.tech.add('thundercannon');
  bridge(w, 51, 90);
  const far = { player: 1, x: 70, y: 41 } as const;
  // More than 30 cells from the centre of the Wind Temple: too far for anything.
  assert.equal(w.apply({ t: 'build', type: 'suncannon', ...far }), 'no energy');
  // A Sun Generator feeds only Sun units.
  w.spawnBuilding('sunbattery', 1, 64, 41);
  assert.equal(w.apply({ t: 'build', type: 'windarcher', ...far }), 'no energy');
  assert.equal(w.canBuild({ type: 'suncannon', ...far }), null);
  // A Wind Generator feeds Wind and Sun units, not Thunder ones.
  w.spawnBuilding('windbattery', 1, 64, 36);
  assert.equal(w.apply({ t: 'build', type: 'thundercannon', ...far }), 'no energy');
  assert.equal(w.apply({ t: 'build', type: 'windarcher', ...far }), null);
});

test('bridge needs an unbroken attachment to the Temple; attaching to a geyser claims its island', () => {
  const w = mk();
  const p = w.players.get(1)!;
  bridge(w, 51, 76);
  p.hand.push({ piece: 7, age: PIECE_HARDEN }, { piece: 7, age: PIECE_HARDEN }); // dominoes
  w.terrain[40 * 256 + 55] = 0; // cut the bridge
  w.owner[40 * 256 + 55] = 0;
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 77, y: 40, rot: 0 }),
    'not connected');
  bridge(w, 55, 55);
  assert.equal(w.owner[39 * 256 + 80], 0);
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 77, y: 40, rot: 0 }), null);
  // The geyser islet (79..81 × 39..41) now belongs to the player and carries the connection on.
  assert.equal(w.owner[39 * 256 + 80], 1);
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 82, y: 40, rot: 0 }), null);
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
  p.hand = [{ piece: 7, age: PIECE_HARDEN }, { piece: 7, age: 0 }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y: 40, rot: 0 }), null);
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 53, y: 40, rot: 0 }), null);
  assert.deepEqual([at(51, 40), at(52, 40), at(53, 40), at(54, 40)], [2, 2, 3, 3]);
  // A cannon off the bridge, touching one solid cell (52) and two cracked cells (53, 54).
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 52, y: 41 }), null);
  const cannon = w.buildingsOf(1).find((b) => b.type === 'suncannon')!;
  const rider = w.spawnTransport('sunwalker', 1, 53, 40);
  const stander = w.spawnTransport('sunwalker', 1, 52, 40);
  const revision = w.terrainRevision;
  assert.equal(w.apply({ t: 'salvage', player: 1, target: cannon.id }), null);
  // Solid cracks; cracked falls, and so does whatever stood on it.
  assert.deepEqual([at(51, 40), at(52, 40), at(53, 40), at(54, 40)], [2, 3, 0, 0]);
  assert.equal(w.owner[40 * 256 + 53], 0);
  assert.ok(w.terrainRevision > revision);
  w.step();
  assert.ok(!w.entities.has(rider.id));
  assert.ok(w.entities.has(stander.id));
  // Nothing can be laid beyond the gap: it would not be attached to the Temple.
  p.hand = [{ piece: 7, age: PIECE_HARDEN }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 55, y: 40, rot: 0 }),
    'not connected');
});

test('a priest left without ground hangs in place until bridge is laid under him', () => {
  const w = mk();
  const p = w.players.get(1)!;
  const priest = w.priestOf(1)!;
  p.hand = [{ piece: 7, age: 0 }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y: 40, rot: 0 }), null);
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
  p.hand = [{ piece: 7, age: PIECE_HARDEN }];
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 51, y: 40, rot: 0 }), null);
  assert.equal(w.apply({ t: 'movePriest', player: 1, x: 45, y: 40 }), null);
});
