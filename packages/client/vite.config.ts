import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { TEXTURES, parsePath, selectFrame, type Manifest } from './src/texture-selection.js';
import {
  inOrderOf,
  mapsOf,
  slimMaps,
  slimMissions,
  slimUnits,
  translateMissions,
} from './src/game-data.js';
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
    // The same missions with their texts in Ukrainian (data/missions.uk.json), in the same order.
    'missions-uk': inOrderOf(missions,
      slimMissions(translateMissions(readData('missions'), readData('missions.uk')), maps)),
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
        const name = /^data\/(units|maps|missions|missions-uk)\.json$/.exec(path)?.[1];

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

      // The tile of the sky, which is drawn whole rather than taken from an atlas.
      this.emitFile({
        type: 'asset',
        fileName: SKY,
        source: readFileSync(new URL(`./public/${SKY}`, import.meta.url)),
      });

      // The picture behind the title screen: the title picture, repainted after the original's.
      this.emitFile({
        type: 'asset',
        fileName: TITLE,
        source: readFileSync(new URL(`./public/${TITLE}`, import.meta.url)),
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

      // The music, as scripts/music.py left it in `public`.
      for (const track of readdirSync(new URL('./public/music', import.meta.url))) {
        this.emitFile({
          type: 'asset',
          fileName: `music/${track}`,
          source: readFileSync(new URL(`./public/music/${track}`, import.meta.url)),
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

const SKY = 'sprites/sky.png';
const TITLE = 'sprites/title.webp';

export default defineConfig(({ command }) => ({
  // Relative URLs let the build run from any path, e.g. a GitHub Pages project site.
  base: './',
  publicDir: command === 'build' ? false : 'public',
  plugins: [
    // The texts of the interface, from messages/{locale}.json (inlang); the menu picks the locale.
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      strategy: ['globalVariable', 'baseLocale'],
      emitTsDeclarations: true,
    }),
    // The panels around the map. A warning of the Svelte compiler stops the build, where the
    // compiler is what catches the mistakes of .svelte files; while editing it is only shown.
    svelte({
      onwarn(warning, warn) {
        if (command !== 'build') {
          warn(warning);
          return;
        }

        throw new Error(`${warning.filename}:${warning.start?.line}: ${warning.message}`);
      },
    }),
    gameAssets(),
  ],
  server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  build: { target: 'es2022' },
}));
