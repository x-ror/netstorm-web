import type { MissionMap } from '@netstorm/sim';

/** Shapes of the game data the client ships, and the build step that trims the extracted originals
 * down to them. Shared by the dev server, the production build and the client. */

/** The original maps the client ships, as the mission builder of the simulation takes them. */
export type Maps = Record<string, MissionMap>;

export interface Mission {
  /** File name of the mission and of its map in `maps.json`. */
  id: string;
  title: string;
  /** Starting Storm Power of the human player in the original mission. */
  storm: number;
  enemy: string;
  /** Seconds between the computer opponent's moves (aiTimeBetweenMoves). */
  aiDelay: number;
  briefing: string;
  succeeded: string;
  failed: string;
}

/** aiTimeBetweenMoves of the campaign missions that leave it out; most set 6. */
export const DEFAULT_AI_DELAY = 6;

/** Fields of a unit that `loadDefs` reads; the rest of the extraction is not shipped. */
const UNIT_FIELDS = [
  'id',
  'description',
  'class',
  'theme',
  'level',
  'cost',
  'maxHitPoints',
  'range',
  'hpPerSec',
  'foot_x',
  'foot_y',
  'speed',
  'group',
  'delayBetweenShots',
  'lifeSpan',
  'airrange',
  'useairdamage',
  'airdamage',
] as const;

/** Keep only what the simulation reads of each unit. */
export function slimUnits(raw: unknown): Record<string, unknown>[] {
  return (Array.isArray(raw) ? raw : []).map((unit) => {
    const from = asRecord(unit);
    const slim: Record<string, unknown> = {};

    for (const field of UNIT_FIELDS) {
      if (from[field] !== undefined) {
        slim[field] = from[field];
      }
    }

    return slim;
  });
}

/** Keep of each map what the mission builder reads: the islets under units are made by it. */
export function slimMaps(raw: unknown): Maps {
  const maps: Maps = {};

  for (const [name, value] of Object.entries(asRecord(raw))) {
    const { islands, geysers, bridges, units } = asRecord(value) as unknown as MissionMap;
    maps[name] = { islands, geysers, bridges, units };
  }

  return maps;
}

/** Keep only the maps some mission is played on. */
export function mapsOf(missions: Mission[], maps: Maps): Maps {
  return Object.fromEntries(missions.flatMap((m) => maps[m.id] ? [[m.id, maps[m.id]!]] : []));
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
      aiDelay: Number(header.aiTimeBetweenMoves) || DEFAULT_AI_DELAY,
      briefing: reflow(withoutTitle(text(sections, 'A.'), header.title)),
      succeeded: reflow(text(sections, 'Succeeded') || text(sections, 'succeeded')),
      failed: reflow(text(sections, 'Failed')),
    });
  }

  return missions.sort((a, b) => a.title.localeCompare(b.title));
}

function text(sections: Record<string, unknown>, name: string): string {
  const value = sections[name];
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : '';
}

const titleKey = (line: string) => line.trim().toLowerCase().replace(/[\s!.?:]+$/, '');

/** Drop a first line that repeats the mission title, which the menu shows as a heading. Case,
 * spacing and closing punctuation may differ ("Capture The Priest!" for "Capture The Priest"). */
function withoutTitle(body: string, title: string): string {
  const lines = body.trim().split('\n');
  return lines[0] !== undefined && titleKey(lines[0]) === titleKey(title)
    ? lines.slice(1).join('\n')
    : body;
}

/** An attribution line under a quote: "--Lament of Light". An inline dash ("--and yours") is not. */
const ATTRIBUTION = /^--\s*[A-Z]/;

/**
 * Reflow a text written for the original's 640 px windows. Paragraphs are split on blank lines,
 * even ones holding spaces. A paragraph that opens with a quotation mark is an epigraph or verse
 * and keeps its line breaks; in others, lines are joined with a space, except attribution lines.
 * Only line-end whitespace is touched, so spacing inside a line stays.
 */
export function reflow(body: string): string {
  return body.replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((paragraph) => {
      const lines = paragraph.split('\n').map((line) => line.trimEnd()).filter((line) =>
        line.trim()
      );

      if (lines[0]?.trimStart().startsWith('"')) {
        return lines.join('\n');
      }

      const out: string[] = [];

      for (const line of lines) {
        if (out.length && !ATTRIBUTION.test(line.trim())) {
          out[out.length - 1] += ` ${line.trimStart()}`;
        } else {
          out.push(out.length ? line.trimStart() : line);
        }
      }

      return out.join('\n');
    })
    .filter((paragraph) => paragraph.trim())
    .join('\n\n')
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
