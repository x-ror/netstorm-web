import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import {
  type WorldView,
  type DeepReadonly,
  type Entity,
  Terrain,
  W,
  H,
  isBridge,
  GEYSER_ISLAND_SIZE,
  TPS,
  barriers,
  FLYER_SCALE,
  DIRS,
  ENERGY_RANGE,
  makerOf,
  oppositeDir,
  type Building,
  stepShare,
  BUILD_SECONDS,
  RESIDENCE_FOOT,
  SUN_CANNON_FIRE,
  UPGRADE_SECONDS,
} from '@netstorm/sim';
import {
  FACING_FRAMES,
  GROUND_FRAMES,
  SKY,
  bridgeSlot,
  fringeSlot,
  shoreFrame,
} from './texture-selection.js';
import { project, TW, TH } from './projection.js';
import { FARM_SLOTS } from './farm-slots.js';
import {
  MANA_BOLTS,
  SACRIFICE,
  discOnArm,
  iceCannonSlot,
  shotFrame,
  overlayOf,
  shadowOf,
  flyerSlot,
  slotOf,
  type Gun,
} from './animations.js';
import {
  MISSILES,
  SPELL_BURSTS,
  FIELD_PUFF,
  alongBarrel,
  nearSide,
  SHELL_BURST,
  explosionFor,
  impactOf,
  missileSlot,
  missileSpeed,
  type Burst,
} from './effects.js';
import { hotSpots } from './assets.js';
import { unitSound, type Sounds } from './sound.js';
import {
  easeOut,
  firstEmission,
  PresentationTime,
  progress,
  VisualStates,
} from './presentation.js';
import { StreamBatch } from './stream-batch.js';
import { anchorsOf, burn, pixelsOf, rise, sparkColour, streaksOf, type Spark } from './burning.js';
import { Growth } from './growth.js';
import { blow, makeSmoke, puffColour, type Smoke } from './smoke.js';
import {
  BOLT_LIFE,
  SPELL_BOLT_LIFE,
  boltLines,
  makeBolt,
  tremble,
  type Bolt,
} from './lightning.js';
import { PIECE, crumble, scatter, shatter, type Piece } from './shrapnel.js';
import { MUZZLES } from './muzzles.js';

const SPRITE_ANCHOR_X = 0.5;
/** The frame groups of residence.type: six frames for each of Sun, Thunder, Wind and Rain. */
const RESIDENCE_FURIES = ['sun', 'thunder', 'wind', 'rain'] as const;
const RESIDENCE_FRAMES = 6;
const UNIT_ANCHOR_Y = 0.85; // a unit's feet sit a little above the bottom of its frame
const STRENGTHS: Readonly<Record<number, 'whole' | 'cracked' | 'hard'>> = {
  [Terrain.HardBridge]: 'hard',
  [Terrain.CrackedBridge]: 'cracked',
};
const BRIDGE_DROP = 9; // from the top of a cell down to the hot spot of its Bridge frame
// The ground a bridge lands on hangs two rows lower: so its rails run on from the bridge's (fitted
// to the pictures, ours).
const LANDING_DROP = BRIDGE_DROP + 2;
const FRINGE_DROP = 44; // from the top of a rim cell down to the hot spot of its Fringe
const FRINGE_SCATTER = 3;
const CLIFF_HEIGHT = 6; // rock face drawn under an island's southern rim
const SCATTER_X = 7;
const SCATTER_Y = 13;
const BAR_GAP = 2; // pixels between a sprite's top and its health bar
/** The white core of a bolt and its pale-cyan edge (palette 0xc3 and 0x55 of the original). */
const BOLT_CORE = 0xffffff;
const BOLT_EDGE = 0x81c0b9;
const ICE_IMPACTS = 4;
/** A Whirligig's bomb falls four rows of the board (flyer.cpp: `y + 9t² + 10t` to `y + 4`). */
const BOMB_ROWS = 4;
const BOMB_DROP = BOMB_ROWS * TH;
const SKY_BOLT = 150; // pixels up from which a Thunder Strike falls
const TRACER_LIFT = 0.6; // share of a shooter's sprite height its shots leave from
const MARKER_RADIUS = 4;
const CELL_CENTER = 0.5;
const MIN_ALPHA = 0.5; // alpha of an entity at zero hp
const BAR_WIDTH = 14;
const BAR_HEIGHT = 2;
const COLOR = {
  bridge: 0x8a8f99,
  crackedBridge: 0x5a5148,
  hardBridge: 0xb9c2d0,
  ownLand: 0x5c7a3a,
  enemyLand: 0x7a3a3a,
  neutralLand: 0x6b5a3a,
  buildingMarker: 0xffd166,
  unitMarker: 0x66ccff,
  enemyPriestTint: 0xff9999,
  enemyBuildingTint: 0xffb0b0,
  noTint: 0xffffff,
  shadow: 0x000000,
  cliff: 0x3a2a1c,
  barBack: 0x1b1f2a,
  barGood: 0x7bd36b,
  barLow: 0xff5a4a,
  tracer: 0xfff2b0,
  stream: 0xbfe9ff,
} as const;
const SIDES: ReadonlyArray<readonly [number, number, number]> = [
  [SKY.north, 0, -1],
  [SKY.east, 1, 0],
  [SKY.south, 0, 1],
  [SKY.west, -1, 0],
];
/** The corner clockwise of each side: north stands for north-east, and so on round. */
const CORNERS: typeof SIDES = [
  [SKY.north, 1, -1],
  [SKY.east, 1, 1],
  [SKY.south, -1, 1],
  [SKY.west, -1, -1],
];
const LOW_HP = 0.35;
const AIR_Z = 1e6; // above any screen row
type Point = { x: number; y: number; };
type Stream = { points: Point[]; cells: number[]; start: number; };
const BOLT_SPEED = 18; // cells a second: `speed` of manabolt.type
const STREAM_EVERY = 5; // ticks between the streaks of a Storm Power Stream (ours)
const STREAK_CELLS = 4; // cells a streak of the stream is long (ours)
const STREAM_LIFT = 6; // pixels the stream runs above the ground (ours)

/** The point `d` cells along a way, between the points it passes. */
/** Island ground or an Edge Farm on it: what the rim frames go round. */
function isLand(terrain: number | undefined): boolean {
  return terrain === Terrain.Island || terrain === Terrain.EdgeFarm;
}

