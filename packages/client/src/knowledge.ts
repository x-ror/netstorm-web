/**
 * The Knowledge a mission gives the player: the units he can build in it, as the original's
 * "Review Knowledge" shows them before the battle. A mission names them in its header (`myTech`);
 * one that names none gives what a skirmish does for the chosen Fury.
 */
import { skirmishTech, type DefTable, type Theme, type UnitDef } from '@netstorm/sim';
import type { Mission } from './game-data.js';

/** The classes of the units' .type files, as the panels name them. */
const CLASSES: Readonly<Record<string, string>> = {
  'Shooter': 'Стрілець',
  'Defense': 'Захист',
  'Anti-Air': 'Протиповітряний',
  'Source of Energy': 'Генератор',
  'Air Attack Base': 'База літунів',
  'Production': 'Майстерня',
  'Energy': 'Храм',
  'Altar': 'Вівтар',
  'Ground Transport': 'Транспорт',
  'Aerial Transport': 'Повітряний транспорт',
  'Aerial Attack': 'Літун',
};

export interface KnownUnit {
  def: Readonly<UnitDef>;
  /** Its class in Ukrainian, or as the .type file names it. */
  kind: string;
}

/** The units a mission lets the player build, lowest level first, cheapest first within it. */
export function knowledgeOf(
  defs: DefTable,
  mission: Mission | undefined,
  theme: Theme,
): KnownUnit[] {
  const ids = mission?.sides[1]?.tech ?? skirmishTech(defs, theme);
  return ids.flatMap((id) => {
    const def = defs.get(id);
    return def ? [{ def, kind: CLASSES[def.cls] ?? def.cls }] : [];
  }).sort((a, b) => a.def.level - b.def.level || a.def.cost - b.def.cost);
}
