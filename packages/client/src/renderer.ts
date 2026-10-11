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
} from '@netstorm/sim';
import { EXPLOSION_FRAMES, GROUND_FRAMES } from './texture-selection.js';
import { project, TW, TH } from './projection.js';

const SPRITE_ANCHOR_X = 0.5;
const UNIT_ANCHOR_Y = 0.85; // a unit's feet sit a little above the bottom of its frame
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
  cliff: 0x3a2a1c,
  enemyGroundTint: 0xffc8c8,
  barBack: 0x1b1f2a,
  barGood: 0x7bd36b,
  barLow: 0xff5a4a,
  tracer: 0xfff2b0,
} as const;
const LOW_HP = 0.35;

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

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const terrain = world.terrain[y * W + x];

        if (!terrain) {
          continue;
        }

        const owner = world.owner[y * W + x]!;
        const { sx, sy } = project(x, y);
        const texture = textures.get(tileKey(terrain, owner, x, y));

        if (y + 1 < H && !world.terrain[(y + 1) * W + x]) {
          terrainG.rect(sx, sy + TH, TW, CLIFF_HEIGHT).fill(COLOR.cliff);
        }

        if (!texture) {
          terrainG.rect(sx, sy, TW, TH).fill(terrainColor(terrain, owner, me));
          continue;
        }

        const tile = new Sprite(texture);
        tile.position.set(sx, sy);
        tile.tint = owner && owner !== me && !isBridge(terrain)
          ? COLOR.enemyGroundTint
          : COLOR.noTint;
        ground.addChild(tile);
        tiles.push(tile);
      }
    }
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

    const theme = world.players.get(owner)?.theme;
    const set = theme && theme !== 'sun' ? theme : 'neutral';
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
  entityLayer.sortableChildren = true;

  function syncEntities() {
    bars.clear();

    for (const entity of world.entities.values()) {
      let sprite = sprites.get(entity.id);
      const key = textureKey(entity);
      const texture = textures.get(key);

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

      if (entity.kind === 'crystal' && entity.carriedBy !== null) {
        sprite.visible = false;
        continue;
      }

      sprite.visible = true;
      // Large things stand on the bottom edge of their footprint, units on the middle of their cell.
      const foot = footprintOf(entity);
      const { sx, sy } = foot
        ? project(foot.x + foot.w / 2, foot.y + foot.h)
        : project(entity.x + CELL_CENTER, entity.y + CELL_CENTER);
      sprite.position.set(sx, sy);
      sprite.zIndex = sy;
      sprite.tint = entityTint(entity, me);
      sprite.alpha = entityAlpha(entity);

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
      }
    }

    drawTracers();
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

/** Buildings drawn with a frame of their own for each facing. */
const FACING_SPRITES: ReadonlySet<string> = new Set(['suncannon', 'thundercannon']);

function textureKey(entity: DeepReadonly<Entity>): string {
  switch (entity.kind) {
    case 'building':
      return FACING_SPRITES.has(entity.type) ? `${entity.type}:${entity.facing}` : entity.type;
    case 'transport':
      return entity.type;
    case 'priest':
      return entity.state === 'normal' ? 'priest' : 'priest:down';
    case 'geyser':
      return 'geyser';
    case 'crystal':
      return 'nugget';
  }
}

function entityAlpha(entity: DeepReadonly<Entity>): number {
  if ('hp' in entity) {
    return MIN_ALPHA + ((1 - MIN_ALPHA) * entity.hp) / entity.hpMax;
  }

  // A depleted geyser fades out.
  return entity.kind === 'geyser' && entity.stock <= 0 ? MIN_ALPHA : 1;
}

function entityTint(entity: DeepReadonly<Entity>, me: number): number {
  if (entity.kind === 'priest' && entity.owner !== me) {
    return COLOR.enemyPriestTint;
  }

  if ((entity.kind === 'building' || entity.kind === 'transport') && entity.owner !== me) {
    return COLOR.enemyBuildingTint;
  }

  return COLOR.noTint;
}
