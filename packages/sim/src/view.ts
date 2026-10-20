import type { UnitDef, UnitGroup } from './defs.js';
import type { Building, Entity, Player, Priest, Shot } from './state.js';
import type { CommandError } from './commands.js';

export type DeepReadonly<T> = T extends Map<infer K, infer V> ? ReadonlyMap<K, DeepReadonly<V>>
  : T extends Set<infer V> ? ReadonlySet<DeepReadonly<V>>
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]>; }
  : T;

/** A compile-time boundary, not a security boundary or a copy of the world. */
export interface WorldView {
  readonly tick: number;
  readonly terrainRevision: number;
  readonly winner: number | null;
  readonly bridgeSet: number;
  readonly bridgeSlots: number;
  readonly unitRate: number;
  readonly killReward: number;
  readonly geyserStock: number;
  readonly anyCapture: boolean;
  readonly terrain: ArrayLike<number>;
  readonly owner: ArrayLike<number>;
  readonly links: ArrayLike<number>;
  readonly wear: ArrayLike<number>;
  readonly occupant: ArrayLike<number>;
  readonly entities: ReadonlyMap<number, DeepReadonly<Entity>>;
  /** Missiles on their way, in the order they were fired. */
  readonly shots: ReadonlyArray<DeepReadonly<Shot>>;
  readonly players: ReadonlyMap<number, DeepReadonly<Player>>;
  readonly defs: ReadonlyMap<string, Readonly<UnitDef>>;
  readonly inside: (x: number, y: number) => boolean;
  readonly at: (x: number, y: number) => number;
  readonly isOwnGround: (player: number, x: number, y: number) => boolean;
  readonly walkable: (player: number, x: number, y: number) => boolean;
  /** A geyser, an Obelisk or a standing Priest on the cell. */
  readonly takenBy: (x: number, y: number) => boolean;
  readonly residences: ReadonlyArray<readonly [number, number]>;
  /** Whether the cell lies under a Residence, where nothing can be built. */
  readonly residenceAt: (x: number, y: number) => boolean;
  readonly priestAt: (x: number, y: number) => DeepReadonly<Priest> | undefined;
  readonly joined: (x: number, y: number, dir: number) => boolean;
  readonly def: (type: string) => Readonly<UnitDef>;
  readonly findPath: (
    player: number,
    sx: number,
    sy: number,
    goal: (cell: [number, number]) => boolean,
    avoidOccupied?: boolean,
  ) => [number, number][] | null;
  readonly hostile: (a: number, b: number) => boolean;
  readonly priestOf: (player: number) => DeepReadonly<Priest> | undefined;
  readonly templeOf: (player: number) => DeepReadonly<Building> | undefined;
  readonly depotsOf: (player: number) => DeepReadonly<Building>[];
  readonly buildingsOf: (
    player: number,
    group?: UnitGroup,
  ) => ReadonlyArray<DeepReadonly<Building>>;
  /** `own` counts generators of the player's theme (and Sun); `total` counts all generators. */
  readonly energy: (player: number) => { own: number; total: number; };
  /** Why a piece from the hand cannot be laid at (x, y) with rotation `rot`, or null. */
  readonly canDropPiece: (command: {
    player: number;
    hand: number;
    x: number;
    y: number;
    rot: number;
  }) => CommandError | null;
  readonly canBuild: (command: {
    player: number;
    type: string;
    x: number;
    y: number;
    facing?: number;
  }) => CommandError | null;
}
