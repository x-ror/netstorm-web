/**
 * Check every unit definition the simulation uses against the original's .type files.
 *
 * It reads original/extracted/d/*.type with its own parser, as RiftType.cpp in netstorm.game does
 * (numbers that the game truncates to integers are truncated here), and compares three layers:
 * the .type file, data/units.json made from it, and the UnitDef that loadDefs gives the
 * simulation. Then it prints what the simulation derives for every shooter: the time between
 * shots and the damage of one hit.
 *
 * Usage: npx tsx scripts/audit-types.ts [original/extracted/d]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadDefs, shotInterval, TPS, type UnitDef } from '../packages/sim/src/index.js';

const dir = process.argv[2] ?? 'original/extracted/d';
const raw: Record<string, unknown>[] = JSON.parse(readFileSync('data/units.json', 'utf8'));
const defs = loadDefs(raw);

type Fields = Map<string, string>;

/** typename, typeflags and the `key = value;` pairs of a .type file's block, in file order. */
function parseType(text: string): { name: string; fields: Fields; repeated: string[]; } {
  const name = /^\s*typename\s+(\S+)/m.exec(text)?.[1] ?? '';
  const block = /\{([\s\S]*?)\n\s*\}/.exec(text)?.[1] ?? '';
  const fields: Fields = new Map();
  const repeated: string[] = [];

  for (const line of block.replace(/\/\/[^\n]*/g, '').split(';')) {
    const m = /^\s*(\w+)\s*=\s*(.+?)\s*$/s.exec(line);

    if (!m) {
      continue;
    }

    const key = m[1]!.toLowerCase();

    if (fields.has(key)) {
      repeated.push(key);
    }

    fields.set(key, m[2]!.replace(/^"|"$/g, ''));
  }

  return { name, fields, repeated };
}

const num = (v: string | undefined, fallback = 0) => (v === undefined ? fallback : Number(v));
const int = (v: string | undefined, fallback = 0) => Math.trunc(num(v, fallback));

/** What the original keeps of each field the simulation uses, from the .type text. */
function expected(f: Fields): Partial<Record<keyof UnitDef, number | string | null>> {
  return {
    hp: int(f.get('maxhitpoints')),
    range: num(f.get('range')),
    dps: num(f.get('hppersec')),
    cost: num(f.get('cost')),
    footX: int(f.get('foot_x') ?? f.get('footx'), 1),
    footY: int(f.get('foot_y') ?? f.get('footy'), 1),
    speed: num(f.get('speed')),
    delay: num(f.get('delaybetweenshots')),
    lifeSpan: int(f.get('lifespan')),
    airRange: int(f.get('airrange')),
    // Missile.cpp: the air damage counts only where `useairdamage` is set.
    airDamage: int(f.get('useairdamage')) ? num(f.get('airdamage')) : 0,
    level: int(f.get('level')),
    castTime: int(f.get('casttime')),
    prayTime: int(f.get('praytime')),
    effectTime: int(f.get('effecttime')),
    spawns: int(f.get('spawns')),
    group: f.get('group') ?? '',
    cls: f.get('class') ?? '',
    theme: f.get('theme')?.toLowerCase() ?? null,
  };
}

const problems: string[] = [];
const seen = new Map<string, string>();

for (const file of readdirSync(dir).filter((n) => n.endsWith('.type')).sort()) {
  const { name, fields, repeated } = parseType(readFileSync(join(dir, file), 'utf8'));
  const id = name.toLowerCase();

  if (repeated.length) {
    problems.push(
      `${file}: repeated ${repeated.join(', ')} (RiftType.cpp asserts on a second maxHitPoints)`,
    );
  }

  if (seen.has(id)) {
    problems.push(`${file}: typename ${name} also in ${seen.get(id)}; units.json keeps the later`);
  }

  seen.set(id, file);
  const def = defs.get(id);

  if (!def) {
    problems.push(`${file}: ${name} missing from the simulation's definitions`);
    continue;
  }

  for (const [key, want] of Object.entries(expected(fields))) {
    let have = def[key as keyof UnitDef] as unknown;

    // The sim knows only the themes and classes it uses; the rest it reads as none.
    if (
      key === 'theme' && want !== null
      && !['sun', 'wind', 'rain', 'thunder'].includes(want as string)
    ) {
      continue;
    }

    if (key === 'cls' && have === '' && want !== '') {
      have = '(unknown class)';
    }

    if (
      typeof want === 'number' && typeof have === 'number'
        ? Math.abs(want - have) > 1e-9
        : want !== have
    ) {
      problems.push(`${file}: ${key} — .type ${JSON.stringify(want)}, sim ${JSON.stringify(have)}`);
    }
  }
}

console.log('## Mismatches between .type and the simulation\n');
console.log(problems.length ? problems.map((p) => `- ${p}`).join('\n') : 'none');

// The groups whose hit is the damage rate times the time since the previous hit (Missile.cpp);
// every other group deals 0.6 of the rate per hit.
const BY_TIME = new Set(['archer', 'cannon']);
const FLAT = 0.6;
console.log('\n## What the simulation derives for every shooter\n');
console.log(
  '| type | name | hp | cost | range | hpPerSec | delay s | interval s | hit | air range | air hit |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|');

// Barricades strike in pulses (rules/fences.ts) and flyers in their own rhythm (rules/flyers.ts).
for (
  const def of [...defs.values()].filter((d) =>
    d.dps > 0 && d.cls !== 'Aerial Attack' && d.group !== 'fence'
  )
    .sort((a, b) => a.id.localeCompare(b.id))
) {
  const interval = shotInterval(def) / TPS;
  const hit = BY_TIME.has(def.group) ? def.dps * interval : def.dps * FLAT;
  console.log(
    `| ${def.id} | ${def.name} | ${def.hp} | ${def.cost} | ${def.range} | ${def.dps} | ${def.delay} | ${interval} | ${+hit
      .toFixed(2)} | ${def.airRange || '—'} | ${def.airDamage || '—'} |`,
  );
}
