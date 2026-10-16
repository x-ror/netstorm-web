import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, growIslands, islandChunks, W } from '../src/index.js';

const sides = [{ id: 1, theme: 'wind' }, { id: 2, theme: 'rain' }] as const;

test('a made-up map has two homes with Temples, the islands and geysers asked for, apart', () => {
  const map = generateMap(42, { islands: 6, geysers: 12, sides });
  assert.equal(map.islands.length, 6);
  assert.equal(map.geysers.length, 12);
  // No two islands share a chunk.
  const chunks = map.islands.flatMap(([shape, cx, cy, seed]) =>
    islandChunks({ shape, cx, cy, seed }).map(([x, y]) => y * 16 + x)
  );
  assert.equal(new Set(chunks).size, chunks.length);
  const ground = growIslands(map.islands.map(([shape, cx, cy, seed]) => ({ shape, cx, cy, seed })));
  // Each Temple stands on its own home, the first on the first island, with its Priest.
  const temples = map.units.filter(([type]) => type.endsWith('vortex'));
  assert.deepEqual(temples.map(([type, owner]) => [type, owner]), [['windvortex', 1], [
    'rainvortex',
    2,
  ]]);

  for (const [home, [, , x, y]] of temples.entries()) {
    assert.equal(ground[y * W + x], home);
    assert.equal(ground[(y - 5) * W + x - 7], home);
  }

  assert.equal(map.units.filter(([type]) => type === 'priest').length, 2);

  // Geysers lie in open sky.
  for (const [x, y] of map.geysers) {
    assert.equal(ground[y * W + x], -1);
  }

  // The same seed again gives the same map.
  assert.deepEqual(generateMap(42, { islands: 6, geysers: 12, sides }), map);
  assert.notDeepEqual(generateMap(43, { islands: 6, geysers: 12, sides }), map);
});
