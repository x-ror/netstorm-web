/** Unit definitions, loaded from data/units.json (parsed from the original .type files). */

export type Theme = 'sun' | 'wind' | 'rain' | 'thunder';

/** Original class names as they appear in the .type files, including the "Offsensive" typo. */
export const UNIT_CLASSES = [
  '',
  'Aerial Attack',
  'Aerial Transport',
  'Air Attack Base',
  'Altar',
  'Anti-Air',
  'Bridge',
  'Defense',
  'Defensive Spell',
  'Energy',
  'Ground Transport',
  'High Priest',
  'Offensive Spell',
  'Offsensive Spell',
  'Production',
  'Residence',
  'Shooter',
  'Source of Energy',
  'Source of Storm Power',
  'Spell',
  'Summons Spell',
  'World Event',
] as const;
export type UnitClass = (typeof UNIT_CLASSES)[number];

export const UNIT_GROUPS = [
  '',
  'anti-air',
  'archer',
  'aviary',
  'balloon',
  'battery',
  'blocker',
  'cannon',
  'fence',
  'walker',
] as const;
export type UnitGroup = (typeof UNIT_GROUPS)[number];

export interface UnitDef {
  id: string; // original type name, e.g. "suncannon"
  name: string; // description, e.g. "Sun Cannon"
  cls: UnitClass;
  theme: Theme | null;
  level: number; // 1..3, 0 = not researchable
  cost: number; // Storm Power
  hp: number;
  range: number; // cells
  dps: number; // hpPerSec
  footX: number;
  footY: number;
  speed: number; // cells per second (transports)
  group: UnitGroup;
  delay: number; // delayBetweenShots (s)
  lifeSpan: number; // s, aerial attackers
  airRange: number; // cells, reach against air units; 0 = the same as `range`
  airDamage: number; // damage of one hit on an air unit; 0 = the usual damage
}

export type DefTable = Map<string, UnitDef>;

/** Values the game shows on a unit's card but its .type file leaves out. See docs/game-rules.md. */
const SHOWN_IN_GAME: Readonly<Record<string, { cost: number; }>> = {
  sunwalker: { cost: 400 }, // Golem: no cost in sunwalker.type, "Cost in Storm Power: 400" in the game
};

export function loadDefs(raw: unknown): DefTable {
  if (!Array.isArray(raw)) {
    throw new TypeError('Unit definitions must be an array');
  }

  const t: DefTable = new Map();

  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Invalid unit definition');
    }

    const r = value as Record<string, unknown>;

    if (typeof r.id !== 'string' || !r.id.trim()) {
      throw new TypeError('Unit definition needs an id');
    }

    const id = r.id.toLowerCase();
    // Original extraction contains repeated ids. Later definitions override earlier ones.
    const theme = typeof r.theme === 'string' ? r.theme.toLowerCase() : null;
    t.set(id, {
      id,
      name: str(r.description, id),
      cls: oneOf(r.class, UNIT_CLASSES, 'class'),
      theme: (['sun', 'wind', 'rain', 'thunder'].includes(theme ?? '')
        ? theme
        : null) as Theme | null,
      level: num(r.level),
      cost: r.cost === undefined && SHOWN_IN_GAME[id] ? SHOWN_IN_GAME[id].cost : num(r.cost),
      hp: num(r.maxHitPoints),
      range: num(r.range),
      dps: num(r.hpPerSec),
      footX: num(r.foot_x, 1),
      footY: num(r.foot_y, 1),
      speed: num(r.speed),
      group: oneOf(r.group, UNIT_GROUPS, 'group'),
      delay: num(r.delayBetweenShots),
      lifeSpan: num(r.lifeSpan),
      airRange: num(r.airrange),
      airDamage: num(r.useairdamage) ? num(r.airdamage) : 0,
    });
  }

  return t;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function oneOf<const T extends readonly string[]>(
  v: unknown,
  options: T,
  label: string,
): T[number] {
  const value = str(v);

  if (!options.includes(value)) {
    throw new TypeError(`Unknown unit ${label}: ${value}`);
  }

  return value;
}

function num(v: unknown, fallback = 0): number {
  if (v === undefined) {
    return fallback;
  }

  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new TypeError('Unit values must be finite non-negative numbers');
  }

  return v;
}
