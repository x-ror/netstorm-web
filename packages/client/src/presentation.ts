/** Presentation time never follows discarded wall time or rewinds after a clock reset. */
export class PresentationTime {
  private tick = 0;
  private alpha = 1;
  private floor = 0;

  sample(tick: number, alpha: number): number {
    this.tick = tick;
    this.alpha = Math.max(0, Math.min(1, alpha));
    return Math.max(this.floor, tick + this.alpha);
  }

  reset(): void {
    this.floor = Math.max(this.floor, this.tick + this.alpha);
  }
}

/** A bounded one-shot; callers own its lifetime and cancellation. Time is in game ticks. */
export function progress(now: number, start: number, duration: number): number {
  return duration <= 0 ? 1 : Math.max(0, Math.min(1, (now - start) / duration));
}

export function easeOut(share: number): number {
  return 1 - (1 - share) * (1 - share);
}

/** Skip expired stream emissions without scanning their history. */
export function firstEmission(now: number, start: number, lifetime: number, every: number): number {
  return start + Math.max(0, Math.ceil((now - lifetime - start) / every)) * every;
}
