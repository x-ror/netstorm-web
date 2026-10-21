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

/** A button under a text of the script: `Tell` shows the page named by `arg`, `DoNothing` goes on
 * with the battle, `MissionBegin` starts the mission named by `arg`, `MissionRestart` plays this
 * one again, `MissionAbort` asks to leave (`0`) or leaves (`1`), `LeaveBattle` leaves. */
export interface MissionButton {
  label: string;
  action: string;
  arg: string;
}

/** A page of the script: a section of the mission file. */
export interface MissionPage {
  text: string;
  buttons: MissionButton[];
  /** It holds `<$Config,Done{mission.fileName}=1>`: showing it completes the mission. */
  done?: boolean;
  /** `$Timeout`: the button pressed by itself after so many seconds of real time. */
  timeout?: { seconds: number; button: MissionButton; };
}

export interface Mission {
  /** File name of the mission. */
  id: string;
  /** The map it is played on, in `maps.json`: its own, or the one its `loadFort` names, as the
   * Easy and Hard files share the map of the Normal one. */
  map: string;
  title: string;
  /** Starting Storm Power of the human player in the original mission. */
  storm: number;
  enemy: string;
  /** Seconds between the computer opponent's moves (aiTimeBetweenMoves). */
  aiDelay: number;
  /** What the mission file says of each side, by player id; 1 is the human player. */
  sides: Record<string, MissionSide>;
  briefing: string;
  /** `allowAnyCapture`: transports may pick up friendly Priests. */
  anyCapture: boolean;
  /** `moreGeysers`: new geysers come up every 30 s. */
  moreGeysers: boolean;
  /**
   * The pages of the script by every name on the line of their section, in lower case: the
   * section's own and the events that bring it up ("succeeded" and "badteamdead" are one page),
   * matched whole, as the original's FUN_0044a180 does.
   */
  pages: Record<string, MissionPage>;
  /** The pages "[@N]" in the file's order: N seconds into the mission. */
  timed: { at: number; page: string; }[];
  /** `[Init]`'s `<$ViewSpot,(XxY)>`: the cell the view starts on. */
  view?: [number, number];
}

/** How a skirmish stands for the player `me`: won, lost or still on. A mission has no verdict
 * of its own: the pages its events bring up decide what comes next. */
