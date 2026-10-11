interface Positioned { id: number; x: number; y: number }

/** Derived cell buckets. Items retain insertion order even when they move.
 * Rebuild at tick boundaries to include scenario/editor changes to public state.
 */
export class CellIndex<T extends Positioned> {
  private readonly cells = new Map<number, T[]>();
  private readonly pool: T[][] = [];
  private readonly order = new Map<number, number>();

  constructor(private readonly width: number, private readonly height: number) {}

  reset(): void {
    for (const bucket of this.cells.values()) { bucket.length = 0; this.pool.push(bucket); }
    this.cells.clear();
    this.order.clear();
  }

  add(item: T): void {
    this.order.set(item.id, this.order.size);
    this.insert(item);
  }

  move(item: T, previousX: number, previousY: number): void {
    const previous = this.key(previousX, previousY);
    if (previous === this.key(item.x, item.y)) return;
    if (previous !== null) {
      const bucket = this.cells.get(previous);
      if (bucket) {
        const position = bucket.indexOf(item);
        if (position >= 0) bucket.splice(position, 1);
        if (!bucket.length) { this.cells.delete(previous); this.pool.push(bucket); }
      }
    }
    this.insert(item);
  }

  at(x: number, y: number): readonly T[] | undefined {
    const key = this.key(x, y);
    return key === null ? undefined : this.cells.get(key);
  }

  private insert(item: T): void {
    const key = this.key(item.x, item.y);
    if (key === null) return;
    let bucket = this.cells.get(key);
    if (!bucket) { bucket = this.pool.pop() ?? []; this.cells.set(key, bucket); }
    const rank = this.order.get(item.id)!;
    let position = bucket.length;
    while (position > 0 && this.order.get(bucket[position - 1]!.id)! > rank) position--;
    bucket.splice(position, 0, item);
  }

  private key(x: number, y: number): number | null {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height ? y * this.width + x : null;
  }
}
