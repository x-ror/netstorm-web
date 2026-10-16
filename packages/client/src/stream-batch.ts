import { type Container, MeshSimple, Texture } from 'pixi.js';

const VERTEX_VALUES = 8;
const VERTICES = 4;
const INDICES = 6;
const INITIAL_CAPACITY = 32;
const MAX_SEGMENTS = 8192;

/** Reused, bounded solid quads: no Graphics tessellation or display-object churn per frame. */
export class StreamBatch {
  readonly mesh: MeshSimple;
  private capacity = INITIAL_CAPACITY;
  private used = 0;
  private positions = new Float32Array(INITIAL_CAPACITY * VERTEX_VALUES);

  constructor(parent: Container, color: number, alpha: number) {
    this.mesh = parent.addChild(new MeshSimple({
      texture: Texture.WHITE,
      vertices: this.positions,
      uvs: new Float32Array(this.positions.length),
      indices: new Uint32Array(this.capacity * INDICES),
    }));
    this.mesh.tint = color;
    this.mesh.alpha = alpha;
    this.mesh.visible = false;
    this.mesh.autoUpdate = false;
    const geometry = this.mesh.geometry;
    this.mesh.on('destroyed', () => geometry.destroy(true));
    this.resize();
  }

  begin(): void {
    this.used = 0;
  }

  segment(ax: number, ay: number, bx: number, by: number, width: number): void {
    if (this.used >= MAX_SEGMENTS) {
      return;
    }

    if (this.used >= this.capacity) {
      this.capacity = Math.min(MAX_SEGMENTS, this.capacity * 2);
      const positions = new Float32Array(this.capacity * VERTEX_VALUES);
      positions.set(this.positions);
      this.positions = positions;
      this.resize();
    }

    const length = Math.hypot(bx - ax, by - ay);
    const nx = length > 0 ? ((by - ay) * width) / (length * 2) : 0;
    const ny = length > 0 ? ((ax - bx) * width) / (length * 2) : 0;
    const offset = this.used++ * VERTEX_VALUES;
    // Four x/y pairs, clockwise around the segment.
    /* oxlint-disable no-magic-numbers */
    this.positions[offset] = ax + nx;
    this.positions[offset + 1] = ay + ny;
    this.positions[offset + 2] = bx + nx;
    this.positions[offset + 3] = by + ny;
    this.positions[offset + 4] = bx - nx;
    this.positions[offset + 5] = by - ny;
    this.positions[offset + 6] = ax - nx;
    this.positions[offset + 7] = ay - ny;
    /* oxlint-enable no-magic-numbers */
  }

  finish(): void {
    if (this.used === 0) {
      this.mesh.visible = false;
      return;
    }

    this.positions.fill(0, this.used * VERTEX_VALUES);
    this.mesh.visible = this.used > 0;
    this.mesh.geometry.getBuffer('aPosition').update();
  }

  private resize(): void {
    const uvs = new Float32Array(this.positions.length);
    const indices = new Uint32Array(this.capacity * INDICES);

    for (let i = 0; i < this.capacity; i++) {
      const vertex = i * VERTICES;
      // Two triangles for each quad.
      // oxlint-disable-next-line no-magic-numbers
      indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], i * INDICES);
      uvs.set([0, 0, 1, 0, 1, 1, 0, 1], i * VERTEX_VALUES);
    }

    this.mesh.geometry.uvs = uvs;
    this.mesh.geometry.positions = this.positions;
    this.mesh.geometry.indices = indices;
  }
}
