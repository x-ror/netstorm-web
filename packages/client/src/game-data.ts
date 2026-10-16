import type { AiOptions, MissionMap } from '@netstorm/sim';

/** Shapes of the game data the client ships, and the build step that trims the extracted originals
 * down to them. Shared by the dev server, the production build and the client. */

/** The original maps the client ships, as the mission builder of the simulation takes them. */
export type Maps = Record<string, MissionMap>;

/** A side of a mission as its file sets it up; what is left out takes the default. */
export interface MissionSide {
  name?: string;
  storm?: number;
  /** Unit ids the side knows. */
  tech?: string[];
  allies?: number[];
  /** Storm Power the side is given every second (`aiMoneyRechargeRate`). */
  income?: number;
  /** Seconds between the side's moves (`aiTimeBetweenMoves`). */
  delay?: number;
  /** What its header tells the computer that plays it. */
  ai?: Omit<AiOptions, 'player'>;
}

/** A text of the mission's script and the events that bring it up: "@120" is 120 seconds into the
 * mission, "ai3templedead" the fall of the Temple of side 3. */
export interface MissionMessage {
  on: string[];
  text: string;
  buttons: MissionButton[];
}

/** A button under a text of the script: `Tell` shows the page named by `arg`, `DoNothing` goes on
 * with the battle, `MissionBegin` starts the mission named by `arg`, the rest leave the battle. */
export interface MissionButton {
  label: string;
  action: string;
  arg: string;
}

/** A page of the script that a button leads to. */
export interface MissionPage {
  text: string;
  buttons: MissionButton[];
}

export interface Mission {
  /** File name of the mission and of its map in `maps.json`. */
  id: string;
  title: string;
  /** Starting Storm Power of the human player in the original mission. */
  storm: number;
  enemy: string;
  /** Seconds between the computer opponent's moves (aiTimeBetweenMoves). */
  aiDelay: number;
  /** What the mission file says of each side, by player id; 1 is the human player. */
  sides: Record<string, MissionSide>;
  briefing: string;
  succeeded: string;
  failed: string;
  /** Sides whose Priest has to be brought to safety to win ("[Succeeded][Ai2PriestSaved]"). With
   * none, the mission is won when every enemy is defeated ("[Succeeded][BadTeamDead]"). */
  rescue: number[];
  /** Sides whose defeat loses the mission ("[Failed][Ai2PriestDead]"), besides the player's own. */
  wards: number[];
  /** `allowAnyCapture`: transports may pick up friendly Priests. */
  anyCapture: boolean;
  messages: MissionMessage[];
  /** Every page of the script by the name of its section in lower case, for buttons to lead to;
   * 'succeeded' and 'failed' are the pages of the two endings. */
  pages: Record<string, MissionPage>;
}

/** The side numbers in the events of one kind: "ai2priestsaved" gives 2 for "priestsaved". */
function sidesIn(events: unknown, kind: string): number[] {
  return (Array.isArray(events) ? events : []).flatMap((event) => {
    const side = new RegExp(`^ai(\\d+)${kind}$`).exec(String(event))?.[1];
    return side ? [Number(side)] : [];
  });
}

/**
 * How a mission stands for the player `me`: won, lost or still on. `saved` holds the sides whose
 * Priest has been brought to safety.
 */
export function outcome(
  mission: Pick<Mission, 'rescue' | 'wards'> | undefined,
  world: {
    winner: number | null;
    players: ReadonlyMap<number, { alive: boolean; }>;
    hostile: (a: number, b: number) => boolean;
  },
  me: number,
  saved: ReadonlySet<number>,
): 'won' | 'lost' | null {
  const fallen = [me, ...(mission?.wards ?? [])].some((id) =>
    world.players.get(id)?.alive === false
  );

  if (fallen) {
    return 'lost';
  }

  if (mission?.rescue.length) {
    return mission.rescue.every((id) => saved.has(id)) ? 'won' : null;
  }

  if (world.winner === null) {
    return null;
  }

  // Allies win together.
  return world.hostile(world.winner, me) ? 'lost' : 'won';
}

const PER_CENT = 100;

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
  'casttime',
  'effecttime',
  'spawns',
] as const;
/** The one type flag the simulation reads. */
const UNIT_FLAG = 'createsisland';

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

    if (
      Array.isArray(from.flags)
      && from.flags.some((flag) => String(flag).toLowerCase() === UNIT_FLAG)
    ) {
      slim.flags = [UNIT_FLAG];
    }

    // For the client: the .type files spell these in more than one way.
    for (const [field, wanted] of HOT_FOOT_FIELDS) {
      const value = Object.entries(from).find(([key]) => key.toLowerCase() === wanted)?.[1];

      if (typeof value === 'number') {
        slim[field] = value;
      }
    }

    return slim;
  });
}

const HOT_FOOT_FIELDS = [['hotFootRatioX', 'hotfootratiox'], [
  'hotFootRatioY',
  'hotfootratioy',
]] as const;

