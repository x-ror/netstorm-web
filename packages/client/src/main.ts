import { loadDefs } from '@netstorm/sim';
import { loadTextures, type Manifest } from './assets.js';
import { type Maps, type Mission } from './game-data.js';
import { showMenu } from './menu.js';
import { runMatch } from './match.js';

async function main() {
  const [unitsRaw, maps, missions, manifest] = await Promise.all([
    fetchJson<unknown>('data/units.json'),
    fetchJson<Maps>('data/forts.json'),
    fetchJson<Mission[]>('data/missions.json'),
    fetchJson<Manifest>('data/sprites.json'),
  ]);
  const data = {
    defs: loadDefs(unitsRaw),
    maps,
    missions,
    textures: await loadTextures(manifest),
  };
  const menu = document.getElementById('menu')!;
  const game = document.getElementById('game')!;

  for (;;) {
    const options = await showMenu(menu, missions);
    await runMatch(game, data, options);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }

  return response.json() as Promise<T>;
}

main().catch((error) => {
  console.error(error);
  const menu = document.getElementById('menu')!;
  menu.hidden = false;
  menu.textContent = 'Не вдалося запустити гру. Перевірте доступність даних та WebGL.';
});