export function outcome(
  world: {
    winner: number | null;
    players: ReadonlyMap<number, { alive: boolean; }>;
    hostile: (a: number, b: number) => boolean;
  },
  me: number,
): 'won' | 'lost' | null {
  if (world.players.get(me)?.alive === false) {
    return 'lost';
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
  'damageEffect',
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
  return Object.fromEntries(missions.flatMap((m) => maps[m.map] ? [[m.map, maps[m.map]!]] : []));
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
    // The Easy and Hard files tell what the Normal one does.
    const ours = asRecord(
      byId[String(file.file)] ?? byId[String(file.file).replace(/(easy|hard)$/, '')],
    );

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

/** A chapter of the campaign at one difficulty: an `offical*.english` file of the original. */
export interface Chapter {
  /** The file, `offical31` for instance. */
  id: string;
  /** Its title, the difficulty left out: "Struggle For Freedom". */
  name: string;
  difficulty: 'easy' | 'normal' | 'hard';
  /** The text of its Overview page. */
  text: string;
  /** Its missions in order, each with the mission completed before it can be played (its
   * `$Checked` line's last field, `{DoneTheWarBegins}`), or null for none. */
  missions: { id: string; after: string | null; }[];
}

/**
 * The campaign as the original's Campaign menu lists it (tell.english [UCampaign], FUN_00507ee0):
 * the `offical*` files in the order of their names, each a chapter at one difficulty with an
 * Overview whose `$Checked=label,MissionBegin,File,{DoneFile},{DonePrevious}` lines are its
 * missions. The tutorials and the boot camp are left out.
 */
export function campaignOf(raw: unknown): Chapter[] {
  const chapters: Chapter[] = [];
  const files = (Array.isArray(raw) ? raw : []).map(asRecord)
    .filter((file) => /^offical\d+$/.test(String(file.file)))
    .sort((a, b) => String(a.file).localeCompare(String(b.file)));

  for (const file of files) {
    const title = String(asRecord(file.header).title ?? '');
    const level = /^(.*?)\s*\((Easy|Normal|Hard)\)$/.exec(title);
    const overview = text(asRecord(file.sections), 'Overview');
    const missions = [...overview.matchAll(/^\$Checked=[^,]*,MissionBegin,([^,]+),[^,]*,(.*)$/gm)]
      .map(([, id, after]) => ({
        id: id!.trim().toLowerCase(),
        after: /\{Done(.+)\}/i.exec(after ?? '')?.[1]?.toLowerCase() ?? null,
      }));

    if (!level || !missions.length) {
      continue;
    }

    chapters.push({
      id: String(file.file),
      name: level[1]!,
      difficulty: level[2]!.toLowerCase() as Chapter['difficulty'],
      text: reflow(overview.split('\n').filter((line) => !/^\s*[{$]/.test(line)).join('\n').trim()),
      missions,
    });
  }

  return chapters;
}

/** The missions of `others` in the order of `order`, by id: a translation lists them as the
 * original does, not by its own titles. */
export function inOrderOf(order: readonly Mission[], others: readonly Mission[]): Mission[] {
  const place = new Map(order.map((m, i) => [m.id, i]));
  return [...others].sort((a, b) => (place.get(a.id) ?? Infinity) - (place.get(b.id) ?? Infinity));
}

/** The campaign missions, Easy, Normal and Hard, that have a map, with their scripts. */
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
    const map = typeof header.loadFort === 'string' ? header.loadFort.toLowerCase() : id;

    if (!maps[map] || header.missionType !== 'Tutorial' || typeof header.title !== 'string') {
      continue;
    }

    const goals = asRecord(file.goals);
    missions.push({
      id,
      map,
      title: header.title,
      storm: Number(header.myStartMoney) || 0,
      enemy: typeof header.aiName === 'string' ? header.aiName : '',
      aiDelay: Number(header.aiTimeBetweenMoves) || DEFAULT_AI_DELAY,
      sides: sidesOf(header),
      // "A1." is the second page of the briefing.
      briefing: [text(sections, 'A.'), text(sections, 'A1.')].filter(Boolean)
        .map((page) => reflow(withoutTitle(page, header.title as string))).join('\n\n'),
      anyCapture: Number(header.allowAnyCapture) === 1,
      moreGeysers: Number(header.moreGeysers) === 1,
      ...scriptOf(goals, sections),
    });
  }

  return missions;
}

/** The sections of a script as scripts/mission-goals.py lists them, made pages. */
function scriptOf(
  goals: Record<string, unknown>,
  sections: Record<string, unknown>,
): Pick<Mission, 'pages' | 'timed' | 'view'> {
  const pages: Record<string, MissionPage> = {};
  const timed: Mission['timed'] = [];
  let view: [number, number] | undefined;
  const listed = Array.isArray(goals.sections) ? goals.sections.map(asRecord) : [];

  for (const section of listed) {
    const names = Array.isArray(section.names) ? section.names.map(String) : [];
    const first = Object.keys(sections).find((name) => name.toLowerCase() === names[0]);
    const commands = Array.isArray(section.commands)
      ? section.commands.map((c) => (Array.isArray(c) ? c.map(String) : []))
      : [];
    // "<$ViewSpot,(139x88)>" of [Init]: the cell the view starts on.
    const spot = commands.find(([name]) => name?.toLowerCase() === 'viewspot');
    const cell = /\((\d+)x(\d+)\)/.exec(spot?.[1] ?? '');

    if (cell) {
      view = [Number(cell[1]), Number(cell[2])];
    }

    const body = first ? reflow(text(sections, first)) : '';

    if (!first || !body) {
      continue;
    }

    const timeout = Array.isArray(section.timeout) ? section.timeout.map(String) : [];
    const page: MissionPage = {
      text: body,
      buttons: buttonsOf(goals, first),
      ...(commands.some(([name, arg]) =>
          name?.toLowerCase() === 'config' && /^Done/i.test(arg ?? '')
        )
        ? { done: true }
        : {}),
      ...(timeout.length >= 2
        ? {
          timeout: {
            seconds: Number(timeout[0]),
            button: { label: '', action: timeout[1]!, arg: timeout[2] ?? '' },
          },
        }
        : {}),
    };

    for (const name of names) {
      pages[name] ??= page;
      const at = /^@(\d+)$/.exec(name);

      if (at) {
        timed.push({ at: Number(at[1]), page: name });
      }
    }
  }

  return { pages, timed, ...(view ? { view } : {}) };
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
