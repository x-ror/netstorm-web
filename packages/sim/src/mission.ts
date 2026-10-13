/** Missions built from the original's maps: the islands, bridges and units a .fort file holds
 * (read into data/maps.json by scripts/fort-maps.py). See "Карти місій" in docs/game-rules.md. */
import { GEYSER_ISLAND_SIZE, World } from './world.js';
import type { DefTable, Theme, UnitDef } from './defs.js';
import { growIslands, type IslandSpec } from './terrain.js';
import { skirmishTech, type SkirmishOptions, applyOptions } from './scenario.js';
import { isSpell } from './rules/spells.js';
import { LINK_ALL, Terrain, W, type Facing } from './state.js';

/** A map as the original stores it. Positions are the far (south-east) cell of a footprint. */
export interface MissionMap {
  islands: [shape: number, cx: number, cy: number, seed: number][];
  geysers: [x: number, y: number][];
  bridges: [x: number, y: number, frame: number, owner: number][];
  units: [type: string, owner: number, x: number, y: number, frame: number][];
}

export interface MissionPlayer {
  name: string;
  /** Followed by a player the map gives no Temple; with one, its Fury is the player's. */
  theme: Theme;
  storm: number;
  /** What the side knows; left out, it knows the Sun units and those of its Fury. */
  tech?: string[];
  /** The sides it is allied with. */
  allies?: number[];
}

/* oxlint-disable no-magic-numbers -- the frame table of the original's bridge type */
/**
 * The frames of the bridge type in the order of bridge.type: the letter of each (the sides it
 * joins on) and whether it is a normal, a cracked or a hard one.
 */
const BRIDGE_FRAMES: [links: number, terrain: number][] = [];
// Per letter A to K: the sides it joins on, and how many normal, cracked and hard frames it has.
const BRIDGE_LETTERS: readonly (readonly [number, number, number, number])[] = [
  [15, 1, 1, 1],
  [7, 2, 2, 1],
  [14, 2, 2, 1],
  [13, 2, 2, 1],
  [11, 2, 2, 1],
  [6, 1, 1, 1],
  [12, 1, 1, 1],
  [9, 1, 1, 1],
  [3, 1, 1, 1],
  [5, 2, 3, 1],
  [10, 2, 3, 1],
];
const BRIDGE_KINDS = [Terrain.Bridge, Terrain.CrackedBridge, Terrain.HardBridge];

for (const [links, ...perKind] of BRIDGE_LETTERS) {
  for (const [kind, n] of perKind.entries()) {
    for (let i = 0; i < n; i++) {
      BRIDGE_FRAMES.push([links, BRIDGE_KINDS[kind]!]);
    }
  }
}

/** Frames of one facing of a unit that is saved with its frame; the facing is the frame over it.
 * Which way each set looks is not established (`?`). */
const FACING_FRAMES: Readonly<Record<string, number>> = {
  thundercannon: 9,
  windarcher: 25,
  windblocker: 1,
};
/* oxlint-enable no-magic-numbers */
const FACINGS = 4;
const STATIC: ReadonlySet<string> = new Set([
  'Shooter',
  'Defense',
  'Anti-Air',
  'Source of Energy',
  'Air Attack Base',
  'Production',
  'Energy',
  'Altar',
]);
const MOVING: ReadonlySet<string> = new Set(['Ground Transport', 'Aerial Transport']);
const PRIEST = 'priest';
const THEMES: readonly Theme[] = ['wind', 'rain', 'thunder'];

function templeTheme(defs: DefTable, map: MissionMap, owner: number): Theme | undefined {
  for (const [type, of] of map.units) {
    const def = defs.get(type);

    if (of === owner && def?.cls === 'Energy' && THEMES.includes(def.theme as Theme)) {
      return def.theme as Theme;
    }
  }

  return undefined;
}

/**
 * Build the world of a mission. The sides come from the owners of the map's units; `side` tells
 * how each of them is set up.
 */
