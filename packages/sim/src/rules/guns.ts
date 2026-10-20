/**
 * How long the guns of netstorm.game 10.82 take to turn and to fire (GunAnim.cpp). The simulation
 * times its shots by these, and the client draws the same frames from them, so the two agree.
 */

import { TPS } from '../state.js';

/* oxlint-disable no-magic-numbers -- tables and constants read from GunAnim.cpp */

/** Seconds a Sun Cannon takes over one frame of its turn. */
export const SUN_CANNON_STEP = 0.2;
/** The Sun Cannon's slot as built: its barrel lies flat, west to east. */
export const SUN_CANNON_FLAT = 16;
/** Its raised barrel by facing (north, east, south, west); its fire frame is that plus 24. */
export const SUN_CANNON_RAISED = [1, 3, 0, 2] as const;
export const SUN_CANNON_FIRE = 24;
const ARRIVED = -1;
/**
 * The next slot of a Sun Cannon's turn from each of its 28 slots, by the facing it turns to (the
 * table at 0x0060ad88): it lowers its barrel, swings it flat and raises it again.
 */
const SUN_CANNON_TURNS: readonly (readonly number[])[] = [
  [4, -1, 12, 19, 5, 6, 7, 8, 9, 10, 11, 1, 13, 14, 15, 16, 20, 16, 17, 18, 21, 8, 8, 22],
  [4, 11, 12, -1, 5, 6, 7, 8, 22, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19, 3, 16, 20, 23, 16],
  [-1, 11, 12, 19, 0, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 20, 16, 17, 18, 21, 8, 8, 22],
  [4, 11, -1, 19, 5, 6, 7, 8, 22, 8, 9, 10, 2, 12, 13, 14, 15, 16, 17, 18, 16, 20, 23, 16],
];

/** The slots a Sun Cannon's barrel passes through from `from` until it is raised to `facing`,
 * `from` first; one per SUN_CANNON_STEP. */
export function sunCannonTurn(from: number, facing: number): number[] {
  const path = [from];
  const row = SUN_CANNON_TURNS[facing]!;

  for (let at = from; path.length <= row.length;) {
    const next = row[at] ?? ARRIVED;

    if (next === ARRIVED) {
      break;
    }

    path.push(next);
    at = next;
  }

  return path;
}

/** The Disc Thrower's arm: a spring wound four turns and a bit, from GunAnim.cpp (FUN_0047cfb0). */
const ARM = {
  speed: 180, // degrees per second at the start
  spin: 180, // degrees per second, gained each second until it is sprung, then lost
  turns: 4, // whole turns before the throw
  early: 30, // the throw comes this many degrees before the bearing to the target
  sprung: 180, // degrees before the throw that it is sprung, and after it that it stays so
  slow: 180, // it may stop once it is no faster than this, in degrees per second
  rest: 270, // pointing south
  slack: 30, // within this many degrees of the rest
  frame: 1 / 30, // seconds of one game frame, over which the spring is run
  most: 30, // seconds, a bound no spin comes near
} as const;
/** Slots of the arm: 16 bearings wound up, then the same 16 flung out. */
export const ARM_SLOTS = 16;
/** The arm's slot as built: its base frame, on which no arm is drawn. */
export const ARM_BUILT = 32;

export interface Spin {
  /** Seconds from the start of the spin to the throw. */
  throw: number;
  /** Seconds the whole spin takes; the next one starts then. */
  end: number;
  /** The slot the arm is left on, which the next spin starts from. */
  rest: number;
}

/** The angle the arm starts a spin from, by its slot: 0 for the base frame of a new building. */
function startAngle(slot: number): number {
  return 360 - (360 / ARM_SLOTS) * (slot > ARM_SLOTS - 1 ? slot - ARM_SLOTS : slot);
}

/** The slot of the wound-up arm pointing at `angle`: 0 east, then clockwise. */
function armAt(angle: number): number {
  return Math.round(((360 - ((angle + 720) % 360)) * ARM_SLOTS) / 360) % ARM_SLOTS;
}

/**
 * Run the spring of a Disc Thrower whose arm starts on `slot`, throwing at a target `bearing`
 * degrees counter-clockwise from east, for `until` seconds or to its end. `at` is told the slot
 * shown at each frame.
 */
