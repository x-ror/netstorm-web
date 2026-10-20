import './styles.css';
import '@fontsource-variable/golos-text';
import { loadDefs } from '@netstorm/sim';
import { loadTextures, type Atlas } from './assets.js';
import { hotFeet, type Maps, type Mission } from './game-data.js';
import { showMenu } from './menu.js';
import { createSounds, type SoundIndex } from './sound.js';
import { runMatch } from './match.js';
import { burners } from './burning.js';
import { m } from './paraglide/messages.js';

async function main() {
  const [unitsRaw, maps, missions, translated, manifest, soundIndex] = await Promise.all([
    fetchJson<unknown>('data/units.json'),
    fetchJson<Maps>('data/maps.json'),
    fetchJson<Mission[]>('data/missions.json'),
    fetchJson<Mission[]>('data/missions-uk.json'),
    fetchJson<Atlas>('data/sprites.json'),
    fetchJson<SoundIndex>('data/sounds.json'),
  ]);
  const data = {
    defs: loadDefs(unitsRaw),
    hotFeet: hotFeet(unitsRaw),
    burning: burners(unitsRaw),
    maps,
    missions,
    textures: await loadTextures(manifest),
    atlas: manifest,
    sounds: createSounds(soundIndex),
  };
  const menu = document.getElementById('menu')!;
  const game = document.getElementById('game')!;

  const texts = { en: missions, uk: translated };
  const menuOf = () => showMenu(menu, texts, data.defs, data.atlas);
  let options = await menuOf();

  for (;;) {
    // The missions in the language chosen; the same missions either way.
    const next = await runMatch(game, { ...data, missions: texts[options.lang] }, options);
    // "Next Mission" leads straight on to a mission, if the game has it; otherwise to the menu.
    options = missions.some((mission) => mission.id === next)
      ? { ...options, mission: next! }
      : await menuOf();
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
  menu.textContent = m.start_failed();
});
