import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadDefs } from '@netstorm/sim';
import { happened, mapsOf, outcome, reflow, slimMaps, slimMissions } from '../src/game-data.js';
import { createMatchWorld, ENEMY, ME } from '../src/setup.js';
import { DEFAULT_OPTIONS } from '../src/menu.js';
import {
  FACING_FRAMES,
  SKY,
  TEXTURES,
  fringeSlot,
  parsePath,
  shoreFrame,
} from '../src/texture-selection.js';
import { SLOT_COUNTS, heading, overlayOf, shadowOf, slotOf } from '../src/animations.js';
import { MISSILES, SPELL_BURSTS, explosionFor, missileSlot } from '../src/effects.js';
import { anchorFor, entityAt, placeable } from '../src/ui-state.js';
import { describeEvent } from '../src/messages.js';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../data/${name}.json`, import.meta.url), 'utf8'));
const defs = loadDefs(read('units'));
const maps = slimMaps(read('maps'));
// A place with no map: the rectangular skirmish.
const bare = {
  geysers: [[70, 150], [110, 120]] as [number, number][],
  islands: [],
  bridges: [],
  units: [],
};
const skirmish = () =>
  createMatchWorld(defs, { test: bare }, [], { ...DEFAULT_OPTIONS, mission: 'test' });
const missions = slimMissions(read('missions'), maps);

test('shipped data keeps the maps of the missions and the campaign briefings only', () => {
  assert.deepEqual(Object.keys(maps.thewarbegins!), ['islands', 'geysers', 'bridges', 'units']);
  assert.deepEqual(Object.keys(mapsOf(missions, maps)).length, missions.length);
  assert.deepEqual(maps.thewarbegins!.islands, [[17, 5, 6, 240], [3, 8, 7, 146]]);
  assert.ok(maps.thewarbegins!.geysers.length > 0);
  const mission = missions.find((m) => m.id === 'thewarbegins')!;
  assert.equal(mission.title, 'The War Begins!');
  assert.equal(mission.enemy, 'The Jailer');
  assert.equal(mission.storm, 3000);
  assert.equal(mission.aiDelay, 6);
  // The title line is dropped and the original's hard line breaks are reflowed.
  assert.match(mission.briefing, /^"Darkness and tyranny/);
  assert.match(mission.briefing, /Lords of Darkness are now/);
  assert.match(mission.briefing, /\n--Lament of Light\n/);
  assert.match(mission.succeeded, /Success/);
  // Easy and hard variants and non-mission files are left out.
  assert.ok(missions.every((m) => !/easy$|hard$/.test(m.id) && maps[m.id]));
});

test('verse keeps its lines, prose is joined, attributions stay apart', () => {
  const rescue = missions.find((m) => m.id === 'totherescue')!;
  assert.match(rescue.briefing,
    /^"For your friend and for devotion,\nCome up from the dusty ocean,\nand into the bleeding fray\."/);
  assert.ok(!rescue.briefing.startsWith('To The Rescue')); // title differs in case only
  assert.equal(reflow('A wrapped \nline.  Two spaces.\n  --Captain X\n\nTheir souls\n--and yours'),
    'A wrapped line.  Two spaces.\n--Captain X\n\nTheir souls --and yours');
});

test('reflow handles CRLF, blank lines with spaces and trailing spaces', () => {
  assert.equal(reflow('para one  \r\n \t\r\npara\r\ntwo \r\n'), 'para one\n\npara two');
  assert.equal(reflow('heir.  \n\nHis people'), 'heir.\n\nHis people');
  assert.equal(reflow(''), '');
});

test('the default match is the first mission on its own map', () => {
  const world = createMatchWorld(defs, maps, missions, DEFAULT_OPTIONS);
  // Each side follows the Fury of the Temple the map gives it, whatever the menu says.
  assert.equal(world.templeOf(ME)!.type, 'rainvortex');
  assert.equal(world.players.get(ME)!.theme, 'rain');
  assert.equal(world.players.get(ENEMY)!.name, 'The Jailer');
  assert.equal(world.templeOf(ENEMY)!.type, 'windvortex');
  assert.ok(world.buildingsOf(ENEMY).some((b) => b.type === 'sunarcher'));
  assert.ok([...world.entities.values()].some((e) => e.kind === 'geyser'));

  // Everything the map lays stands on ground of its owner.
  for (const b of [...world.buildingsOf(ME), ...world.buildingsOf(ENEMY)]) {
    assert.ok(world.isOwnGround(b.owner, b.x, b.y), `${b.type} at ${b.x},${b.y}`);
  }
});

test('without a map, geysers that would cut into a home island are dropped', () => {
  const world = skirmish();
  assert.equal(world.players.get(ME)!.theme, 'wind');
  const geysers = [...world.entities.values()].filter((e) => e.kind === 'geyser');
  assert.deepEqual(geysers.map((g) => [g.x, g.y]), [[110, 120]]);
});

test('the Production Window offers buildings and transports, not flyers', () => {
  assert.ok(placeable(defs.get('suncannon')!));
  assert.ok(placeable(defs.get('windbattery')!));
  assert.ok(placeable(defs.get('windwalker')!));
  assert.ok(placeable(defs.get('sunwalker')!));
  assert.ok(placeable(defs.get('sunballoon')!));
  assert.ok(!placeable(defs.get('sunflyer')!));
  assert.ok(!placeable(defs.get('geyser')!));
});

test('a footprint is centred on the cursor', () => {
  assert.deepEqual(anchorFor(defs.get('suncannon')!, 10, 10), { x: 9, y: 9 });
  assert.deepEqual(anchorFor(defs.get('windwalker')!, 10, 10), { x: 10, y: 10 });
});

test('a click picks the unit on the cell, then the building, then a unit next to it', () => {
  const world = skirmish();
  const view = world.view();
  const priest = world.priestOf(ME)!;
  const transport = [...world.entities.values()].find((e) => e.kind === 'transport')!;
  assert.equal(entityAt(view, priest.x, priest.y)?.id, priest.id);
  assert.equal(entityAt(view, transport.x, transport.y)?.id, transport.id);
  const temple = world.buildingsOf(ME).find((b) => b.type === 'windvortex')!;
  assert.equal(entityAt(view, temple.x + 1, temple.y + 1)?.id, temple.id);
  assert.equal(entityAt(view, -1, -1), undefined);
});

test('the log speaks of the local player and hides the enemy routine', () => {
  const world = createMatchWorld(defs, maps, missions, DEFAULT_OPTIONS);
  const view = world.view();
  const refused = describeEvent(view, ME, {
    tick: 1,
    what: 'rejected',
    who: ME,
    data: { cmd: 'build', err: 'no energy' },
  });
  assert.deepEqual(refused, { text: 'Будівництво: бракує енергії поруч', tone: 'bad' });
  assert.equal(
    describeEvent(view, ME, { tick: 1, what: 'build', who: ENEMY, data: { id: 9, type: 'x' } }),
    null,
  );
  assert.equal(describeEvent(view, ME, {
    tick: 1,
    what: 'destroyed',
    who: ENEMY,
    data: { id: 9, type: 'suncannon' },
  })?.text, 'Знищено ворожий Sun Cannon');
});

test('a mission sets up its sides: names, knowledge, Storm Power and alliances', () => {
  const rescue = missions.find((m) => m.id === 'totherescue')!;
  // The governor fights beside the player; the two princes beside each other.
  assert.deepEqual([2, 3, 4].map((id) => rescue.sides[id]!.allies), [[1], [4], [3]]);
  assert.equal(rescue.sides[2]!.name, 'Governor Cherok');
  const world = createMatchWorld(defs, maps, missions, {
    ...DEFAULT_OPTIONS,
    mission: 'totherescue',
  });
  assert.ok(!world.hostile(1, 2) && world.hostile(1, 3) && !world.hostile(3, 4));
  assert.equal(world.players.get(3)!.name, 'Prince of Thunder');
  // The first mission teaches four units and gives its jailer nothing to spend.
  const first = createMatchWorld(defs, maps, missions, DEFAULT_OPTIONS);
  assert.deepEqual([...first.players.get(ME)!.tech].sort(), [
    'rainbattery',
    'sunaviary',
    'suncannon',
    'sunwalker',
  ]);
  assert.equal(first.players.get(ENEMY)!.storm, 0);
});

test('a mission is won and lost as its file says', () => {
  const goals = (id: string) => {
    const m = missions.find((mission) => mission.id === id)!;
    return [m.rescue, m.wards, m.anyCapture];
  };
  assert.deepEqual(goals('thewarbegins'), [[], [], false]);
  assert.deepEqual(goals('totherescue'), [[], [2], false]);
  assert.deepEqual(goals('enemyterritory'), [[2], [2], true]);

  const world = createMatchWorld(defs, maps, missions, {
    ...DEFAULT_OPTIONS,
    mission: 'enemyterritory',
  });
  const territory = missions.find((m) => m.id === 'enemyterritory')!;
  assert.equal(world.anyCapture, true);
  assert.equal(outcome(territory, world, ME, new Set()), null);
  assert.equal(outcome(territory, world, ME, new Set([2])), 'won');
  // The traitor is sacrificed: the mission is lost though the player still stands.
  world.players.get(2)!.alive = false;
  assert.equal(outcome(territory, world, ME, new Set([2])), 'lost');

  // Without goals of its own a battle ends with its winner; allies win together.
  const plain = {
    winner: 2 as number | null,
    players: world.players,
    hostile: world.hostile.bind(world),
  };
  world.players.get(2)!.alive = true;
  assert.equal(outcome(undefined, plain, ME, new Set()), 'won');
  assert.equal(outcome(undefined, { ...plain, winner: 3 }, ME, new Set()), 'lost');
  assert.equal(outcome(undefined, { ...plain, winner: null }, ME, new Set()), null);
});

test('an island cell gets the rim frame of the sides the sky is on', () => {
  assert.equal(shoreFrame(0, 0, 3), undefined); // inland: grass
  assert.deepEqual([0, 1, 5].map((pick) => shoreFrame(SKY.west, 0, pick)), [0, 1, 0]);
  assert.equal(shoreFrame(SKY.south, 0, 0), 21);
  assert.equal(shoreFrame(SKY.north | SKY.west, 0, 1), 31);
  // Ground all round and sky across the south-west corner: an inside corner.
  assert.equal(shoreFrame(0, SKY.south, 0), 17);
  // Rock hangs under the southern rim only: an edge, or one of the two southern corners.
  assert.deepEqual(
    [SKY.north, SKY.south, SKY.south | SKY.west, SKY.south | SKY.east].map((sides) =>
      fringeSlot(sides, 0)
    ),
    [undefined, 0, 39, 63],
  );
  // A spit one cell wide has no frame of its own: the nearest corner, with its rock face.
  assert.equal(shoreFrame(SKY.north | SKY.south | SKY.west, 0, 0), 16);
  assert.equal(shoreFrame(SKY.north | SKY.south | SKY.east | SKY.west, 0, 0), 16);
});

test('every unit that faces a way has a frame for each of the four, in the shipped sprites', () => {
  const manifest = read('../packages/client/public/data/sprites') as Record<
    string,
    Record<string, Record<string, string>>
  >;

  for (const [type, frames] of Object.entries(FACING_FRAMES)) {
    assert.equal(frames.length, 4, type);

    for (const [facing, [gif, frame]] of frames.entries()) {
      assert.ok(manifest[type]?.[gif]?.[frame], `${type} facing ${facing}`);
      assert.ok(TEXTURES.some(([key]) => key === `${type}:${facing}`));
    }
  }

  // A map's Ice Cannon looks the way its saved frame says: three frames to a facing.
  const world = createMatchWorld(defs, {
    test: { ...bare, islands: [[0, 5, 5, 1]], units: [['raincannon', 1, 100, 100, 7]] },
  }, [], { ...DEFAULT_OPTIONS, mission: 'test' });
  const cannon = world.buildingsOf(ME).find((b) => b.type === 'raincannon');
  assert.equal(cannon?.facing, 2);
});

test('animated entities show a slot of their type for the tick', () => {
  const manifest = read('../packages/client/public/data/sprites') as Record<
    string,
    Record<string, Record<string, string>>
  >;

  // Every slot the animations may ask for is shipped, with the offset of its picture.
  for (const [type, count] of Object.entries(SLOT_COUNTS)) {
    for (let slot = 0; slot < count; slot++) {
      // Two lines are blank frames, which have no picture: the Priest's 65th and the Altar's 15th.
      const blank = (type === 'priest' && slot === 64) || (type === 'altar' && slot === 14);
      assert.ok(blank || parsePath(manifest[type]!['@']![slot]!).offset, `${type} ${slot}`);
    }
  }

  assert.deepEqual(parsePath('sprites/a/b.png#-5,-24'), {
    file: 'sprites/a/b.png',
    offset: [-5, -24],
  });
  assert.deepEqual(parsePath('sprites/a/b.png'), { file: 'sprites/a/b.png' });
  assert.deepEqual([heading(0, -1), heading(1, 1), heading(-1, 0), heading(0, 0)], [
    0,
    3,
    6,
    undefined,
  ]);

  const world = skirmish();
  const headings = {
    world: world.view(),
    headings: new Map<number, number>(),
    aims: new Map<number, number>(),
  };
  const golem = world.spawnTransport('sunwalker', ME, 40, 40);
  // Standing, the Golem shows the default frame of its file; walking east, the frames of group C.
  assert.deepEqual(slotOf(golem, 3, headings), ['sunwalker', 5]);

  golem.path = [[golem.x + 1, golem.y]];

  assert.deepEqual(slotOf(golem, 3, headings), ['sunwalker', 2 * 8 + 3]);

  golem.path = [];

  assert.deepEqual(slotOf(golem, 4, headings), ['sunwalker', 2 * 8]); // stands as it stopped
  // A full geyser is whole pictures; a spent one is its rock with a lower plume laid over it.
  const geyser = [...world.entities.values()].find((e) => e.kind === 'geyser')!;
  const view = world.view();
  assert.deepEqual([slotOf(geyser, 18, headings), overlayOf(geyser, 18, view)], [
    ['geyser', 1],
    null,
  ]);

  if (geyser.kind === 'geyser') {
    geyser.stock = world.geyserStock / 2;
    assert.deepEqual([slotOf(geyser, 18, headings), overlayOf(geyser, 18, view)], [
      ['geyser', 49],
      ['geyser', 17 + 2],
    ]);
    geyser.stock = 200;
    assert.deepEqual(overlayOf(geyser, 18, view), ['geyser', 33 + 2]);
    geyser.stock = 0;
    assert.deepEqual([slotOf(geyser, 18, headings), overlayOf(geyser, 18, view)], [
      ['geyser', 49],
      null,
    ]);
  }

  // A Wind Temple is a still picture with its whirl laid over it.
  const temple = world.templeOf(ME)!;
  assert.deepEqual(slotOf(temple, 14, headings), ['windvortex', 13]);
  assert.deepEqual(overlayOf(temple, 14, world.view()), ['windvortex', 1]);
  assert.equal(overlayOf(golem, 14, world.view()), null);
  // A Bulf has four headings: a step to the north-east shows the frames of east.
  const bulf = world.spawnTransport('bulf', ME, 41, 41);
  bulf.path = [[42, 40]];
  assert.deepEqual(slotOf(bulf, 2, headings), ['bulf', 8 + 2]);
  // A Thunder Cannon fires, rests on its gun and charges up to the next shot, 4 s later.
  const cannon = world.spawnBuilding('thundercannon', ME, 60, 60, 1);
  assert.deepEqual([slotOf(cannon, 0, headings), overlayOf(cannon, 0, world.view())], [
    ['thundercannon', 9],
    null,
  ]);
  cannon.target = golem.id;
  cannon.cooldown = 39;
  assert.deepEqual([slotOf(cannon, 0, headings), overlayOf(cannon, 0, world.view())], [
    ['thundercannon', 16],
    null,
  ]);
  cannon.cooldown = 1;
  assert.deepEqual([slotOf(cannon, 0, headings), overlayOf(cannon, 0, world.view())], [
    ['thundercannon', 9],
    ['thundercannon', 15],
  ]);
  assert.equal(slotOf(world.spawnBuilding('sunblocker', ME, 70, 60), 1, headings), null);
  // A Sun Cannon swings through the frames between two facings, a step a tick, then rests.
  const gun = world.spawnBuilding('suncannon', ME, 80, 80, 0);
  assert.deepEqual(slotOf(gun, 0, headings), ['suncannon', 1]);
  gun.facing = 1;
  assert.deepEqual([1, 2, 3, 4].map((tick) => slotOf(gun, tick, headings)![1]), [22, 23, 3, 3]);
  // A Bulf turns the shorter way round its 24 frames: from east to north, anticlockwise.
  bulf.path = [[bulf.x, bulf.y - 1]];
  assert.deepEqual([1, 2].map((tick) => slotOf(bulf, tick, headings)), [['bulf', 32 + 5], [
    'bulf',
    32 + 4,
  ]]);
  // Struck down, a Priest floats: the twelve frames after his walking ones.
  const fallen = world.priestOf(ENEMY)!;
  fallen.state = 'down';
  assert.deepEqual(slotOf(fallen, 14, headings), ['priest', 65 + 2]);
  fallen.state = 'normal';
  // A shadow is the slot of the same frame past the frame lines of the file.
  assert.deepEqual(shadowOf(['sunwalker', 5]), ['sunwalker', 66 + 5]);
  assert.equal(shadowOf(['thundercannon', 0]), null);
  // A Disc Thrower lays its arm over its base, turned to its target; flung out just after a shot.
  const thrower = world.spawnBuilding('sunarcher', ME, 50, 70);
  assert.deepEqual([slotOf(thrower, 0, headings), overlayOf(thrower, 0, world.view())], [
    ['sunarcher', 32],
    ['sunarcher', 0],
  ]);
  thrower.target = world.spawnBuilding('sunblocker', ENEMY, 60, 70).id; // due east
  thrower.cooldown = 69;
  assert.deepEqual(overlayOf(thrower, 0, world.view()), ['sunarcher', 16 + 4]);
  thrower.cooldown = 10;
  assert.deepEqual(overlayOf(thrower, 0, world.view()), ['sunarcher', 4]);
  // An Altar shows the runes warded on its ring and the captive between its horns.
  const altar = world.buildingsOf(ME).find((b) => b.type === 'altar')!;
  assert.deepEqual([slotOf(altar, 0, headings), overlayOf(altar, 0, world.view())], [
    ['dais', 3],
    ['altar', 0],
  ]);
  const captive = world.priestOf(ENEMY)!;
  captive.state = 'chained';
  captive.chainedAt = altar.id;
  captive.runes = 2;
  assert.deepEqual([slotOf(altar, 5, headings), overlayOf(altar, 5, world.view())], [
    ['dais', 25],
    ['altar', 6],
  ]);
  captive.runeTimer = 75; // half way through the third rune
  assert.deepEqual(slotOf(altar, 5, headings), ['dais', 2 * 11 + 4 + 5]);
  assert.deepEqual(slotOf(world.priestOf(ME)!, 5, headings), ['priest', 77 + 2 * 18 + 5]);
});

test('a mission gives its computer sides their orders, income and pace, and its script messages', () => {
  const side = (id: string, n: number) => missions.find((m) => m.id === id)!.sides[n]!;
  // "aiMoneyRechargeRate = 8" is shared by the computer sides, not the player.
  assert.equal(side('enemyterritory', 3).income, 8);
  assert.equal(side('enemyterritory', 1).income, undefined);
  assert.deepEqual(side('enemyterritory', 2).ai, { collect: false, attack: false });
  assert.equal(side('enemyterritory', 3).delay, 4);
  assert.equal(side('guardmyback', 3).ai?.enemy, 2);
  // The first mission: one collector, one geyser, and the keys this AI has no use for dropped.
  assert.deepEqual(side('thewarbegins', 2).ai, { transports: 1, geysers: 1 });

  const rescue = missions.find((m) => m.id === 'totherescue')!;
  assert.deepEqual(rescue.messages.map((m) => m.on), [['@120']]);
  assert.match(rescue.messages[0]!.text, /^A message arrives from the governor/);
  assert.match(rescue.briefing, /Avert this crisis of confidence/); // the second page, "A1."
  const guard = missions.find((m) => m.id === 'guardmyback')!;
  assert.deepEqual(guard.messages[0]!.on, ['ai2priestcaptured', 'ai2templehalf']);

  const temple = { hp: 100, hpMax: 400 };
  const world = { tick: 1199, templeOf: (id: number) => (id === 2 ? temple : undefined) };
  const none = new Set<number>();
  assert.equal(happened('@120', world, none, none), false);
  assert.equal(happened('@120', { ...world, tick: 1200 }, none, none), true);
  assert.equal(happened('ai2templehalf', world, none, new Set([2])), true);
  assert.equal(happened('ai2templedead', world, none, new Set([2])), false);
  // A side that never had a Temple has not lost one.
  assert.equal(happened('ai3templedead', world, none, new Set([2])), false);
  assert.equal(happened('ai3templedead', world, none, new Set([2, 3])), true);
  assert.equal(happened('ai2priestcaptured', world, new Set([2]), none), true);
});

test('missiles point the way they fly, and effects are runs of shipped slots', () => {
  // The Crossbow's bolt has twenty bearings from north: east is the fifth, south the tenth.
  assert.deepEqual(
    [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => missileSlot('windarcher', dx!, dy!, 0)),
    [0, 5, 10, 15],
  );
  // The Thunder Cannon's has four, with three frames to each.
  assert.deepEqual([0, 1, 2, 3].map((tick) => missileSlot('thundercannon', 1, 0, tick)), [
    3,
    4,
    5,
    3,
  ]);
  assert.equal(missileSlot('sunarcher', -3, 2, 7), 0);
  // A Whirligig's bomb has one bearing and tumbles through six frames, then blasts.
  assert.deepEqual([4, 5, 6].map((tick) => missileSlot('sunflyer', 0, 1, tick)), [4, 5, 0]);
  assert.deepEqual(MISSILES.sunflyer!.blast, { type: 'sunflyerbomb', first: 6, frames: 17 });
  assert.deepEqual([1, 2, 3, 7].map((width) => explosionFor(width).first), [66, 58, 0, 0]);

  const runs = [
    ...Object.values(MISSILES).flatMap((m) => (m.blast ? [m.blast] : [])),
    ...Object.values(MISSILES).map((m) => ({
      type: m.type,
      first: 0,
      frames: m.bearings * m.frames,
    })),
    ...[1, 2, 3].map(explosionFor),
    ...Object.values(SPELL_BURSTS).flatMap((b) =>
      [b.each, b.here].filter((run) => run !== undefined)
    ),
  ];

  for (const run of runs) {
    assert.ok(run.first + run.frames <= SLOT_COUNTS[run.type]!, run.type);
  }
});
