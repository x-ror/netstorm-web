import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { TEXTURES, selectFrame, type Manifest } from './src/texture-selection.js';

/** Ship only frames loaded by the scene. Keep the complete extraction in public for development. */
function gameAssets(): Plugin {
  return {
    name: 'netstorm-game-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        const name = path === '/data/units.json' ? 'units' : path === '/data/forts.json' ? 'forts' : undefined;
        if (!name) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(new URL(`../../data/${name}.json`, import.meta.url)));
      });
    },
    generateBundle() {
      const manifest: Manifest = JSON.parse(readFileSync(new URL('./public/data/sprites.json', import.meta.url), 'utf8'));
      const selected: Manifest = {};
      const files = new Set<string>();
      for (const [, type, gif, frame] of TEXTURES) {
        const entry = selectFrame(manifest, type, gif, frame);
        if (!entry) continue;
        const [index, file] = entry;
        ((selected[type] ??= {})[gif] ??= {})[index] = file;
        files.add(file);
      }
      for (const file of files) {
        if (!file.startsWith('sprites/') || file.split('/').includes('..')) throw new Error(`Invalid sprite path: ${file}`);
        this.emitFile({ type: 'asset', fileName: file, source: readFileSync(new URL(`./public/${file}`, import.meta.url)) });
      }
      this.emitFile({ type: 'asset', fileName: 'data/sprites.json', source: JSON.stringify(selected) });
      for (const name of ['units', 'forts']) {
        const data = JSON.parse(readFileSync(new URL(`../../data/${name}.json`, import.meta.url), 'utf8'));
        this.emitFile({ type: 'asset', fileName: `data/${name}.json`, source: JSON.stringify(data) });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  publicDir: command === 'build' ? false : 'public',
  plugins: [gameAssets()],
  server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  build: { target: 'es2022' },
}));