function pointAt(points: readonly Point[], cells: readonly number[], d: number): Point {
  const i = Math.max(1, cells.findIndex((c) => c >= d));
  const a = points[i - 1]!;
  const b = points[i] ?? a;
  const span = cells[i]! - cells[i - 1]!;
  const t = span > 0 ? (d - cells[i - 1]!) / span : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// A streak is a wide faint stroke under a thin bright one.
const STREAK_GLOW = { width: 4, alpha: 0.3 };
const STREAK_CORE = { width: 1.5, alpha: 1 };
const STREAK_STROKES = [STREAK_GLOW, STREAK_CORE];
const HALF_CELL = 0.5;
const OVERLAY_Z = 0.5; // an overlay lies just over its own entity, a shadow just under
const SHADOW_ALPHA = 0.45; // the original draws shadows translucent; how much is not read (`?`)
/** At most this many tenths of a second of sparks at once, after a stall or a hidden tab. */
const MAX_SPARK_STEP = 5;
const RAISE_SOUNDS = 9;
const VANDER_BOLT_LIFT = 76;
/** The disc's frame: the default of sundisc.type. */
const DISC_FRAME = 1;
/** Guns that strike at once, with no missile in the air. */
const LIGHTNING_GUNS: ReadonlySet<string> = new Set(['thunderarcher']);
/** A Sun Cannon's tail: ten sparks as it leaves, then about two a game frame within three pixels
 * of the shell (FUN_004672d0); how long its sparks live is not read (`?`). */
const SHELL_SPARKS_AT_START = 10;
const TAIL_PER_TENTH = 6;
const TAIL_SPREAD = 3;
const TAIL_LIFE = 4;
const PLACE_TICKS = 3;
const MAX_PLACE_CELLS = 64;
const PROGRESS_COLOR = 0xbfe9ff;
const DEVIL_FORMS_WEST = -1.4;
/** Ticks between two bursts of an Ice Cannon, the four shots of one being within a second. */
const SMOKE_GAP = 10;
/* oxlint-disable no-magic-numbers -- slots of fenceshield.type and range.type */
/** The picture of a cell of a barrier's field, by the way it runs and the tick. An Acid
 * Barricade's wide group F along the board's x and tall group D along its y is read off the
 * pictures' shapes (`?`). */
const FIELD_SLOTS: Readonly<
  Record<string, (along: 'x' | 'y', tick: number) => readonly [string, number]>
> = {
  sunfence: (along) => ['fenceshield', along === 'y' ? 0 : 1],
  rainfence: (along, tick) => ['range', (along === 'x' ? 50 : 38) + (Math.floor(tick / 5) % 5)],
};
/* oxlint-enable no-magic-numbers */

/** What a building has left of its construction, or of an Upgrade: a Workshop being Upgraded is
 * built anew over itself, so it shows the same progress. */
function workOf(b: DeepReadonly<Building>): { left: number; whole: number; } | null {
  if (b.rising > 0) {
    return { left: b.rising, whole: BUILD_SECONDS };
  }

  return b.upgrading > 0 ? { left: b.upgrading, whole: UPGRADE_SECONDS } : null;
}

export function createWorldRenderer(
  world: WorldView,
  /** The side looked through: its own are blue, its enemies red. */
  viewer: () => number,
  terrainG: Graphics,
  ground: Container,
  entityLayer: Container,
  barsLayer: Container,
  textures: Map<string, Texture>,
  sounds: Sounds,
  hotFeet: ReadonlyMap<string, readonly [number, number]> = new Map(),
  /** Types that burn below half their hit points (burning.ts `burners`). */
  burning: ReadonlySet<string> = new Set(),
) {
  const timeline = new PresentationTime();
  let presentationTick = world.tick;
  const bars = barsLayer.addChild(new Graphics());
  const movingBars = barsLayer.addChild(new Container());
  const streamG = barsLayer.addChild(new Container());
  const streamBatches = STREAK_STROKES.map(({ alpha }) =>
    new StreamBatch(streamG, COLOR.stream, alpha)
  );
  const polishG = barsLayer.addChild(new Container());
  const healthBars = new Map<number, Graphics>();
  const constructionBars = new Map<number, Graphics>();
  // Fire on what is below half its hit points (burning.ts); a hit itself shows nothing on the unit,
  // as in the original.
  const fireG = barsLayer.addChild(new Graphics());
  const sparks: Spark[] = [];
  const pieces: Piece[] = [];
  const anchors = new Map<number, number[][][]>();
  /** The slot each Sun Cannon showed last, to hear its turns. */
  const barrels = new Map<number, number>();
  const discs = new Map<number, Sprite>();
  let sparkTick = world.tick;
  const placementsAccent: {
    x: number;
    y: number;
    w: number;
    h: number;
    start: number;
    entity?: number;
    graphic?: Graphics;
  }[] = [];

  function dropAccent(): void {
    placementsAccent.shift()?.graphic?.destroy();
  }

  function placed(cells: readonly (readonly [number, number])[]): void {
    for (const [x, y] of cells) {
      if (placementsAccent.length >= MAX_PLACE_CELLS) {
        dropAccent();
      }

      placementsAccent.push({ x, y, w: 1, h: 1, start: world.tick });
    }
  }

  /** Minimal previous-tick placements, including targets removed by an instant shot. */
  const placements = new Map<number, {
    at: Point;
    type: string;
    height: number;
    entity: DeepReadonly<Entity>;
  }>();
  // --- terrain: a tile per cell, a cliff face under each southern rim, colours where tiles are missing
  const tiles: Sprite[] = [];

  function drawTerrain() {
    terrainG.clear();

    for (const tile of tiles.splice(0)) {
      tile.destroy();
    }

    const hanging: Sprite[] = [];
    const landings: Sprite[] = [];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const terrain = world.terrain[y * W + x];

        if (!terrain) {
          continue;
        }

        const owner = world.owner[y * W + x]!;
        const { sx, sy } = project(x, y);

        // A cell of bridge shows the frame of the sides it joins on, walled where it does not.
        // The frame is a cell and the face under it, hung on a hot spot nine rows down its side.
        if (isBridge(terrain)) {
          const strength = STRENGTHS[terrain] ?? 'whole';
          const slot = bridgeSlot(world.links[y * W + x]!, strength,
            (x * SCATTER_X) ^ (y * SCATTER_Y));
          const plank = painted(`slot:bridge:${slot}`, owner);
          const hang = plank && hotSpots.get(plank);

          if (plank && hang) {
            const tile = new Sprite(plank);
            tile.anchor.set(hang.x, hang.y);
            tile.position.set(sx + TW - 1, sy + BRIDGE_DROP);
            ground.addChild(tile);
            tiles.push(tile);
            continue;
          }
        }

        const sides = isLand(terrain) ? skyAround(x, y, SIDES) : 0;
        const shore = sides || !isLand(terrain)
          ? shoreFrame(sides, 0, x + y)
          : shoreFrame(0, skyAround(x, y, CORNERS), x + y);
        const texture = (shore === undefined
          ? undefined
          : painted(`shore:${groundSet(owner)}:${shore}`, owner))
          ?? textures.get(tileKey(terrain, owner, x, y));
        // The southern rim frames carry their own rock face.
        const faced = shore !== undefined && (sides & SKY.south) !== 0;

        if (!faced && y + 1 < H && !world.terrain[(y + 1) * W + x]) {
          terrainG.rect(sx, sy + TH, TW, CLIFF_HEIGHT).fill(COLOR.cliff);
        }

        if (!texture) {
          terrainG.rect(sx, sy, TW, TH).fill(terrainColor(terrain, owner, viewer()));
          continue;
        }

        const hung = textures.get(`slot:fringe:${fringeSlot(sides, x * FRINGE_SCATTER + y)}`);
        const spot = hung && hotSpots.get(hung);

        if (hung && spot) {
          // The hot spot of a Fringe frame lies four rows under the top of its picture. That the
          // picture starts level with its rim cell is our reading of that (`?`).
          const rock = new Sprite(hung);
          rock.anchor.set(spot.x, spot.y);
          rock.position.set(sx + TW - 1, sy + FRINGE_DROP);
          hanging.push(rock);
        }

        // An Edge Farm takes the place of its rim frame, in the colours of the island's ground
        // (edgefarm.type follows isle.type frame for frame), hung on the frame's hot spot.
        const farm = terrain === Terrain.EdgeFarm && shore !== undefined
          ? textures.get(`slot:edgefarm:${FARM_SLOTS[groundSet(farmOwner(x, y))]?.[shore]}`)
          : undefined;
        const farmSpot = farm && hotSpots.get(farm);
        const tile = new Sprite(farm && farmSpot ? farm : texture);

        if (farm && farmSpot) {
          tile.anchor.set(farmSpot.x, farmSpot.y);
          tile.position.set(sx + TW - 1, sy + TH - 1);
        } else {
          // A rim frame is cut down to its picture: it keeps to the side its ground is on.
          tile.position.set(sides & SKY.west ? sx + TW - texture.width : sx,
            sides & SKY.north ? sy + TH - texture.height : sy);
        }

        ground.addChild(tile);
        tiles.push(tile);

        if (terrain === Terrain.Island) {
          landings.push(...landingsAt(x, y, sx, sy));
        }
      }
    }

    // Where a bridge comes onto an island it lands on a patch of ground, over both.
    for (const landing of landings) {
      ground.addChild(landing);
      tiles.push(landing);
    }

    for (const [x, y] of world.residences) {
      const texture = textures.get(`slot:residence:${residenceSlot(x, y)}`);
      const spot = texture && hotSpots.get(texture);

      if (texture && spot) {
        const house = new Sprite(texture);
        house.anchor.set(spot.x, spot.y);
        const { sx, sy } = project(x + RESIDENCE_FOOT, y + RESIDENCE_FOOT);
        house.position.set(sx, sy);
        ground.addChild(house);
        tiles.push(house);
      }
    }

    // The rock hangs behind the ground: under every tile.
    for (const rock of hanging) {
      ground.addChildAt(rock, 0);
      tiles.push(rock);
    }
  }

  /**
   * The ground a bridge lands on where it joins an island cell (the BridgeConnector type): one
   * picture for each bridge that joins it, by the side the island lies on from the bridge, north,
   * east, south or west. Its frames come from the Bridge pictures.
   */
  function landingsAt(x: number, y: number, sx: number, sy: number): Sprite[] {
    const found: Sprite[] = [];

    for (const [dir, [dx, dy]] of DIRS.entries()) {
      const next = world.terrain[(y + dy) * W + x + dx];

      if (next === undefined || !isBridge(next) || !world.joined(x, y, dir)) {
        continue;
      }

      const texture = painted(`slot:bridgeconnector:${oppositeDir(dir)}`, world.owner[y * W + x]!);
      const spot = texture && hotSpots.get(texture);

      if (texture && spot) {
        const landing = new Sprite(texture);
        landing.anchor.set(spot.x, spot.y);
        landing.position.set(sx + TW - 1, sy + LANDING_DROP);
        found.push(landing);
      }
    }

    return found;
  }

  /** A rim or bridge frame in the colour of its owner's side: blue for the player and his allies,
   * red for the enemy, as saved for nobody (owner-colours.ts). */
  function painted(key: string, owner: number): Texture | undefined {
    if (owner === 0) {
      return textures.get(key);
    }

    return textures.get(`${key}:${world.hostile(viewer(), owner) ? 'red' : 'blue'}`)
      ?? textures.get(key);
  }

  /** The owner of the island an Edge Farm grows on: "the alignment of that Temple grows into the
   * Edge Farm itself". The farm's own cell has none. */
  function farmOwner(x: number, y: number): number {
    for (const [, dx, dy] of SIDES) {
      const i = (y + dy) * W + x + dx;

      if (world.terrain[i] === Terrain.Island) {
        return world.owner[i]!;
      }
    }

    return 0;
  }

  /** Buildings going up, each with the picture it grows into and the texture drawn meanwhile. */
  const growths = new Map<number, {
    growth: Growth;
    context: CanvasRenderingContext2D;
    image: ImageData;
    texture: Texture;
  }>();

  /** A building going up shows the pixels of it the work has brought so far (growth.ts). */
  function grow(b: DeepReadonly<Building>, sprite: Sprite, dt: number): void {
    let g = growths.get(b.id);

    if (!g) {
      const picture = typeof document === 'undefined' ? null : pixelsOf(sprite.texture);
      const canvas = picture && document.createElement('canvas');
      const context = canvas?.getContext('2d');
      const spot = hotSpots.get(sprite.texture);

      if (!picture || !canvas || !context || !spot) {
        return;
      }

      canvas.width = picture.width;
      canvas.height = picture.height;
      const texture = Texture.from(canvas);
      hotSpots.set(texture, spot);
      g = {
        growth: new Growth(picture.rgba, picture.width, picture.height),
        context,
        image: context.createImageData(picture.width, picture.height),
        texture,
      };
      growths.set(b.id, g);
    }

    g.growth.step(dt, 1 - b.rising / (BUILD_SECONDS * TPS));
    g.image.data.set(g.growth.out);
    g.context.putImageData(g.image, 0, 0);
    g.texture.source.update();
    sprite.texture = g.texture;
    sprite.alpha = 1;
  }

  function stopGrowing(id: number): void {
    growths.get(id)?.texture.destroy(true);
    growths.delete(id);
    building.get(id)?.();
    building.delete(id);
  }

  /** Show a slot on a sprite, hung on the slot's hot spot. */
  function retexture(sprite: Sprite, [type, slot]: readonly [string, number]): void {
    const texture = textures.get(`slot:${type}:${slot}`);
    const spot = texture && hotSpots.get(texture);

    if (texture && spot) {
      sprite.texture = texture;
      sprite.anchor.set(spot.x, spot.y);
    }
  }

  /** Where the island ends around a cell: SKY bits of the neighbours, given as [bit, dx, dy]. */
  function skyAround(x: number, y: number, around: typeof SIDES): number {
    let found = 0;

    for (const [bit, dx, dy] of around) {
      const nx = x + dx;
      const ny = y + dy;
      const island = nx >= 0 && ny >= 0 && nx < W && ny < H && isLand(world.terrain[ny * W + nx]);

      if (!island) {
        found |= bit;
      }
    }

    return found;
  }

  /** A Residence takes the alignment of the Temple of its island (help: "As a Temple is built,
   * the alignment of that Temple grows into the Residence"); its six frames, lit and unlit,
   * are scattered by place. */
  function residenceSlot(x: number, y: number): number {
    const theme = world.players.get(world.owner[y * W + x]!)?.theme ?? 'sun';
    return RESIDENCE_FURIES.indexOf(theme) * RESIDENCE_FRAMES + (x + y) % RESIDENCE_FRAMES;
  }

  function groundSet(owner: number): string {
    const theme = world.players.get(owner)?.theme;
    return theme && theme !== 'sun' ? theme : 'neutral';
  }

  function tileKey(terrain: number, owner: number, x: number, y: number): string {
    if (terrain === Terrain.HardBridge) {
      return 'bridge:hard';
    }

    if (terrain === Terrain.Bridge) {
      return 'bridge:solid';
    }

    if (terrain === Terrain.CrackedBridge) {
      return 'bridge:cracked';
    }

    const set = groundSet(owner);
    // A fixed scatter of the grass variants, so a redraw does not reshuffle the ground.
    const frame = GROUND_FRAMES[((x * SCATTER_X) ^ (y * SCATTER_Y)) % GROUND_FRAMES.length]!;
    return `ground:${set}:${frame}`;
  }

  // --- entities
  const sprites = new Map<number, Sprite | Graphics>();
  const groups = new Map<number, Container>();

  function entityRoot(id: number): Container {
    let group = groups.get(id);

    if (!group) {
      group = entityLayer.addChild(new Container({ sortableChildren: true }));
      groups.set(id, group);
    }

    return group;
  }

  function displayedDepth(id: number, sprite: Sprite | Graphics, flying: boolean): void {
    const group = groups.get(id);

    if (group) {
      // Keep air below the existing effects plane; group attachments cannot interleave with
      // another entity. Equal depths retain deterministic entity insertion order.
      group.zIndex = flying ? AIR_Z - 1 + sprite.y / (H * TH + 1) : sprite.y;
      sprite.zIndex = 0;
      const over = overlays.get(id);
      const shadow = shadows.get(id);

      if (over) {
        over.zIndex = OVERLAY_Z;
      }

      if (shadow) {
        shadow.zIndex = -OVERLAY_Z;
      }
    }
  }

  /** Cooldowns seen on the previous tick: a shooter whose cooldown went up has fired. */
  const cooldowns = new Map<number, number>();
  const widths = new Map<number, number>(); // footprint width in cells, kept for the explosion
  /** Pictures laid over an entity's own: the whirl of a Temple, the charge of a Thunder Cannon. */
  const overlays = new Map<number, Sprite>();
  /** The middle of each thing that stands still, kept for its explosion. */
  const centres = new Map<number, Point>();
  /** Which way each walker last went (animations.ts). */
  const headings = new Map<number, number>();
  const states = new VisualStates();
  const scene = {
    world,
    headings,
    aims: new Map<number, number>(),
    states,
    guns: new Map<number, Gun>(),
  };
  const shadows = new Map<number, Sprite>();
  /** Where each unit was drawn on the previous tick and this one: between ticks it glides. */
  const glides = new Map<number, { from: Point; to: Point; }>();
  /** Altars with a captive on them. */
  const holding = new Set<number>();
  entityLayer.sortableChildren = true;

  /** Buildings under construction, to hear them finished, and the loops they sound meanwhile. */
  const rising = new Set<number>();
  const building = new Map<number, () => void>();

  /** A building sounds when it is finished: with the sound of its .type file, or the original's
   * "buildDone" (ours). Units do not sound for what they do by themselves: only when ordered. */
  function listen(entity: DeepReadonly<Entity>): void {
    if (entity.kind !== 'building') {
      return;
    }

    if (entity.rising > 0) {
      if (!rising.has(entity.id)) {
        // "jimBuild.wav" loops while it goes up (ConstructionProcess, FUN_0044e960).
        building.set(entity.id, sounds.loop('jimbuild', centres.get(entity.id)));
      }

      rising.add(entity.id);
    } else if (rising.delete(entity.id)) {
      stopGrowing(entity.id);
      sounds.play(unitSound(sounds.index, entity.type, 'built') ?? 'builddone',
        centres.get(entity.id));
    }
  }

  /**
   * Show, hide or move a picture that goes with an entity's own on the same hot spot: one laid
   * over it (the whirl of a Temple) or its shadow under it.
   */
  function attach(
    layer: Map<number, Sprite>,
    id: number,
    slot: readonly [string, number] | null,
    under: Sprite | Graphics,
    z: number,
    alpha: number,
  ): void {
    const texture = slot ? textures.get(`slot:${slot[0]}:${slot[1]}`) : undefined;
    const spot = texture ? hotSpots.get(texture) : undefined;
    let sprite = layer.get(id);

    if (!texture || !spot) {
      if (sprite) {
        sprite.visible = false;
      }

      return;
    }

    if (!sprite) {
      sprite = new Sprite(texture);
      entityRoot(id).addChild(sprite);
      layer.set(id, sprite);
    }

    sprite.texture = texture;
    sprite.visible = true;
    sprite.anchor.set(spot.x, spot.y);
    sprite.position.copyFrom(under.position);
    // A Dust Devil forms 1.4 cells west of its Devil Maker (FUN_0046ed00).
    sprite.x += slot?.[0] === 'windflyer' && layer === overlays ? DEVIL_FORMS_WEST * TW : 0;
    sprite.zIndex = under.zIndex + z;
    sprite.alpha = under.alpha * alpha;
    // A shadow keeps only its shape: the extraction leaves it in a flat palette colour.
    sprite.tint = layer === shadows ? COLOR.shadow : COLOR.noTint;
  }

  /** Sparks of a unit on fire, from the streaks laid on its picture the first time it burns. */
  function throwSparks(entity: DeepReadonly<Entity>, sprite: Sprite | Graphics, dt: number): void {
    const streaks = 'type' in entity && 'hp' in entity && burning.has(entity.type)
        && !(entity.kind === 'building' && (entity.rising > 0 || entity.regrow > 0))
      ? streaksOf(entity.hp, entity.hpMax)
      : 0;

    if (streaks === 0 || !(sprite instanceof Sprite)) {
      return;
    }

    let laid = anchors.get(entity.id);

    if (!laid) {
      laid = anchorsOf(sprite.texture);
      anchors.set(entity.id, laid);

      // A Bulf catching fire cries out (Damageable.cpp).
      if (entity.kind === 'transport' && entity.type === 'bulf') {
        sounds.play('bulfhurt', { x: sprite.x, y: sprite.y });
      }
    }

    burn(sparks, laid.slice(0, streaks).flat(), sprite.x - sprite.anchor.x * sprite.width,
      sprite.y - sprite.anchor.y * sprite.height, dt);
  }

  function drawSparks(): void {
    fireG.clear();

    for (const { x, y, colour } of pieces) {
      fireG.rect(Math.round(x), Math.round(y), PIECE, PIECE).fill(colour);
    }

    for (const smoke of smokes) {
      for (const { x, y, life } of smoke.puffs) {
        fireG.rect(Math.round(x), Math.round(y), 2, 1).fill(puffColour(life));
      }
    }

    for (const { x, y, life } of sparks) {
      // Five pixels of one colour: a square of two by two and one over it.
      fireG.rect(Math.round(x), Math.round(y) - 1, 2, 2).rect(Math.round(x), Math.round(y) - 2, 1,
        1)
        .fill(sparkColour(life));
    }
  }

  function syncEntities() {
    bars.clear();

    for (const entity of world.entities.values()) {
      let sprite = sprites.get(entity.id);

      if (!sprite && entity.kind === 'building' && entityTick >= 0) {
        if (placementsAccent.length >= MAX_PLACE_CELLS) {
          dropAccent();
        }

        placementsAccent.push({
          x: entity.x,
          y: entity.y,
          w: entity.fx,
          h: entity.fy,
          start: world.tick,
          entity: entity.id,
        });
      }

      const slot = slotOf(entity, world.tick, scene);

      // A Sun Cannon's barrel creaks at every frame of a turn (sunCannonRaiseLower1..9, at random).
      if (entity.kind === 'building' && entity.type === 'suncannon' && slot) {
        const before = barrels.get(entity.id);
        barrels.set(entity.id, slot[1]);

        if (
          before !== undefined && before !== slot[1] && Math.max(before, slot[1]) < SUN_CANNON_FIRE
        ) {
          sounds.play(`suncannonraiselower${1 + Math.floor(Math.random() * RAISE_SOUNDS)}`,
            centres.get(entity.id));
        }
      }

      const texture = (slot ? textures.get(`slot:${slot[0]}:${slot[1]}`) : undefined)
        ?? textures.get(textureKey(entity));

      if (!sprite) {
        if (texture) {
          const newSprite = new Sprite(texture);
          newSprite.anchor.set(SPRITE_ANCHOR_X, footprintOf(entity) ? 1 : UNIT_ANCHOR_Y);
          sprite = newSprite;
        } else {
          const marker = new Graphics();
          marker.circle(0, 0, MARKER_RADIUS).fill(
            entity.kind === 'building' ? COLOR.buildingMarker : COLOR.unitMarker,
          );
          sprite = marker;
        }

        entityRoot(entity.id).addChild(sprite);
        sprites.set(entity.id, sprite);
        widths.set(entity.id, entity.kind === 'building' ? entity.fx : 1);
      } else if (sprite instanceof Sprite && texture && sprite.texture !== texture) {
        sprite.texture = texture;
      }

      // A slot is drawn about the hot spot of its frame: the far corner of a footprint, the
      // middle of the cell of a unit. Other pictures stand on the bottom edge of their place.
      const spot = sprite instanceof Sprite ? hotSpots.get(sprite.texture) : undefined;
      const bySpot = spot !== undefined;

      if (sprite instanceof Sprite) {
        if (spot) {
          sprite.anchor.set(spot.x, spot.y);
        } else {
          sprite.anchor.set(SPRITE_ANCHOR_X, footprintOf(entity) ? 1 : UNIT_ANCHOR_Y);
        }
      }

      // A carried crystal is not drawn, nor a Priest chained on an altar: its frames show him.
      const chained = entity.kind === 'priest' && entity.state === 'chained';

      if (chained || (entity.kind === 'crystal' && entity.carriedBy !== null)) {
        sprite.visible = false;
        const bar = healthBars.get(entity.id);

        if (bar) {
          bar.visible = false;
        }

        glides.delete(entity.id);
        attach(shadows, entity.id, null, sprite, 0, 0);
        continue;
      }

      sprite.visible = true;
      centres.set(entity.id, middle(entity));
      listen(entity);
      // Large things stand on the bottom edge of their footprint, units on the middle of their cell.
      const foot = footprintOf(entity);
      // A slot hangs on the hot spot its type sets in the far cell of the footprint.
      const [inX, inY] = bySpot && foot ? hotFeet.get(kindOf(entity)) ?? [0, 0] : [0, 0];
      const { sx, sy } = foot
        ? project(foot.x + (bySpot ? foot.w - inX : foot.w / 2), foot.y + foot.h - inY)
        : unitSpot(entity);
      sprite.position.set(sx, sy);

      if (!foot) {
        glides.set(entity.id, {
          from: glides.get(entity.id)?.to ?? { x: sx, y: sy },
          to: { x: sx, y: sy },
        });
      }

      // A flyer is drawn over everything on the ground.
      sprite.zIndex = entity.kind === 'flyer' ? AIR_Z : sy;
      sprite.tint = entityTint(entity, viewer());
      sprite.alpha = entityAlpha(entity);
      const over = bySpot ? overlayOf(entity, world.tick, world, scene.guns) : null;
      attach(overlays, entity.id, over, sprite, OVERLAY_Z, 1);
      attachDisc(entity, sprite);
      attach(shadows, entity.id, bySpot ? shadowOf(slot) : null, sprite, -OVERLAY_Z, SHADOW_ALPHA);
      displayedDepth(entity.id, sprite, entity.kind === 'flyer');

      // An Altar that holds a captive when it goes plays the sacrifice where it stood.
      if (over?.[0] === 'altar' && over[1] > 0) {
        holding.add(entity.id);
      } else {
        holding.delete(entity.id);
      }

      const bar = healthBars.get(entity.id);
      const needsBar = 'hp' in entity && entity.hp < entity.hpMax;

      if (needsBar) {
        const graphic = bar ?? movingBars.addChild(new Graphics());
        healthBars.set(entity.id, graphic);
        graphic.clear();
        drawBar(graphic, entity.hp / entity.hpMax);
        graphic.visible = true;
      } else if (bar) {
        bar.visible = false;
      }

      const work = entity.kind === 'building' && entity.regrow === 0 ? workOf(entity) : null;
      const line = constructionBars.get(entity.id);

      if (work) {
        const graphic = line ?? polishG.addChild(new Graphics());
        constructionBars.set(entity.id, graphic);
        graphic.clear();
        const share = Math.max(0, 1 - work.left / (work.whole * TPS));
        graphic.moveTo(-BAR_WIDTH / 2, 0).lineTo(-BAR_WIDTH / 2 + BAR_WIDTH * share, 0)
          .stroke({ color: PROGRESS_COLOR, width: 1 });
      } else if (line) {
        line.destroy();
        constructionBars.delete(entity.id);
      }
    }

    for (const [id, sprite] of sprites) {
      if (!world.entities.has(id)) {
        if (holding.delete(id)) {
          burst({ type: 'altar', ...SACRIFICE }, sprite.position,
            groups.get(id)?.zIndex ?? sprite.zIndex);
        }

        sprite.destroy();
        sprites.delete(id);
        widths.delete(id);
        centres.delete(id);
        rising.delete(id);
        stopGrowing(id);
        smoked.delete(id);
        headings.delete(id);
        glides.delete(id);
        scene.aims.delete(id);
        scene.guns.delete(id);
        states.delete(id);
        anchors.delete(id);
        barrels.delete(id);
        healthBars.get(id)?.destroy();
        healthBars.delete(id);
        constructionBars.get(id)?.destroy();
        constructionBars.delete(id);

        for (const layer of [overlays, shadows, discs]) {
          layer.get(id)?.destroy();
          layer.delete(id);
        }

        groups.get(id)?.destroy();
        groups.delete(id);
      }
    }

    flyBolts();
    drawBarriers();
    drawTracers();

    for (const id of cooldowns.keys()) {
      if (!world.entities.has(id)) {
        cooldowns.delete(id);
      }
    }

    playEffects();
    placements.clear();

    for (const entity of world.entities.values()) {
      placements.set(entity.id, {
        at: middle(entity),
        type: kindOf(entity),
        height: sprites.get(entity.id)?.height ?? 0,
        entity,
      });
    }
  }

  /**
   * "When a Workshop creates a unit, a Storm Power Stream streaks from the Workshop to the build
   * site. When it combines with the proper Energy the unit will be created on the spot." As
   * construction starts, one bolt of the Energy it takes (type Manabolt, 18 cells a second) flies
   * straight to the site from the nearest Temple or Generator that powers it, and the stream sets
   * off from the Workshop that makes the unit (the Temple, for a Golem) and runs on until the unit
   * stands. The stream keeps to the way a transport would walk, found once when construction
   * starts, so a bridge that falls meanwhile does not turn it: so the author of this project saw it
   * in the original. How either is drawn is ours (`?`).
   */
  const bolts: { sprite: Sprite; from: Point; to: Point; start: number; ticks: number; }[] = [];
  /** The stream to each building site: its way in screen points with the cells walked to each. */
  const streams = new Map<number, Stream>();

  function flyBolts(): void {
    for (const b of world.entities.values()) {
      if (
        b.kind !== 'building' || b.rising === 0 || b.builder !== null || streams.has(b.id)
      ) {
        continue;
      }

      const site = { x: b.x + b.fx / 2, y: b.y + b.fy / 2 };
      const source = energySource(b.owner, site);
      streams.set(b.id, streamTo(b));

      // What the Priest builds takes no Energy.
      if (source && (world.defs.get(b.type)?.level ?? 0) > 0) {
        bolt(source, site, world.defs.get(source.type)?.theme ?? 'sun');
      }
    }

    for (const id of streams.keys()) {
      const b = world.entities.get(id);

      if (b?.kind !== 'building' || b.rising === 0) {
        streams.delete(id);
      }
    }

    for (let i = bolts.length - 1; i >= 0; i--) {
      const { sprite, from, to, start, ticks } = bolts[i]!;
      const done = (world.tick - start) / ticks;

      if (done >= 1) {
        sprite.destroy();
        bolts.splice(i, 1);
      } else {
        sprite.position.set(from.x + (to.x - from.x) * done, from.y + (to.y - from.y) * done);
      }
    }
  }

  /** The nearest of the player's finished Temples and Generators whose circle covers the spot. */
  function energySource(player: number, spot: Point): DeepReadonly<Building> | undefined {
    let best: DeepReadonly<Building> | undefined;
    let bestFar = ENERGY_RANGE;

    for (const e of world.buildingsOf(player)) {
      const def = world.defs.get(e.type);
      const far = Math.hypot(e.x + e.fx / 2 - spot.x, e.y + e.fy / 2 - spot.y);

      if (
        def && (def.cls === 'Energy' || def.group === 'battery') && e.rising === 0
        && far <= bestFar
      ) {
        best = e;
        bestFar = far;
      }
    }

    return best;
  }

  /** One Manabolt of a Fury from a building to a spot, in cells. */
  function bolt(from: DeepReadonly<Building>, to: Point, fury: string): void {
    const texture = textures.get(`slot:manabolt:${MANA_BOLTS[fury]}`);
    const spot = texture && hotSpots.get(texture);

    if (!texture || !spot) {
      return;
    }

    const a = project(from.x + from.fx / 2, from.y + from.fy / 2);
    const b = project(to.x, to.y);
    const cells = Math.hypot(from.x + from.fx / 2 - to.x, from.y + from.fy / 2 - to.y);
    const sprite = entityLayer.addChild(new Sprite(texture));
    sprite.anchor.set(spot.x, spot.y);
    sprite.zIndex = AIR_Z;
    bolts.push({
      sprite,
      from: { x: a.sx, y: a.sy },
      to: { x: b.sx, y: b.sy },
      start: world.tick,
      ticks: Math.max(1, Math.round((cells / BOLT_SPEED) * TPS)),
    });
  }

  /** The way of the stream to a site: walked from the Workshop that makes the unit, or straight
   * where none does (a Temple, a Workshop and an Altar are the Priest's work) or no way leads. */
  function streamTo(
    b: DeepReadonly<Building>,
  ): Stream {
    const maker = makerOf(world, b.owner, b.type, b.x, b.y);
    const end: [number, number] = [b.x + b.fx / 2, b.y + b.fy / 2];

    if (!maker) {
      return { points: [], cells: [], start: world.tick };
    }

    const near = (x: number, y: number) =>
      x >= maker.x - 1 && x <= maker.x + maker.fx && y >= maker.y - 1 && y <= maker.y + maker.fy;
    // From the site, whose corner is on its walkable rim, to the rim of the Workshop.
    const walked = world.findPath(b.owner, b.x, b.y, ([x, y]) => near(x, y)) ?? [];
    const way: [number, number][] = [
      [maker.x + maker.fx / 2, maker.y + maker.fy / 2],
      ...walked.reverse().map(([x, y]): [number, number] => [x + HALF_CELL, y + HALF_CELL]),
      end,
    ];
    const points: Point[] = [];
    const cells: number[] = [];

    for (const [i, [x, y]] of way.entries()) {
      const at = project(x, y);
      const [px, py] = way[i - 1] ?? [x, y];
      points.push({ x: at.sx, y: at.sy });
      cells.push((cells.at(-1) ?? 0) + Math.hypot(x - px, y - py));
    }

    return { points, cells, start: world.tick };
  }

  /** Streaks of Storm Power running along the way of a stream, one sent every STREAM_EVERY ticks. */
  function drawStream(stream: Stream, now: number): void {
    const { points, cells, start } = stream;
    const length = cells.at(-1) ?? 0;

    if (points.length < 2) {
      return;
    }

    const first = firstEmission(now, start, ((length + STREAK_CELLS) * TPS) / BOLT_SPEED,
      STREAM_EVERY);

    for (let sent = first; sent <= now; sent += STREAM_EVERY) {
      const head = ((now - sent) * BOLT_SPEED) / TPS;
      const tail = head - STREAK_CELLS;

      if (tail >= length) {
        continue;
      }

      const line = [pointAt(points, cells, Math.max(0, tail))];

      for (const [i, d] of cells.entries()) {
        if (d > Math.max(0, tail) && d < Math.min(head, length)) {
          line.push(points[i]!);
        }
      }

      line.push(pointAt(points, cells, Math.min(head, length)));

      for (const [stroke, { width }] of STREAK_STROKES.entries()) {
        for (let i = 1; i < line.length; i++) {
          const from = line[i - 1]!;
          const to = line[i]!;
          streamBatches[stroke]!.segment(from.x, from.y - STREAM_LIFT, to.x, to.y - STREAM_LIFT,
            width);
        }
      }
    }
  }

  /** Runs of frames played once at a place: explosions, the sacrifice, the mark of a Spell. */
  const bursts: (Burst & { at: Point; z: number; start: number; sprite?: Sprite; })[] = [];

  function burst(run: Burst, at: Point, z: number): void {
    bursts.push({ ...run, at: { x: at.x, y: at.y }, z, start: world.tick });
  }

  function playEffects(): void {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const effect = bursts[i]!;
      const frame = world.tick - effect.start;
      const texture = textures.get(`slot:${effect.type}:${effect.first + frame}`);
      const spot = texture && hotSpots.get(texture);

      if (frame >= effect.frames || !texture || !spot) {
        effect.sprite?.destroy();
        bursts.splice(i, 1);
        continue;
      }

      effect.sprite ??= entityLayer.addChild(new Sprite(texture));
      effect.sprite.texture = texture;
      effect.sprite.anchor.set(spot.x, spot.y);
      effect.sprite.position.set(effect.at.x, effect.at.y);
      effect.sprite.zIndex = effect.z;
    }
  }

  /** Show what a Spell does: its mark on every unit in its range, or a blast at the caster. */
  function cast(caster: number, spell: string): void {
    const by = world.entities.get(caster) ?? placements.get(caster)?.entity;
    const show = SPELL_BURSTS[spell];
    const range = world.defs.get(spell)?.range ?? 0;

    if (!by || !show) {
      return;
    }

    if (show.here) {
      burst(show.here, middle(by), AIR_Z);
    }

    for (const e of world.entities.values()) {
      const flying = e.kind === 'flyer'
        || (e.kind === 'transport' && world.defs.get(e.type)?.group === 'balloon');
      const near = Math.hypot(e.x - by.x, e.y - by.y) <= range;

      if (!('hp' in e) || e.id === caster || !near) {
        continue;
      }

      if (show.each && (!show.air || flying)) {
        burst(show.each, middle(e), AIR_Z);
      }

      if (show.bolt && !flying) {
        const at = middle(e);
        beam(show.bolt === 'sky' ? { x: at.x, y: at.y - SKY_BOLT } : middle(by), at, 'thundercrack',
          SPELL_BOLT_LIFE);
      }
    }
  }

  /**
   * The field between every two posts joined into a barrier, a picture a cell. A Sun Barricade's
   * is a Force Field cell, north-south or east-west (fence.cpp, FUN_00464660); an Acid
   * Barricade's a cell of the range type, its five frames turning every 0.5 s (RainFenceProcess).
   * An Arc Spire has no standing field: its pulse is a bolt from post to post.
   */
  function drawBarriers(): void {
    for (const field of fields.splice(0)) {
      field.destroy();
    }

    for (const { from, to } of barriers(world)) {
      const a = sprites.get(from.id);
      const b = sprites.get(to.id);
      const pulsed = from.type === 'thunderfence'
        && from.cooldown > (cooldowns.get(from.id) ?? Infinity);

      if (a && b && pulsed) {
        beam({ x: a.x, y: a.y - a.height / 2 }, { x: b.x, y: b.y - b.height / 2 });
      }

      const along = from.x === to.x ? 'y' : 'x';
      const slot = FIELD_SLOTS[from.type]?.(along, world.tick);

      if (slot === undefined) {
        continue;
      }

      const [x0, y0] = along === 'x'
        ? [from.x + from.fx, from.y + (from.fy >> 1)]
        : [from.x + (from.fx >> 1), from.y + from.fy];
      const end = along === 'x' ? to.x : to.y;

      for (let at = along === 'x' ? x0 : y0; at < end; at++) {
        const [x, y] = along === 'x' ? [at, y0] : [x0, at];
        const texture = textures.get(`slot:${slot[0]}:${slot[1]}`);
        const spot = texture && hotSpots.get(texture);

        if (texture && spot) {
          const cell = new Sprite(texture);
          cell.anchor.set(spot.x, spot.y);
          const { sx, sy } = project(x, y);
          cell.position.set(sx + TW - 1, sy + TH - 1);
          fieldLayer.addChild(cell);
          fields.push(cell);
        }
      }
    }
  }

  /** Missiles on their way, and the bolts of lightning that are simply there for a moment. */
  const missiles: {
    sprite: Sprite;
    shooter: string;
    from: Point;
    to: Point;
    start: number;
    ticks: number;
    blocked: boolean;
  }[] = [];
  const fields: Sprite[] = [];
  const smokes: Smoke[] = [];
  /** The tick each Ice Cannon last blew smoke, so that a burst of four shots blows it once. */
  const smoked = new Map<number, number>();
  // The fields of barriers stand over the units, as zoFLARES does.
  const fieldLayer = barsLayer.addChild(new Container());
  const strikes: Bolt[] = [];
  // Over every unit, as the bolt of a Vander Tower is: with the bars, above the entities.
  const strikeG = barsLayer.addChild(new Graphics());
  /**
   * A Sun Cannon's shells: no picture, but a fiery tail of sparks (FieryTail of netstorm.game)
   * along their way, and the small explosion where they land.
   */
  const shells: { from: Point; to: Point; start: number; land: number; blocked: boolean; }[] = [];
  /** Shots fired whose missile has yet to leave the gun. */
  const launches: {
    shooter: string;
    from: Point;
    to: Point;
    flight: number | undefined;
    leave: number;
    blocked: boolean;
  }[] = [];

  /** Show the shot of everything that fired this tick. A gun's missile takes as long as the
   * simulation's, so it lands on the tick its damage is dealt. */
  function drawTracers(): void {
    const shooters = new Map<number, DeepReadonly<Entity>>();

    for (const [id, previous] of placements) {
      shooters.set(id, previous.entity);
    }

    for (const [id, entity] of world.entities) {
      shooters.set(id, entity);
    }

    for (const entity of shooters.values()) {
      const bomber = entity.kind === 'flyer' && entity.type in MISSILES;

      if (entity.kind !== 'building' && !(entity.kind === 'flyer' && bomber)) {
        continue;
      }

      // A cooldown that merely stands still is not a shot: a building brought down by an explosion
      // waits a tick with its cooldown frozen.
      const fired = entity.cooldown > (cooldowns.get(entity.id) ?? Infinity);
      cooldowns.set(entity.id, entity.cooldown);
      const from = sprites.get(entity.id);
      const previous = placements.get(entity.id);
      const aim = entity.target === null ? undefined : world.entities.get(entity.target);

      let endpoint = aim ? middle(aim) : placements.get(entity.target ?? -1)?.at;

      if (!fired || (!from && !previous) || !endpoint) {
        continue;
      }

      // A gun shoots from its top; a Whirligig drops its bomb from where it hangs.
      // A gun's missile leaves from the launch point of the frame it fires on, from the hot spot
      // its frames are drawn at; a Whirligig drops its bomb from where it hangs.
      const muzzle = entity.kind === 'building' && from ? muzzleOf(entity, from) : null;
      const start = muzzle ?? (bomber
        ? { x: from?.x ?? previous!.at.x, y: (from?.y ?? previous!.at.y) - BOMB_DROP }
        : {
          x: middle(entity).x,
          y: (from?.y ?? previous!.at.y) - (from?.height ?? previous!.height) * TRACER_LIFT,
        });
      // The shot this gun fired this tick: its copy of the gun has the cooldown it has now. A Sun
      // Cannon's cooldown also goes up as it starts to turn, with no shot.
      let shot: (typeof world.shots)[number] | undefined;

      for (const sent of world.shots) {
        if (
          sent.gun.id === entity.id && !sent.ricochet && sent.gun.cooldown === entity.cooldown
        ) {
          shot = sent;
        }
      }

      if (!shot && !bomber && !LIGHTNING_GUNS.has(entity.type)) {
        continue;
      }

      const cannon = entity.kind === 'building' && world.def(entity.type).group === 'cannon';

      if (shot) {
        const target = aim ?? placements.get(shot.target)?.entity;
        // A shot into a hostile force field flies to the cell where it meets the field.
        const foot = !shot.blocked && target ? footprintOf(target) : null;
        const [w, h] = [foot?.w ?? 1, foot?.h ?? 1];
        // A cannon's missile stops at the near side of its target, where it touches it.
        const [px, py] = nearSide(shot.x, shot.y, w, h,
          cannon && entity.kind === 'building' ? entity.facing : -1);
        const point = project(px, py);
        endpoint = { x: point.sx, y: point.sy };
      }

      // An Ice Cannon blows smoke out of its muzzle as its burst begins (Smoke, FUN_004d6e30).
      if (
        entity.kind === 'building' && entity.type === 'raincannon'
        && world.tick - (smoked.get(entity.id) ?? -Infinity) > SMOKE_GAP
      ) {
        smoked.set(entity.id, world.tick);
        smokes.push(makeSmoke(start.x, start.y));
      }

      // A cannon fires along its barrel, not at the middle of its target.
      if (cannon && entity.kind === 'building') {
        endpoint = alongBarrel(start, endpoint, entity.facing);
      }

      // A Thunder Cannon charges, and a Disc Thrower spins, before its missile leaves.
      launches.push({
        shooter: entity.type,
        from: start,
        to: endpoint,
        flight: shot ? shot.land - shot.leave : undefined,
        leave: shot?.leave ?? world.tick,
        blocked: shot?.blocked ?? false,
      });
    }

    for (let i = 0; i < launches.length;) {
      const launch = launches[i]!;

      if (launch.leave > world.tick) {
        i++;
        continue;
      }

      launches.splice(i, 1);
      shoot(launch.shooter, launch.from, launch.to, launch.flight, launch.blocked);
    }

    fly();
  }

  /** Send off what a shooter throws: its missile, a bolt of lightning, or a plain streak. `flight`
   * is the ticks the simulation gives the missile; a bomb works its own out. */
  function shoot(shooter: string, from: Point, to: Point, flight?: number, blocked = false): void {
    sounds.unit(shooter, 'fire', from);

    const missile = MISSILES[shooter];
    const first = missile ? textures.get(`slot:${missile.type}:0`) : undefined;

    if (missile && first) {
      const far = Math.hypot(to.x - from.x, to.y - from.y);
      // A missile may have a sound of its own for leaving and for landing (its .type file).
      sounds.unit(missile.type, 'fire', from);
      const sprite = entityLayer.addChild(new Sprite(first));
      sprite.zIndex = AIR_Z;
      // The speed is in cells; a cell is TW pixels wide. A bomb takes at least its six frames.
      const ticks = flight
        || Math.max(missile.blast ? missile.frames : 1,
          Math.round((far / TW / missileSpeed(shooter)) * TPS));
      missiles.push({ sprite, shooter, from, to, start: world.tick, ticks, blocked });
      return;
    }

    if (shooter === 'thunderarcher') {
      beam(from, to, 'shortzap');
      return;
    }

    if (shooter === 'suncannon') {
      const far = Math.hypot(to.x - from.x, to.y - from.y);
      const ticks = flight || Math.max(1, Math.round((far / TW / missileSpeed(shooter)) * TPS));
      shells.push({ from, to, start: world.tick, land: world.tick + ticks, blocked });
      // Ten sparks where it leaves, then two at each step of the way (FUN_004672d0).
      throwTail(from, SHELL_SPARKS_AT_START);
    }
  }

  /**
   * Where a gun's missile leaves: the hot spot its frames hang on plus the launch point of the
   * frame it fires on (Missile.cpp). The Vander Tower's lightning starts 76 pixels over its hot
   * spot (FUN_0048dcb0). The Disc Thrower throws from where its disc sits on the arm, moved by its
   * hot foot in pixels, (1, 5), as FUN_00482870 leaves it.
   */
  function muzzleOf(b: DeepReadonly<Building>, sprite: Sprite | Graphics): Point | null {
    if (!(sprite instanceof Sprite) || !hotSpots.get(sprite.texture)) {
      return null;
    }

    if (b.type === 'thunderarcher') {
      return { x: sprite.x, y: sprite.y - VANDER_BOLT_LIFT };
    }

    const slot = shotFrame(b, scene.guns);
    const point = slot === null ? undefined : MUZZLES[b.type]?.[slot];

    if (!point) {
      return null;
    }

    const [footX, footY] = b.type === 'sunarcher' ? hotFeet.get(b.type) ?? [0, 0] : [0, 0];
    return {
      x: sprite.x + point[0] + Math.trunc(footX * TW),
      y: sprite.y + point[1] + Math.trunc(footY * TH),
    };
  }

  /** The Disc Thrower's disc, drawn where it sits on the arm until it is thrown (FUN_004827d0). */
  function attachDisc(entity: DeepReadonly<Entity>, under: Sprite | Graphics): void {
    const slot = entity.kind === 'building' ? discOnArm(entity, scene.guns, world.tick) : null;
    const point = slot === null ? undefined : MUZZLES.sunarcher?.[slot];
    const texture = textures.get(`slot:sundisc:${DISC_FRAME}`);
    const spot = texture && hotSpots.get(texture);
    let disc = discs.get(entity.id);

    if (!point || !texture || !spot) {
      if (disc) {
        disc.visible = false;
      }

      return;
    }

    if (!disc) {
      disc = new Sprite(texture);
      entityRoot(entity.id).addChild(disc);
      discs.set(entity.id, disc);
    }

    disc.anchor.set(spot.x, spot.y);
    disc.position.set(under.x + point[0], under.y + point[1]);
    disc.zIndex = under.zIndex + OVERLAY_Z * 2;
    disc.visible = true;
  }

  /** Sparks of a Sun Cannon's tail, thrown within three pixels of a point. */
  function throwTail(at: Point, count: number): void {
    for (let n = 0; n < count; n++) {
      sparks.push({
        x: at.x + (Math.random() * 2 - 1) * TAIL_SPREAD,
        y: at.y + (Math.random() * 2 - 1) * TAIL_SPREAD,
        life: TAIL_LIFE,
      });
    }
  }

  /** A bolt of lightning between two points, built as the original builds it (lightning.ts). */
  function beam(from: Point, to: Point, sound = 'thundercrack', life = BOLT_LIFE): void {
    if (from.x === to.x && from.y === to.y) {
      return;
    }

    sounds.play(sound, to);
    strikes.push(makeBolt(from, to, presentationTick, life));
  }

  /** The bolts of lightning, trembling, and gone when their points are. */
  function drawStrikes(dt: number): void {
    strikeG.clear();

    for (let i = strikes.length - 1; i >= 0; i--) {
      const strike = strikes[i]!;
      const lines = boltLines(strike, presentationTick);

      if (!lines.length) {
        strikes.splice(i, 1);
        continue;
      }

      tremble(strike, dt);

      for (const edge of [true, false]) {
        for (const line of lines.filter((l) => l.edge === edge)) {
          strikeG.moveTo(line.x0, line.y0).lineTo(line.x1, line.y1);
        }

        strikeG.stroke({ color: edge ? BOLT_EDGE : BOLT_CORE, width: 1 });
      }
    }
  }

  function fly(): void {
    for (let i = missiles.length - 1; i >= 0; i--) {
      const { sprite, shooter, from, to, start, ticks, blocked } = missiles[i]!;
      const done = (world.tick - start) / ticks;
      // Its bearing is taken on the board, whose cells are not square on the screen.
      const slot = missileSlot(shooter, (to.x - from.x) / TW, (to.y - from.y) / TH, world.tick);
      const texture = textures.get(`slot:${MISSILES[shooter]!.type}:${slot}`);
      const spot = texture && hotSpots.get(texture);

      if (done >= 1 && blocked) {
        // A shot spent on a Sun Barricade's field ends in a puff of dust (anim.type, group C).
        burst(FIELD_PUFF, to, AIR_Z);
        sounds.play('sunfenceimpact', to);
        sprite.destroy();
        missiles.splice(i, 1);
        continue;
      }

      if (done >= 1 || !texture || !spot) {
        const blast = MISSILES[shooter]!.blast;
        sounds.unit(MISSILES[shooter]!.type, 'impact', to);
        // The game picks one of the Ice Cannon's impact sounds at random; here by the tick.
        sounds.play(
          shooter === 'raincannon' ? `icecannonimpact${1 + (world.tick % ICE_IMPACTS)}` : undefined,
          to,
        );

        // A bomb ends in its own blast; any other missile in the explosion of its impact.
        if (done >= 1) {
          burst(blast ?? impactOf(shooter), to, AIR_Z);
        }

        sprite.destroy();
        missiles.splice(i, 1);
        continue;
      }

      sprite.texture = texture;
      sprite.anchor.set(spot.x, spot.y);
      sprite.position.set(from.x + (to.x - from.x) * done, from.y + (to.y - from.y) * done);
    }

    for (let i = shells.length - 1; i >= 0; i--) {
      const shell = shells[i]!;

      if (world.tick >= shell.land) {
        burst(shell.blocked ? FIELD_PUFF : SHELL_BURST, shell.to, AIR_Z);
        sounds.play(shell.blocked ? 'sunfenceimpact' : 'impact', shell.to);
        shells.splice(i, 1);
      }
    }
  }

  /** Play the explosion of a unit where it stands; call before the next sync removes it. */
  /** An Ice Cannon shot that splintered: its ricochet flies on from the unit hit to the next. */
  function ricochet(hit: number, to: number): void {
    const from = centres.get(hit);
    const at = centres.get(to);

    if (from && at) {
      shoot('raincannon', from, at);
    }
  }

  function explode(id: number): void {
    const target = sprites.get(id);
    const at = centres.get(id);

    if (target && at) {
      burst(explosionFor(widths.get(id) ?? 1), at, (groups.get(id)?.zIndex ?? target.zIndex) + 1);
      sounds.play('explosion', at);
      breakUp(target, false);
    }
  }

  /** A cell of bridge that falls rains down in its pixels (Fall); `bridgeFall.wav` is the event's. */
  function fell(cell: { x: number; y: number; }): void {
    const plank = textures.get('slot:bridge:0');
    const hang = plank && hotSpots.get(plank);

    if (plank && hang) {
      const { sx, sy } = project(cell.x, cell.y);
      crumble(pieces, plank, sx + TW - 1 - hang.x * plank.width,
        sy + BRIDGE_DROP - hang.y * plank.height);
    }
  }

  /** The islet under a unit laid off a bridge rains down with it, cell by cell (IslandDropper). */
  function isletFell(rect: { x: number; y: number; w: number; h: number; }): void {
    const rock = textures.get(`ground:neutral:${GROUND_FRAMES[0]}`);

    if (!rock) {
      return;
    }

    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const { sx, sy } = project(x, y);
        crumble(pieces, rock, sx, sy);
      }
    }
  }

  /** A salvaged unit crumbles away (Collapse). */
  function collapse(id: number): void {
    const target = sprites.get(id);

    if (target) {
      breakUp(target, true);
    }
  }

  function breakUp(sprite: Sprite | Graphics, falls: boolean): void {
    if (sprite instanceof Sprite) {
      shatter(pieces, sprite.texture, sprite.x - sprite.anchor.x * sprite.width,
        sprite.y - sprite.anchor.y * sprite.height, falls);
    }
  }

  let terrainRevision = -1;
  let entityTick = -1;

  function capture(): void {
    if (entityTick !== world.tick) {
      syncEntities();
      entityTick = world.tick;
    }
  }

  return {
    explode,
    collapse,
    fell,
    isletFell,
    ricochet,
    cast,
    placed,
    capture,
    resetTime() {
      timeline.reset();
    },
    inspect() {
      return {
        tick: entityTick,
        presentationTick,
        missiles: missiles.map((effect) => ({
          start: effect.start,
          land: effect.start + effect.ticks,
          x: effect.sprite.x,
          y: effect.sprite.y,
          from: { ...effect.from },
          to: { ...effect.to },
        })),
        bursts: bursts.map((effect) => ({
          type: effect.type,
          first: effect.first,
          start: effect.start,
          expires: effect.start + effect.frames,
          initialized: effect.sprite !== undefined,
        })),
        bolts: bolts.length,
        streams: streams.size,
        beams: strikes.length,
        accents: placementsAccent.length,
      };
    },
    /** Paint the ground anew, as for another side's eyes. */
    repaint() {
      terrainRevision = -1;
    },
    /** `alpha`: how far the time is between the last tick and the next (FixedStepClock.alpha). */
    sync(alpha = 1) {
      if (terrainRevision !== world.terrainRevision) {
        drawTerrain();
        terrainRevision = world.terrainRevision;
      }

      capture();
      presentationTick = timeline.sample(world.tick, alpha);
      // Tenths of a second since the last frame, which is what a tick is.
      const dt = Math.max(0, Math.min(MAX_SPARK_STEP, presentationTick - sparkTick));
      sparkTick = presentationTick;
      rise(sparks, dt);
      scatter(pieces, dt);

      for (let i = smokes.length - 1; i >= 0; i--) {
        if (!blow(smokes[i]!, dt)) {
          smokes.splice(i, 1);
        }
      }

      drawStrikes(dt);

      for (const { from, to, start, land } of shells) {
        const done = Math.min(1, Math.max(0, (presentationTick - start) / (land - start)));
        throwTail({ x: from.x + (to.x - from.x) * done, y: from.y + (to.y - from.y) * done },
          Math.round(dt * TAIL_PER_TENTH));
      }

      const poseAlpha = Math.min(1, presentationTick - world.tick);

      for (const [id, { from, to }] of glides) {
        const sprite = sprites.get(id);

        if (!sprite?.visible) {
          continue;
        }

        sprite.position.set(from.x + (to.x - from.x) * poseAlpha,
          from.y + (to.y - from.y) * poseAlpha);
        overlays.get(id)?.position.copyFrom(sprite.position);
        shadows.get(id)?.position.copyFrom(sprite.position);
        displayedDepth(id, sprite, world.entities.get(id)?.kind === 'flyer');
      }

      for (const entity of world.entities.values()) {
        const sprite = sprites.get(entity.id);

        if (!sprite?.visible) {
          continue;
        }

        sprite.tint = entityTint(entity, viewer());
        throwSparks(entity, sprite, dt);

        if (
          entity.kind === 'building' && entity.type === 'raincannon' && entity.rising === 0
          && sprite instanceof Sprite
        ) {
          const texture = textures.get(
            `slot:raincannon:${iceCannonSlot(entity, presentationTick)}`,
          );
          const spot = texture && hotSpots.get(texture);

          if (texture && spot) {
            sprite.texture = texture;
            sprite.anchor.set(spot.x, spot.y);
          }
        }

        if (entity.kind === 'building' && entity.rising > 0 && sprite instanceof Sprite) {
          grow(entity, sprite, dt);
        }

        // A flyer's frames run by the clock, faster than the steps for a Whirligig.
        if (entity.kind === 'flyer' && sprite instanceof Sprite) {
          const slot: [string, number] = [
            entity.type,
            flyerSlot(entity.type, entity.id, presentationTick),
          ];
          retexture(sprite, slot);
          const shadow = shadows.get(entity.id);
          const under = shadowOf(slot);

          if (shadow instanceof Sprite && under) {
            retexture(shadow, under);
          }
        }

        const top = sprite instanceof Sprite
          ? sprite.y - sprite.height * sprite.anchor.y
          : sprite.y;
        const health = healthBars.get(entity.id);

        if (health) {
          health.position.set(sprite.x, top - BAR_GAP - BAR_HEIGHT);
        }

        const construction = constructionBars.get(entity.id);

        if (construction) {
          construction.position.set(sprite.x, top - BAR_GAP);
        }
      }

      drawSparks();

      for (const effect of [...missiles, ...bolts]) {
        // Current-tick projectile interpolation: endpoints are never extrapolated. Removal and
        // impact remain tick-owned, unlike the adjacent-sample (one-tick-latent) entity pose.
        const done = progress(presentationTick, effect.start, effect.ticks);
        effect.sprite.position.set(effect.from.x + (effect.to.x - effect.from.x) * done,
          effect.from.y + (effect.to.y - effect.from.y) * done);
      }

      for (const batch of streamBatches) {
        batch.begin();
      }

      for (const stream of streams.values()) {
        drawStream(stream, presentationTick);
      }

      for (const batch of streamBatches) {
        batch.finish();
      }

      for (let i = placementsAccent.length - 1; i >= 0; i--) {
        const accent = placementsAccent[i]!;
        const done = progress(presentationTick, accent.start, PLACE_TICKS);
        const gone = accent.entity === undefined
          ? !isBridge(world.terrain[world.at(accent.x, accent.y)]!)
          : !world.entities.has(accent.entity);

        if (done >= 1 || gone) {
          accent.graphic?.destroy();
          placementsAccent.splice(i, 1);
          continue;
        }

        if (!accent.graphic) {
          const { sx, sy } = project(accent.x, accent.y);
          accent.graphic = polishG.addChild(new Graphics())
            .rect(sx, sy, accent.w * TW, accent.h * TH)
            .stroke({ color: PROGRESS_COLOR, width: 1 });
        }

        accent.graphic.alpha = 1 - easeOut(done);
      }
    },
  };
}

