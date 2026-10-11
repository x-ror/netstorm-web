import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { World, W, H } from '@netstorm/sim';
import { iso, TW, TH } from './projection.js';

export function createWorldRenderer(
  world: World,
  terrainG: Graphics,
  entityLayer: Container,
  tex: Map<string, Texture>,
) {
  // --- terrain
  function drawTerrain() {
    terrainG.clear();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = world.terrain[y * W + x];
        if (!t) continue;
        const o = world.owner[y * W + x]!;
        const { sx, sy } = iso(x, y);
        const col = t === 2 ? 0x8a8f99 : o === 1 ? 0x5c7a3a : o === 2 ? 0x7a3a3a : 0x6b5a3a;
        terrainG
          .poly([sx, sy, sx + TW / 2, sy + TH / 2, sx, sy + TH, sx - TW / 2, sy + TH / 2])
          .fill(col)
          .stroke({ color: 0x0b1020, width: 0.5 });
      }
  }

  // --- entities
  const sprites = new Map<number, Sprite | Graphics>();
  entityLayer.sortableChildren = true;
  function syncEntities() {
    for (const e of world.entities.values()) {
      let s = sprites.get(e.id);
      let key =
        e.kind === 'building'
          ? e.type === 'suncannon'
            ? `suncannon:${e.facing}`
            : e.type
          : e.kind === 'transport'
            ? e.type
            : e.kind === 'priest'
              ? e.state === 'normal'
                ? 'priest'
                : 'priest:down'
              : e.kind === 'geyser'
                ? 'geyser'
                : e.kind === 'crystal'
                  ? 'nugget'
                  : '';
      const t = tex.get(key);
      if (!s) {
        if (t) {
          const sp = new Sprite(t);
          sp.anchor.set(0.5, 0.85);
          s = sp;
        } else {
          const g = new Graphics();
          g.circle(0, 0, 4).fill(e.kind === 'building' ? 0xffd166 : 0x66ccff);
          s = g;
        }
        entityLayer.addChild(s);
        sprites.set(e.id, s);
      } else if (s instanceof Sprite && t && s.texture !== t) s.texture = t;
      if (e.kind === 'crystal' && e.carriedBy !== null) {
        s.visible = false;
        continue;
      }
      s.visible = true;
      const cx = e.kind === 'building' ? e.x + e.fx / 2 : e.x + 0.5,
        cy = e.kind === 'building' ? e.y + e.fy / 2 : e.y + 0.5;
      const { sx, sy } = iso(cx, cy);
      s.position.set(sx, sy + TH / 2);
      s.zIndex = sy;
      s.tint =
        e.kind === 'priest' && e.owner !== 1
          ? 0xff9999
          : e.kind === 'building' && e.owner === 2
            ? 0xffb0b0
            : 0xffffff;
      s.alpha = 'hp' in e ? 0.5 + (0.5 * e.hp) / e.hpMax : 1;
    }
    for (const [id, s] of sprites)
      if (!world.entities.has(id)) {
        s.destroy();
        sprites.delete(id);
      }
  }

  let terrainRevision = -1,
    entityTick = -1;
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
