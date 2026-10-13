import { Application, Container, Graphics, type Texture } from 'pixi.js';
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
import { type MatchOptions } from './menu.js';
import { createMatchWorld, ME } from './setup.js';
import { createWorldRenderer } from './renderer.js';
import { createControls } from './controls.js';
import { createHud } from './hud.js';
import { createMinimap } from './minimap.js';
import { describeEvent } from './messages.js';
import { centerOn } from './camera.js';
import { ZOOM } from './projection.js';
import { createUiState } from './ui-state.js';

const HUD_REFRESH_TICKS = 5;
const LOG_MAX_ENTRIES = 60;

export interface GameData {
  defs: DefTable;
  maps: Maps;
  missions: Mission[];
  textures: Map<string, Texture>;
}

/** Play one local match. Resolves when the player leaves it for the menu. */
export async function runMatch(root: HTMLElement, data: GameData, options: MatchOptions) {
  const world = createMatchWorld(data.defs, data.maps, data.missions, options);
  const mission = data.missions.find((m) => m.id === options.mission);
  const match = new ReplayRecorder(world);
  const view = match.view();
  const commands: Command[] = [];
  const ui = createUiState();

  const app = new Application();
  await app.init({
    preference: 'webgl',
    background: '#0b1020',
    resizeTo: window,
    antialias: false,
    resolution: 1,
  });
  document.body.prepend(app.canvas);
  const camera = new Container();
  camera.scale.set(ZOOM);
  app.stage.addChild(camera);
  const terrainG = new Graphics();
  const ground = new Container();
  const entityLayer = new Container();
  const bars = new Graphics();
  const overlay = new Graphics();
  camera.addChild(terrainG, ground, entityLayer, bars, overlay);
  const renderer = createWorldRenderer(view, ME, terrainG, ground, entityLayer, bars,
    data.textures);

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
    salvageSelected: () => controls.salvageSelected(),
    meltdownSelected: () => controls.meltdownSelected(),
    castSelected: () => controls.castSelected(),
    dropSelected: () => controls.dropSelected(),
    page: (button) => press(shown[button]),
    exit: () => leave?.(),
  });
  const controls = createControls({
    world: view,
    me: ME,
    ui,
    app,
    camera,
    overlay,
    submit: (command) => commands.push(command),
    changed: () => hud.render(),
    togglePause,
  });
  const minimapCanvas = document.createElement('canvas');
  minimapCanvas.id = 'minimap';
  root.append(minimapCanvas);
  const minimap = createMinimap(minimapCanvas, view, ME, camera);
  const logEl = root.querySelector<HTMLElement>('#log')!;

  const pending: SimEvent[] = [];

  /** Take the tick's events: effects play at once, the log is written with the next HUD refresh. */
  /** Sides whose Priest has been carried off, and those that began with a Temple: what the
   * events of the mission's script ask about. */
  const captured = new Set<number>();
  const temples = new Set([...world.players.keys()].filter((id) => world.templeOf(id)));
  const unread = [...(mission?.messages ?? [])];
  /** Sides whose Priest the player or an ally has brought to safety. */
  const saved = new Set<number>();

  function takeEvents(): void {
    for (const event of match.drainEvents()) {
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

  function renderLog(): void {
    for (const event of pending.splice(0)) {
      const line = describeEvent(view, ME, event);

      if (!line) {
        continue;
      }

      const entry = document.createElement('div');
      entry.className = line.tone;
      entry.textContent = `${formatTime(event.tick)} ${line.text}`;
      logEl.prepend(entry);
    }

    while (logEl.childElementCount > LOG_MAX_ENTRIES) {
      logEl.lastElementChild!.remove();
    }
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
      shown = [...shown, { label: 'До меню', action: 'MissionAbort', arg: '' }];
    } else if (!shown.length) {
      shown = [{ label: 'Продовжити', action: 'DoNothing', arg: '' }];
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
      show(won ? 'Перемога!' : 'Поразка', {
        text: page?.text
          || (won ? 'Ворожого жерця принесено в жертву.' : 'Вашого жерця принесено в жертву.'),
        buttons: page?.buttons ?? [],
      });
    }
  });

  const next = await left;
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