function run(slot: number, bearing: number, until: number, at?: (slot: number) => void): Spin {
  const release = bearing + ARM.turns * 360 - ARM.early;
  let angle = startAngle(slot);
  let speed: number = ARM.speed;
  let spin: number = ARM.spin;
  let thrown = -1;
  let t = 0;
  let shown = armAt(angle);

  for (; t < Math.min(until, ARM.most); t += ARM.frame) {
    angle += ARM.frame * speed;
    speed += ARM.frame * spin;

    if (angle >= release - ARM.sprung) {
      spin = -ARM.spin;
    }

    if (thrown < 0 && angle >= release) {
      thrown = t;
    }

    const sprung = angle >= release - ARM.sprung && angle < release + ARM.sprung;
    shown = sprung ? ARM_SLOTS + ((armAt(angle) + 2) % ARM_SLOTS) : armAt(angle);
    at?.(shown);

    if (
      thrown >= 0 && speed <= ARM.slow && Math.abs((angle % 360) - ARM.rest) < ARM.slack
    ) {
      break;
    }
  }

  return { throw: thrown < 0 ? t : thrown, end: t, rest: shown };
}

/** When a Disc Thrower whose arm is on `slot` throws at a target `bearing` degrees from east, and
 * when its spin ends. Between 5.2 and 8.2 s a spin, the throw 2.7 to 3.2 s in. */
export function discSpin(slot: number, bearing: number): Spin {
  return run(slot, bearing, Infinity);
}

/** The slot the arm shows `seconds` into a spin. */
export function armSlot(slot: number, bearing: number, seconds: number): number {
  let shown = armAt(startAngle(slot));
  run(slot, bearing, seconds, (s) => {
    shown = s;
  });
  return shown;
}

/** Degrees counter-clockwise from east from one point of the board to another (y grows south). */
export function bearingTo(fromX: number, fromY: number, toX: number, toY: number): number {
  return ((Math.atan2(fromY - toY, toX - fromX) * 180) / Math.PI + 360) % 360;
}

/** Degrees clockwise from north from one point of the board to another. */
export function compassTo(fromX: number, fromY: number, toX: number, toY: number): number {
  return (450 - bearingTo(fromX, fromY, toX, toY)) % 360;
}

/**
 * The Crossbow's twenty bearings, degrees clockwise from north (the table at 0x0060b178): uneven,
 * five frames of a shot to each, a facing every fifth. It turns one bearing per 0.1 s.
 */
export const CROSSBOW_BEARINGS = [
  0,
  21,
  35,
  52,
  71,
  86,
  97,
  115,
  121,
  148,
  180,
  205,
  237,
  256,
  272,
  282,
  291,
  314,
  328,
  345,
] as const;
export const CROSSBOW_PER_FACING = 5;
export const CROSSBOW_STEP = 0.1;

/** The Crossbow's bearing nearest a compass way. */
export function crossbowBearing(compass: number): number {
  const off = (degrees: number) => {
    const d = Math.abs(compass - degrees) % 360;
    return Math.min(d, 360 - d);
  };
  let best = 0;

  for (const [i, degrees] of CROSSBOW_BEARINGS.entries()) {
    if (off(degrees) < off(CROSSBOW_BEARINGS[best]!)) {
      best = i;
    }
  }

  return best;
}

/** Steps the shorter way round a ring of `size` from one place to another. */
export function ringSteps(from: number, to: number, size: number): number {
  const ahead = (((to - from) % size) + size) % size;
  return Math.min(ahead, size - ahead);
}

/**
 * The Ice Cannon fires in bursts: for 4 s a shot every 0.24 s, the first 0.08 s in, then 6 s of
 * rest, while its frames go on cycling (GunAnim.cpp, FUN_0047ef80). Seventeen shots a burst.
 */
export const ICE_CANNON = { burst: 4, rest: 6, first: 0.08, every: 0.24 } as const;

/** The tick of a burst the `k`-th shot of an Ice Cannon falls on. */
export function iceShotTick(k: number): number {
  return Math.ceil(Math.round((ICE_CANNON.first + ICE_CANNON.every * k) * TPS * 1e6) / 1e6);
}

/** The Thunder Cannon charges for 3.5 s and fires; 0.125 s later it is back at rest. */
export const THUNDER_CANNON = { release: 3.5, cycle: 3.625, frame: 0.5 } as const;
