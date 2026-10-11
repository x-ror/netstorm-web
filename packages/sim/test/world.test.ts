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
  PIECE_HARD,
  PIECES,
  PIECE_WEIGHTS,
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
  assert.equal(w.canDropPiece({ player: 1, hand: 0, x: 51, y: 40, rot: 0 }), null);
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
  assert.equal(w.apply({ t: 'dropPiece', player: 1, hand: 0, x: 52, y: 44, rot: 1 }), null);
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
  assert.equal(w.apply({ t: 'build', player: 1, type: 'suncannon', x: 52, y: 41 }), null);
  const cannon = w.buildingsOf(1).find((b) => b.type === 'suncannon')!;
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
  assert.equal(w.apply({ t: 'build', player: 1, type: 'sunballoon', x: 46, y: 46 }),
    'cannot build');
  assert.equal(w.apply({ t: 'build', player: 1, type: 'geyser', x: 46, y: 44 }), 'cannot build');
});
