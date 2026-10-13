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
import { DEFAULT_AI_DELAY, type Maps, type Mission } from './game-data.js';
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
  let leave: (() => void) | undefined;
  const left = new Promise<void>((resolve) => {
    leave = resolve;
  });
  const clock = new FixedStepClock(TPS);
  const aiInterval = Math.max(1, Math.round((mission?.aiDelay ?? DEFAULT_AI_DELAY) * TPS));
  // Every other side is played by the computer. Its moves are commands like the player's, so the replay records them.
  const aiCommands = () =>
    options.opponent === 'ai' && world.tick % aiInterval === 0
      ? [...world.players.keys()].filter((id) => id !== ME).flatMap((player) =>
        aiMove(view, { player })
      )
      : [];
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
  function takeEvents(): void {
    for (const event of match.drainEvents()) {
      if (event.what === 'destroyed') {
        renderer.explode(event.data.id);
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

    const lost = !world.players.get(ME)!.alive;

    if (!ended && (world.winner !== null || lost)) {
      ended = true;
      renderLog();
      // Allies win together.
      const won = world.winner !== null && !lost && !world.hostile(world.winner, ME);
      hud.showEnd(won ? 'Перемога!' : 'Поразка', (won ? mission?.succeeded : mission?.failed)
        || (won ? 'Ворожого жерця принесено в жертву.' : 'Вашого жерця принесено в жертву.'));
    }
  });

  await left;
  controls.dispose();
  minimap.dispose();
  hud.dispose();
  document.removeEventListener('visibilitychange', resetClock);
  app.destroy(true, { children: true });
  root.hidden = true;
  delete (window as unknown as { ns?: unknown; }).ns;
}

function formatTime(tick: number): string {
  return `${(tick / TPS).toFixed(1)}s`;
}
