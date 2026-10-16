import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Container, Graphics, Texture, TextureSource } from 'pixi.js';
import { FixedStepClock, World, loadDefs, TPS } from '@netstorm/sim';
import { createWorldRenderer } from '../src/renderer.js';
import { hotSpots } from '../src/assets.js';
import { firstEmission, PresentationTime, progress, VisualStates } from '../src/presentation.js';
import { slotOf } from '../src/animations.js';
import { physicalPixel } from '../src/camera.js';
import type { Sounds } from '../src/sound.js';

const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8')),
);

test('physical-pixel snapping is bounded at DPR 1, 1.5 and 2, including negative pans', () => {
  for (const density of [1, 1.5, 2]) {
    for (const value of [-100.3, -0.4, 0, 0.4, 100.3]) {
      const snapped = physicalPixel(value, density);
      assert.ok(Math.abs(snapped - value) <= 0.5 / density);
      assert.ok(Math.abs(snapped * density - Math.round(snapped * density)) < 1e-10);
    }
  }
});

function fixture() {
  const world = new World(defs, 42);
  world.addPlayer(1, 'Blue', 'sun', 1000, [...defs.keys()]);
  world.addPlayer(2, 'Red', 'rain', 1000, [...defs.keys()]);
  world.addIsland(35, 35, 40, 40, 1);
  const layer = new Container();
  const bars = new Container();
  const heard: unknown[][] = [];
  const sounds = {
    index: { units: {}, files: {} },
    play: (...args: unknown[]) => heard.push(args),
    unit: (...args: unknown[]) => heard.push(args),
  } as unknown as Sounds;
  const texture = new Texture({ source: new TextureSource({ width: 16, height: 16 }) });
  hotSpots.set(texture, { x: 0.5, y: 1 });
  const textures = new Map<string, Texture>();

  for (
    const type of [
      'bolt',
      'anim',
      'raincannonmissile',
      'sunflyerbomb',
      'thundercannonmissile',
      'sundisc',
      'healeffect',
      'manabolt',
    ]
  ) {
    for (let i = 0; i < 100; i++) {
      textures.set(`slot:${type}:${i}`, texture);
    }
  }

  const renderer = createWorldRenderer(world.view(), 1, new Graphics(), new Container(), layer,
    bars, textures, sounds);
  return { world, renderer, layer, bars, heard, texture, textures };
}

test('presentation reset freezes partial pose without rewinding or following discarded time', () => {
  const time = new PresentationTime();
  assert.equal(time.sample(10, 0.7), 10.7);
  time.reset();
  assert.equal(time.sample(10, 0), 10.7);
  assert.equal(time.sample(10, 0.4), 10.7);
  time.reset();
  assert.equal(time.sample(10, 0), 10.7);
  assert.equal(time.sample(11, 0.2), 11.2);
  assert.equal(progress(12, 10, 2), 1);
  assert.equal(progress(9, 10, 2), 0);
  assert.ok(firstEmission(100000, 0, 20, 5) >= 99980);
});

test('visual states restart walking only on entry and cleanly cancel on removal', () => {
  const { world } = fixture();
  const unit = world.spawnTransport('sunwalker', 1, 40, 40);
  const states = new VisualStates();
  const scene = {
    world: world.view(),
    headings: new Map<number, number>(),
    aims: new Map<number, number>(),
    states,
  };
  unit.path = [[41, 40]];
  const first = slotOf(unit, 7, scene);
  assert.deepEqual(slotOf(unit, 7, scene), first);
  assert.notDeepEqual(slotOf(unit, 8, scene), first);
  unit.path = [];
  slotOf(unit, 9, scene);
  unit.path = [[41, 40]];
  assert.deepEqual(slotOf(unit, 10, scene), first);
  states.delete(unit.id);
  assert.equal(states.enter(unit.id, 'walking', 100), 0);
  assert.equal(states.enter(unit.id, 'walking', 101), 1);
  states.clear();
  assert.equal(states.enter(unit.id, 'walking', 102), 0);
});

