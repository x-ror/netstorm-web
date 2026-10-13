import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadDefs } from '@netstorm/sim';
import { reflow, slimMaps, slimMissions } from '../src/game-data.js';
import { createMatchWorld, ENEMY, ME } from '../src/setup.js';
import { DEFAULT_OPTIONS } from '../src/menu.js';
import { anchorFor, entityAt, placeable } from '../src/ui-state.js';
import { describeEvent } from '../src/messages.js';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../data/${name}.json`, import.meta.url), 'utf8'));
const defs = loadDefs(read('units'));
const maps = slimMaps(read('forts'));
const missions = slimMissions(read('missions'), maps);

test('shipped data keeps geysers and the campaign briefings only', () => {
  assert.deepEqual(Object.keys(maps.thewarbegins!), ['geysers']);
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

test('the default match is the old demo skirmish', () => {
  const world = createMatchWorld(defs, maps, missions, DEFAULT_OPTIONS);
  assert.equal(world.players.get(ME)!.theme, 'wind');
  assert.equal(world.players.get(ENEMY)!.name, 'The Jailer');
  assert.equal(world.players.get(ENEMY)!.theme, 'rain');
  assert.ok([...world.entities.values()].some((e) => e.kind === 'geyser'));
});

test('geysers that would cut into a home island are dropped', () => {
  const world = createMatchWorld(defs, { test: { geysers: [[70, 150], [110, 120]] } }, [], {
    ...DEFAULT_OPTIONS,
    mission: 'test',
  });
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
  const world = createMatchWorld(defs, maps, missions, DEFAULT_OPTIONS);
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
