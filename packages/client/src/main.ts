import { loadDefs } from '@netstorm/sim';
import { loadTextures, type Atlas } from './assets.js';
import { type Maps, type Mission } from './game-data.js';
import { showMenu } from './menu.js';
import { runMatch } from './match.js';

async function main() {
  const [unitsRaw, maps, missions, manifest] = await Promise.all([
    fetchJson<unknown>('data/units.json'),
    fetchJson<Maps>('data/maps.json'),
    fetchJson<Mission[]>('data/missions.json'),
    fetchJson<Atlas>('data/sprites.json'),
  ]);
  const data = {
    defs: loadDefs(unitsRaw),
    maps,
    missions,
    textures: await loadTextures(manifest),
    atlas: manifest,
  };
  const menu = document.getElementById('menu')!;
  const game = document.getElementById('game')!;

  let options = await showMenu(menu, missions);

  for (;;) {
    // "Next Mission" leads straight on to a mission, if the game has it; otherwise to the menu.
    const next = await runMatch(game, data, options);
    options = missions.some((mission) => mission.id === next)
      ? { ...options, mission: next! }
      : await showMenu(menu, missions);
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