/** A health bar about its own origin: it is moved to its entity every frame. */
function drawBar(graphics: Graphics, share: number): void {
  const left = -BAR_WIDTH / 2;
  graphics.rect(left, 0, BAR_WIDTH, BAR_HEIGHT).fill(COLOR.barBack);
  graphics.rect(left, 0, BAR_WIDTH * Math.max(0, share), BAR_HEIGHT)
    .fill(share < LOW_HP ? COLOR.barLow : COLOR.barGood);
}

/** The middle of what an entity stands on, in screen pixels. */
function middle(entity: DeepReadonly<Entity>): Point {
  const foot = footprintOf(entity);
  const at = foot ? project(foot.x + foot.w / 2, foot.y + foot.h / 2) : unitSpot(entity);
  return { x: at.sx, y: at.sy };
}

/** Where a unit of one cell is drawn: a flyer at its exact place, the rest mid-cell. */
function unitSpot(entity: DeepReadonly<Entity>): { sx: number; sy: number; } {
  if (entity.kind === 'flyer') {
    return project(entity.px / FLYER_SCALE, entity.py / FLYER_SCALE);
  }

  // A walker is drawn on its way to the next cell of its path, as far as its move has come.
  const [nx, ny] = ('path' in entity && entity.path[0]) || [entity.x, entity.y];
  const share = 'path' in entity ? stepShare(entity) : 0;
  return project(entity.x + (nx - entity.x) * share + CELL_CENTER,
    entity.y + (ny - entity.y) * share + CELL_CENTER);
}

