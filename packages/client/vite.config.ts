import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { TEXTURES, parsePath, selectFrame, type Manifest } from './src/texture-selection.js';
import { mapsOf, slimMaps, slimMissions, slimUnits } from './src/game-data.js';
import { buildAtlas } from './atlas.js';

function readData(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../data/${name}.json`, import.meta.url), 'utf8'));
}

/** The trimmed data files the client loads, by published name. */
function gameData(): Record<string, unknown> {
  const maps = slimMaps(readData('maps'));
  const missions = slimMissions(readData('missions'), maps);
  return {
    units: slimUnits(readData('units')),
    maps: mapsOf(missions, maps),
    missions,
  };
}

/** The atlases of the frames the scene loads, packed once. The complete extraction stays in
 * `public` as their source and is never served as it is. */
let packed: ReturnType<typeof buildAtlas> | undefined;

function atlases(): ReturnType<typeof buildAtlas> {
  if (packed) {
    return packed;
  }

  const manifest: Manifest = JSON.parse(
    readFileSync(new URL('./public/data/sprites.json', import.meta.url), 'utf8'),
  );
  const wanted = new Map<string, { file: string; offset?: [number, number]; }>();

  for (const [key, type, gif, frame] of TEXTURES) {
    const entry = selectFrame(manifest, type, gif, frame);

    if (!entry) {
      continue; // some original definitions have no extracted frames
    }

    const found = parsePath(entry[1]);

    if (!found.file.startsWith('sprites/') || found.file.split('/').includes('..')) {
      throw new Error(`Invalid sprite path: ${found.file}`);
    }

    wanted.set(key, found);
  }

  packed = buildAtlas(wanted, (file) => readFileSync(new URL(`./public/${file}`, import.meta.url)));
  return packed;
}

function gameAssets(): Plugin {
  return {
    name: 'netstorm-game-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url?.split('?')[0] ?? '').replace(/^\//, '');
        const name = /^data\/(units|maps|missions)\.json$/.exec(path)?.[1];

        if (name) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(gameData()[name]));
        } else if (path === 'data/sprites.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(atlases().atlas));
        } else if (atlases().files.has(path)) {
          res.setHeader('Content-Type', 'image/png');
          res.end(atlases().files.get(path));
        } else {
          next();
        }
      });
    },
    generateBundle() {
      const { atlas, files } = atlases();

      for (const [fileName, source] of files) {
        this.emitFile({ type: 'asset', fileName, source });
      }

      this.emitFile({
        type: 'asset',
        fileName: 'data/sprites.json',
        source: JSON.stringify(atlas),
      });

      // The sounds and their index, as scripts/sounds.py left them in `public`.
      const sounds = readFileSync(new URL('./public/data/sounds.json', import.meta.url), 'utf8');
      const heard = (JSON.parse(sounds) as { files: Record<string, [string, number]>; }).files;
      this.emitFile({ type: 'asset', fileName: 'data/sounds.json', source: sounds });

      for (const [file] of Object.values(heard)) {
        this.emitFile({
          type: 'asset',
          fileName: file,
          source: readFileSync(new URL(`./public/${file}`, import.meta.url)),
        });
      }

      for (const [name, data] of Object.entries(gameData())) {
        this.emitFile({
          type: 'asset',
          fileName: `data/${name}.json`,
          source: JSON.stringify(data),
        });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  // Relative URLs let the build run from any path, e.g. a GitHub Pages project site.
  base: './',
  publicDir: command === 'build' ? false : 'public',
  plugins: [gameAssets()],
  server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  build: { target: 'es2022' },
}));