test('tick capture keeps adjacent movement samples through catch-up and pause resets', () => {
  const { world, renderer, layer } = fixture();
  const unit = world.spawnTransport('sunwalker', 1, 40, 40);
  renderer.sync(1);
  const sprite = layer.children[0]!.children[0]!;
  const start = sprite.x;

  for (let i = 0; i < 4; i++) {
    unit.x++;
    world.tick++;
    renderer.capture();
  }

  renderer.sync(0.5);
  assert.equal(sprite.x, start + 3.5 * 16);
  renderer.resetTime();
  renderer.sync(0);
  assert.equal(sprite.x, start + 3.5 * 16);
});

test('depth follows displayed feet and attachments stay in an atomic entity group', () => {
  const { world, renderer, layer, bars } = fixture();
  const unit = world.spawnTransport('sunwalker', 1, 40, 40);
  unit.hp /= 2;
  renderer.sync(1);
  const group = layer.children[0]!;
  const sprite = group.children[0]!;
  const y = sprite.y;
  unit.y += 2;
  world.tick++;
  renderer.capture();
  renderer.sync(0.25);
  assert.equal(sprite.y, y + 0.5 * 11);
  assert.equal(group.zIndex, sprite.y);
  const health = bars.children[1]!.getLocalBounds();
  assert.equal(health.minY, sprite.y - 4);
  renderer.setImproved(false);
  assert.ok(layer.children.includes(sprite));
  renderer.setImproved(true);
  assert.ok(layer.children[0]!.children.includes(sprite));
});

test('legacy/improved switches leave world unchanged and do not replay audio', () => {
  const { world, renderer, heard } = fixture();
  const gun = world.spawnBuilding('windarcher', 1, 40, 40);
  gun.rising = 20;
  renderer.sync();
  const hash = world.hash();
  const count = heard.length;
  renderer.setImproved(false);
  renderer.setImproved(true);
  renderer.sync(0);
  assert.equal(world.hash(), hash);
  assert.equal(heard.length, count);
});

test('damage feedback restores ownership tint, ignores healing and preserves HP alpha', () => {
  const { world, renderer, layer } = fixture();
  const unit = world.spawnTransport('sunwalker', 2, 40, 40);
  renderer.sync(1);
  const sprite = layer.children[0]!.children[0] as Graphics;
  const ownership = sprite.tint;
  unit.hp /= 2;
  world.tick++;
  renderer.capture();
  renderer.sync(0);
  assert.notEqual(sprite.tint, ownership);
  assert.equal(sprite.alpha, 0.75);
  world.tick += 2;
  renderer.sync(0);
  assert.equal(sprite.tint, ownership);
  unit.hp++;
  world.tick++;
  renderer.sync(0);
  assert.equal(sprite.tint, ownership);
});

test('missiles sample fractional positions, land once, initialize frame zero and keep expiry', () => {
  for (const type of ['windarcher', 'raincannon', 'suncannon', 'sunflyer']) {
    const { world, renderer, heard } = fixture();
    const target = world.spawnTransport('sunwalker', 2, 44, 40);
    const gun = type === 'sunflyer'
      ? world.spawnFlyer(type, 1, world.spawnBuilding('sunaviary', 1, 40, 40))
      : world.spawnBuilding(type, 1, 40, 40);
    gun.cooldown = 0;
    gun.target = target.id;
    renderer.sync(1);
    world.tick++;
    gun.cooldown = 10;

    if (gun.kind === 'building') {
      world.shots.push({
        gun: { ...gun },
        target: target.id,
        x: target.x,
        y: target.y,
        land: world.tick + 2,
        amount: 1,
      });
    }

    renderer.capture();
    renderer.sync(0);
    const initial = renderer.inspect().missiles[0];
    renderer.sync(0.5);

    if (initial) {
      const half = renderer.inspect().missiles[0]!;
      assert.notEqual(half.x + half.y, initial.x + initial.y, type);
    }

    // Removing both ends must not erase the in-flight effect or its recorded landing point.
    world.entities.delete(target.id);
    world.entities.delete(gun.id);
    const land = renderer.inspect().missiles[0]?.land ?? world.tick + 2;

    while (world.tick < land) {
      world.tick++;
      renderer.capture();
    }

    renderer.sync(0);
    const burst = renderer.inspect().bursts[0]!;
    assert.ok(burst, type);
    assert.equal(burst.start, land, type);
    assert.equal(burst.initialized, true, type);
    const count = heard.length;
    renderer.sync(0.5);
    assert.equal(renderer.inspect().bursts.length, 1, type);
    assert.equal(heard.length, count, type);
    world.tick = burst.expires;
    renderer.sync(0);
    assert.equal(renderer.inspect().bursts.length, 0, type);
  }
});

