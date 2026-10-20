import { Application, Assets, Container, Graphics, TilingSprite, type Texture } from 'pixi.js';
import {
  FixedStepClock,
  aiMove,
  DIFFICULTY,
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
import { loudness, sideOf, type Sounds } from './sound.js';
import { createMinimap } from './minimap.js';
import { describeEvent } from './messages.js';
import { m } from './paraglide/messages.js';
import { cellAt, centerOn, snapZoom, zoomAt } from './camera.js';
import { project, ZOOM } from './projection.js';
import { createUiState } from './ui-state.js';
import { PerformanceMonitor } from './perf.js';
import { AiSchedule } from './ai-schedule.js';
import type { AiReply, AiRequest } from './ai-worker.js';

const HUD_REFRESH_TICKS = 5;
const ALTAR = 'altar';
const HALF_CELL = 0.5;

/** The middle of a map cell, in the pixels the map is drawn in: where its sound is made. */
function cellMiddle(cell: { x: number; y: number; }): { x: number; y: number; } {
  const { sx, sy } = project(cell.x + HALF_CELL, cell.y + HALF_CELL);
  return { x: sx, y: sy };
}

/** Ticks between asking the computer for a move and applying it: a second, so that the move is
 * worked out off the main thread meanwhile and no frame waits for it. */
const AI_LEAD = TPS;
/** Lines of the computer's reasons kept for copying; the oldest go first (about an hour of a
 * match of two sides at the hardest level). */
const AI_LOG_LINES = 200_000;

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
  // A skirmish borrows the map's geysers alone: no script, no goals, no orders for the computer.
  const mission = options.mode === 'mission'
    ? data.missions.find((entry) => entry.id === options.mission)
    : undefined;
  const match = new ReplayRecorder(world);
  const view = match.view();
  const commands: Command[] = [];
  const ui = createUiState(ME);
  // Watching, the computer plays every side and the screen only looks on, through one side's
  // eyes at a time.
  ui.watching = options.opponent === 'watch';
  ui.muted = data.sounds.muted; // the choice outlives a match
  // A sound is as loud as its place is near the middle of the screen, measured on the map.
  data.sounds.heard = (at) =>
    loudness(
      Math.hypot(at.x - (window.innerWidth / 2 - camera.x) / camera.scale.x,
        at.y - (window.innerHeight / 2 - camera.y) / camera.scale.y),
    );
  // And it comes from the side of the screen it is on.
  data.sounds.side = (at) =>
    sideOf(at.x * camera.scale.x + camera.x - window.innerWidth / 2, window.innerWidth / 2);

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
  const bars = new Container();
  const overlay = new Graphics();
  const ghost = new Container();
  camera.addChild(terrainG, ground, entityLayer, bars, ghost, overlay);
  // `?perf=1`: time the match; read the numbers with `ns.perf()` (docs/architecture.md).
  const perf = new URLSearchParams(location.search).get('perf') === '1'
    ? new PerformanceMonitor(world, app.renderer)
    : undefined;
  const renderer = createWorldRenderer(view, () => ui.viewer, terrainG, ground, entityLayer, bars,
    data.textures, data.sounds, data.hotFeet);

  root.hidden = false;
  let leave: ((next?: string) => void) | undefined;
  /** Resolved when the match is left, with the mission to go straight on to, if any. */
  const left = new Promise<string | undefined>((resolve) => {
    leave = resolve;
  });
  const clock = new FixedStepClock(TPS);
  // Every other side is played by the computer, each at the pace and with the orders its mission
  // gives it. Its moves are commands like the player's, so the replay records them.
  // A skirmish plays at the level chosen; a mission at the pace its file sets. Each side keeps
  // its memory between moves here, outside the world: the replay records only the commands.
  /** Why the computer did what it did, each move of each side it plays, oldest first. */
  const aiLog: string[] = [];
  const explain = (line: string) => {
    aiLog.push(line);

    if (aiLog.length > AI_LOG_LINES) {
      aiLog.shift();
    }
  };
  // Watching, the computer plays the player's side too.
  const computer = (player: number) => ui.watching || (options.opponent === 'ai' && player !== ME);
  // The move is worked out in a worker from the world as it stands and applied AI_LEAD ticks
  // later, so the frame never waits for it; a tick whose moves are late waits instead.
  const schedule = new AiSchedule(AI_LEAD);
  const aiWorker = [...world.players.keys()].some(computer)
    ? new Worker(new URL('./ai-worker.ts', import.meta.url), { type: 'module' })
    : undefined;
  aiWorker?.addEventListener('message', ({ data: reply }: MessageEvent<AiReply>) => {
    schedule.deliver(reply.due, reply.player, reply.commands);
    reply.lines.forEach(explain);
    perf?.record('ai', reply.ms);
  });
  /** Ask for the moves of the sides whose turn it is on this tick. */
  const requestAi = () => {
    for (const player of world.players.keys()) {
      const side = mission?.sides[player];
      const delay = mission
        ? side?.delay ?? mission.aiDelay ?? DEFAULT_AI_DELAY
        : DIFFICULTY[options.difficulty].moveSeconds;
      // The sides take their turns on successive ticks, so that no frame carries every move.
      const due = computer(player)
        && (world.tick - player) % Math.max(1, Math.round(delay * TPS)) === 0;

      if (due && aiWorker) {
        const request: AiRequest = {
          due: schedule.request(world.tick, player),
          world: world.handoff(),
          options: { ...side?.ai, player, difficulty: options.difficulty },
          seed: options.seed,
        };
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's
        aiWorker.postMessage(request);
      }
    }
  };
  /** Time while paused or hidden does not pile up as ticks to catch up on. */
  const resetClock = () => {
    renderer.resetTime();
    clock.reset();
  };
  const togglePause = () => {
    ui.paused = !ui.paused;
    resetClock();
    hud.render();
  };
  /** Look through another side's eyes: its colours, panels, sounds and log, at its Priest. */
  const lookThrough = (player: number) => {
    if (!ui.watching || player === ui.viewer || !world.players.has(player)) {
      return;
    }

    ui.viewer = player;
    ui.selected = null;
    renderer.repaint();
    minimap.repaint();
    const priest = world.priestOf(player);

    if (priest) {
      centerOn(camera, priest.x, priest.y);
    }

    hud.render();
    controls.drawOverlay();
  };
  const nextViewer = () => {
    const sides = [...world.players.keys()];
    lookThrough(sides[(sides.indexOf(ui.viewer) + 1) % sides.length]!);
  };
  /** Put the reasons on the clipboard with how the match was set up, or into a file when the
   * browser keeps the clipboard closed. */
  const copyAiLog = async () => {
    const text = [`NetStorm Web, AI log. Match: ${JSON.stringify(options)}`, ...aiLog].join('\n');
    let said: string;

    try {
      await navigator.clipboard.writeText(text);
      said = m.ai_log_copied({ lines: aiLog.length });
    } catch {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      link.download = `netstorm-ai-${options.seed}-${world.tick}.txt`;
      link.click();
      URL.revokeObjectURL(link.href);
      said = m.ai_log_saved();
    }

    hud.log([{ id: logId++, time: formatTime(world.tick), text: said, tone: 'info' }]);
  };
  const hud = createHud(root, view, ui, {
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
    pray: (spell) => void commands.push({ t: 'pray', player: ui.viewer, spell }),
    dropSelected: () => controls.dropSelected(),
    view: lookThrough,
    copyAiLog: () => void copyAiLog(),
    page: (button) => press(shown[button]),
    exit: () => leave?.(),
  }, data.atlas, [...world.players.keys()].some(computer));
  const controls = createControls({
    world: view,
    ui,
    app,
    camera,
    overlay,
    ghost,
    textures: data.textures,
    submit: (command) => commands.push(command),
    sounds: data.sounds,
    nextViewer,
    changed: () => hud.render(),
    togglePause,
    context: (x, y) => hud.context(x, y),
  });
  const minimapCanvas = document.createElement('canvas');
  minimapCanvas.id = 'minimap';
  root.append(minimapCanvas);
  const minimap = createMinimap(minimapCanvas, view, () => ui.viewer, camera);

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
    const mine = event.who === ui.viewer;
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
      case 'bridge cracked':
        return sounds.play('bridgecrack', cellMiddle(event.data));
      case 'bridge fell':
        return sounds.play('bridgefall', cellMiddle(event.data));
      case 'destroyed':
        return sounds.play(event.data.type === ALTAR ? 'altarburncollapse' : undefined);
      default:
        return undefined;
    }
  }

  function takeEvents(): void {
    for (const event of match.drainEvents()) {
      hear(event);

      if (event.what === 'destroyed') {
        renderer.explode(event.data.id);
      } else if (event.what === 'ricochet') {
        renderer.ricochet(event.data.hit, event.data.to);
      } else if (event.what === 'cast') {
        renderer.cast(event.data.transport, event.data.spell);
      } else if (event.what === 'bridge') {
        renderer.placed(event.data);
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
      const line = describeEvent(view, ui.viewer, event);
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
    animation: renderer,
    aiLog,
    ...(perf ? { perf: () => perf.snapshot() } : {}),
    cameraTools: { cellAt, zoomAt },
    advanceCamera: controls.updateCamera,
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
      resetClock();
      hud.render();
    } else if (button?.action === 'MissionBegin') {
      leave?.(button.arg.toLowerCase());
    } else {
      // "LeaveBattle", "MissionAbort" and a "Tell" of a page the mission does not have, such as
      // the "TryAgain" of every failure.
      leave?.();
    }
  }

  document.addEventListener('visibilitychange', resetClock);
  hud.render();
  renderer.sync();
  minimap.draw();

  /** One tick, or false while the computer's moves owed on it are still to come. */
  const stepWorld = (): boolean => {
    const owed = schedule.take(world.tick);

    if (!owed) {
      return false;
    }

    requestAi();
    match.step([...commands.splice(0), ...owed]);
    return true;
  };

  app.ticker.add((t) => {
    sky.setSize(app.screen.width, app.screen.height);
    sky.tileScale.set(camera.scale.x);

    if (document.hidden) {
      return;
    }

    controls.updateCamera(t.deltaMS);

    perf?.frame();
    const steps = ui.paused ? 0 : clock.advance(t.deltaMS, () => {
      const stepped = perf ? perf.measure('simulationTick', stepWorld) : stepWorld();

      if (!stepped) {
        return false;
      }

      takeEvents();
      renderer.capture();
      return true;
    });
    takeEvents();

    if (perf) {
      perf.measure('renderSync', () => renderer.sync(clock.alpha));
    } else {
      renderer.sync(clock.alpha);
    }

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
      resetClock();
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
  perf?.dispose();
  aiWorker?.terminate();
  app.destroy(true, { children: true });
  root.hidden = true;
  delete (window as unknown as { ns?: unknown; }).ns;
  return next;
}

function formatTime(tick: number): string {
  return `${(tick / TPS).toFixed(1)}s`;
}
