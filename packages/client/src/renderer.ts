import { type Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { type WorldView, type DeepReadonly, type Entity, Terrain, W, H } from '@netstorm/sim';
import { iso, TW, TH } from './projection.js';

const SPRITE_ANCHOR_X = 0.5;
const SPRITE_ANCHOR_Y = 0.85;
const MARKER_RADIUS = 4;
const CELL_CENTER = 0.5;
const MIN_ALPHA = 0.5; // alpha of an entity at zero hp
const COLOR = {
  bridge: 0x8a8f99,
  ownLand: 0x5c7a3a,
  enemyLand: 0x7a3a3a,
  neutralLand: 0x6b5a3a,
  buildingMarker: 0xffd166,
  unitMarker: 0x66ccff,
  enemyPriestTint: 0xff9999,
  enemyBuildingTint: 0xffb0b0,
  noTint: 0xffffff,
} as const;

export function createWorldRenderer(
  world: WorldView,
  terrainG: Graphics,
  entityLayer: Container,
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
        const color = terrainColor(terrain, owner);
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
      sprite.zIndex = sy;
      sprite.tint = entityTint(entity);
      sprite.alpha = 'hp' in entity ? MIN_ALPHA + ((1 - MIN_ALPHA) * entity.hp) / entity.hpMax : 1;
    }

    for (const [id, sprite] of sprites) {
      if (!world.entities.has(id)) {
        sprite.destroy();
        sprites.delete(id);
      }
    }
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

function terrainColor(terrain: number, owner: number): number {
  if (terrain === Terrain.Bridge) {
    return COLOR.bridge;
  }

  if (owner === 1) {
    return COLOR.ownLand;
  }

  if (owner === 2) {
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

function entityTint(entity: DeepReadonly<Entity>): number {
  if (entity.kind === 'priest' && entity.owner !== 1) {
    return COLOR.enemyPriestTint;
  }

  if (entity.kind === 'building' && entity.owner === 2) {
    return COLOR.enemyBuildingTint;
  }

  return COLOR.noTint;
}
