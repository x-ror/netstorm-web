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
  MISSILE_SPEED,
  SPELL_BURSTS,
  SHELL_BURST,
  explosionFor,
  missileSlot,
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
type Point = { x: number; y: number; };
const BOLT_SPEED = 18; // cells a second: `speed` of manabolt.type
const BOLT_EVERY = 3; // ticks between the bolts sent to one building site (ours)
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
  sounds: Sounds,
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

        // A cell of bridge shows the frame of the sides it joins on, walled where it does not.
        // The frame is a cell and the face under it, hung on a hot spot nine rows down its side.
        if (isBridge(terrain)) {
          const strength = STRENGTHS[terrain] ?? 'whole';
          const slot = bridgeSlot(world.links[y * W + x]!, strength,
            (x * SCATTER_X) ^ (y * SCATTER_Y));
          const plank = textures.get(`slot:bridge:${slot}`);
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
  const widths = new Map<number, number>(); // footprint width in cells, kept for the explosion
  /** Pictures laid over an entity's own: the whirl of a Temple, the charge of a Thunder Cannon. */
  const overlays = new Map<number, Sprite>();
  /** The middle of each thing that stands still, kept for its explosion. */
  const centres = new Map<number, Point>();
  /** Which way each walker last went (animations.ts). */
  const headings = new Map<number, number>();
  const scene = { world, headings, aims: new Map<number, number>() };
  const shadows = new Map<number, Sprite>();
  /** Altars with a captive on them. */
  const holding = new Set<number>();
  entityLayer.sortableChildren = true;

  /** What each unit was doing a tick ago, to hear it start: walking, carrying, being built. */
  const walking = new Set<number>();
  const laden = new Set<number>();
  const rising = new Set<number>();

  /** Play what a unit starts to do: a transport sets off or takes something up, a building is
   * finished. The sounds are those of its .type file; a building without one of its own gets the
   * original's "buildDone" (ours). */
  function listen(entity: DeepReadonly<Entity>): void {
    const at = centres.get(entity.id);

    if (entity.kind === 'building') {
      if (entity.rising > 0) {
        rising.add(entity.id);
      } else if (rising.delete(entity.id)) {
        sounds.play(unitSound(sounds.index, entity.type, 'built') ?? 'builddone', at);
      }

      return;
    }

    if (entity.kind !== 'transport' && entity.kind !== 'priest') {
      return;
    }

    const type = entity.kind === 'priest' ? 'priest' : entity.type;
    const turn = (was: Set<number>, now: boolean, what: 'move' | 'pickup') => {
      if (now && !was.has(entity.id)) {
        sounds.unit(type, what, at);
      }

      if (now) {
        was.add(entity.id);
      } else {
        was.delete(entity.id);
      }
    };
    turn(walking, entity.path.length > 0, 'move');
    turn(laden, entity.carrying !== null, 'pickup');
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
        attach(shadows, entity.id, null, sprite, 0, 0);
        continue;
      }

      sprite.visible = true;
      centres.set(entity.id, middle(entity));
      listen(entity);
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
        centres.delete(id);
        walking.delete(id);
        laden.delete(id);
        rising.delete(id);
        headings.delete(id);
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
   * "The stream of Storm Power goes to the chosen spot": while a unit is built, bolts of its Fury
   * (type Manabolt, 18 cells a second) fly to it from its owner's Temple. That they start at the
   * Temple and how often they leave is ours; the original draws this with particles.
   */
  const bolts: { sprite: Sprite; from: Point; to: Point; start: number; ticks: number; }[] = [];

  function flyBolts(): void {
    for (const b of world.entities.values()) {
      if (
        b.kind !== 'building' || b.rising === 0 || b.builder !== null
        || world.tick % BOLT_EVERY !== 0
      ) {
        continue;
      }

      const home = world.templeOf(b.owner);
      const fury = world.defs.get(b.type)?.theme ?? 'sun';
      const texture = textures.get(`slot:manabolt:${MANA_BOLTS[fury]}`);
      const spot = texture && hotSpots.get(texture);

      if (!home || !texture || !spot || home.id === b.id) {
        continue;
      }

      const from = project(home.x + home.fx / 2, home.y + home.fy / 2);
      const to = project(b.x + b.fx / 2, b.y + b.fy / 2);
      const cells = Math.hypot(b.x - home.x, b.y - home.y);
      const sprite = entityLayer.addChild(new Sprite(texture));
      sprite.anchor.set(spot.x, spot.y);
      sprite.zIndex = AIR_Z;
      bolts.push({
        sprite,
        from: { x: from.sx, y: from.sy },
        to: { x: to.sx, y: to.sy },
        start: world.tick,
        ticks: Math.max(1, Math.round((cells / BOLT_SPEED) * TPS)),
      });
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

  /** Show the shot of everything that fired this tick. Shots are not simulated as projectiles:
   * this only shows who has hit whom. */
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
      shoot(entity.type, start, middle(aim));
    }

    fly();
  }

  /** Send off what a shooter throws: its missile, a bolt of lightning, or a plain streak. */
  function shoot(shooter: string, from: Point, to: Point): void {
    sounds.unit(shooter, 'fire', from);
    const missile = MISSILES[shooter];
    const first = missile ? textures.get(`slot:${missile.type}:0`) : undefined;

    if (missile && first) {
      const far = Math.hypot(to.x - from.x, to.y - from.y);
      const sprite = entityLayer.addChild(new Sprite(first));
      sprite.zIndex = AIR_Z;
      // The speed is in cells; a cell is TW pixels wide. A bomb takes at least its six frames.
      const ticks = Math.max(missile.blast ? missile.frames : 1,
        Math.round((far / TW / MISSILE_SPEED) * TPS));
      missiles.push({ sprite, shooter, from, to, start: world.tick, ticks });
      return;
    }

    if (shooter === 'thunderarcher') {
      beam(from, to);
      return;
    }

    if (shooter === 'suncannon') {
      burst(SHELL_BURST, to, AIR_Z);
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
        // The game picks one of the Ice Cannon's impact sounds at random; here by the tick.
        sounds.play(
          shooter === 'raincannon' ? `icecannonimpact${1 + (world.tick % ICE_IMPACTS)}` : undefined,
          to,
        );

        if (blast) {
          burst(blast, to, AIR_Z);
        }

        sprite.destroy();
        missiles.splice(i, 1);
        continue;
      }

      sprite.texture = texture;
      sprite.anchor.set(spot.x, spot.y);
      sprite.position.set(from.x + (to.x - from.x) * done, from.y + (to.y - from.y) * done);
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

/** The middle of what an entity stands on, in screen pixels. */
function middle(entity: DeepReadonly<Entity>): Point {
  const foot = footprintOf(entity);
  const at = foot ? project(foot.x + foot.w / 2, foot.y + foot.h / 2) : unitSpot(entity);
  return { x: at.sx, y: at.sy };
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
