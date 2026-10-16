import { type Container, Graphics, Sprite, type Texture } from 'pixi.js';
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
import { MANA_BOLTS, SACRIFICE, overlayOf, shadowOf, slotOf } from './animations.js';
import {
  MISSILES,
  SPELL_BURSTS,
  SHELL_BURST,
  explosionFor,
  impactOf,
  missileSlot,
  missileSpeed,
  type Burst,
} from './effects.js';
import { hotSpots } from './assets.js';
import { unitSound, type Sounds } from './sound.js';

const SPRITE_ANCHOR_X = 0.5;
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
const BEAM_LENGTH = 154; // pixels of the Lightning picture
const BEAM_TICKS = 2;
const ICE_IMPACTS = 4;
const BOMB_DROP = 60; // pixels a Whirligig hangs over the ground it bombs
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
  sunField: 0xffd166,
  acidField: 0x8ee06b,
  arcField: 0x9fd8ff,
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
const BOLT_SPEED = 18; // cells a second: `speed` of manabolt.type
const STREAM_EVERY = 5; // ticks between the streaks of a Storm Power Stream (ours)
const STREAK_CELLS = 4; // cells a streak of the stream is long (ours)
const STREAM_LIFT = 6; // pixels the stream runs above the ground (ours)

/** The point `d` cells along a way, between the points it passes. */
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
const FIELD_WIDTH = 2;
const FIELD_ALPHA = 0.7;
const FIELD_COLOR: Readonly<Record<string, number>> = {
  sunfence: COLOR.sunField,
  rainfence: COLOR.acidField,
  thunderfence: COLOR.arcField,
};

