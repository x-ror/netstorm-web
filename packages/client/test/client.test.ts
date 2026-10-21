import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { AI_ALIGNMENTS, ARM_BUILT, discSpin, homeIsland, loadDefs } from '@netstorm/sim';
import {
  happened,
  hotFeet,
  mapsOf,
  outcome,
  reflow,
  slimMaps,
  slimMissions,
  slimUnits,
  inOrderOf,
  translateMissions,
} from '../src/game-data.js';
import { knowledgeOf } from '../src/knowledge.js';
import { burn, burners, rise, streaksOf, type Spark } from '../src/burning.js';
import { scatter, type Piece } from '../src/shrapnel.js';
import { createAlarm } from '../src/alarm.js';
import { MUZZLES } from '../src/muzzles.js';
import { paint, paintOf } from '../src/owner-colours.js';
import { createMatchWorld, ENEMY, ME } from '../src/setup.js';
import { DEFAULT_OPTIONS, MAX_STORM, normalizeOptions } from '../src/options.js';
import { contract } from '../src/ui/contracts.js';
import {
  FACING_FRAMES,
  SKY,
  TEXTURES,
  bridgeSlot,
  fringeSlot,
  parsePath,
  shoreFrame,
} from '../src/texture-selection.js';
import {
  SLOT_COUNTS,
  flyerSlot,
  heading,
  overlayOf,
  shadowOf,
  shotFrame,
  slotOf,
} from '../src/animations.js';
import { Growth } from '../src/growth.js';
import { boltLines, makeBolt } from '../src/lightning.js';
import { blow, makeSmoke, puffColour } from '../src/smoke.js';
import { VisualStates } from '../src/presentation.js';
import {
  alongBarrel,
  nearSide,
  MISSILES,
  SPELL_BURSTS,
  explosionFor,
  impactOf,
  missileSlot,
  missileSpeed,
} from '../src/effects.js';
import { loudness, sideOf, unitSound, type SoundIndex } from '../src/sound.js';
import { anchorFor, createUiState, entityAt, placeable } from '../src/ui-state.js';
import { describeEvent } from '../src/messages.js';
import { setLocale } from '../src/paraglide/runtime.js';
import { hudModel, iconOf } from '../src/hud-model.js';

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

/** A skirmish from the menu: Thunder against Wind, six islands, no geysers at the start. */
const make = (seed: number, more = {}) =>
  createMatchWorld(defs, maps, missions, {
    ...DEFAULT_OPTIONS,
    mode: 'skirmish',
    theme: 'thunder',
    enemyTheme: 'wind',
    islands: 6,
    startGeysers: 0,
    seed,
    ...more,
  });

test('a skirmish is fought on a map made from its seed, with the Furies and the counts chosen', () => {
  const world = make(5);
  assert.equal(world.templeOf(ME)!.type, 'thundervortex');
  assert.equal(world.templeOf(ENEMY)!.type, 'windvortex');
  assert.deepEqual(world.buildingsOf(ENEMY).map((b) => b.type), ['windvortex']);
  assert.ok(world.priestOf(ME) && world.priestOf(ENEMY));
  // Only the three by each home.
  assert.equal([...world.entities.values()].filter((e) => e.kind === 'geyser').length, 6);
  // The same seed gives the same map; another seed, another.
  const at = (w: typeof world) => [w.templeOf(ME)!.x, w.templeOf(ME)!.y];
  assert.deepEqual(at(make(5)), at(world));
  assert.notDeepEqual(at(make(6)), at(world));
  assert.equal(make(5).hash(), world.hash());
});

test('a skirmish starts with the Sun basics and what the Furies granted in the battles before', () => {
  const opts = { ...DEFAULT_OPTIONS, mode: 'skirmish' as const, theme: 'thunder' as const };
  const world = createMatchWorld(defs, maps, missions, opts, {
    known: ['thunderfence'],
    altarLevel: 2,
  });
  const me = world.players.get(ME)!;
  assert.ok(world.multiplayer);
  assert.ok(me.tech.has('suncannon') && me.tech.has('thunderfence'));
  assert.ok(!me.tech.has('thundercannon') && !me.tech.has('sunfence'));
  assert.equal(me.altarLevel, 2);
  // The computer knows the same start and one of the original's sixteen alignments.
  const enemy = world.players.get(ENEMY)!;
  assert.ok(!me.ai && enemy.ai);
  assert.ok(AI_ALIGNMENTS.some((a) => a.tech.every((id) => enemy.tech.has(id))));
  assert.ok(enemy.tech.has('suncannon'));
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
  })?.text, 'Знищено у ворога: Сонячна гармата');
});

