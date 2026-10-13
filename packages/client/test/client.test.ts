import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadDefs } from '@netstorm/sim';
import { mapsOf, outcome, reflow, slimMaps, slimMissions } from '../src/game-data.js';
import { createMatchWorld, ENEMY, ME } from '../src/setup.js';
import { DEFAULT_OPTIONS } from '../src/menu.js';
import { FACING_FRAMES, SKY, TEXTURES, shoreFrame } from '../src/texture-selection.js';
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