test('death/spell bursts initialize immediately and expired catch-up effects do not backlog', () => {
  const { world, renderer } = fixture();
  const unit = world.spawnTransport('sunwalker', 1, 40, 40);
  renderer.sync(1);
  renderer.explode(unit.id);
  renderer.cast(unit.id, 'bombexplodesmall');
  renderer.capture();
  // Event-created bursts are followed by capture on the completed tick, before frame sync.
  world.tick++;
  renderer.capture();
  const effects = renderer.inspect().bursts;
  assert.equal(effects.length, 2);
  assert.ok(effects.every((effect) => effect.initialized));
  world.tick += 30;
  renderer.capture();
  renderer.sync(0);
  assert.equal(renderer.inspect().bursts.length, 0);
});

test('shots keep recorded target coordinates and survive removal in their launch tick', () => {
  const { world, renderer } = fixture();
  const gun = world.spawnBuilding('windarcher', 1, 40, 40);
  const target = world.spawnTransport('sunwalker', 2, 44, 40);
  gun.rising = 0;
  gun.cooldown = 0;
  gun.target = target.id;
  renderer.sync(1);
  gun.cooldown = 8;
  world.tick++;
  world.shots.push({
    gun: { ...gun },
    target: target.id,
    x: 44,
    y: 40,
    land: world.tick + 2,
    amount: 1,
  });
  target.x = 45;
  world.entities.delete(gun.id);
  renderer.capture();
  renderer.sync(0);
  const missile = renderer.inspect().missiles[0]!;
  assert.ok(missile);
  assert.deepEqual(missile.to, { x: 44.5 * 16, y: 40.5 * 11 });
});

test('construction feedback completes on the authoritative tick and placement accents are bounded', () => {
  const { world, renderer, bars } = fixture();
  const site = world.spawnBuilding('sunfactory', 1, 40, 40);
  site.rising = 10;
  renderer.sync(1);
  assert.equal(bars.children[3]!.children.length, 1);
  site.rising = 0;
  world.tick++;
  renderer.capture();
  renderer.sync(0);
  assert.equal(bars.children[3]!.children.length, 0);
  renderer.placed(Array.from({ length: 100 }, (_, x) => [x, 40] as const));
  assert.equal(renderer.inspect().accents, 64);
  world.tick += 3;
  renderer.capture();
  renderer.sync(0);
  assert.equal(renderer.inspect().accents, 0);
});