test('the interface has every message in English too, and speaks it once chosen', () => {
  const [uk, en] = ['uk', 'en'].map((locale) =>
    Object.keys(
      JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')),
    )
  );
  assert.deepEqual(en, uk);
  const view = createMatchWorld(defs, maps, missions, DEFAULT_OPTIONS).view();
  const refused = {
    tick: 1,
    what: 'rejected',
    who: ME,
    data: { cmd: 'build', err: 'no energy' },
  } as const;

  try {
    setLocale('en', { reload: false });
    assert.equal(describeEvent(view, ME, refused)?.text, 'Build: not enough energy nearby');
  } finally {
    setLocale('uk', { reload: false });
  }
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
      // Some lines are blank frames, which have no picture: the Priest's 65th, the Altar's 15th,
      // and four of the ring between Level 1 and Level 2, which no animation asks for.
      const blank = (type === 'priest' && slot === 64) || (type === 'altar' && slot === 14)
        || (type === 'dais' && slot >= 60 && slot < 64);
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
    states: new VisualStates(),
    guns: new Map(),
  };
  const golem = world.spawnTransport('sunwalker', ME, 40, 40);
  // Standing, the Golem shows the default frame of its file; walking east, the frames of group C.
  assert.deepEqual(slotOf(golem, 3, headings), ['sunwalker', 5]);

  golem.path = [[golem.x + 1, golem.y]];

  // The walk starts on its first frame as it sets off, whatever the tick.
  assert.deepEqual(slotOf(golem, 3, headings), ['sunwalker', 2 * 8]);
  assert.deepEqual(slotOf(golem, 6, headings), ['sunwalker', 2 * 8 + 3]);

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
  assert.deepEqual(slotOf(bulf, 2, headings), ['bulf', 8]);
  assert.deepEqual(slotOf(bulf, 4, headings), ['bulf', 8 + 2]);
  // A Thunder Cannon charges through frames 1 to 7, 0.5 s each, fires on 8 at 3.5 s and is back
  // at rest 0.125 s later (GunAnim.cpp).
  const cannon = world.spawnBuilding('thundercannon', ME, 60, 60, 1);
  assert.deepEqual(slotOf(cannon, 0, headings), ['thundercannon', 9]);
  cannon.target = golem.id;
  cannon.cooldown = 36;
  assert.deepEqual([1, 6, 31, 36, 37].map((tick) => slotOf(cannon, tick, headings)![1]), [
    10,
    11,
    16,
    17,
    9,
  ]);
  assert.equal(overlayOf(cannon, 37, world.view()), null);
  assert.equal(slotOf(world.spawnBuilding('sunblocker', ME, 70, 60), 1, headings), null);
  // A Sun Cannon is built with its barrel flat. To turn, it lowers it, swings it round and raises
  // it again, 0.2 s a frame; it fires on its raised frame plus 24.
  const gun = world.spawnBuilding('suncannon', ME, 80, 80, 0);
  assert.deepEqual(slotOf(gun, 0, headings), ['suncannon', 16]);
  gun.barrel = 1;
  gun.cooldown = 14;
  assert.deepEqual([1, 2, 3, 5, 13, 14].map((tick) => slotOf(gun, tick, headings)![1]), [
    20,
    20,
    21,
    8,
    1,
    1,
  ]);
  gun.cooldown = 50;
  assert.deepEqual([15, 16].map((tick) => slotOf(gun, tick, headings)![1]), [25, 1]);
  // A Crossbow facing east turns, a bearing a tick, to the one of its uneven twenty nearest a target
  // to the north-east (52°); five frames to a bearing, +4 as it fires and back to +0 as it loads.
  const crossbow = world.spawnBuilding('windarcher', ME, 90, 80, 1);
  assert.deepEqual(slotOf(crossbow, 0, headings), ['windarcher', 25]);
  crossbow.target = world.spawnTransport('sunwalker', ENEMY, 101, 72).id;
  crossbow.barrel = 3; // where the simulation turns it
  assert.deepEqual([1, 2, 3].map((tick) => slotOf(crossbow, tick, headings)![1]), [20, 15, 15]);
  crossbow.cooldown = 8;
  assert.deepEqual([4, 5, 7, 11].map((tick) => slotOf(crossbow, tick, headings)![1]), [
    19,
    18,
    17,
    15,
  ]);
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
  // A Disc Thrower lays its arm over its base. A spring spins it round from where it stands; for
  // the half turn before the throw and after it, the arm is flung out (slots 16 to 31).
  const thrower = world.spawnBuilding('sunarcher', ME, 50, 70);
  const guns = new Map();
  assert.deepEqual([slotOf(thrower, 0, headings), overlayOf(thrower, 0, world.view(), guns)], [
    ['sunarcher', 32],
    null,
  ]);
  thrower.target = world.spawnBuilding('sunblocker', ENEMY, 60, 70).id; // due east
  thrower.cooldown = 74;
  const spin = discSpin(ARM_BUILT, 0);
  thrower.barrel = spin.rest;
  const at = (seconds: number) =>
    overlayOf(thrower, 1 + Math.round(seconds * 10), world.view(), guns)![1];
  assert.equal(at(0), 0);
  assert.ok(at(spin.throw) >= 16);
  assert.equal(at(spin.end + 1), spin.rest);
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
  assert.deepEqual(side('enemyterritory', 2).ai, {
    collect: false,
    attack: false,
    encircle: false,
  });
  assert.equal(side('enemyterritory', 3).delay, 4);
  assert.equal(side('guardmyback', 3).ai?.enemy, 2);
  // The first mission: one collector, one geyser, a Priest who carries no crystals, and the keys
  // this AI has no use for dropped.
  assert.deepEqual(side('thewarbegins', 2).ai, {
    encircle: false,
    priestCollects: false,
    transports: 1,
    geysers: 1,
  });

  const rescue = missions.find((m) => m.id === 'totherescue')!;
  assert.deepEqual(rescue.messages.map((m) => m.on), [['@120']]);
  assert.match(rescue.messages[0]!.text, /^A message arrives from the governor/);
  assert.match(rescue.briefing, /Avert this crisis of confidence/); // the second page, "A1."
  // Buttons of the script: a reply leads to another page, a victory to the next mission.
  const power = missions.find((m) => m.id === 'thunderingpower')!;
  const note = power.messages.find((m) => m.on.includes('@500'))!;
  assert.deepEqual(note.buttons, [
    { label: 'Reply', action: 'Tell', arg: 'Wife' },
    { label: 'Ignore', action: 'DoNothing', arg: '0' },
  ]);
  assert.match(power.pages.wife!.text, /^You send a response/);
  assert.deepEqual(power.pages.wife!.buttons, []);
  assert.deepEqual(power.pages.surrender!.buttons.map((b) => b.action), [
    'LeaveBattle',
    'Tell',
    'Tell',
  ]);
  assert.deepEqual(power.pages.victorynote!.buttons.at(-1), {
    label: 'Next Mission',
    action: 'MissionBegin',
    arg: 'DissolvedAlliance',
  });
  assert.ok(missions.some((m) => m.id === 'dissolvedalliance'));
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
  assert.deepEqual(['windarcher', 'sunarcher', 'raincannon'].map(missileSpeed), [35, 35, 20]);
  // A Whirligig's bomb has one bearing and tumbles through six frames, then blasts.
  assert.deepEqual([4, 5, 6].map((tick) => missileSlot('sunflyer', 0, 1, tick)), [4, 5, 0]);
  assert.deepEqual(MISSILES.sunflyer!.blast, { type: 'sunflyerbomb', first: 6, frames: 17 });
  // A building goes up in the second large explosion; an Ice Cannon's shot lands with a kaboom.
  assert.deepEqual([1, 2, 3, 7].map((width) => explosionFor(width).first), [66, 35, 35, 35]);
  assert.deepEqual(['raincannon', 'windarcher'].map((s) => impactOf(s).first), [58, 66]);

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

test('a cell of bridge shows the frame of the sides it joins on', () => {
  // A straight north-south cell (the letter J of bridge.type): whole, cracked and hard.
  assert.deepEqual(
    (['whole', 'cracked', 'hard'] as const).map((strength) => bridgeSlot(5, strength, 1)),
    [35, 37, 40],
  );
  // One cell in five takes the second frame of its letter, and keeps it when it cracks.
  assert.deepEqual([bridgeSlot(7, 'whole', 0), bridgeSlot(7, 'cracked', 0)], [4, 6]);
  assert.deepEqual([bridgeSlot(7, 'whole', 3), bridgeSlot(7, 'cracked', 3)], [3, 5]);
  // A corner, a cross, a stump that hangs on its western neighbour.
  assert.deepEqual([3, 15, 8].map((links) => bridgeSlot(links, 'whole', 1)), [32, 0, 50]);
  // Bridge laid without a piece joins on every side.
  assert.equal(bridgeSlot(0, 'whole', 1), 0);
});

test('units sound as their .type files say, and every sound named is shipped', () => {
  const index = read('../packages/client/public/data/sounds') as SoundIndex;
  assert.equal(unitSound(index, 'suncannon', 'fire'), 'suncannonfire');
  assert.equal(unitSound(index, 'sunwalker', 'drop'), 'golemdrop');
  assert.equal(unitSound(index, 'bombheal', 'active'), 'healget');
  assert.equal(unitSound(index, 'sunblocker', 'fire'), undefined);
  // "thunderCannon-1000.wav" is the Thunder Cannon's shot, ten decibels down.
  assert.deepEqual(index.files.thundercannon, ['sounds/thundercannon.mp3', 0.316]);
  // A sound is heard in full near the middle of the screen and fades, never quite to nothing.
  assert.deepEqual([0, 320, 800, 5000].map(loudness), [1, 1, 0.5, 0.08]);
  // A sound comes from its side of the screen, never wholly from one ear.
  assert.deepEqual([-1000, -320, 0, 320, 1000].map((dx) => sideOf(dx, 640)), [
    -0.7,
    -0.35,
    0,
    0.35,
    0.7,
  ]);
  assert.equal(sideOf(100, 0), 0);
  const named = Object.values(index.units).flatMap((sounds) => Object.values(sounds));

  for (
    const name of [
      ...named,
      'explosion',
      'thundercrack',
      'icecannonimpact4',
      'droppiece',
      'builddone',
      'select',
      'rotatepiece',
      'distantwindquiet',
      'thunderquietdistant',
      'eaglescream',
      'whale',
    ]
  ) {
    const file = index.files[name!];
    assert.ok(file && existsSync(new URL(`../public/${file[0]}`, import.meta.url)), name);
  }
});

test('the hot spot of a unit is read whichever way its .type file spells it', () => {
  const raw = [
    { id: 'rainBattery', hotFootRatioX: 0.5, hotFootRatioY: 0.4 },
    { id: 'windaviary', hotfootratiox: 0.5, hotfootratioy: 0.625 },
    { id: 'sunAviary', hotfootRatioX: 0, hotfootRatioY: 0.27 },
    { id: 'sunCannon', hotFootRatioY: 0.625 },
    { id: 'priest' },
  ];
  const feet = hotFeet(raw);
  assert.deepEqual(feet.get('rainbattery'), [0.5, 0.4]);
  assert.deepEqual(feet.get('windaviary'), [0.5, 0.625]);
  assert.deepEqual(feet.get('sunaviary'), [0, 0.27]);
  assert.deepEqual(feet.get('suncannon'), [0, 0.625]);
  assert.equal(feet.has('priest'), false);
  // What is shipped to the browser keeps them, under one spelling.
  assert.deepEqual(hotFeet(slimUnits(raw)), feet);
});

/** An orange of the rim, a plank colour that is not a rail colour, and a grey rail. */
const pixels = () => new Uint8ClampedArray([185, 123, 71, 255, 178, 103, 54, 255, 82, 90, 99, 255]);

test('rims and bridge rails take the colour of their side; other pictures keep theirs', () => {
  assert.equal(paintOf('shore:wind:3'), 'rim');
  assert.equal(paintOf('slot:bridge:41'), 'rail');
  assert.equal(paintOf('slot:bridgeconnector:2'), 'rail');
  assert.equal(paintOf('slot:priest:0'), null);
  const rim = pixels();
  paint(rim, 'rim', 'red');
  assert.deepEqual(Array.from(rim.slice(0, 3)), [119, 9, 9]);
  const rail = pixels();
  paint(rail, 'rail', 'blue');
  // On a bridge the plank keeps its orange, the rail turns blue.
  assert.deepEqual([...rail], [185, 123, 71, 255, 178, 103, 54, 255, 68, 105, 134, 255]);
});

test('the HUD is built as plain data from the world and the tool in hand', () => {
  const world = createMatchWorld(defs, maps, missions, DEFAULT_OPTIONS);
  const ui = createUiState();
  const atlas = {
    atlases: ['atlas.png'],
    frames: {
      'suncannon:1': [0, 10, 20, 44, 41],
      'slot:sunarcher:32': [0, 0, 0, 39, 26, -42, -25],
      'slot:sunarcher:0': [0, 50, 0, 20, 14, -27, -33],
    },
  };
  const player = world.players.get(ME)!;
  player.storm = 300;
  player.hand = [{ piece: 1, age: 0 }];
  const model = hudModel(world.view(), ME, ui, atlas);
  assert.equal(model.slots.length, world.bridgeSlots);
  assert.deepEqual(model.slots.map((slot) => slot.piece !== null), [
    true,
    false,
    false,
    false,
    false,
    false,
  ]);
  assert.ok(model.slots[0]!.cracked);
  // The Production Window holds what something makes: the Temple's Golem, not the Sun Cannon
  // the player knows but has no Workshop for. The Golem is too dear at 300 Storm Power.
  ui.tool = { kind: 'build', type: 'sunwalker' };
  const units = hudModel(world.view(), ME, ui, atlas).units;
  assert.ok(!units.some((card) => card.id === 'suncannon'));
  const golem = units.find((card) => card.id === 'sunwalker');
  assert.deepEqual([golem?.poor, golem?.short, golem?.active, golem?.facing], [
    true,
    true,
    true,
    null,
  ]);
  // The Temple, selected: its owner's side and a full health bar.
  ui.selected = world.templeOf(ME)!.id;
  const selected = hudModel(world.view(), ME, ui, atlas).selected!;
  assert.deepEqual([selected.owner?.side, selected.hp?.band, selected.hp?.share], [
    'own',
    'high',
    1,
  ]);
  // A unit's icon is cut out of the atlas, enlarged by whole steps only.
  assert.deepEqual(iconOf(atlas, 'suncannon', 40), {
    width: 44,
    height: 41,
    layers: [{
      left: 0,
      top: 0,
      width: 44,
      height: 41,
      background: 'url(atlas.png) -10px -20px',
    }],
    scale: 40 / 44,
  });
  // The Sun Disc Thrower is its base with the thrower laid over it about their hot spot.
  assert.deepEqual(iconOf(atlas, 'sunarcher', 40)?.layers.map((l) => [l.left, l.top]), [
    [0, 8],
    [15, 0],
  ]);
  assert.deepEqual([iconOf(atlas, 'sunarcher', 40)?.width, iconOf(atlas, 'sunarcher', 40)?.height],
    [
      39,
      34,
    ]);
  assert.equal(iconOf(atlas, 'nosuchunit', 40), null);
});

test('an emptied number field starts with nothing; a missing one keeps the default', () => {
  const emptied = normalizeOptions({ storm: null, seed: null }, missions);
  assert.deepEqual([emptied.storm, emptied.seed], [0, 0]);
  const missing = normalizeOptions({}, missions);
  assert.deepEqual([missing.storm, missing.seed], [DEFAULT_OPTIONS.storm, DEFAULT_OPTIONS.seed]);
  assert.equal(normalizeOptions({ storm: 9e9 }, missions).storm, MAX_STORM);
  assert.equal(normalizeOptions({ difficulty: 'hard' }, missions).difficulty, 'hard');
  assert.equal(normalizeOptions({ difficulty: 'cheat' }, missions).difficulty, 'normal');
  assert.equal(normalizeOptions({ opponent: 'watch' }, missions).opponent, 'watch');
  assert.equal(normalizeOptions({ islands: 9, startGeysers: 7 }, missions).islands, 9);
  assert.equal(normalizeOptions({ islands: 9, startGeysers: 7 }, missions).startGeysers,
    DEFAULT_OPTIONS.startGeysers);
  assert.equal(normalizeOptions({ geyserPlacement: 'traditional' }, missions).geyserPlacement,
    'traditional');
});

test('a component missing a function its contract promises fails at mount', () => {
  const hud = { update() {}, addLog() {}, showPage() {} };
  assert.throws(() => contract('Hud', hud as never, ['update', 'addLog', 'showPage', 'hidePage']),
    /Hud\.svelte does not export hidePage\(\)/);
  assert.equal(contract('Hud', hud, ['update', 'addLog']), hud);
});

test('a translation replaces the texts and button labels of a mission and nothing else', () => {
  const translation = {
    thunderingpower: {
      title: 'Міць Грому',
      sections: { '@500': 'Записка від Маркіза.' },
      buttons: { Reply: 'Відповісти' },
    },
  };
  const ours = slimMissions(translateMissions(read('missions'), translation), maps);
  const power = ours.find((m) => m.id === 'thunderingpower')!;
  const original = missions.find((m) => m.id === 'thunderingpower')!;
  assert.equal(power.title, 'Міць Грому');
  const note = power.messages.find((m) => m.on.includes('@500'))!;
  assert.equal(note.text, 'Записка від Маркіза.');
  assert.deepEqual(note.buttons.map((b) => [b.label, b.action, b.arg]), [
    ['Відповісти', 'Tell', 'Wife'],
    ['Ignore', 'DoNothing', '0'],
  ]);
  // What is not translated stays English; how the mission plays does not change.
  assert.equal(power.pages.wife!.text, original.pages.wife!.text);
  assert.deepEqual([power.rescue, power.wards, power.sides], [
    original.rescue,
    original.wards,
    original.sides,
  ]);
  assert.equal(ours.length, missions.length);
  // Listed as the original lists them, whatever the translated titles.
  assert.deepEqual(inOrderOf(missions, [...ours].reverse()).map((m) => m.id),
    missions.map((m) => m.id));
});

test('a translation names the enemies of a mission', () => {
  const translation = { thewarbegins: { names: { aiName: 'Тюремник' } } };
  const ours = slimMissions(translateMissions(read('missions'), translation), maps);
  assert.equal(ours.find((m) => m.id === 'thewarbegins')!.enemy, 'Тюремник');
});

test('the Knowledge of a mission is what its header gives the player, lowest level first', () => {
  const first = missions.find((m) => m.id === 'thewarbegins')!;
  assert.deepEqual(knowledgeOf(defs, first, 'wind').map((k) => k.def.id).sort(), [
    'rainbattery',
    'sunaviary',
    'suncannon',
    'sunwalker',
  ]);
  assert.ok(
    knowledgeOf(defs, first, 'wind').every((k, i, all) =>
      i === 0 || all[i - 1]!.def.level <= k.def.level
    ),
  );
  assert.equal(knowledgeOf(defs, first, 'wind').find((k) => k.def.id === 'sunwalker')!.kind,
    'Транспорт');
  // Without a mission the Fury's skirmish units are known.
  assert.ok(knowledgeOf(defs, undefined, 'thunder').some((k) => k.def.id === 'thundercannon'));
});

test('a unit burns below half its hit points, with a streak more for each tenth lost', () => {
  assert.deepEqual([100, 50, 49, 40, 39, 10, 9, 1, 0].map((hp) => streaksOf(hp, 100)), [
    0,
    0,
    2,
    2,
    3,
    5,
    6,
    6,
    0,
  ]);
  // slimUnits keeps the field the client reads it from.
  const raw = JSON.parse(
    readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8'),
  );
  const fire = burners(slimUnits(raw));
  assert.ok(fire.has('suncannon') && fire.has('bulf') && !fire.has('sunwalker'));

  // An anchor throws a spark when the dice allow; a spark rises and dies within 0.9 s.
  const sparks: Spark[] = [];
  burn(sparks, [[3, 4]], 10, 20, 1, () => 0);
  assert.deepEqual(sparks, [{ x: 13, y: 24, life: 4 }]);
  rise(sparks, 1);
  assert.deepEqual(sparks, [{ x: 13, y: 22, life: 3 }]);
  rise(sparks, 3);
  assert.deepEqual(sparks, []);
});

test('a destroyed unit breaks into its pixels, which fly out, fall and are gone in 0.55 s', () => {
  const pieces: Piece[] = [{ x: 0, y: 0, vx: 1, vy: -14, fall: 6, life: 3, colour: 0 }];
  scatter(pieces, 1);
  assert.deepEqual(pieces, [{ x: 1, y: -14, vx: 1, vy: -8, fall: 6, life: 2, colour: 0 }]);
  scatter(pieces, 2);
  assert.deepEqual(pieces, []);
});

test('an alarm sounds when units are hit on their home island, at most once in thirty seconds', () => {
  const world = skirmish();
  const alarm = createAlarm(world.view());
  const home = homeIsland(world.view(), ME);
  const temple = world.templeOf(ME)!;
  assert.ok(home.has(world.at(temple.x, temple.y)) && home.size > 100);
  assert.equal(alarm(ME), false);
  temple.hp -= 10;
  assert.equal(alarm(ME), true);
  temple.hp -= 10;
  world.tick += 10;
  assert.equal(alarm(ME), false);
  temple.hp -= 10;
  world.tick += 30 * 10;
  assert.equal(alarm(ME), true);
});

test('a missile leaves from the launch point of the frame its gun fires on', () => {
  const world = skirmish();
  const guns = new Map();
  const at = (type: string, facing: 0 | 1 | 2 | 3) => {
    const b = world.spawnBuilding(type, ME, 60, 60, facing);
    return MUZZLES[type]![shotFrame(b, guns)!];
  };
  // A Sun Cannon facing east fires on slot 27, from the end of its barrel (_shapes.shp).
  assert.deepEqual(at('suncannon', 1), [-8, -25]);
  // A Thunder Cannon facing north fires on its eighth frame, from high up its barrel.
  assert.deepEqual(at('thundercannon', 0), [-21, -85]);
  assert.equal(MUZZLES.sunarcher!.length, 33);
});

test('an Altar shows the ring of its Level, and its Upgrade with the horns hidden', () => {
  const world = skirmish();
  const scene = {
    world: world.view(),
    headings: new Map<number, number>(),
    aims: new Map<number, number>(),
    states: new VisualStates(),
    guns: new Map(),
  };
  const altar = world.buildingsOf(ME).find((b) => b.type === 'altar')!;
  altar.upgrades = 1;
  assert.deepEqual(slotOf(altar, 0, scene), ['dais', 64]);
  // Level 1 to 2: 45 frames of 0.12 s, the first at once.
  altar.upgrades = 0;
  altar.upgrading = 54;
  assert.deepEqual(slotOf(altar, 1, scene), ['daisextraframes', 0]);
  altar.upgrading = 1;
  assert.deepEqual(slotOf(altar, 2, scene), ['daisextraframes', 44]);
  assert.equal(overlayOf(altar, 2, world.view()), null);
});

test('the missile of a cannon flies along its barrel, not to the middle of its target', () => {
  const muzzle = { x: 100, y: 50 };
  const middle = { x: 300, y: 70 };
  assert.deepEqual(alongBarrel(muzzle, middle, 1), { x: 300, y: 50 }); // east: along its row
  assert.deepEqual(alongBarrel(muzzle, { x: 120, y: -200 }, 0), { x: 100, y: -200 }); // north
  // It stops where it touches its target: the side facing the gun.
  assert.deepEqual(nearSide(10, 20, 4, 4, 1), [10, 22]);
  assert.deepEqual(nearSide(10, 20, 4, 4, 0), [12, 24]);
  assert.deepEqual(nearSide(10, 20, 4, 4, -1), [12, 22]);
});

test('flyers turn their frames by the clock: a Whirligig’s rotor in 0.145 s, the others per frame', () => {
  // A Man o' War: 0.1 s a frame, sixteen of them; a Dust Devil: 0.08 s, thirteen.
  assert.equal(flyerSlot('rainflyer', 1, 15), 15);
  assert.equal(flyerSlot('rainflyer', 1, 16), 0);
  assert.equal(flyerSlot('windflyer', 1, 1), 1);
  assert.equal(flyerSlot('windflyer', 1, 2.5), 3);
  // Within one tick the rotor goes round most of the way.
  const frames = new Set([0, 0.25, 0.5, 0.75, 1].map((t) => flyerSlot('sunflyer', 0, t)));
  assert.ok(frames.size >= 4 && [...frames].every((f) => f >= 0 && f <= 7));
});

test('a building going up shows its pixels from the base up, as many as the work done', () => {
  // A picture 6 wide and 6 high, its top row clear.
  const rgba = new Uint8ClampedArray(6 * 6 * 4);

  for (let i = 6; i < 36; i++) {
    rgba.set([10, 20, 30, 255], i * 4);
  }

  const growth = new Growth(rgba, 6, 6, () => 0.5);
  const shown = () => [...Array(36).keys()].filter((i) => growth.out[i * 4 + 3]! > 0);
  growth.step(0, 0);
  // Only the seeds of the edge: the lowest row.
  assert.ok(shown().every((i) => i >= 30));
  growth.step(1, 0.5);
  assert.ok(shown().length >= 15);
  assert.ok(shown().some((i) => i >= 30));
  // Done, and time enough for every pixel to take its own colour.
  growth.step(1, 1);
  growth.step(20, 1);
  assert.deepEqual([...growth.out], [...rgba]);
});

test('a bolt runs crooked from one point exactly to the other, with twigs, and is gone in 0.4 s', () => {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bolt = makeBolt({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 3, random);
  const main = bolt.points.filter((p) => p.intensity === 1);
  assert.deepEqual([main.at(-1)!.x, main.at(-1)!.y], [100, 0]);
  assert.ok(main.length >= 8 && main.length <= 14, `${main.length}`);
  assert.ok(bolt.points.some((p) => p.intensity === 0.125));
  // It grows within the first tenth, and its lines are gone after its life.
  assert.ok(boltLines(bolt, 0.05).length < boltLines(bolt, 1).length);
  assert.equal(boltLines(bolt, 4).length, 0);
});

test('an Ice Cannon’s smoke blows ten puffs and fades from pale to deep blue-green', () => {
  const smoke = makeSmoke(0, 0);
  let alive = true;

  for (let t = 0; t < 40 && alive; t++) {
    alive = blow(smoke, 1, () => 0.5);
  }

  assert.equal(smoke.left, 0);
  assert.ok(smoke.puffs.every((p) => p.x < 0 && p.y < 0)); // up and to the left
  assert.equal(puffColour(100), 0x9bd2ce);
  assert.equal(puffColour(0), 0x366482);
});

test('the gift window of a Sacrifice offers the units of the Altar’s Level of all four Furies', () => {
  const opts = { ...DEFAULT_OPTIONS, mode: 'skirmish' as const, theme: 'wind' as const };
  const world = createMatchWorld(defs, maps, missions, opts, { known: [], altarLevel: 1 });
  const temple = world.templeOf(ME)!;
  const altar = world.spawnBuilding('altar', ME, temple.x + 10, temple.y);
  const ui = createUiState(ME);
  const atlas = { atlases: [], frames: {} };
  assert.equal(hudModel(world.view(), ME, ui, atlas).gift, null);
  ui.gift = { altar: altar.id, until: world.tick + 150 };
  const gift = hudModel(world.view(), ME, ui, atlas).gift!;
  assert.equal(gift.furies.length, 4);
  // Level 1: the Arc Spire of Thunder is offered, the Sun Cannon known from the start is greyed.
  assert.ok(gift.furies[2]!.units.some((u) => u.id === 'thunderfence' && !u.known));
  assert.ok(gift.furies[3]!.units.some((u) => u.id === 'suncannon' && u.known));
  assert.equal(gift.chosen, 'storm');
  assert.equal(gift.seconds, 15);
  // It closes by itself when its time is up.
  ui.gift.until = world.tick;
  assert.equal(hudModel(world.view(), ME, ui, atlas).gift, null);
});
