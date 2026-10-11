import { Application, Container, Graphics } from 'pixi.js';
import { loadTextures, type Manifest } from './assets.js';
import { createWorldRenderer } from './renderer.js';
import { iso, ZOOM } from './projection.js';
import { createControls } from './controls.js';
import {
  loadDefs,
  createSkirmish,
  FixedStepClock,
  ReplayRecorder,
  playReplay,
  type Command,
  TPS,
} from '@netstorm/sim';

async function main() {
  const [unitsRaw, forts, manifest] = await Promise.all([
    fetch('data/units.json').then((r) => r.json()),
    fetch('data/forts.json').then((r) => r.json()),
    fetch('data/sprites.json').then((r) => r.json()) as Promise<Manifest>,
  ]);
  const defs = loadDefs(unitsRaw);
  const geysers: [number, number][] = (forts['thewarbegins']?.geysers ?? []).map((
    [x, y]: number[],
  ) => [x!, y!]);
  const world = createSkirmish(defs, 42, [
    { id: 1, name: 'Ти', theme: 'wind', x: 70, y: 150 },
    { id: 2, name: 'The Jailer', theme: 'rain', x: 150, y: 90 },
  ], geysers.length ? geysers : [[110, 120]]);

  const app = new Application();
  await app.init({
    preference: 'webgl',
    background: '#0b1020',
    resizeTo: window,
    antialias: false,
    resolution: 1,
  });
  document.body.appendChild(app.canvas);
  const camera = new Container();
  camera.scale.set(ZOOM);
  app.stage.addChild(camera);
  const terrainG = new Graphics();
  const entityLayer = new Container();
  const ghost = new Graphics();
  camera.addChild(terrainG, entityLayer, ghost);

  const tex = await loadTextures(manifest);
  const match = new ReplayRecorder(world);
  const view = match.view();
  const commands: Command[] = [];
  const renderer = createWorldRenderer(view, terrainG, entityLayer, tex);

  const controls = createControls(view, app, camera, ghost, (command) => commands.push(command),
    () => match.drainEvents());

  // --- loop: fixed-step simulation at TPS, rendering every frame
  const me = world.priestOf(1)!;
  const start = iso(me.x, me.y);
  camera.position.set(window.innerWidth / 2 - start.sx * ZOOM,
    window.innerHeight / 2 - start.sy * ZOOM);
  (window as unknown as { ns: unknown; }).ns = {
    world,
    match,
    playReplay,
    camera,
    app,
    terrainG,
    entityLayer,
  };
  const clock = new FixedStepClock(TPS, 5);
  let hudTick = -1;
  controls.renderHud();
  renderer.sync();
  const resetClock = () => clock.reset();
  document.addEventListener('visibilitychange', resetClock);
  app.ticker.add((t) => {
    if (document.hidden) {
      return;
    }

    const steps = clock.advance(t.deltaMS, () => {
      match.step(commands.splice(0));
    });
    renderer.sync();

    if (steps) {
      controls.drawGhost();
    }

    if (world.tick - hudTick >= 5) {
      hudTick = world.tick;
      controls.renderHud();
      controls.renderLog();
    }
  });
  return () => {
    controls.dispose();
    document.removeEventListener('visibilitychange', resetClock);
    app.destroy(true, { children: true });
    delete (window as unknown as { ns?: unknown; }).ns;
  };
}

main()
  .then((dispose) => {
    import.meta.hot?.dispose(dispose);
  })
  .catch((error) => {
    console.error(error);
    document.getElementById('log')!.textContent =
      'Не вдалося запустити гру. Перевірте доступність даних та WebGL.';
  });
