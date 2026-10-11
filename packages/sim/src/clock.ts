/** Fixed simulation steps with bounded local catch-up. Pass elapsed wall time in ms.
 * This clock may discard time on slow frames. A future lockstep client must wait
 * for authoritative ticks instead of using this local scheduling policy.
 */
export class FixedStepClock {
  private accumulator = 0;
  readonly stepMs: number;

  constructor(
    ticksPerSecond: number,
    readonly maxSteps = 5,
  ) {
    if (
      !Number.isFinite(ticksPerSecond) ||
      ticksPerSecond <= 0 ||
      !Number.isSafeInteger(maxSteps) ||
      maxSteps < 1
    ) {
      throw new RangeError('Invalid fixed-step clock configuration');
    }
    this.stepMs = 1000 / ticksPerSecond;
  }

  advance(elapsedMs: number, step: () => void): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
    this.accumulator = Math.min(this.accumulator + elapsedMs, this.stepMs * this.maxSteps);
    let steps = 0;
    while (this.accumulator >= this.stepMs && steps < this.maxSteps) {
      step();
      this.accumulator -= this.stepMs;
      steps++;
    }
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
