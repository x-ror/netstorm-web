import type { World } from '@netstorm/sim';

/** Samples kept per metric: the last ten seconds of frames at 60 Hz. */
const SAMPLE_LIMIT = 600;
const HEAP_EVERY_MS = 1000;
const P95 = 0.95;
const P99 = 0.99;

export type Metric =
  | 'frame'
  | 'simulationTick'
  | 'ai'
  | 'pathfinding'
  | 'renderSync'
  | 'render'
  | 'drawCalls';
const METRICS: readonly Metric[] = [
  'frame',
  'simulationTick',
  'ai',
  'pathfinding',
  'renderSync',
  'render',
  'drawCalls',
];
/** The world's methods timed from outside: by name, under which metric. */
const WORLD_HOOKS: readonly (readonly [method: string, metric: Metric])[] = [
  ['findPath', 'pathfinding'],
];
const GL_DRAWS = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'];

type AnyFunction = (...args: unknown[]) => unknown;
type RendererLike = { render?: AnyFunction; gl?: Record<string, unknown>; };

export interface Summary {
  samples: number;
  average: number | null;
  p95: number | null;
  p99: number | null;
}

function summarize(values: readonly number[]): Summary {
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

/**
 * Timings of a running match, kept for `?perf=1` and the perf scripts: frames, simulation ticks,
 * AI moves, the world's hot systems, the renderer and its WebGL draw calls. It wraps methods of the
 * world and the renderer to time them and puts them back on `dispose()`; it never changes what
 * they do, so the world's hash is the same with it and without.
 */
export class PerformanceMonitor {
  private readonly samples = new Map<Metric, number[]>(METRICS.map((metric) => [metric, []]));
  private readonly next = new Map<Metric, number>();
  private readonly heap: { elapsedMs: number; bytes: number; }[] = [];
  private readonly restore: (() => void)[] = [];
  private readonly startedAt = performance.now();
  private lastFrameAt = this.startedAt;
  private lastHeapAt = this.startedAt;
  private drawCalls = 0;

  constructor(private readonly world: World, renderer?: object) {
    const target = world as unknown as Record<string, unknown>;

    for (const [method, metric] of WORLD_HOOKS) {
      this.wrap(target, method, (run, args) => this.measure(metric, () => run(...args)));
    }

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

  /** Call once a frame: the time since the last one, and a heap sample every second. */
  frame(): void {
    const now = performance.now();
    this.record('frame', now - this.lastFrameAt);
    this.lastFrameAt = now;

    if (now - this.lastHeapAt >= HEAP_EVERY_MS) {
      const bytes = (performance as { memory?: { usedJSHeapSize?: number; }; }).memory
        ?.usedJSHeapSize;

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

  snapshot() {
    const entities: Record<string, number> = { total: this.world.entities.size };

    for (const entity of this.world.entities.values()) {
      entities[entity.kind] = (entities[entity.kind] ?? 0) + 1;
    }

    const ms = Object.fromEntries(
      METRICS.map((metric) => [metric, summarize(this.samples.get(metric)!)]),
    ) as Record<Metric, Summary>;
    return {
      elapsedMs: performance.now() - this.startedAt,
      ms,
      entities,
      projectiles: this.world.shots.length,
      heap: [...this.heap],
    };
  }

  dispose(): void {
    for (const restore of this.restore.reverse()) {
      restore();
    }

    this.restore.length = 0;
  }

  /** A sample measured elsewhere, as by the worker that makes the computer's moves. */
  record(metric: Metric, value: number): void {
    const values = this.samples.get(metric)!;

    if (values.length < SAMPLE_LIMIT) {
      values.push(value);
      return;
    }

    const at = this.next.get(metric) ?? 0;
    values[at] = value;
    this.next.set(metric, (at + 1) % SAMPLE_LIMIT);
  }

  /** Replace `target[name]` with `around(original, args)`, to be put back on dispose. */
  private wrap(
    target: Record<string, unknown>,
    name: string,
    around: (run: AnyFunction, args: unknown[]) => unknown,
  ): void {
    const original = target[name];

    if (typeof original !== 'function') {
      return;
    }

    const own = Object.hasOwn(target, name);
    const run = (original as AnyFunction).bind(target);
    target[name] = (...args: unknown[]) => around(run, args);
    this.restore.push(() => {
      if (own) {
        target[name] = original;
      } else {
        delete target[name];
      }
    });
  }

  private hookRenderer(renderer: RendererLike): void {
    this.wrap(renderer as Record<string, unknown>, 'render', (run, args) => {
      try {
        return this.measure('render', () => run(...args));
      } finally {
        this.record('drawCalls', this.drawCalls);
        this.drawCalls = 0;
      }
    });

    for (const name of GL_DRAWS) {
      this.wrap(renderer.gl ?? {}, name, (run, args) => {
        this.drawCalls++;
        return run(...args);
      });
    }
  }
}