/**
 * Where the hot spot of each unit's pictures lies, as `hotFootRatioX` and `hotFootRatioY` of its
 * .type file: the share of a cell it stands in from the far (south-east) corner of the footprint,
 * across and up. Without them it is the corner itself. Read off the pictures: with this every
 * unit stands in the middle of its islet, without it a Generator stands half a cell to the east.
 */
export function hotFeet(raw: unknown): ReadonlyMap<string, readonly [number, number]> {
  const feet = new Map<string, readonly [number, number]>();

  for (const unit of Array.isArray(raw) ? raw : []) {
    const from = asRecord(unit);
    const ratio = HOT_FOOT_FIELDS.map(([, wanted]) =>
      Object.entries(from).find(([key]) => key.toLowerCase() === wanted)?.[1]
    );

    if (typeof from.id === 'string' && ratio.some((value) => typeof value === 'number')) {
      feet.set(from.id.toLowerCase(), [Number(ratio[0] ?? 0), Number(ratio[1] ?? 0)]);
    }
  }

  return feet;
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

const SIDES = 8;

/** A list like "sunWalker;rainBattery" or "2;3" of a mission header. */
function items(value: unknown): string[] | undefined {
  return typeof value === 'string' && value.trim()
    ? value.split(';').map((item) => item.trim()).filter(Boolean)
    : undefined;
}

/**
 * The sides of a mission. The header names the human player's settings `my…`, those every
 * computer side shares `ai…`, and those of side N `aiN…`; the case of the names varies.
 */
function sidesOf(header: Record<string, unknown>): Record<string, MissionSide> {
  const lower = Object.fromEntries(Object.entries(header).map(([k, v]) => [k.toLowerCase(), v]));
  const read = (prefix: string): MissionSide => {
    const tech = items(lower[`${prefix}tech`])?.map((type) => type.toLowerCase());
    const allies = items(lower[`${prefix}allylist`])?.map(Number).filter(Number.isInteger);
    const name = lower[`${prefix}name`];
    const storm = lower[`${prefix}startmoney`];
    // A value may carry a comment: "8    // One sun cannon per minute".
    const count = (key: string): number | undefined => {
      const value = Number.parseFloat(String(lower[`${prefix}${key}`] ?? ''));
      return Number.isFinite(value) ? value : undefined;
    };
    const denied = new Set(items(lower[`${prefix}ability`]) ?? []);
    const ai = {
      ...(denied.has('!COLLECT_STORM_POWER') ? { collect: false } : {}),
      ...(denied.has('!ATTACH_TO_ENEMY_ISLAND') ? { attack: false } : {}),
      ...(denied.has('!SACRIFICE_ENEMY_PRIEST') ? { capture: false } : {}),
      ...(denied.has('!CONCENTRATE_FIRE') ? { concentrate: false } : {}),
      ...(denied.has('!ENCIRCLE_ENEMY_ISLAND') ? { encircle: false } : {}),
      ...(denied.has('!STOP_COLLECTING_FROM_DANGEROUS_GEYSERS') ? { avoidDanger: false } : {}),
      ...(denied.has('!USE_PRIEST_TO_COLLECT') ? { priestCollects: false } : {}),
      ...(count('collectors') === undefined ? {} : { transports: count('collectors')! }),
      ...(count('geyserattachments') === undefined ? {} : { geysers: count('geyserattachments')! }),
      ...(count('enemy') === undefined ? {} : { enemy: count('enemy')! }),
      // `aiSalvageChance` is a percentage: the missions set 1 or 100.
      ...(count('salvagechance') === undefined
        ? {}
        : { salvageChance: count('salvagechance')! / PER_CENT }),
    };
    return {
      ...(typeof name === 'string' && name ? { name: name.split('\n')[0] } : {}),
      ...(storm === undefined ? {} : { storm: Number(storm) || 0 }),
      ...(tech ? { tech } : {}),
      ...(allies ? { allies } : {}),
      ...(count('moneyrechargerate') === undefined ? {} : { income: count('moneyrechargerate')! }),
      ...(count('timebetweenmoves') === undefined ? {} : { delay: count('timebetweenmoves')! }),
      ...(Object.keys(ai).length ? { ai } : {}),
    };
  };
  const shared = read('ai');
  const sides: Record<string, MissionSide> = { 1: { ...read('ai1'), ...read('my') } };
  delete sides[1]!.name; // the header calls him "Player"

  // What the computer is told belongs to the computer sides only.
  delete sides[1]!.ai;
  delete sides[1]!.income;

  for (let id = 2; id <= SIDES; id++) {
    const own = read(`ai${id}`);
    sides[id] = {
      ...shared,
      ...own,
      ...(shared.ai || own.ai ? { ai: { ...shared.ai, ...own.ai } } : {}),
    };
  }

  return sides;
}

/**
 * The mission files with their texts in another language laid over the English: the title, any
 * section the translation has, and the labels of the buttons. Keys and events stay as they are,
 * so the missions play the same. `translation` is data/missions.uk.json: by mission, its title,
 * its sections by name and its button labels by the English ones.
 */
export function translateMissions(raw: unknown, translation: unknown): unknown {
  const byId = asRecord(translation);
  return (Array.isArray(raw) ? raw : []).map((entry) => {
    const file = asRecord(entry);
    const ours = asRecord(byId[String(file.file)]);

    if (!Object.keys(ours).length) {
      return file;
    }

    const labels = asRecord(ours.buttons);
    const goals = asRecord(file.goals);
    const buttons = Object.fromEntries(
      Object.entries(asRecord(goals.buttons)).map(([name, list]) => [
        name,
        (Array.isArray(list) ? list : []).map((button) =>
          Array.isArray(button)
            ? [labels[String(button[0])] ?? button[0], ...button.slice(1)]
            : button
        ),
      ]),
    );
    return {
      ...file,
      header: {
        ...asRecord(file.header),
        ...(typeof ours.title === 'string' ? { title: ours.title } : {}),
        // The names of the sides (`aiName`, `ai2Name`…).
        ...asRecord(ours.names),
      },
      sections: { ...asRecord(file.sections), ...asRecord(ours.sections) },
      goals: { ...goals, buttons },
    };
  });
}

/** The missions of `others` in the order of `order`, by id: a translation lists them as the
 * original does, not by its own titles. */
export function inOrderOf(order: readonly Mission[], others: readonly Mission[]): Mission[] {
  const place = new Map(order.map((m, i) => [m.id, i]));
  return [...others].sort((a, b) => (place.get(a.id) ?? Infinity) - (place.get(b.id) ?? Infinity));
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
      sides: sidesOf(header),
      // "A1." is the second page of the briefing.
      briefing: [text(sections, 'A.'), text(sections, 'A1.')].filter(Boolean)
        .map((page) => reflow(withoutTitle(page, header.title as string))).join('\n\n'),
      messages: tells(asRecord(file.goals), sections),
      pages: pagesOf(asRecord(file.goals), sections),
      succeeded: reflow(text(sections, 'Succeeded') || text(sections, 'succeeded')),
      failed: reflow(text(sections, 'Failed')),
      rescue: sidesIn(asRecord(file.goals).win, 'priestsaved'),
      wards: sidesIn(asRecord(file.goals).lose, 'priestdead'),
      anyCapture: Number(header.allowAnyCapture) === 1,
    });
  }

  return missions.sort((a, b) => a.title.localeCompare(b.title));
}

