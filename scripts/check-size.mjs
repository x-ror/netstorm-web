import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const root = new URL('../packages/client/dist/', import.meta.url);
let raw = 0;
let compressed = 0;
let files = 0;

async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entry.name, dir);

    if (entry.isDirectory()) {
      await visit(new URL(`${entry.name}/`, dir));
      continue;
    }

    const content = await readFile(url);
    raw += content.length;
    compressed += /\.(js|json|html|css)$/.test(entry.name)
      ? gzipSync(content).length
      : content.length;
    files++;
  }
}

await visit(root);
console.log(
  `Production: ${files} files, ${(raw / 1024).toFixed(1)} KiB raw, ${
    (compressed / 1024).toFixed(1)
  } KiB with gzip for text.`,
);
// The size is reported, not limited: optimising the build is put off until the game is whole.