export function createMission(
  defs: DefTable,
  seed: number,
  map: MissionMap,
  side: (id: number) => MissionPlayer,
  options: SkirmishOptions = {},
): World {
  const w = new World(defs, seed);
  applyOptions(w, options);
  const owners = [...new Set(map.units.map(([, owner]) => owner).filter((owner) => owner > 0))]
    .sort((a, b) => a - b);

  for (const id of owners) {
    const settings = side(id);
    const theme = templeTheme(defs, map, id) ?? settings.theme;
    const tech = settings.tech?.filter((type) => defs.has(type)) ?? skirmishTech(defs, theme);
    w.addPlayer(id, settings.name, theme, settings.storm, tech, settings.allies);
  }

  const specs: IslandSpec[] = map.islands.map(([shape, cx, cy, grain]) => ({
    shape,
    cx,
    cy,
    seed: grain,
  }));
  const ground = growIslands(specs);
  const lords = islandOwners(w, map, ground, specs.length);

  for (const [i, island] of ground.entries()) {
    if (island >= 0) {
      w.terrain[i] = Terrain.Island;
      w.owner[i] = lords[island]!;
    }
  }

  for (const [x, y, frame, owner] of map.bridges) {
    const [links, terrain] = BRIDGE_FRAMES[frame] ?? [LINK_ALL, Terrain.Bridge];

    if (w.inside(x, y) && w.terrain[w.at(x, y)] === Terrain.Sky) {
      w.terrain[w.at(x, y)] = terrain;
      w.links[w.at(x, y)] = links;
      w.owner[w.at(x, y)] = w.players.has(owner) ? owner : 0;
    }
  }

  for (const [x, y] of map.geysers) {
    islet(w, x - 1, y - 1, GEYSER_ISLAND_SIZE, GEYSER_ISLAND_SIZE, 0);

    if (!w.occupant[w.at(x, y)]) {
      w.addGeyser(x, y, undefined, false);
    }
  }

  // Buildings first: a Priest saved inside the footprint of his Temple steps aside.
  const moving = (type: string) => type === PRIEST || MOVING.has(defs.get(type)?.cls ?? '');

  for (const unit of map.units.filter(([type]) => !moving(type))) {
    place(w, unit);
  }

  for (const unit of map.units.filter(([type]) => moving(type))) {
    place(w, unit);
  }

  w.invalidateTerrain();
  return w;
}

/** An island belongs to whoever has a Temple on it; without a Temple, to the side whose Priest
 * stands on it, so that he can build one; otherwise to nobody. */
function islandOwners(w: World, map: MissionMap, ground: Int16Array, islands: number): number[] {
  const lords: number[] = Array.from({ length: islands }, () => 0);
  const claim = (wanted: (type: string) => boolean) => {
    for (const [type, owner, x, y] of map.units) {
      const island = w.inside(x, y) ? ground[y * W + x]! : -1;

      if (island >= 0 && lords[island] === 0 && w.players.has(owner) && wanted(type)) {
        lords[island] = owner;
      }
    }
  };

  claim((type) => w.defs.get(type)?.cls === 'Energy');
  claim((type) => type === PRIEST);
  return lords;
}

/** Turn open sky under a footprint into ground; true if any of it was sky. */
function islet(w: World, x0: number, y0: number, fx: number, fy: number, owner: number): boolean {
  let made = false;

  for (let y = y0; y < y0 + fy; y++) {
    for (let x = x0; x < x0 + fx; x++) {
      if (w.inside(x, y) && w.terrain[w.at(x, y)] === Terrain.Sky) {
        w.terrain[w.at(x, y)] = Terrain.Island;
        w.owner[w.at(x, y)] = owner;
        made = true;
      }
    }
  }

  return made;
}

function fits(w: World, x0: number, y0: number, def: UnitDef): boolean {
  for (let y = y0; y < y0 + def.footY; y++) {
    for (let x = x0; x < x0 + def.footX; x++) {
      if (!w.inside(x, y) || w.occupant[w.at(x, y)]) {
        return false;
      }
    }
  }

  return true;
}

/** How far around his saved place a Priest looks for a free cell of ground. */
const PRIEST_REACH = 12;

/** The free cell of ground nearest to a place, by rings around it. */
function freeNear(w: World, x: number, y: number): [number, number] | null {
  for (let r = 0; r <= PRIEST_REACH; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        const ring = Math.max(Math.abs(dx), Math.abs(dy)) === r;

        if (
          ring && w.inside(nx, ny) && w.terrain[w.at(nx, ny)] !== Terrain.Sky
          && !w.occupant[w.at(nx, ny)]
        ) {
          return [nx, ny];
        }
      }
    }
  }

  return null;
}

function place(w: World, [type, owner, x, y, frame]: MissionMap['units'][number]): void {
  // An Obelisk is saved as the Spell it holds, whoever the file says it belongs to.
  if (isSpell(type) && w.inside(x, y) && !w.occupant[w.at(x, y)]) {
    islet(w, x, y, 1, 1, 0);
    w.addObelisk(x, y, type);
    return;
  }

  if (!w.players.has(owner) || !w.inside(x, y)) {
    return; // scenery and things of nobody are not modelled
  }

  if (type === PRIEST) {
    const spot = w.priestOf(owner) ? null : freeNear(w, x, y);

    if (spot) {
      w.addPriest(owner, ...spot);
    }

    return;
  }

  const def = w.defs.get(type);

  if (def && MOVING.has(def.cls)) {
    w.spawnTransport(type, owner, x, y);
    return;
  }

  if (!def || !STATIC.has(def.cls)) {
    return;
  }

  const x0 = x - def.footX + 1;
  const y0 = y - def.footY + 1;

  if (!fits(w, x0, y0, def)) {
    return;
  }

  const per = FACING_FRAMES[type];
  const facing = (per ? Math.floor(frame / per) % FACINGS : 0) as Facing;
  const stood = islet(w, x0, y0, def.footX, def.footY, owner);
  w.spawnBuilding(type, owner, x0, y0, facing).islet = stood;
}
