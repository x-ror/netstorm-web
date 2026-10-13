import { type Application, type Container, type Graphics, Sprite, type Texture } from 'pixi.js';
import {
  DIRS,
  ENERGY_RANGE,
  PIECES,
  pieceEnds,
  ROTATION_MASK,
  rotateLinks,
  rotatePiece,
  type Command,
  type DeepReadonly,
  type Entity,
  type Facing,
  type UnitDef,
  type WorldView,
} from '@netstorm/sim';
import { project, TW, TH } from './projection.js';
import { hotSpots } from './assets.js';
import { unitSound, type Sounds } from './sound.js';
import { bridgeSlot } from './texture-selection.js';
import { cellAt, zoomAt } from './camera.js';
import { anchorFor, entityAt, hasFacing, type Tool, type UiState } from './ui-state.js';

const ZOOM_IN = 1.1;
const ZOOM_OUT = 0.9;
const PAN_STEP = 48; // screen pixels per arrow key press
const DRAG_THRESHOLD = 6; // screen pixels a press may move and still count as a click
const CELL_HALF = 0.5;
const ARC_TAN = 0.577; // tan 30°, half the width of the Crossbow's arc at a distance of one
// Size, in cells, of the mark at an open end of a piece: across the edge and along it.
const END_DEPTH = 0.3;
const END_WIDTH = 0.6;
const PLANK_DROP = 9; // from the top of a cell down to the hot spot of its Bridge frame
const PLANK_ALPHA = 0.75;
const COLOR = {
  plank: 0xffffff,
  valid: 0xffd166,
  invalid: 0xff4444,
  selection: 0xffffff,
  hover: 0x9fd3ff,
  path: 0x9fd3ff,
  energy: 0x66ccff,
  reach: 0xff9f43,
} as const;
const GHOST_ALPHA = 0.5;
const ENERGY_ALPHA = 0.35;
const PATH_DOT = 1.5;
const AIM_DISTANCE = 3; // cells from the cursor to the cannon aim marker
const AIM_RADIUS = 2;

type View = DeepReadonly<Entity>;

function cellPoly(x: number, y: number): number[] {
  return rectPoly(x, y, 1, 1);
}

/** Outline of a rectangle of cells. */
function rectPoly(x: number, y: number, w: number, h: number): number[] {
  const { sx, sy } = project(x, y);
  return [sx, sy, sx + w * TW, sy, sx + w * TW, sy + h * TH, sx, sy + h * TH];
}

function footprint(entity: View): number[] {
  return entity.kind === 'building'
    ? rectPoly(entity.x, entity.y, entity.fx, entity.fy)
    : cellPoly(entity.x, entity.y);
}

/** First cell, along one axis, of a cannon's line of fire in direction `d` (-1, 0 or 1). */
function lineStart(d: number, origin: number, foot: number, centre: number, range: number): number {
  if (d > 0) {
    return origin + foot;
  }

  return d < 0 ? origin - range : centre;
}

