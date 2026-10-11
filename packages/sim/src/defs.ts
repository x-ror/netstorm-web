/** Unit definitions, loaded from data/units.json (parsed from the original .type files). */

export type Theme = 'sun' | 'wind' | 'rain' | 'thunder';

export interface UnitDef {
  id: string;            // original type name, e.g. "suncannon"
  name: string;          // description, e.g. "Sun Cannon"
  cls: string;           // original class: Shooter, Defense, Ground Transport, ...
  theme: Theme | null;
  level: number;         // 1..3, 0 = not researchable
  cost: number;          // Storm Power
  hp: number;
  range: number;         // cells
  dps: number;           // hpPerSec
  footX: number;
  footY: number;
  speed: number;         // cells per second (transports)
  group: string;         // cannon | archer | blocker | fence | aviary | battery | walker | balloon | anti-air | ''
  delay: number;         // delayBetweenShots (s)
  lifeSpan: number;      // s, aerial attackers
}

export type DefTable = Map<string, UnitDef>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadDefs(raw: any[]): DefTable {
  const t: DefTable = new Map();
  for (const r of raw) {
    const id = String(r.id).toLowerCase();
    const theme = typeof r.theme === 'string' ? r.theme.toLowerCase() : null;
    t.set(id, {
      id, name: r.description ?? id, cls: r.class ?? '',
      theme: (['sun', 'wind', 'rain', 'thunder'].includes(theme ?? '') ? theme : null) as Theme | null,
      level: num(r.level), cost: num(r.cost), hp: num(r.maxHitPoints), range: num(r.range), dps: num(r.hpPerSec),
      footX: num(r.foot_x, 1), footY: num(r.foot_y, 1), speed: num(r.speed), group: r.group ?? '',
      delay: num(r.delayBetweenShots), lifeSpan: num(r.lifeSpan),
    });
  }
  return t;
}

function num(v: unknown, d = 0): number { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

/** Energy a unit needs to be built: level 1 → 1 of own theme; level 2 → +1 any; level 3 → 2 own + 1 any. */
export function energyNeed(def: UnitDef): { own: number; any: number } {
  if (def.level <= 1) return { own: 1, any: 0 };
  if (def.level === 2) return { own: 1, any: 1 };
  return { own: 2, any: 1 };
}
