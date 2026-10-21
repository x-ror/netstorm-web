/**
 * The events a mission's script answers, as the original raises them (TutorialMission,
 * FUN_004f9070 of netstorm.game 10.82): for each side, its Temple at half or gone, its Priest dead,
 * captured or brought to safety; then no friend left, no enemy left, and the player's own Priest
 * dead. Each comes once in a mission, and only while no page of the script is open. A mission
 * file shows the section that names the event, if it has one; it never ends by itself.
 */
import type { DeepReadonly, Player, Priest, WorldView } from '@netstorm/sim';

export type MissionWorld = Pick<
  WorldView,
  'players' | 'templeOf' | 'priestOf' | 'hostile' | 'owner' | 'at'
>;

/** The next event that has come and not yet been raised, marked raised; null when none has. */
export function nextEvent(world: MissionWorld, me: number, raised: Set<string>): string | null {
  const players = [...world.players.values()].sort((a, b) => a.id - b.id);

  for (const player of players) {
    for (const [name, came] of SIDE_EVENTS) {
      const event = `ai${player.id}${name}`;

      if (!raised.has(event) && came(world, player, me)) {
        raised.add(event);
        return event;
      }
    }
  }

  // Those still standing: an enemy unless allied both ways (ours are: alliances are mutual).
  const standing = players.filter((p) => p.alive);
  const teams: [string, boolean][] = [
    ['goodteamdead', !standing.some((p) => !world.hostile(p.id, me))],
    ['badteamdead', !standing.some((p) => world.hostile(p.id, me))],
    ['failed', world.players.get(me)?.alive === false],
  ];

  for (const [event, came] of teams) {
    if (!raised.has(event) && came) {
      raised.add(event);
      return event;
    }
  }

  return null;
}

type Came = (world: MissionWorld, player: DeepReadonly<Player>, me: number) => boolean;

const priestOf = (world: MissionWorld, player: DeepReadonly<Player>) =>
  world.priestOf(player.id) as DeepReadonly<Priest> | undefined;

/** In the original's order. A side with no Temple has lost it, and half of it, from the start. */
const SIDE_EVENTS: readonly (readonly [string, Came])[] = [
  ['templehalfdead', (world, p) => {
    const temple = world.templeOf(p.id);
    return !temple || temple.hp * 2 < temple.hpMax;
  }],
  ['templedead', (world, p) => !world.templeOf(p.id)],
  ['priestdead', (_, p) => !p.alive],
  ['priestcaptured', (world, p) => {
    const state = priestOf(world, p)?.state;
    return state === 'carried' || state === 'chained';
  }],
  // Its Priest stands on ground of the player's.
  ['priestsaved', (world, p, me) => {
    const priest = priestOf(world, p);
    return priest !== undefined && world.owner[world.at(priest.x, priest.y)] === me;
  }],
];