const SECOND_TICKS = 10; // TPS of the simulation; not imported, the build config loads this file

/**
 * Whether an event of a mission's script has come. `captured` holds the sides whose Priest has
 * been carried off, `temples` those that had a Temple when the mission began.
 */
export function happened(
  event: string,
  world: {
    tick: number;
    templeOf: (player: number) => { hp: number; hpMax: number; } | undefined;
  },
  captured: ReadonlySet<number>,
  temples: ReadonlySet<number>,
): boolean {
  const timed = /^@(\d+)$/.exec(event);

  if (timed) {
    return world.tick >= Number(timed[1]) * SECOND_TICKS;
  }

  const [, id, what] = /^ai(\d+)(templedead|templehalf|priestcaptured)$/.exec(event) ?? [];
  const side = Number(id);
  const temple = world.templeOf(side);

  switch (what) {
    case 'templedead':
      return temples.has(side) && !temple;
    case 'templehalf':
      return temples.has(side) && (!temple || temple.hp * 2 <= temple.hpMax);
    case 'priestcaptured':
      return captured.has(side);
    default:
      return false;
  }
}

/** The messages of the script, as scripts/mission-goals.py lists them, with their texts. */
function tells(
  goals: Record<string, unknown>,
  sections: Record<string, unknown>,
): MissionMessage[] {
  return (Array.isArray(goals.tell) ? goals.tell : []).flatMap((entry) => {
    const { on, section } = asRecord(entry);
    const body = reflow(text(sections, String(section)));
    const buttons = buttonsOf(goals, String(section));
    return Array.isArray(on) && body ? [{ on: on.map(String), text: body, buttons }] : [];
  });
}

/** The buttons scripts/mission-goals.py lists for a section: label, action and argument. */
function buttonsOf(goals: Record<string, unknown>, section: string): MissionButton[] {
  const raw = asRecord(goals.buttons)[section];
  return (Array.isArray(raw) ? raw : []).flatMap((button) =>
    Array.isArray(button) && button.length >= 2
      ? [{ label: String(button[0]), action: String(button[1]), arg: String(button[2] ?? '') }]
      : []
  );
}

function pagesOf(
  goals: Record<string, unknown>,
  sections: Record<string, unknown>,
): Record<string, MissionPage> {
  const pages: Record<string, MissionPage> = {};

  for (const name of Object.keys(sections)) {
    const body = reflow(text(sections, name));

    if (body) {
      pages[name.toLowerCase()] = { text: body, buttons: buttonsOf(goals, name) };
    }
  }

  return pages;
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
