import { type Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { type WorldView, type DeepReadonly, type Entity, Terrain, W, H } from '@netstorm/sim';
import { iso, TW, TH } from './projection.js';

const SPRITE_ANCHOR_X = 0.5;
const SPRITE_ANCHOR_Y = 0.85;
const MARKER_RADIUS = 4;
const CELL_CENTER = 0.5;
const MIN_ALPHA = 0.5; // alpha of an entity at zero hp
const BAR_WIDTH = 14;
const BAR_HEIGHT = 2;
const BAR_LIFT = 26; // pixels above the entity's ground point
const COLOR = {
  bridge: 0x8a8f99,
  crackedBridge: 0x5a5148,
  ownLand: 0x5c7a3a,
  enemyLand: 0x7a3a3a,
  neutralLand: 0x6b5a3a,
  buildingMarker: 0xffd166,
  unitMarker: 0x66ccff,
  enemyPriestTint: 0xff9999,
  enemyBuildingTint: 0xffb0b0,
  noTint: 0xffffff,
  barBack: 0x1b1f2a,
  barGood: 0x7bd36b,
  barLow: 0xff5a4a,
} as const;
const LOW_HP = 0.35;

export function createWorldRenderer(
  world: WorldView,
  me: number,
  terrainG: Graphics,
  entityLayer: Container,
  bars: Graphics,
  textures: Map<string, Texture>,
) {
  // --- terrain
  function drawTerrain() {
    terrainG.clear();

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const terrain = world.terrain[y * W + x];

        if (!terrain) {
          continue;
        }

        const owner = world.owner[y * W + x]!;
        const { sx, sy } = iso(x, y);
        const color = terrainColor(terrain, owner, me);
        terrainG
          .poly([sx, sy, sx + TW / 2, sy + TH / 2, sx, sy + TH, sx - TW / 2, sy + TH / 2])
          .fill(color)
          .stroke({ color: 0x0b1020, width: 0.5 });
      }
    }
  }

  // --- entities
  const sprites = new Map<number, Sprite | Graphics>();
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
          newSprite.anchor.set(SPRITE_ANCHOR_X, SPRITE_ANCHOR_Y);
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
      } else if (sprite instanceof Sprite && texture && sprite.texture !== texture) {
        sprite.texture = texture;
      }

      if (entity.kind === 'crystal' && entity.carriedBy !== null) {
        sprite.visible = false;
        continue;
      }

      sprite.visible = true;
      const cx = entity.kind === 'building' ? entity.x + entity.fx / 2 : entity.x + CELL_CENTER;
      const cy = entity.kind === 'building' ? entity.y + entity.fy / 2 : entity.y + CELL_CENTER;
      const { sx, sy } = iso(cx, cy);
      sprite.position.set(sx, sy + TH / 2);
      sprite.zIndex = depth(entity);
      sprite.tint = entityTint(entity, me);
      sprite.alpha = entityAlpha(entity);

      if ('hp' in entity && entity.hp < entity.hpMax) {
        drawBar(sx, sy + TH / 2 - BAR_LIFT, entity.hp / entity.hpMax);
      }
    }

    for (const [id, sprite] of sprites) {
      if (!world.entities.has(id)) {
        sprite.destroy();
        sprites.delete(id);
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
    sync() {
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

/** Draw order: what stands nearer the bottom of the screen covers what is behind it. A building
 * is ordered by its front corner, so a unit walking behind a large building stays hidden. */
function depth(entity: DeepReadonly<Entity>): number {
  if (entity.kind === 'building') {
    return iso(entity.x + entity.fx, entity.y + entity.fy).sy;
  }

  return iso(entity.x + 1, entity.y + 1).sy;
}

function terrainColor(terrain: number, owner: number, me: number): number {
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
      return entity.type === 'suncannon' ? `suncannon:${entity.facing}` : entity.type;
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