/** Cells a building or a geyser's islet covers; the sprite stands on their bottom edge, which
 * also orders drawing so that nearer things cover those behind. */
function footprintOf(
  entity: DeepReadonly<Entity>,
): { x: number; y: number; w: number; h: number; } | null {
  if (entity.kind === 'building') {
    return { x: entity.x, y: entity.y, w: entity.fx, h: entity.fy };
  }

  // A geyser stands in the middle of its 3×3 islet (World.addGeyser).
  return entity.kind === 'geyser'
    ? { x: entity.x - 1, y: entity.y - 1, w: GEYSER_ISLAND_SIZE, h: GEYSER_ISLAND_SIZE }
    : null;
}

function terrainColor(terrain: number, owner: number, me: number): number {
  if (terrain === Terrain.HardBridge) {
    return COLOR.hardBridge;
  }

  if (terrain === Terrain.Bridge) {
    return COLOR.bridge;
  }

  if (terrain === Terrain.CrackedBridge) {
    return COLOR.crackedBridge;
  }

  if (owner === me) {
    return COLOR.ownLand;
  }

  if (owner) {
    return COLOR.enemyLand;
  }

  return COLOR.neutralLand;
}

function textureKey(entity: DeepReadonly<Entity>): string {
  switch (entity.kind) {
    case 'building':
      return entity.type in FACING_FRAMES ? `${entity.type}:${entity.facing}` : entity.type;
    case 'transport':
    case 'flyer':
      return entity.type;
    case 'priest':
      return entity.state === 'normal' ? 'priest' : 'priest:down';
    case 'geyser':
      return 'geyser';
    case 'crystal':
      return 'nugget';
    case 'obelisk':
      return 'obelisk';
  }
}

function entityAlpha(entity: DeepReadonly<Entity>): number {
  if ('hp' in entity) {
    // An invisible unit is shown as a faint outline to everyone; hiding it from the enemy's
    // screen is a matter for multiplayer.
    return entity.invisible > 0
      ? MIN_ALPHA
      : MIN_ALPHA + ((1 - MIN_ALPHA) * entity.hp) / entity.hpMax;
  }

  return 1;
}

function entityTint(entity: DeepReadonly<Entity>, me: number): number {
  if (entity.kind === 'priest' && entity.owner !== me) {
    return COLOR.enemyPriestTint;
  }

  if (
    (entity.kind === 'building' || entity.kind === 'transport' || entity.kind === 'flyer')
    && entity.owner !== me
  ) {
    return COLOR.enemyBuildingTint;
  }

  return COLOR.noTint;
}

/** The unit type of an entity, by which its hot spot is looked up; a geyser is one too. */
function kindOf(entity: DeepReadonly<Entity>): string {
  return 'type' in entity ? entity.type : entity.kind;
}
