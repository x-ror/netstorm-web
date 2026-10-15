import { Application, Assets, Container, Graphics, TilingSprite, type Texture } from 'pixi.js';
import {
  FixedStepClock,
  aiMove,
  ReplayRecorder,
  TPS,
  playReplay,
  type Command,
  type DefTable,
  type Event as SimEvent,
} from '@netstorm/sim';
import {
  DEFAULT_AI_DELAY,
  happened,
  outcome,
  type Maps,
  type Mission,
  type MissionButton,
  type MissionPage,
} from './game-data.js';
import { type MatchOptions } from './options.js';
import { createMatchWorld, ME } from './setup.js';
import { createWorldRenderer } from './renderer.js';
import { createControls } from './controls.js';
import { createHud } from './hud.js';
import type { Atlas } from './assets.js';
import { loudness, type Sounds } from './sound.js';
import { createMinimap } from './minimap.js';
import { describeEvent } from './messages.js';
import { m } from './paraglide/messages.js';
import { centerOn, snapZoom } from './camera.js';
import { ZOOM } from './projection.js';
import { createUiState } from './ui-state.js';

const HUD_REFRESH_TICKS = 5;

export interface GameData {
  defs: DefTable;
  maps: Maps;
  missions: Mission[];
  textures: Map<string, Texture>;
  /** Where each texture lies in the atlas files, for pictures drawn outside the canvas. */
  atlas: Atlas;
  sounds: Sounds;
  /** Where each unit's pictures hang in its footprint (game-data.ts `hotFeet`). */
  hotFeet: ReadonlyMap<string, readonly [number, number]>;
}

