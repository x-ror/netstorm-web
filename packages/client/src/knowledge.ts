/**
 * The Knowledge a mission gives the player: the units he can build in it, as the original's
 * "Review Knowledge" shows them before the battle. A mission names them in its header (`myTech`);
 * one that names none gives what a skirmish does for the chosen Fury.
 */
import { skirmishTech, type DefTable, type Theme, type UnitDef } from '@netstorm/sim';
import type { Mission } from './game-data.js';
import { m } from './paraglide/messages.js';

/** The classes of the units' .type files, as the panels name them. */
const CLASSES: Readonly<Record<string, () => string>> = {
  'Shooter': m.class_shooter,
  'Defense': m.class_defense,
  'Anti-Air': m.class_anti_air,
  'Source of Energy': m.class_source_of_energy,
  'Air Attack Base': m.class_air_attack_base,
  'Production': m.class_production,
  'Energy': m.class_energy,
  'Altar': m.class_altar,
  'Ground Transport': m.class_ground_transport,
  'Aerial Transport': m.class_aerial_transport,
  'Aerial Attack': m.class_aerial_attack,
};

export interface KnownUnit {
  def: Readonly<UnitDef>;
  /** Its class in the player's language, or as the .type file names it. */
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
    return def ? [{ def, kind: CLASSES[def.cls]?.() ?? def.cls }] : [];
  }).sort((a, b) => a.def.level - b.def.level || a.def.cost - b.def.cost);
}
