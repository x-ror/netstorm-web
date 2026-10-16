import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Container, Graphics, Texture, TextureSource } from 'pixi.js';
import { FixedStepClock, World, loadDefs, TPS } from '@netstorm/sim';
import { createWorldRenderer } from '../src/renderer.js';
import { hotSpots } from '../src/assets.js';
import { firstEmission, PresentationTime, progress, VisualStates } from '../src/presentation.js';
import { slotOf } from '../src/animations.js';
import type { Sounds } from '../src/sound.js';

const defs = loadDefs(
  JSON.parse(readFileSync(new URL('../../../data/units.json', import.meta.url), 'utf8')),
);

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

  for (const type of ['bolt', 'explosion', 'explosion2', 'explosion3', 'iceball', 'bomb']) {
    for (let i = 0; i < 40; i++) {
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

test('synthetic 30/60/144 Hz, irregular, catch-up and clock-cap schedules preserve gameplay', () => {
  const schedules = [
    [1000 / 30],
    [1000 / 60],
    [1000 / 144],
    [7, 93, 15, 285],
    [450, 50],
    [60000, 10, 90],
  ];

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
  }
});
