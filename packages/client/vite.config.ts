import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { TEXTURES, selectFrame, type Manifest } from './src/texture-selection.js';
import { mapsOf, slimMaps, slimMissions, slimUnits } from './src/game-data.js';

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

/** Ship only frames loaded by the scene. Keep the complete extraction in public for development. */
function gameAssets(): Plugin {
  return {
    name: 'netstorm-game-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        const name = /^\/data\/(units|maps|missions)\.json$/.exec(path ?? '')?.[1];

        if (!name) {
          return next();
        }

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(gameData()[name]));
      });
    },
    generateBundle() {
      const manifest: Manifest = JSON.parse(
        readFileSync(new URL('./public/data/sprites.json', import.meta.url), 'utf8'),
      );
      const selected: Manifest = {};
      const files = new Set<string>();

      for (const [, type, gif, frame] of TEXTURES) {
        const entry = selectFrame(manifest, type, gif, frame);

        if (!entry) {
          continue;
        }

        const [index, file] = entry;
        ((selected[type] ??= {})[gif] ??= {})[index] = file;
        files.add(file);
      }

      for (const file of files) {
        if (!file.startsWith('sprites/') || file.split('/').includes('..')) {
          throw new Error(`Invalid sprite path: ${file}`);
        }

        this.emitFile({
          type: 'asset',
          fileName: file,
          source: readFileSync(new URL(`./public/${file}`, import.meta.url)),
        });
      }

      this.emitFile({
        type: 'asset',
        fileName: 'data/sprites.json',
        source: JSON.stringify(selected),
      });

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