/** Browser input becomes commands; only the fixed-step loop submits them to the world. */
export function createControls(options: {
  world: WorldView;
  me: number;
  ui: UiState;
  app: Application;
  camera: Container;
  overlay: Graphics;
  /** Where the piece under the cursor is drawn, and the textures to draw it with. */
  ghost: Container;
  textures: ReadonlyMap<string, Texture>;
  submit: (command: Command) => void;
  sounds: Sounds;
  /** Called after the interface state changed and the panels should be redrawn. */
  changed: () => void;
  togglePause: () => void;
}) {
  const { world, me, ui, app, camera, overlay, ghost, textures, submit, changed, sounds } = options;
  const abort = new AbortController();
  const signal = abort.signal;

  function setTool(tool: Tool): void {
    ui.tool = tool;
    changed();
    drawOverlay();
  }

  function own(entity: View | undefined): boolean {
    return !!entity && 'owner' in entity && entity.owner === me;
  }

  function salvage(entity: View | undefined): void {
    if ((entity?.kind === 'building' || entity?.kind === 'transport') && entity.owner === me) {
      submit({ t: 'salvage', player: me, target: entity.id });
    }
  }

  function handIndex(tool: Extract<Tool, { kind: 'piece'; }>): number {
    return Math.min(tool.hand, world.players.get(me)!.hand.length - 1);
  }

  /** A left click or tap on map cell (x, y). */
  function primary(x: number, y: number): void {
    const tool = ui.tool;

    if (tool.kind === 'piece') {
      const hand = handIndex(tool);

      if (hand >= 0) {
        submit({ t: 'dropPiece', player: me, hand, x, y, rot: ui.rot });
      }

      return;
    }

    if (tool.kind === 'build') {
      const def = world.def(tool.type);
      submit({
        t: 'build',
        player: me,
        type: def.id,
        ...anchorFor(def, x, y),
        ...(hasFacing(def) ? { facing: ui.facing } : {}),
      });
      return;
    }

    const target = entityAt(world, x, y);

    if (tool.kind === 'salvage') {
      salvage(target);
      return;
    }

    if (order(x, y, target)) {
      // The unit answers its order: a carrier sent for something with its pickup sound.
      voice(world.entities.get(ui.selected!), target ? 'pickup' : 'move');
      return;
    }

    ui.selected = target?.id ?? null;
    voice(target, 'move');
    changed();
    drawOverlay();
  }

  /**
   * The sound of a unit the player has just picked or ordered. A unit is heard when the player
   * turns to it, not for what it does by itself. One with no sound of its own, and anything that
   * is not the player's, gives the plain click.
   */
  function voice(entity: View | undefined, what: 'move' | 'pickup' | 'drop'): void {
    if (!entity) {
      return;
    }

    const type = 'type' in entity ? entity.type : entity.kind; // a Priest's type is his kind
    sounds.play((own(entity) ? unitSound(sounds.index, type, what) : undefined) ?? 'select');
  }

  /** Give the selected unit an order for the clicked spot; false when the click is a selection. */
  function order(x: number, y: number, target: View | undefined): boolean {
    const selected = ui.selected === null ? undefined : world.entities.get(ui.selected);

    if (!selected || !own(selected) || own(target)) {
      return false;
    }

    // The Priest fetches crystals as a transport does; everything else is for transports only.
    if ((selected.kind === 'transport' || selected.kind === 'priest') && target) {
      const transport = selected.id;

      if (target.kind === 'geyser') {
        submit({ t: 'collect', player: me, transport, geyser: target.id });
        return true;
      }

      if (target.kind === 'crystal') {
        submit({ t: 'pickupCrystal', player: me, transport, crystal: target.id });
        return true;
      }

      if (selected.kind === 'transport' && target.kind === 'obelisk') {
        submit({ t: 'takeSpell', player: me, transport, obelisk: target.id });
        return true;
      }

      // A fallen enemy Priest is carried off to the Altar; where the mission allows it, a friendly
      // one is carried home to safety.
      const friend = target.kind === 'priest' && !world.hostile(me, target.owner);

      if (
        selected.kind === 'transport' && target.kind === 'priest'
        && (friend ? world.anyCapture : target.state === 'down')
      ) {
        submit({ t: 'capturePriest', player: me, transport, target: target.id });
        return true;
      }
    }

    if (selected.kind === 'priest' && target?.kind !== 'building') {
      submit({ t: 'movePriest', player: me, x, y });
      return true;
    }

    return false;
  }

  /** Right click or Escape: drop the current tool, then the selection. */
  function cancel(): void {
    if (ui.tool.kind !== 'select') {
      setTool({ kind: 'select' });
    } else if (ui.selected !== null) {
      ui.selected = null;
      changed();
      drawOverlay();
    }
  }

  // --- pointer: mouse, pen and touch
  const pointers = new Map<number, { x: number; y: number; }>();
  let press:
    | { id: number; button: number; x: number; y: number; cx: number; cy: number; moved: boolean; }
    | null = null;
  let pinch: number | null = null; // distance between two touches

  const distance = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  app.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault(), { signal });
  app.canvas.addEventListener('pointerdown', (ev) => {
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size === 2) {
      pinch = distance();
      press = null;
      return;
    }

    press = {
      id: ev.pointerId,
      button: ev.button,
      x: ev.clientX,
      y: ev.clientY,
      cx: camera.x,
      cy: camera.y,
      moved: false,
    };
  }, { signal });

  window.addEventListener('pointermove', (ev) => {
    if (pointers.has(ev.pointerId)) {
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    }

    if (pinch !== null && pointers.size === 2) {
      const now = distance();
      const [a, b] = [...pointers.values()];
      zoomAt(camera, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2, now / (pinch || now));
      pinch = now;
      return;
    }

    if (press && press.id === ev.pointerId) {
      const dx = ev.clientX - press.x;
      const dy = ev.clientY - press.y;
      press.moved ||= Math.hypot(dx, dy) > DRAG_THRESHOLD;
      // The left mouse button keeps clicking; other buttons and a finger drag the camera.
      const pans = press.button !== 0 || ev.pointerType === 'touch';

      if (pans && press.moved) {
        camera.x = press.cx + dx;
        camera.y = press.cy + dy;
      }
    }

    if (ev.target === app.canvas) {
      const cell = cellAt(camera, ev.clientX, ev.clientY);

      if (cell.x !== ui.hover.x || cell.y !== ui.hover.y) {
        ui.hover = cell;
        drawOverlay();
      }
    }
  }, { signal });

  const release = (ev: PointerEvent) => {
    pointers.delete(ev.pointerId);

    if (pointers.size < 2) {
      pinch = null;
    }

    if (!press || press.id !== ev.pointerId) {
      return;
    }

    const click = !press.moved && ev.type === 'pointerup';
    const button = press.button;
    press = null;

    if (!click) {
      return;
    }

    if (button === 0) {
      const cell = cellAt(camera, ev.clientX, ev.clientY);
      ui.hover = cell;
      primary(cell.x, cell.y);
    } else if (button === 2) {
      cancel();
    }
  };
  window.addEventListener('pointerup', release, { signal });
  window.addEventListener('pointercancel', release, { signal });

  app.canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    zoomAt(camera, ev.clientX, ev.clientY, ev.deltaY < 0 ? ZOOM_IN : ZOOM_OUT);
  }, { signal, passive: false });

  // --- keyboard
  const PAN: Record<string, [number, number]> = {
    ArrowLeft: [1, 0],
    ArrowRight: [-1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };

  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement) {
      return;
    }

    const key = ev.key.toLowerCase();
    const slot = Number(ev.key);
    const pan = PAN[ev.key];

    if (pan) {
      camera.x += pan[0] * PAN_STEP;
      camera.y += pan[1] * PAN_STEP;
      ev.preventDefault();
    } else if (key === 'r' || key === 'к') {
      ui.rot = (ui.rot + 1) & ROTATION_MASK;
      sounds.play('rotatepiece');
    } else if (key === 'f' || key === 'а') {
      ui.facing = ((ui.facing + 1) & ROTATION_MASK) as Facing;
    } else if (key === 'escape') {
      cancel();
    } else if (key === ' ') {
      ev.preventDefault();
      options.togglePause();
    } else if (key === 'delete') {
      salvage(ui.selected === null ? undefined : world.entities.get(ui.selected));
    } else if (Number.isInteger(slot) && slot >= 1 && slot <= world.bridgeSlots) {
      ui.tool = { kind: 'piece', hand: slot - 1 };
    } else {
      return;
    }

    changed();
    drawOverlay();
  }, { signal });

  // --- overlay: placement ghost, energy circles, selection
  function drawGhost(): void {
    const { x, y } = ui.hover;
    const tool = ui.tool;
    let cells: [number, number][] = [];
    let error = false;

    ghost.removeChildren().forEach((plank) => plank.destroy());

    if (tool.kind === 'piece') {
      const piece = world.players.get(me)!.hand[handIndex(tool)];
      cells = piece
        ? rotatePiece(PIECES[piece.piece]!, ui.rot).map(([dx, dy]) => [x + dx, y + dy])
        : [];
      error = piece !== undefined
        && world.canDropPiece({ player: me, hand: handIndex(tool), x, y, rot: ui.rot }) !== null;

      // The piece is shown as the bridge it will be, red where it cannot lie.
      if (piece && drawPlanks(cells, rotateLinks(piece.piece, ui.rot), error)) {
        return;
      }
    } else if (tool.kind === 'build') {
      const def = world.def(tool.type);
      const anchor = anchorFor(def, x, y);
      error = world.canBuild({
        player: me,
        type: def.id,
        ...anchor,
        ...(hasFacing(def) ? { facing: ui.facing } : {}),
      }) !== null;
      cells = Array.from({ length: def.footX * def.footY }, (_, index) => [
        anchor.x + (index % def.footX),
        anchor.y + Math.floor(index / def.footX),
      ]);
      drawEnergy();
      drawReach(def, anchor.x, anchor.y, ui.facing);

      if (hasFacing(def)) {
        const [dx, dy] = DIRS[ui.facing]!;
        const aim = project(x + dx * AIM_DISTANCE + 1 / 2, y + dy * AIM_DISTANCE + 1 / 2);
        overlay.circle(aim.sx, aim.sy, AIM_RADIUS).fill(COLOR.invalid);
      }
    }

    const style = { color: error ? COLOR.invalid : COLOR.valid, alpha: GHOST_ALPHA };

    for (const [cx, cy] of cells) {
      // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- Pixi fills geometry with a paint style, not an array.
      overlay.poly(cellPoly(cx, cy)).fill(style);
    }

    if (tool.kind === 'piece') {
      drawEnds(x, y, handIndex(tool));
    }
  }

  /** Draw the cells of a piece with their Bridge frames, top row first; false if the frames are
   * not there to draw with. */
  function drawPlanks(cells: [number, number][], links: number[], error: boolean): boolean {
    const rows = cells.map((cell, i) => [cell, links[i]!] as const)
      .sort(([a], [b]) => a[1] - b[1] || a[0] - b[0]);

    for (const [[cx, cy], joins] of rows) {
      const texture = textures.get(`slot:bridge:${bridgeSlot(joins, 'whole', 1)}`);
      const spot = texture && hotSpots.get(texture);

      if (!texture || !spot) {
        return false;
      }

      const plank = ghost.addChild(new Sprite(texture));
      const { sx, sy } = project(cx, cy);
      plank.anchor.set(spot.x, spot.y);
      plank.position.set(sx + TW - 1, sy + PLANK_DROP);
      plank.alpha = PLANK_ALPHA;
      plank.tint = error ? COLOR.invalid : COLOR.plank;
    }

    return true;
  }

  /** Mark the open ends of the piece under the cursor: it attaches by these and nowhere else. */
  function drawEnds(x: number, y: number, hand: number): void {
    const piece = world.players.get(me)!.hand[hand];

    if (!piece) {
      return;
    }

    for (const [cx, cy, dir] of pieceEnds(piece.piece, ui.rot)) {
      const [dx, dy] = DIRS[dir]!;
      const centreX = x + cx + CELL_HALF + dx * CELL_HALF;
      const centreY = y + cy + CELL_HALF + dy * CELL_HALF;
      // A bar across the edge the end points through.
      const w = dx ? END_DEPTH : END_WIDTH;
      const h = dx ? END_WIDTH : END_DEPTH;
      overlay.poly(rectPoly(centreX - w / 2, centreY - h / 2, w, h)).fill(COLOR.selection);
    }
  }

  /** Where a shooter can hit, measured as the simulation does from its centre cell: a square of
   * its range for most shooters, a straight line from the muzzle for cannons. */
  function drawReach(def: Readonly<UnitDef>, x: number, y: number, facing: Facing): void {
    if (!def.dps || !def.range) {
      return;
    }

    const cx = x + (def.footX >> 1);
    const cy = y + (def.footY >> 1);
    const style = { color: COLOR.reach, alpha: ENERGY_ALPHA, width: 1 };

    if (def.id === 'windarcher') {
      // The Crossbow's arc: 30° either side of the way it faces.
      const [ax, ay] = DIRS[facing]!;
      const reach = def.range;
      const spread = reach * ARC_TAN;
      const corner = (side: number) =>
        project(cx + CELL_HALF + ax * reach - ay * spread * side,
          cy + CELL_HALF + ay * reach + ax * spread * side);
      const tip = project(cx + CELL_HALF, cy + CELL_HALF);
      const left = corner(-1);
      const right = corner(1);
      overlay.poly([tip.sx, tip.sy, left.sx, left.sy, right.sx, right.sy]).stroke(style);
      return;
    }

    if (def.group !== 'cannon') {
      overlay.poly(rectPoly(cx - def.range, cy - def.range, def.range * 2 + 1, def.range * 2 + 1))
        .stroke(style);
      return;
    }

    const [dx, dy] = DIRS[facing]!;
    const startX = lineStart(dx, x, def.footX, cx, def.range);
    const startY = lineStart(dy, y, def.footY, cy, def.range);
    overlay.poly(rectPoly(startX, startY, dx ? def.range : 1, dy ? def.range : 1)).stroke(style);
  }

  /** The circles over which the player's Temple and Generators supply energy. */
  function drawEnergy(): void {
    const rx = ENERGY_RANGE * TW;
    const ry = ENERGY_RANGE * TH;

    for (const building of world.buildingsOf(me)) {
      const def = world.def(building.type);

      if (def.cls !== 'Energy' && def.group !== 'battery') {
        continue;
      }

      const centre = project(building.x + building.fx / 2, building.y + building.fy / 2);
      overlay.ellipse(centre.sx, centre.sy, rx, ry)
        .stroke({ color: COLOR.energy, alpha: ENERGY_ALPHA, width: 1 });
    }
  }

  function drawOverlay(): void {
    overlay.clear();
    drawGhost();

    if (ui.tool.kind === 'select' || ui.tool.kind === 'salvage') {
      const hovered = entityAt(world, ui.hover.x, ui.hover.y);

      if (hovered && hovered.id !== ui.selected) {
        overlay.poly(footprint(hovered)).stroke({
          color: COLOR.hover,
          width: 1,
          alpha: GHOST_ALPHA,
        });
      }
    }

    const selected = ui.selected === null ? undefined : world.entities.get(ui.selected);

    if (!selected) {
      return;
    }

    overlay.poly(footprint(selected)).stroke({ color: COLOR.selection, width: 1 });

    if (selected.kind === 'building') {
      drawReach(world.def(selected.type), selected.x, selected.y, selected.facing);
    }

    if ('path' in selected) {
      for (const [px, py] of selected.path) {
        const { sx, sy } = project(px + 1 / 2, py + 1 / 2);
        // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- Pixi fills geometry with a paint style, not an array.
        overlay.circle(sx, sy, PATH_DOT).fill({ color: COLOR.path, alpha: GHOST_ALPHA });
      }
    }
  }

  return {
    setTool,
    drawOverlay,
    dropSelected() {
      if (ui.selected !== null) {
        submit({ t: 'dropCargo', player: me, transport: ui.selected });
        voice(world.entities.get(ui.selected), 'drop');
      }
    },
    castSelected() {
      if (ui.selected !== null) {
        submit({ t: 'castSpell', player: me, transport: ui.selected });
      }
    },
    meltdownSelected() {
      if (ui.selected !== null) {
        submit({ t: 'meltdown', player: me, target: ui.selected });
      }
    },
    salvageSelected() {
      salvage(ui.selected === null ? undefined : world.entities.get(ui.selected));
    },
    dispose() {
      abort.abort();
    },
  };
}