export function createWorldRenderer(
  world: WorldView,
  /** The side looked through: its own are blue, its enemies red. */
  viewer: () => number,
  terrainG: Graphics,
  ground: Container,
  entityLayer: Container,
  bars: Graphics,
  textures: Map<string, Texture>,
  sounds: Sounds,
  hotFeet: ReadonlyMap<string, readonly [number, number]> = new Map(),
) {
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

        const sides = terrain === Terrain.Island ? skyAround(x, y, SIDES) : 0;
        const shore = sides || terrain !== Terrain.Island
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

        const tile = new Sprite(texture);
        // A rim frame is cut down to its picture: it keeps to the side its ground is on.
        tile.position.set(sides & SKY.west ? sx + TW - texture.width : sx,
          sides & SKY.north ? sy + TH - texture.height : sy);
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

  /** Where the island ends around a cell: SKY bits of the neighbours, given as [bit, dx, dy]. */
  function skyAround(x: number, y: number, around: typeof SIDES): number {
    let found = 0;

    for (const [bit, dx, dy] of around) {
      const nx = x + dx;
      const ny = y + dy;
      const island = nx >= 0 && ny >= 0 && nx < W && ny < H
        && world.terrain[ny * W + nx] === Terrain.Island;

      if (!island) {
        found |= bit;
      }
    }

    return found;
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
  /** Cooldowns seen on the previous tick: a shooter whose cooldown went up has fired. */
  const cooldowns = new Map<number, number>();
  const widths = new Map<number, number>(); // footprint width in cells, kept for the explosion
  /** Pictures laid over an entity's own: the whirl of a Temple, the charge of a Thunder Cannon. */
  const overlays = new Map<number, Sprite>();
  /** The middle of each thing that stands still, kept for its explosion. */
  const centres = new Map<number, Point>();
  /** Which way each walker last went (animations.ts). */
  const headings = new Map<number, number>();
  const scene = { world, headings, aims: new Map<number, number>() };
  const shadows = new Map<number, Sprite>();
  /** Where each unit was drawn on the previous tick and this one: between ticks it glides. */
  const glides = new Map<number, { from: Point; to: Point; }>();
  /** Altars with a captive on them. */
  const holding = new Set<number>();
  entityLayer.sortableChildren = true;

  /** Buildings under construction, to hear them finished. */
  const rising = new Set<number>();

  /** A building sounds when it is finished: with the sound of its .type file, or the original's
   * "buildDone" (ours). Units do not sound for what they do by themselves: only when ordered. */
  function listen(entity: DeepReadonly<Entity>): void {
    if (entity.kind !== 'building') {
      return;
    }

    if (entity.rising > 0) {
      rising.add(entity.id);
    } else if (rising.delete(entity.id)) {
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
      entityLayer.addChild(sprite);
      layer.set(id, sprite);
    }

    sprite.texture = texture;
    sprite.visible = true;
    sprite.anchor.set(spot.x, spot.y);
    sprite.position.copyFrom(under.position);
    sprite.zIndex = under.zIndex + z;
    sprite.alpha = under.alpha * alpha;
    // A shadow keeps only its shape: the extraction leaves it in a flat palette colour.
    sprite.tint = layer === shadows ? COLOR.shadow : COLOR.noTint;
  }

  function syncEntities() {
    bars.clear();

    for (const entity of world.entities.values()) {
      let sprite = sprites.get(entity.id);
      const slot = slotOf(entity, world.tick, scene);
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

        entityLayer.addChild(sprite);
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
      const over = bySpot ? overlayOf(entity, world.tick, world) : null;
      attach(overlays, entity.id, over, sprite, OVERLAY_Z, 1);
      attach(shadows, entity.id, bySpot ? shadowOf(slot) : null, sprite, -OVERLAY_Z, SHADOW_ALPHA);

      // An Altar that holds a captive when it goes plays the sacrifice where it stood.
      if (over?.[0] === 'altar' && over[1] > 0) {
        holding.add(entity.id);
      } else {
        holding.delete(entity.id);
      }

      if ('hp' in entity && entity.hp < entity.hpMax) {
        const top = sprite instanceof Sprite ? sy - sprite.height * sprite.anchor.y : sy;
        drawBar(sx, top - BAR_GAP - BAR_HEIGHT, entity.hp / entity.hpMax);
      }
    }

    for (const [id, sprite] of sprites) {
      if (!world.entities.has(id)) {
        sprite.destroy();
        sprites.delete(id);
        cooldowns.delete(id);
        widths.delete(id);
        centres.delete(id);
        rising.delete(id);
        headings.delete(id);
        glides.delete(id);
        scene.aims.delete(id);

        if (holding.delete(id)) {
          burst({ type: 'altar', ...SACRIFICE }, sprite.position, sprite.zIndex);
        }

        for (const layer of [overlays, shadows]) {
          layer.get(id)?.destroy();
          layer.delete(id);
        }
      }
    }

    playEffects();
    flyBolts();
    drawBarriers();
    drawTracers();
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
  const streams = new Map<number, { points: Point[]; cells: number[]; start: number; }>();

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

    for (const [id, stream] of streams) {
      const b = world.entities.get(id);

      if (b?.kind !== 'building' || b.rising === 0) {
        streams.delete(id);
      } else {
        drawStream(stream);
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
  ): { points: Point[]; cells: number[]; start: number; } {
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
  function drawStream(stream: { points: Point[]; cells: number[]; start: number; }): void {
    const { points, cells, start } = stream;
    const length = cells.at(-1) ?? 0;

    if (points.length < 2) {
      return;
    }

    for (let sent = start; sent <= world.tick; sent += STREAM_EVERY) {
      const head = ((world.tick - sent) * BOLT_SPEED) / TPS;
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

      for (const { width, alpha } of STREAK_STROKES) {
        bars.moveTo(line[0]!.x, line[0]!.y - STREAM_LIFT);

        for (const p of line.slice(1)) {
          bars.lineTo(p.x, p.y - STREAM_LIFT);
        }

        bars.stroke({ color: COLOR.stream, width, alpha });
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
    const by = world.entities.get(caster);
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
        beam(show.bolt === 'sky' ? { x: at.x, y: at.y - SKY_BOLT } : middle(by), at);
      }
    }
  }

  /** A line between every two fence posts that are joined into a barrier. */
  function drawBarriers(): void {
    for (const { from, to } of barriers(world)) {
      const a = sprites.get(from.id);
      const b = sprites.get(to.id);

      // An Arc Spire's pulse is a bolt between its two posts.
      const pulsed = from.type === 'thunderfence'
        && from.cooldown > (cooldowns.get(from.id) ?? Infinity);

      if (a && b && pulsed) {
        beam({ x: a.x, y: a.y - a.height / 2 }, { x: b.x, y: b.y - b.height / 2 });
      }

      if (a && b) {
        bars.moveTo(a.x, a.y - a.height / 2)
          .lineTo(b.x, b.y - b.height / 2)
          .stroke({ color: FIELD_COLOR[from.type], width: FIELD_WIDTH, alpha: FIELD_ALPHA });
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
  }[] = [];
  const beams: { sprite: Sprite; until: number; }[] = [];
  /** Where a Sun Cannon's shells land, and on which tick: its missile is not drawn. */
  const shells: { to: Point; land: number; }[] = [];

  /** Show the shot of everything that fired this tick. A gun's missile takes as long as the
   * simulation's, so it lands on the tick its damage is dealt. */
  function drawTracers(): void {
    for (const entity of world.entities.values()) {
      const bomber = entity.kind === 'flyer' && entity.type in MISSILES;

      if (entity.kind !== 'building' && !(entity.kind === 'flyer' && bomber)) {
        continue;
      }

      // A cooldown that merely stands still is not a shot: a building brought down by an explosion
      // waits a tick with its cooldown frozen.
      const fired = entity.hp > 0 && entity.cooldown > (cooldowns.get(entity.id) ?? Infinity);
      cooldowns.set(entity.id, entity.cooldown);
      const from = sprites.get(entity.id);
      const aim = entity.target === null ? undefined : world.entities.get(entity.target);

      if (!fired || !from || !aim) {
        continue;
      }

      // A gun shoots from its top; a Whirligig drops its bomb from where it hangs.
      const start = bomber
        ? { x: from.x, y: from.y - BOMB_DROP }
        : { x: middle(entity).x, y: from.y - from.height * TRACER_LIFT };
      let flight: number | undefined;

      for (const shot of world.shots) {
        if (shot.gun.id === entity.id) {
          flight = shot.land - world.tick; // the last one is the one just fired
        }
      }

      shoot(entity.type, start, middle(aim), flight);
    }

    fly();
  }

  /** Send off what a shooter throws: its missile, a bolt of lightning, or a plain streak. `flight`
   * is the ticks the simulation gives the missile; a bomb works its own out. */
  function shoot(shooter: string, from: Point, to: Point, flight?: number): void {
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
      missiles.push({ sprite, shooter, from, to, start: world.tick, ticks });
      return;
    }

    if (shooter === 'thunderarcher') {
      beam(from, to);
      return;
    }

    if (shooter === 'suncannon') {
      shells.push({ to, land: world.tick + (flight ?? 0) });
    }

    bars.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: COLOR.tracer, width: 1 });
  }

  /** A bolt of lightning between two points: the Lightning type is one picture of a bolt, which
   * is turned and stretched to fit and shown for a moment. */
  function beam(from: Point, to: Point): void {
    const lightning = textures.get('slot:lightning:0');
    const far = Math.hypot(to.x - from.x, to.y - from.y);

    if (!lightning || far === 0) {
      return;
    }

    sounds.play('thundercrack', to);
    const sprite = entityLayer.addChild(new Sprite(lightning));
    sprite.anchor.set(0, SPRITE_ANCHOR_X);
    sprite.position.set(from.x, from.y);
    sprite.rotation = Math.atan2(to.y - from.y, to.x - from.x);
    sprite.scale.x = far / BEAM_LENGTH;
    sprite.zIndex = AIR_Z;
    beams.push({ sprite, until: world.tick + BEAM_TICKS });
  }

  function fly(): void {
    for (let i = missiles.length - 1; i >= 0; i--) {
      const { sprite, shooter, from, to, start, ticks } = missiles[i]!;
      const done = (world.tick - start) / ticks;
      const slot = missileSlot(shooter, to.x - from.x, to.y - from.y, world.tick);
      const texture = textures.get(`slot:${MISSILES[shooter]!.type}:${slot}`);
      const spot = texture && hotSpots.get(texture);

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
      if (world.tick >= shells[i]!.land) {
        burst(SHELL_BURST, shells[i]!.to, AIR_Z);
        shells.splice(i, 1);
      }
    }

    for (let i = beams.length - 1; i >= 0; i--) {
      if (world.tick >= beams[i]!.until) {
        beams[i]!.sprite.destroy();
        beams.splice(i, 1);
      }
    }
  }

  /** Play the explosion of a unit where it stands; call before the next sync removes it. */
  function explode(id: number): void {
    const target = sprites.get(id);
    const at = centres.get(id);

    if (target && at) {
      burst(explosionFor(widths.get(id) ?? 1), at, target.zIndex + 1);
      sounds.play('explosion', at);
    }
  }

  function drawBar(x: number, y: number, share: number): void {
    const left = x - BAR_WIDTH / 2;
    bars.rect(left, y, BAR_WIDTH, BAR_HEIGHT).fill(COLOR.barBack);
    bars.rect(left, y, BAR_WIDTH * Math.max(0, share), BAR_HEIGHT)
      .fill(share < LOW_HP ? COLOR.barLow : COLOR.barGood);
  }

  let terrainRevision = -1;
  let entityTick = -1;
  return {
    explode,
    cast,
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

      if (entityTick !== world.tick) {
        syncEntities();
        entityTick = world.tick;
      }

      // ponytail: the health bar is drawn per tick and does not glide with its unit.
      for (const [id, { from, to }] of glides) {
        const sprite = sprites.get(id);

        if (!sprite?.visible) {
          continue;
        }

        sprite.position.set(from.x + (to.x - from.x) * alpha, from.y + (to.y - from.y) * alpha);
        overlays.get(id)?.position.copyFrom(sprite.position);
        shadows.get(id)?.position.copyFrom(sprite.position);
      }
    },
  };
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
