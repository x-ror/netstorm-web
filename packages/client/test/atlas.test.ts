import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAtlas, decodePng, encodePng, pack, type Picture } from '../atlas.js';

function picture(width: number, height: number, shade: number): Picture {
  return { width, height, pixels: new Uint8Array(width * height * 4).fill(shade) };
}

const sprite = (file: string) =>
  decodePng(readFileSync(new URL(`../public/sprites/${file}`, import.meta.url)));

test('a picture survives being written as a PNG and read back', () => {
  const made = picture(5, 3, 0);
  made.pixels.set([255, 128, 0, 255, 1, 2, 3, 4], 8);
  assert.deepEqual(decodePng(encodePng(made)), made);

  // With more than 256 colours it is written as RGBA, and still read back the same.
  const rich = picture(300, 1, 255);
  rich.pixels.forEach((_, i) => {
    rich.pixels[i] = i % 4 === 3 ? 255 : (i >> 2) % 256;
  });
  rich.pixels[(299 * 4) + 1] = 7;
  assert.deepEqual(decodePng(encodePng(rich)), rich);
  // A clear pixel keeps no colour of its own: it comes back clear and black.
  const clear = picture(2, 1, 0);
  clear.pixels.set([9, 9, 9, 0], 0);
  assert.deepEqual([...decodePng(encodePng(clear)).pixels], [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('the sprites of both kinds, RGBA and palette, are read alike', () => {
  const golem = sprite('sunwalker/000_golem_064.png');
  assert.deepEqual([golem.width, golem.height, golem.pixels.length], [11, 25, 11 * 25 * 4]);
  // Its corners are clear and its middle is not.
  assert.equal(golem.pixels[3], 0);
  assert.equal(golem.pixels[(12 * 11 + 5) * 4 + 3], 255);
});

test('pictures are packed apart from each other and found again by their keys', () => {
  const pictures = [
    picture(4, 2, 10),
    picture(3, 6, 20),
    picture(2000, 1, 30),
    picture(100, 1, 40),
  ];
  const { atlases, places } = pack(pictures);
  assert.equal(atlases.length, 1);

  for (const [i, [, x, y]] of places.entries()) {
    const at = (y * atlases[0]!.width + x) * 4;
    assert.equal(atlases[0]!.pixels[at], [10, 20, 30, 40][i]);

    // No two places overlap, and a gap of a pixel lies between neighbours.
    for (const [j, [, ox, oy]] of places.entries()) {
      const apart = x + pictures[i]!.width < ox || ox + pictures[j]!.width < x
        || y + pictures[i]!.height < oy || oy + pictures[j]!.height < y;
      assert.ok(i === j || apart, `${i} and ${j}`);
    }
  }

  const files = new Map([['a.png', encodePng(pictures[0]!)], ['b.png', encodePng(pictures[1]!)]]);
  const { atlas } = buildAtlas(new Map([
    ['one', { file: 'a.png' }],
    ['same', { file: 'a.png', offset: [-2, -1] as [number, number] }],
    ['two', { file: 'b.png' }],
  ]), (file) => files.get(file)!);
  assert.deepEqual(atlas.atlases, ['sprites/atlas-0.png']);
  assert.deepEqual(atlas.frames.one!.slice(3), [4, 2]);
  // Keys that share a file share its place; a hot spot rides along.
  assert.deepEqual(atlas.frames.same, [...atlas.frames.one!, -2, -1]);
  assert.deepEqual(atlas.frames.two!.slice(3), [3, 6]);
});
