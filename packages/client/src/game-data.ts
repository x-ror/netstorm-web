/** Shapes of the game data the client ships, and the build step that trims the extracted originals
 * down to them. Shared by the dev server, the production build and the client. */

/** Geysers of each original map, in map cells. Island shapes are not decoded yet. */
export type Maps = Record<string, { geysers: [number, number][]; }>;

export interface Mission {
  /** File name of the mission and of its map in `forts.json`. */
  id: string;
  title: string;
  /** Starting Storm Power of the human player in the original mission. */
  storm: number;
  enemy: string;
  briefing: string;
  succeeded: string;
  failed: string;
}

/** Keep only the geysers: the client does not read island cells yet. */
export function slimMaps(raw: unknown): Maps {
  const maps: Maps = {};

  for (const [name, value] of Object.entries(asRecord(raw))) {
    const geysers = asRecord(value).geysers;
    maps[name] = {
      geysers: Array.isArray(geysers)
        ? geysers.filter(isCell).map(([x, y]) => [x, y])
        : [],
    };
  }

  return maps;
}

/** The campaign missions (normal difficulty) that have a map, with their briefing texts. */
export function slimMissions(raw: unknown, maps: Maps): Mission[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const missions: Mission[] = [];

  for (const entry of raw) {
    const file = asRecord(entry);
    const id = typeof file.file === 'string' ? file.file : '';
    const header = asRecord(file.header);
    const sections = asRecord(file.sections);

    if (!maps[id] || header.missionType !== 'Tutorial' || typeof header.title !== 'string') {
      continue;
    }

    missions.push({
      id,
      title: header.title,
      storm: Number(header.myStartMoney) || 0,
      enemy: typeof header.aiName === 'string' ? header.aiName : '',
      briefing: section(sections, 'A.'),
      succeeded: section(sections, 'Succeeded') || section(sections, 'succeeded'),
      failed: section(sections, 'Failed'),
    });
  }

  return missions.sort((a, b) => a.title.localeCompare(b.title));
}

function section(sections: Record<string, unknown>, name: string): string {
  const value = sections[name];
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isCell(value: unknown): value is [number, number] {
  return Array.isArray(value) && Number.isInteger(value[0]) && Number.isInteger(value[1]);
}