/** Play one local match. Resolves when the player leaves it for the menu. */
export async function runMatch(root: HTMLElement, data: GameData, options: MatchOptions) {
  const world = createMatchWorld(data.defs, data.maps, data.missions, options);
  const mission = data.missions.find((entry) => entry.id === options.mission);
  const match = new ReplayRecorder(world);
  const view = match.view();
  const commands: Command[] = [];
  const ui = createUiState();
  ui.muted = data.sounds.muted; // the choice outlives a match
  // A sound is as loud as its place is near the middle of the screen, measured on the map.
  data.sounds.heard = (at) =>
    loudness(
      Math.hypot(at.x - (window.innerWidth / 2 - camera.x) / camera.scale.x,
        at.y - (window.innerHeight / 2 - camera.y) / camera.scale.y),
    );

  const app = new Application();
  await app.init({
    preference: 'webgl',
    background: '#0b1020',
    resizeTo: window,
    antialias: false,
    // Draw at the screen's own pixels, and put every picture on whole ones: with the zoom levels
    // of camera.ts each pixel of the original is a whole square of screen pixels.
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    roundPixels: true,
  });
  document.body.prepend(app.canvas);
  // The clouds of the Pyrosphere: a 512-pixel tile taken off the original's screen (the picture is
  // in the part of its archive not yet read). It stays put when the map is scrolled, as there; the
  // original also lets it drift slowly, which is not done (`?`).
  const sky = new TilingSprite({ width: app.screen.width, height: app.screen.height });
  app.stage.addChild(sky);

  // Without its picture the sky stays the plain background.
  try {
    sky.texture = await Assets.load<Texture>('sprites/sky.png');
    sky.texture.source.scaleMode = 'nearest';
  } catch {
    sky.visible = false;
  }

  const camera = new Container();
  camera.scale.set(snapZoom(ZOOM));
  app.stage.addChild(camera);
  const terrainG = new Graphics();
  const ground = new Container();
  const entityLayer = new Container();
  const bars = new Graphics();
  const overlay = new Graphics();
  const ghost = new Container();
  camera.addChild(terrainG, ground, entityLayer, bars, ghost, overlay);
  const renderer = createWorldRenderer(view, ME, terrainG, ground, entityLayer, bars, data.textures,
    data.sounds, data.hotFeet);

  root.hidden = false;
  let leave: ((next?: string) => void) | undefined;
  /** Resolved when the match is left, with the mission to go straight on to, if any. */
  const left = new Promise<string | undefined>((resolve) => {
    leave = resolve;
  });
  const clock = new FixedStepClock(TPS);
  // Every other side is played by the computer, each at the pace and with the orders its mission
  // gives it. Its moves are commands like the player's, so the replay records them.
  const aiCommands = () =>
    options.opponent !== 'ai' ? [] : [...world.players.keys()].flatMap((player) => {
      const side = mission?.sides[player];
      const delay = side?.delay ?? mission?.aiDelay ?? DEFAULT_AI_DELAY;
      const due = player !== ME && world.tick % Math.max(1, Math.round(delay * TPS)) === 0;
      return due ? aiMove(view, { ...side?.ai, player }) : [];
    });
  const togglePause = () => {
    ui.paused = !ui.paused;
    clock.reset();
    hud.render();
  };
  const hud = createHud(root, view, ME, ui, {
    setTool: (tool) => controls.setTool(tool),
    togglePause,
    toggleSound: () => {
      ui.muted = !ui.muted;
      data.sounds.muted = ui.muted;
      data.sounds.ambience(true); // start the wind again, or still it
      hud.render();
    },
    salvageSelected: () => controls.salvageSelected(),
    produceSelected: (type) => controls.produceSelected(type),
    upgradeSelected: () => controls.upgradeSelected(),
    meltdownSelected: () => controls.meltdownSelected(),
    castSelected: () => controls.castSelected(),
    dropSelected: () => controls.dropSelected(),
    page: (button) => press(shown[button]),
    exit: () => leave?.(),
  }, data.atlas);
  const controls = createControls({
    world: view,
    me: ME,
    ui,
    app,
    camera,
    overlay,
    ghost,
    textures: data.textures,
    submit: (command) => commands.push(command),
    sounds: data.sounds,
    changed: () => hud.render(),
    togglePause,
    context: (x, y) => hud.context(x, y),
  });
  const minimapCanvas = document.createElement('canvas');
  minimapCanvas.id = 'minimap';
  root.append(minimapCanvas);
  const minimap = createMinimap(minimapCanvas, view, ME, camera);

  const pending: SimEvent[] = [];

  /** Take the tick's events: effects play at once, the log is written with the next HUD refresh. */
  /** Sides whose Priest has been carried off, and those that began with a Temple: what the
   * events of the mission's script ask about. */
  const captured = new Set<number>();
  const temples = new Set([...world.players.keys()].filter((id) => world.templeOf(id)));
  const unread = [...(mission?.messages ?? [])];
  /** Sides whose Priest the player or an ally has brought to safety. */
  const saved = new Set<number>();

  /** The sound of an event of the battle. Spells and transports sound as their .type files say;
   * the rest are matched to the events by the names of the original's sound files (ours). */
  function hear(event: SimEvent): void {
    const mine = event.who === ME;
    const { sounds } = data;

    switch (event.what) {
      case 'bridge':
        return sounds.play(mine ? 'droppiece' : undefined);
      case 'build':
        return sounds.play(mine ? 'somethingcreated' : undefined);
      case 'salvaged':
        return sounds.play(mine ? 'dissolve' : undefined);
      case 'spell':
        return sounds.unit(event.data.spell, 'active');
      case 'cast':
        return sounds.unit(event.data.spell, 'fire');
      case 'captured':
        return sounds.play(mine ? 'enemypriestcaptured' : 'ourpriestcaptured');
      case 'priest down':
        return sounds.play(mine ? 'ourpriestimmobile' : undefined);
      case 'released':
        return sounds.play('priestfree');
      case 'sacrifice':
        return sounds.play('priestsacrifice2');
      default:
        return undefined;
    }
  }

  function takeEvents(): void {
    for (const event of match.drainEvents()) {
      hear(event);

      if (event.what === 'destroyed') {
        renderer.explode(event.data.id);
      } else if (event.what === 'cast') {
        renderer.cast(event.data.transport, event.data.spell);
      } else if (event.what === 'saved' && !world.hostile(event.who, ME)) {
        saved.add(event.data.owner);
      } else if (event.what === 'captured') {
        const priest = world.entities.get(event.data.priest);

        if (priest?.kind === 'priest') {
          captured.add(priest.owner);
        }
      }

      pending.push(event);
    }
  }

  let logId = 0;

  function renderLog(): void {
    const lines = pending.splice(0).flatMap((event) => {
      const line = describeEvent(view, ME, event);
      return line
        ? [{ id: logId++, time: formatTime(event.tick), text: line.text, tone: line.tone }]
        : [];
    });
    hud.log(lines);
  }

  const me = world.priestOf(ME)!;
  centerOn(camera, me.x, me.y);
  (window as unknown as { ns: unknown; }).ns = {
    world,
    match,
    playReplay,
    aiMove,
    camera,
    app,
    terrainG,
    ground,
    entityLayer,
    ui,
  };

  let hudTick = -1;
  let ended = false;
  /** The buttons of the page of the script that is shown, in their order on it. */
  let shown: MissionButton[] = [];

  /**
   * Show a page of the script with its buttons. A page without any goes on with the battle; once
   * the battle is over every page also offers the way back to the menu.
   */
  function show(title: string, page: MissionPage): void {
    shown = page.buttons.filter((button) => button.action !== 'ShowTechnology');

    if (ended) {
      shown = [...shown, { label: m.page_to_menu(), action: 'MissionAbort', arg: '' }];
    } else if (!shown.length) {
      shown = [{ label: m.page_continue(), action: 'DoNothing', arg: '' }];
    }

    hud.showPage(title, page.text, shown.map((button) => button.label));
  }

  /** Do what a button of the script says. */
  function press(button: MissionButton | undefined): void {
    const next = button?.action === 'Tell' ? mission?.pages[button.arg.toLowerCase()] : undefined;

    if (next) {
      show('', next);
    } else if (button?.action === 'DoNothing' && !ended) {
      hud.hidePage();
      ui.paused = false;
      clock.reset();
      hud.render();
    } else if (button?.action === 'MissionBegin') {
      leave?.(button.arg.toLowerCase());
    } else {
      // "LeaveBattle", "MissionAbort" and a "Tell" of a page the mission does not have, such as
      // the "TryAgain" of every failure.
      leave?.();
    }
  }

  const resetClock = () => clock.reset();
  document.addEventListener('visibilitychange', resetClock);
  hud.render();
  renderer.sync();
  minimap.draw();

  app.ticker.add((t) => {
    sky.setSize(app.screen.width, app.screen.height);
    sky.tileScale.set(camera.scale.x);

    if (document.hidden) {
      return;
    }

    const steps = ui.paused ? 0 : clock.advance(t.deltaMS, () => {
      match.step([...commands.splice(0), ...aiCommands()]);
    });
    takeEvents();
    renderer.sync();

    if (ui.selected !== null && !world.entities.has(ui.selected)) {
      ui.selected = null;
    }

    if (steps) {
      controls.drawOverlay();
    }

    if (world.tick - hudTick >= HUD_REFRESH_TICKS) {
      hudTick = world.tick;
      hud.render();
      renderLog();
      minimap.draw();
    }

    const result = ended ? null : outcome(mission, world, ME, saved);
    // One message of the script at a time, the game standing still while it is read.
    const told = result || ui.paused
      ? -1
      : unread.findIndex((message) =>
        message.on.some((event) => happened(event, world, captured, temples))
      );

    if (told >= 0) {
      ui.paused = true;
      show('', unread.splice(told, 1)[0]!);
    }

    if (result) {
      ended = true;
      renderLog();
      const won = result === 'won';
      const page = mission?.pages[won ? 'succeeded' : 'failed'];
      show(won ? m.page_victory() : m.page_defeat(), {
        text: page?.text
          || (won ? m.page_enemy_sacrificed() : m.page_own_sacrificed()),
        buttons: page?.buttons ?? [],
      });
    }
  });

  data.sounds.ambience(true);
  const next = await left;
  data.sounds.ambience(false);
  controls.dispose();
  minimap.dispose();
  hud.dispose();
  document.removeEventListener('visibilitychange', resetClock);
  app.destroy(true, { children: true });
  root.hidden = true;
  delete (window as unknown as { ns?: unknown; }).ns;
  return next;
}

function formatTime(tick: number): string {
  return `${(tick / TPS).toFixed(1)}s`;
}
