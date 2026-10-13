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
  barriers,
  FLYER_SCALE,
} from '@netstorm/sim';
import {
  EXPLOSION_FRAMES,
  FACING_FRAMES,
  GROUND_FRAMES,
  fringeSlot,
  SKY,
  shoreFrame,
} from './texture-selection.js';
import { project, TW, TH } from './projection.js';
import { SACRIFICE, overlayOf, shadowOf, slotOf } from './animations.js';
import { hotSpots } from './assets.js';

const SPRITE_ANCHOR_X = 0.5;
const UNIT_ANCHOR_Y = 0.85; // a unit's feet sit a little above the bottom of its frame
const FRINGE_DROP = 44; // from the top of a rim cell down to the hot spot of its Fringe
const FRINGE_SCATTER = 3;
const CLIFF_HEIGHT = 6; // rock face drawn under an island's southern rim
const SCATTER_X = 7;
const SCATTER_Y = 13;
const BAR_GAP = 2; // pixels between a sprite's top and its health bar
const EXPLOSION_FRAME_MS = 70;
const EXPLOSION_CELLS = 2; // footprint width the small explosion covers at scale 1
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
  enemyGroundTint: 0xffc8c8,
  barBack: 0x1b1f2a,
  barGood: 0x7bd36b,
  barLow: 0xff5a4a,
  tracer: 0xfff2b0,
  sunField: 0xffd166,
  acidField: 0x8ee06b,
  arcField: 0x9fd8ff,
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
  me: number,
  terrainG: Graphics,
  ground: Container,
  entityLayer: Container,
  bars: Graphics,
  textures: Map<string, Texture>,
) {
  // --- terrain: a tile per cell, a cliff face under each southern rim, colours where tiles are missing
  const tiles: Sprite[] = [];

  function drawTerrain() {
    terrainG.clear();

    for (const tile of tiles.splice(0)) {
      tile.destroy();
    }

    const hanging: Sprite[] = [];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const terrain = world.terrain[y * W + x];

        if (!terrain) {
          continue;
        }

        const owner = world.owner[y * W + x]!;
        const { sx, sy } = project(x, y);
        const sides = terrain === Terrain.Island ? skyAround(x, y, SIDES) : 0;
        const shore = sides || terrain !== Terrain.Island
          ? shoreFrame(sides, 0, x + y)
          : shoreFrame(0, skyAround(x, y, CORNERS), x + y);
        const texture = (shore === undefined
          ? undefined
          : textures.get(`shore:${groundSet(owner)}:${shore}`))
          ?? textures.get(tileKey(terrain, owner, x, y));
        // The southern rim frames carry their own rock face.
        const faced = shore !== undefined && (sides & SKY.south) !== 0;

        if (!faced && y + 1 < H && !world.terrain[(y + 1) * W + x]) {
          terrainG.rect(sx, sy + TH, TW, CLIFF_HEIGHT).fill(COLOR.cliff);
        }

        if (!texture) {
          terrainG.rect(sx, sy, TW, TH).fill(terrainColor(terrain, owner, me));
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
        tile.tint = owner && owner !== me && !isBridge(terrain)
          ? COLOR.enemyGroundTint
          : COLOR.noTint;
        ground.addChild(tile);
        tiles.push(tile);
      }
    }

    // The rock hangs behind the ground: under every tile.
    for (const rock of hanging) {
      ground.addChildAt(rock, 0);
      tiles.push(rock);
    }
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
  const explosions: { sprite: Sprite; start: number; }[] = [];
  const widths = new Map<number, number>(); // footprint width in cells, kept for the explosion
  /** Pictures laid over an entity's own: the whirl of a Temple, the charge of a Thunder Cannon. */
  const overlays = new Map<number, Sprite>();
  /** Which way each walker last went (animations.ts). */
  const headings = new Map<number, number>();
  const scene = { world, headings, aims: new Map<number, number>() };
  const shadows = new Map<number, Sprite>();
  /** Altars with a captive on them. */
  const holding = new Set<number>();
  entityLayer.sortableChildren = true;

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
        attach(shadows, entity.id, null, sprite, 0, 0);
        continue;
      }

      sprite.visible = true;
      // Large things stand on the bottom edge of their footprint, units on the middle of their cell.
      const foot = footprintOf(entity);
      const { sx, sy } = foot
        ? project(foot.x + (bySpot ? foot.w : foot.w / 2), foot.y + foot.h)
        : unitSpot(entity);
      sprite.position.set(sx, sy);
      // A flyer is drawn over everything on the ground.
      sprite.zIndex = entity.kind === 'flyer' ? AIR_Z : sy;
      sprite.tint = entityTint(entity, me);
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
        headings.delete(id);
        scene.aims.delete(id);

        if (holding.delete(id)) {
          effects.push({ at: sprite.position.clone(), z: sprite.zIndex, start: world.tick });
        }

        for (const layer of [overlays, shadows]) {
          layer.get(id)?.destroy();
          layer.delete(id);
        }
      }
    }

    playEffects();
    drawBarriers();
    drawTracers();
  }

  /** Sacrifices in progress: the frames of the Altar type played once where an altar stood. */
  const effects: { at: { x: number; y: number; }; z: number; start: number; sprite?: Sprite; }[] =
    [];

  function playEffects(): void {
    for (let i = effects.length - 1; i >= 0; i--) {
      const effect = effects[i]!;
      const frame = world.tick - effect.start;
      const texture = textures.get(`slot:altar:${SACRIFICE.first + frame}`);
      const spot = texture && hotSpots.get(texture);

      if (frame >= SACRIFICE.frames || !texture || !spot) {
        effect.sprite?.destroy();
        effects.splice(i, 1);
        continue;
      }

      effect.sprite ??= entityLayer.addChild(new Sprite(texture));
      effect.sprite.texture = texture;
      effect.sprite.anchor.set(spot.x, spot.y);
      effect.sprite.position.set(effect.at.x, effect.at.y);
      effect.sprite.zIndex = effect.z;
    }
  }

  /** A line between every two fence posts that are joined into a barrier. */
  function drawBarriers(): void {
    for (const { from, to } of barriers(world)) {
      const a = sprites.get(from.id);
      const b = sprites.get(to.id);

      if (a && b) {
        bars.moveTo(a.x, a.y - a.height / 2)
          .lineTo(b.x, b.y - b.height / 2)
          .stroke({ color: FIELD_COLOR[from.type], width: FIELD_WIDTH, alpha: FIELD_ALPHA });
      }
    }
  }

  /** A line from each shooter that fired this tick to its target. Shots are not simulated as
   * projectiles, so this only shows who is shooting whom. */
  function drawTracers(): void {
    for (const entity of world.entities.values()) {
      if (entity.kind !== 'building') {
        continue;
      }

      // A cooldown that merely stands still is not a shot: a building brought down by an explosion
      // waits a tick with its cooldown frozen.
      const fired = entity.hp > 0 && entity.cooldown > (cooldowns.get(entity.id) ?? Infinity);
      cooldowns.set(entity.id, entity.cooldown);
      const from = sprites.get(entity.id);
      const to = entity.target === null ? undefined : sprites.get(entity.target);

      if (!fired || !from || !to) {
        continue;
      }

      bars.moveTo(from.x, from.y - from.height * TRACER_LIFT)
        .lineTo(to.x, to.y - to.height / 2)
        .stroke({ color: COLOR.tracer, width: 1 });
    }
  }

  /** Play the explosion where an entity's sprite stands; call before the next sync removes it. */
  function explode(id: number): void {
    const target = sprites.get(id);
    const first = textures.get('explosion:0');

    if (!target || !first) {
      return;
    }

    const sprite = new Sprite(first);
    sprite.anchor.set(SPRITE_ANCHOR_X, 1);
    sprite.position.copyFrom(target.position);
    sprite.scale.set(Math.max(1, (widths.get(id) ?? 1) / EXPLOSION_CELLS));
    sprite.zIndex = target.zIndex + 1;
    entityLayer.addChild(sprite);
    explosions.push({ sprite, start: performance.now() });
  }

  function animate(now: number): void {
    for (let i = explosions.length - 1; i >= 0; i--) {
      const { sprite, start } = explosions[i]!;
      const frame = Math.floor((now - start) / EXPLOSION_FRAME_MS);
      const texture = textures.get(`explosion:${frame}`);

      if (frame >= EXPLOSION_FRAMES.length || !texture) {
        sprite.destroy();
        explosions.splice(i, 1);
      } else {
        sprite.texture = texture;
      }
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
    sync() {
      animate(performance.now());

      if (terrainRevision !== world.terrainRevision) {
        drawTerrain();
        terrainRevision = world.terrainRevision;
      }

      if (entityTick !== world.tick) {
        syncEntities();
        entityTick = world.tick;
      }
    },
  };
}

/** Where a unit of one cell is drawn: a flyer at its exact place, the rest mid-cell. */
function unitSpot(entity: DeepReadonly<Entity>): { sx: number; sy: number; } {
  return entity.kind === 'flyer'
    ? project(entity.px / FLYER_SCALE, entity.py / FLYER_SCALE)
    : project(entity.x + CELL_CENTER, entity.y + CELL_CENTER);
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

  // A depleted geyser fades out.
  return entity.kind === 'geyser' && entity.stock <= 0 ? MIN_ALPHA : 1;
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