test('crossings use displayed depth, while temple overlays cannot interleave with another entity', () => {
  const { world, renderer, layer, texture, textures } = fixture();

  for (let i = 0; i < 14; i++) {
    textures.set(`slot:windvortex:${i}`, texture);
  }

  const temple = world.spawnBuilding('windvortex', 1, 40, 40);
  temple.rising = 0;
  const first = world.spawnTransport('sunwalker', 1, 40, 45);
  const second = world.spawnTransport('sunwalker', 1, 40, 46);
  renderer.sync(1);
  const firstGroup = layer.children[1]!;
  const secondGroup = layer.children[2]!;
  const templeGroup = layer.children[0]!;
  assert.ok(templeGroup.children.length >= 2);
  first.y += 2;
  world.tick++;
  renderer.capture();
  renderer.sync(0.25);
  assert.ok(firstGroup.zIndex < secondGroup.zIndex);
  renderer.sync(0.75);
  assert.ok(firstGroup.zIndex > secondGroup.zIndex);
  assert.ok(templeGroup.children.every((child) => child.parent === templeGroup));
  assert.equal(second.y, 46);
});

test('Energy bolts and bounded stream streaks advance between ticks without recapturing the world', () => {
  const { world, renderer, bars } = fixture();
  const source = world.spawnBuilding('windvortex', 1, 40, 40);
  source.rising = 0;
  const workshop = world.spawnBuilding('windfactory', 1, 47, 47);
  workshop.rising = 0;
  workshop.slots.push('windarcher');
  const site = world.spawnBuilding('windarcher', 1, 55, 50);
  site.rising = 100;
  site.builder = null;
  renderer.sync(0);
  assert.equal(renderer.inspect().streams, 1);
  assert.equal(renderer.inspect().bolts, 1);
  renderer.sync(0.25);
  const before = { ...bars.children[2]!.getLocalBounds() };
  renderer.sync(0.75);
  const after = { ...bars.children[2]!.getLocalBounds() };
  assert.notDeepEqual(after, before);
  site.rising = 0;
  world.tick++;
  renderer.capture();
  renderer.sync(0);
  assert.equal(renderer.inspect().streams, 0);
});

test('synthetic 30/60/144 Hz, irregular, catch-up and clock-cap schedules preserve gameplay', () => {
  const schedules = [
    [1000 / 30],
    [1000 / 60],
    [1000 / 144],
    [7, 93, 15, 285],
    [450, 50],
    [60000, 10, 90],
  ];
  let reference: number[] | undefined;

  for (const schedule of schedules) {
    const runs = [];

    for (const improved of [false, true]) {
      const { world, renderer } = fixture();
      renderer.setImproved(improved);
      const gun = world.spawnBuilding('windarcher', 1, 40, 40);
      gun.rising = 0;
      world.spawnTransport('sunwalker', 2, 43, 40);
      const site = world.spawnBuilding('sunfactory', 1, 50, 50);
      site.builder = null;
      site.rising = 8;
      const clock = new FixedStepClock(TPS);
      const events: unknown[] = [];
      const shots: unknown[] = [];
      const completed: number[] = [];
      const hashes: number[] = [];
      renderer.sync(1);

      for (let frame = 0; frame < 160; frame++) {
        clock.advance(schedule[frame % schedule.length]!, () => { // oxlint-disable-line max-nested-callbacks
          world.step();
          events.push(...world.drainEvents());
          shots.push(world.shots.map((shot) => [shot.gun.id, shot.target, shot.land]));

          if (site.rising === 0) {
            completed.push(world.tick);
          }

          hashes.push(world.hash());

          if (improved) {
            renderer.capture();
          }
        });
        renderer.sync(clock.alpha);

        // Both explicit pause and hidden-tab suspension discard accumulator time, not sim ticks.
        if (frame === 40 || frame === 80) {
          renderer.resetTime();
          clock.reset();
          renderer.sync(0);
        }
      }

      runs.push({ events, shots, completed, hashes, tick: world.tick });
    }

    assert.deepEqual(runs[1], runs[0], `schedule ${schedule}`);
    const hashes = runs[0]!.hashes;

    if (reference) {
      const shared = Math.min(reference.length, hashes.length);
      assert.deepEqual(hashes.slice(0, shared), reference.slice(0, shared),
        `equal ticks ${schedule}`);
    } else {
      reference = hashes;
    }
  }
});
