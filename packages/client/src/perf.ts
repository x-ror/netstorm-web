import type { World } from '@netstorm/sim';

const SAMPLE_LIMIT = 600;
const SAMPLE_INTERVAL_MS = 1000;
const P95 = 0.95;
const P99 = 0.99;

type Metric =
  | 'frame'
  | 'simulationTick'
  | 'ai'
  | 'pathfinding'
  | 'combat'
  | 'movement'
  | 'terrainBuild'
  | 'entitySync'
  | 'renderSync'
  | 'render'
  | 'drawCalls';
type TimedMethod = (...args: unknown[]) => unknown;
type RendererLike = {
  render?: TimedMethod;
  gl?: Record<string, unknown>;
  context?: { gl?: Record<string, unknown>; };
};

function summarize(values: readonly number[]) {
  if (!values.length) {
    return { samples: 0, average: null, p95: null, p99: null };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1]!;
  return {
    samples: values.length,
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: percentile(P95),
    p99: percentile(P99),
  };
}

export class PerformanceMonitor {
  private readonly samples: Record<Metric, number[]> = {
    frame: [],
    simulationTick: [],
    ai: [],
    pathfinding: [],
    combat: [],
    movement: [],
    terrainBuild: [],
    entitySync: [],
    renderSync: [],
    render: [],
    drawCalls: [],
  };

  private readonly samplePositions: Record<Metric, number> = {
    frame: 0,
    simulationTick: 0,
    ai: 0,
    pathfinding: 0,
    combat: 0,
    movement: 0,
    terrainBuild: 0,
    entitySync: 0,
    renderSync: 0,
    render: 0,
    drawCalls: 0,
  };

  private readonly heap: { elapsedMs: number; bytes: number; }[] = [];
  private readonly restore: (() => void)[] = [];
  private startedAt = performance.now();
  private lastFrameAt = this.startedAt;
  private lastHeapAt = this.startedAt;
  private elapsedMs = 0;
  private currentDrawCalls = 0;
  private sceneCounts = { terrainTiles: 0, displayObjects: 0 };

  constructor(private readonly world: World, renderer?: object) {
    this.hookWorld('findPath', 'pathfinding');
    this.hookWorld('tickBuilding', 'combat');
    this.hookWorld('tickTransport', 'movement');
    this.hookWorld('tickPriest', 'movement');

    if (renderer) {
      this.hookRenderer(renderer as RendererLike);
    }
  }

  measure<T>(metric: Metric, run: () => T): T {
    const start = performance.now();

    try {
      return run();
    } finally {
      this.record(metric, performance.now() - start);
    }
  }

  frame(): void {
    const now = performance.now();
    const deltaMs = now - this.lastFrameAt;
    this.lastFrameAt = now;
    this.record('frame', deltaMs);
    this.elapsedMs += deltaMs;

    if (now - this.lastHeapAt >= SAMPLE_INTERVAL_MS) {
      const memory = (performance as Performance & {
        memory?: { usedJSHeapSize?: number; };
      }).memory;
      const bytes = memory?.usedJSHeapSize;

      if (typeof bytes === 'number') {
        this.heapSample(bytes);
      }

      this.lastHeapAt = now;
    }
  }

  heapSample(bytes: number): void {
    this.heap.push({ elapsedMs: performance.now() - this.startedAt, bytes });

    if (this.heap.length > SAMPLE_LIMIT) {
      this.heap.shift();
    }
  }

  recordSceneCounts(terrainTiles: number, displayObjects: number): void {
    this.sceneCounts = { terrainTiles, displayObjects };
  }

  snapshot() {
    const entities = { total: this.world.entities.size } as Record<string, number>;

    for (const entity of this.world.entities.values()) {
      entities[entity.kind] = (entities[entity.kind] ?? 0) + 1;
    }

    return {
      elapsedMs: this.elapsedMs,
      frameMs: summarize(this.samples.frame),
      simulationTickMs: summarize(this.samples.simulationTick),
      systemsMs: {
        ai: summarize(this.samples.ai),
        pathfinding: summarize(this.samples.pathfinding),
        combat: summarize(this.samples.combat),
        movement: summarize(this.samples.movement),
      },
      terrainBuildMs: summarize(this.samples.terrainBuild),
      entitySyncMs: summarize(this.samples.entitySync),
      renderSyncMs: summarize(this.samples.renderSync),
      renderMs: summarize(this.samples.render),
      drawCalls: summarize(this.samples.drawCalls),
      scene: { ...this.sceneCounts },
      entities,
      projectiles: this.world.shots.length,
      heap: [...this.heap],
      heapSupported: this.heap.length > 0,
    };
  }

  dispose(): void {
    for (const restore of this.restore.reverse()) {
      restore();
    }
  }

  private record(metric: Metric, value: number): void {
    const values = this.samples[metric];

    if (values.length < SAMPLE_LIMIT) {
      values.push(value);
      return;
    }

    const position = this.samplePositions[metric];
    values[position] = value;
    this.samplePositions[metric] = (position + 1) % SAMPLE_LIMIT;
  }

  private hookWorld(name: string, metric: Metric): void {
    const target = this.world as unknown as Record<string, unknown>;
    const original = target[name];
    const own = Object.hasOwn(target, name);

    if (typeof original !== 'function') {
      return;
    }

    const run = (original as TimedMethod).bind(this.world);

    if (name === 'findPath') {
      target[name] = (
        player: unknown,
        startX: unknown,
        startY: unknown,
        goal: unknown,
        avoidOccupied: unknown,
      ) => {
        const start = performance.now();

        try {
          return run(player, startX, startY, goal, avoidOccupied);
        } finally {
          this.record(metric, performance.now() - start);
        }
      };
    } else {
      target[name] = (entity: unknown) => {
        const start = performance.now();

        try {
          return run(entity);
        } finally {
          this.record(metric, performance.now() - start);
        }
      };
    }

    this.restore.push(() => {
      if (own) {
        target[name] = original;
      } else {
        delete target[name];
      }
    });
  }

  private hookRenderer(renderer: RendererLike): void {
    if (typeof renderer.render === 'function') {
      const original = renderer.render;
      const own = Object.hasOwn(renderer, 'render');
      const render = original.bind(renderer);
      renderer.render = (...args: unknown[]) => {
        try {
          return this.measure('render', () => render(...args));
        } finally {
          this.record('drawCalls', this.currentDrawCalls);
          this.currentDrawCalls = 0;
        }
      };
      this.restore.push(() => {
        if (own) {
          renderer.render = original;
        } else {
          delete renderer.render;
        }
      });
    }

    const gl = renderer.gl ?? renderer.context?.gl;

    if (!gl) {
      return;
    }

    for (
      const name of [
        'drawArrays',
        'drawElements',
        'drawArraysInstanced',
        'drawElementsInstanced',
      ]
    ) {
      const original = gl[name];
      const own = Object.hasOwn(gl, name);

      if (typeof original !== 'function') {
        continue;
      }

      const draw = (original as TimedMethod).bind(gl);
      gl[name] = (...args: unknown[]) => {
        this.currentDrawCalls++;
        return draw(...args);
      };
      this.restore.push(() => {
        if (own) {
          gl[name] = original;
        } else {
          delete gl[name];
        }
      });
    }
  }
}
