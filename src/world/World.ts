import { WORLD } from '../config';
import { clamp, smootherstep, smoothstep } from './noise';

/** Surface kind per cell, used for colouring, vegetation and AI. */
export const enum Ground {
  Water = 0,
  Sand = 1,
  Grass = 2,
  Jungle = 3,
  Rock = 4,
  River = 5,
}

export interface RiverData {
  /** Path points in world space with local water surface height. */
  points: { x: number; z: number; y: number }[];
}

/** Height of rope bridge decks above the sea. */
export const BRIDGE_DECK_Y = 0.3;
/** How deep a dug canal channel is cut below the surrounding ground. */
export const CANAL_DEPTH = 0.5;
/** Swamp water sits this far below the undug ground (so the shallow mud stays dry and only pools fill). */
export const SWAMP_WATER_DROP = 0.11;

export interface WaterfallData {
  x: number;
  z: number;
  topY: number;
  bottomY: number;
  /** Flow direction (unit vector in XZ). */
  dx: number;
  dz: number;
  poolY: number;
  poolR: number;
}

/**
 * The shared world grid. Every system reads from it: terrain mesh, water,
 * vegetation placement, pathfinding and building placement.
 * Cell (cx, cz) spans world x in [cx - N/2, cx + 1 - N/2].
 */
export class World {
  readonly N = WORLD.size;
  readonly half = WORLD.size / 2;
  readonly H = WORLD.layerHeight;
  seed = 1;

  /** Integer contour layer per cell. Layer >= 1 is dry land. */
  layer = new Int8Array(this.N * this.N);
  /** Blurred layer field; its level sets give smooth, curving terrace contours. */
  smooth = new Float32Array(this.N * this.N);
  private tmpSmooth = new Float32Array(this.N * this.N);
  private tmpSmooth2: Float32Array | null = null;
  ground = new Uint8Array(this.N * this.N);
  /** 0..1 jungle density. */
  forest = new Float32Array(this.N * this.N);
  /** 0..1 rockiness (cliffs, highlands, headlands). */
  rocky = new Float32Array(this.N * this.N);
  /** 0..1 sandiness. */
  sandy = new Float32Array(this.N * this.N);
  /** Cells to the nearest sea water (BFS). */
  distWater = new Float32Array(this.N * this.N);
  /** River / pool water surface height per cell, NaN if no river. */
  riverY = new Float32Array(this.N * this.N).fill(NaN);
  /** Building id + 1 occupying the cell, 0 when free. */
  occ = new Int32Array(this.N * this.N);
  /** Path wear 0..1 (islanders trampling grass into dirt). */
  wear = new Float32Array(this.N * this.N);
  /** Stone paths laid by the player (1 = paved). */
  path = new Uint8Array(this.N * this.N);
  /** Farm soil 0..1. */
  soil = new Float32Array(this.N * this.N);
  /** Foam intensity around rocks in the shallows. */
  foam = new Float32Array(this.N * this.N);

  rivers: RiverData[] = [];
  waterfall: WaterfallData | null = null;
  lagoon: { x: number; z: number; r: number } | null = null;
  meadow = { x: 0, z: 0, r: WORLD.meadowRadius, layer: 3 };
  /** Direction (unit XZ) from the meadow towards the nearest sea. */
  seaDir = { x: 0, z: 1 };
  islets: { x: number; z: number; r: number }[] = [];
  /** The grown islets waiting to be applied (cells and their new layers), from the generator. */
  isletNext: { cells: Int32Array; layer: Int8Array } | null = null;
  /**
   * After growIslets: the cells it reshaped and their terrain, re-applied over saves made before
   * the islets grew (their stored terrain still has the old islets).
   */
  isletGrown: { cells: Int32Array; layer: Int8Array; sandy: Float32Array; forest: Float32Array; rocky: Float32Array } | null = null;
  /** Which island each land cell belongs to: 0 sea, 1 the main island, 2 the wild island. */
  isle = new Uint8Array(this.N * this.N);
  /** Water canals dug by the player from existing water (1 = channel). */
  canal = new Uint8Array(this.N * this.N);
  /** Number of canal cells (0 skips the channel carve in height lookups). */
  canalCount = 0;
  /** Swampland 0..1 per cell (wet ground → mud → pools), and how deep each cell is dug into pools. */
  swamp = new Float32Array(this.N * this.N);
  swampCarve = new Float32Array(this.N * this.N);
  swampOn = false;
  /** Swamps (centre and radius), for the animals and decorations that live there. */
  swamps: { x: number; z: number; r: number }[] = [];
  /** Rope bridges built across shallow water (1 = deck). */
  bridge = new Uint8Array(this.N * this.N);

  /** Monotonic counter bumped whenever terrain changes (for caches). */
  version = 0;
  /** Buildings whose cells islanders may walk through (farm fields, jetty decks). */
  passableBuildings = new Set<number>();
  /**
   * Cells nobody can walk into: boulders (rock plants, redone by Vegetation.syncRockBlock) and the
   * waterfall's rocks, curtain and plunge pool (fixed). Pathfinding routes round them; animals steer
   * round them.
   */
  blockRock = new Uint8Array(this.N * this.N);
  blockFixed = new Uint8Array(this.N * this.N);
  blocked(i: number): boolean {
    return this.blockRock[i] !== 0 || this.blockFixed[i] !== 0;
  }
  /** Block the cells under a round footprint (at least the cell it stands in). */
  blockCircle(x: number, z: number, r: number, grid: Uint8Array = this.blockFixed): void {
    const [cx, cz] = this.cellOf(x, z);
    if (this.inBounds(cx, cz)) grid[this.idx(cx, cz)] = 1;
    const R = Math.ceil(r);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const nx = cx + dx, nz = cz + dz;
      if (!this.inBounds(nx, nz)) continue;
      if (Math.hypot(this.centerX(nx) - x, this.centerZ(nz) - z) <= r) grid[this.idx(nx, nz)] = 1;
    }
  }

  passable(buildingId: number): boolean {
    return this.passableBuildings.has(buildingId);
  }

  idx(cx: number, cz: number): number {
    return cz * this.N + cx;
  }
  inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.N && cz < this.N;
  }
  cellOf(x: number, z: number): [number, number] {
    return [Math.floor(x + this.half), Math.floor(z + this.half)];
  }
  cellIndexAt(x: number, z: number): number {
    const cx = Math.floor(x + this.half), cz = Math.floor(z + this.half);
    if (!this.inBounds(cx, cz)) return -1;
    return cz * this.N + cx;
  }
  centerX(cx: number): number {
    return cx - this.half + 0.5;
  }
  centerZ(cz: number): number {
    return cz - this.half + 0.5;
  }
  layerAt(cx: number, cz: number): number {
    if (!this.inBounds(cx, cz)) return WORLD.minLayer;
    return this.layer[cz * this.N + cx];
  }
  isLandCell(i: number): boolean {
    return this.layer[i] >= 1 && Number.isNaN(this.riverY[i]);
  }
  isSeaCell(i: number): boolean {
    return this.layer[i] <= 0;
  }

  /** Bilinear sample of any per-cell float field at world position. */
  sampleField(f: ArrayLike<number>, x: number, z: number): number {
    const gx = clamp(x + this.half - 0.5, 0, this.N - 1.001);
    const gz = clamp(z + this.half - 0.5, 0, this.N - 1.001);
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const fx = gx - x0, fz = gz - z0;
    const i = z0 * this.N + x0;
    const a = f[i], b = f[i + 1], c = f[i + this.N], d = f[i + this.N + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  /** Smooth (Catmull-Rom bicubic) sample of a per-cell field: no cell-shaped creases in colour blends. */
  sampleFieldCubic(f: ArrayLike<number>, x: number, z: number): number {
    const N = this.N;
    const gx = x + this.half - 0.5, gz = z + this.half - 0.5;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const fx = gx - x0, fz = gz - z0;
    const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
      p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const at = (cx: number, cz: number) => f[Math.min(N - 1, Math.max(0, cz)) * N + Math.min(N - 1, Math.max(0, cx))];
    const row = (cz: number) => cr(at(x0 - 1, cz), at(x0, cz), at(x0 + 1, cz), at(x0 + 2, cz), fx);
    const v = cr(row(z0 - 1), row(z0), row(z0 + 1), row(z0 + 2), fz);
    return Math.min(1, Math.max(0, v));
  }

  /** Continuous (pre-terrace) layer value at a world position. */
  layerF(x: number, z: number): number {
    const gx = x + this.half - 0.5;
    const gz = z + this.half - 0.5;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const fx = gx - x0, fz = gz - z0;
    const a = this.smoothAt(x0, z0), b = this.smoothAt(x0 + 1, z0);
    const c = this.smoothAt(x0, z0 + 1), d = this.smoothAt(x0 + 1, z0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  private smoothAt(cx: number, cz: number): number {
    if (!this.inBounds(cx, cz)) return WORLD.minLayer;
    return this.smooth[cz * this.N + cx];
  }

  /**
   * Rebuild the blurred layer field (three 3x3 binomial passes ~ 7x7 kernel) in a cell rectangle.
   * Constant regions stay exactly flat; boundaries become smooth curves.
   */
  computeSmooth(cx0 = 0, cz0 = 0, cx1 = this.N - 1, cz1 = this.N - 1): void {
    const N = this.N;
    const x0 = Math.max(0, cx0 - 4), x1 = Math.min(N - 1, cx1 + 4);
    const z0 = Math.max(0, cz0 - 4), z1 = Math.min(N - 1, cz1 + 4);
    const src = this.layer, t = this.tmpSmooth, out = this.smooth;
    const at = (f: ArrayLike<number>, x: number, z: number) =>
      f[Math.min(N - 1, Math.max(0, z)) * N + Math.min(N - 1, Math.max(0, x))];
    const pass = (from: ArrayLike<number>, to: Float32Array, xa: number, xb: number, za: number, zb: number) => {
      for (let z = za; z <= zb; z++) {
        for (let x = xa; x <= xb; x++) {
          const v =
            at(from, x - 1, z - 1) + 2 * at(from, x, z - 1) + at(from, x + 1, z - 1) +
            2 * at(from, x - 1, z) + 4 * at(from, x, z) + 2 * at(from, x + 1, z) +
            at(from, x - 1, z + 1) + 2 * at(from, x, z + 1) + at(from, x + 1, z + 1);
          to[z * N + x] = v / 16;
        }
      }
    };
    // Three passes (~7x7 kernel): terrace edges that run diagonally across cells curve instead of zig-zagging.
    const t2 = (this.tmpSmooth2 ??= new Float32Array(N * N));
    pass(src, t, Math.max(0, x0 - 2), Math.min(N - 1, x1 + 2), Math.max(0, z0 - 2), Math.min(N - 1, z1 + 2));
    pass(t, t2, Math.max(0, x0 - 1), Math.min(N - 1, x1 + 1), Math.max(0, z0 - 1), Math.min(N - 1, z1 + 1));
    pass(t2, out, x0, x1, z0, z1);
  }

  /** Turns a continuous layer value into a rounded Godus-style terrace height. */
  terrace(v: number): number {
    // Below sea level the seabed slopes smoothly (no underwater steps showing through the water).
    if (v < 0) return (v - 0.5) * this.H;
    const fl = Math.floor(v);
    const stepped = fl + smootherstep(0.2, 0.8, v - fl);
    // Lowlands keep gentle flat terraces (for building); hills and mountains are smooth slopes.
    const k = smoothstep(2.5, 5, v);
    const t = stepped + (v - stepped) * k;
    return (t - 0.5) * this.H;
  }

  /**
   * The waterfall's ground, too sharp for the blurred layer field: set by shapeWaterfall. Lip (x, z)
   * and flow direction; pool centre l0 along it; basin and rim radii; target heights.
   */
  fallSite: { x: number; z: number; dx: number; dz: number; l0: number; inner: number; rim: number; lipH: number; bankH: number; bedH: number; rimH: number; bound: number } | null = null;

  /**
   * Near the waterfall, blend the terrain to a designed shape: the river channel and high banks
   * above the lip, a sheer drop, a basin running from the foot of the cliff out to the pool and a
   * raised rim round it, open where the river leaves.
   */
  private fallShape(x: number, z: number, h: number): number {
    const s = this.fallSite!;
    const ox = x - s.x, oz = z - s.z;
    if (ox * ox + oz * oz > s.bound * s.bound) return h;
    const a = -ox * s.dz + oz * s.dx, l = ox * s.dx + oz * s.dz, aa = Math.abs(a);
    // Above the drop (raise only).
    const wl = smoothstep(-3.8, -2.6, l) * (1 - smoothstep(0.26, 0.42, l)) * (1 - smoothstep(4.6, 5.6, aa));
    if (wl > 0) {
      const target = s.lipH + (s.bankH - s.lipH) * smoothstep(1.05, 1.8, aa);
      if (target > h) h += (target - h) * wl;
    }
    if (l > 0.26) {
      // Basin: a capsule from the foot of the cliff to the pool centre (lower only).
      const dc = l < s.l0 ? aa : Math.hypot(a, l - s.l0);
      const wb = (1 - smoothstep(s.inner - 0.45, s.inner, dc)) * smoothstep(0.26, 0.4, l);
      if (wb > 0 && s.bedH < h) h += (s.bedH - h) * wb;
      // Rim round it (raise only), open at the outlet.
      const outlet = smoothstep(s.l0 - 0.5, s.l0 + 0.5, l) * (1 - smoothstep(1.0, 1.8, aa));
      const wr = smoothstep(s.inner - 0.15, s.inner + 0.3, dc) * (1 - smoothstep(s.rim - 0.9, s.rim, dc)) * (1 - outlet);
      if (wr > 0 && s.rimH > h) h += (s.rimH - h) * wr;
    }
    return h;
  }

  /** Terrain surface height at a world position (matches the rendered mesh). */
  heightAt(x: number, z: number): number {
    let h = this.terrace(this.layerF(x, z));
    if (this.fallSite) h = this.fallShape(x, z, h);
    if (this.canalCount) h -= this.canalCarve(x, z);
    if (this.swampOn) h -= this.sampleField(this.swampCarve, x, z);
    return h;
  }

  /** Ground height before the swamp pools were dug (their water surface follows this). */
  heightNoSwamp(x: number, z: number): number {
    let h = this.terrace(this.layerF(x, z));
    if (this.fallSite) h = this.fallShape(x, z, h);
    return this.canalCount ? h - this.canalCarve(x, z) : h;
  }

  /** Surface of swamp water at a point (NaN outside the pools). */
  swampWaterY(x: number, z: number): number {
    if (!this.swampOn || this.sampleField(this.swampCarve, x, z) < 0.14) return NaN;
    return this.heightNoSwamp(x, z) - SWAMP_WATER_DROP;
  }

  /**
   * Canals are one cell wide, too narrow for the blurred layer field to show, so their channel
   * is cut into the surface directly: a ditch with steep banks at the cell edges.
   */
  private canalCarve(x: number, z: number): number {
    const gx = x + this.half - 0.5, gz = z + this.half - 0.5;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const fx = gx - x0, fz = gz - z0;
    const c = (cx: number, cz: number) => (this.inBounds(cx, cz) ? this.canal[cz * this.N + cx] : 0);
    const a = c(x0, z0), b = c(x0 + 1, z0), cc = c(x0, z0 + 1), d = c(x0 + 1, z0 + 1);
    if (!(a | b | cc | d)) return 0;
    const v = (a * (1 - fx) + b * fx) * (1 - fz) + (cc * (1 - fx) + d * fx) * fz;
    return CANAL_DEPTH * smoothstep(0.15, 0.62, v);
  }

  /** Recount canal cells after digging, filling or loading. */
  countCanals(): void {
    let n = 0;
    for (let i = 0; i < this.canal.length; i++) n += this.canal[i];
    this.canalCount = n;
  }

  /** Flat top height of a given layer. */
  layerY(layer: number): number {
    return (layer - 0.5) * this.H;
  }

  /** Height islanders and animals stand at (river beds are wadeable, never below 0 in the sea). */
  groundY(x: number, z: number): number {
    const h = this.heightAt(x, z);
    const i = this.cellIndexAt(x, z);
    return i >= 0 && this.bridge[i] ? Math.max(h, BRIDGE_DECK_Y) : h;
  }

  /** True if all cells in the rectangle share a layer, are dry land and unoccupied. */
  isFlatFree(cx: number, cz: number, w: number, d: number): { ok: boolean; layer: number } {
    if (!this.inBounds(cx, cz) || !this.inBounds(cx + w - 1, cz + d - 1)) return { ok: false, layer: 0 };
    const L = this.layer[this.idx(cx, cz)];
    let ok = L >= 1;
    for (let z = cz; z < cz + d && ok; z++) {
      for (let x = cx; x < cx + w; x++) {
        const i = this.idx(x, z);
        if (this.layer[i] !== L || this.occ[i] !== 0 || !Number.isNaN(this.riverY[i])) {
          ok = false;
          break;
        }
      }
    }
    return { ok, layer: L };
  }

  /** Recompute distance-to-sea for all cells (multi-source BFS). */
  computeDistWater(): void {
    const N = this.N;
    const q = new Int32Array(N * N);
    let head = 0, tail = 0;
    for (let i = 0; i < N * N; i++) {
      if (this.layer[i] <= 0) {
        this.distWater[i] = 0;
        q[tail++] = i;
      } else this.distWater[i] = 1e9;
    }
    while (head < tail) {
      const i = q[head++];
      const cx = i % N, cz = (i / N) | 0;
      const d = this.distWater[i] + 1;
      if (cx > 0 && this.distWater[i - 1] > d) { this.distWater[i - 1] = d; q[tail++] = i - 1; }
      if (cx < N - 1 && this.distWater[i + 1] > d) { this.distWater[i + 1] = d; q[tail++] = i + 1; }
      if (cz > 0 && this.distWater[i - N] > d) { this.distWater[i - N] = d; q[tail++] = i - N; }
      if (cz < N - 1 && this.distWater[i + N] > d) { this.distWater[i + N] = d; q[tail++] = i + N; }
    }
  }

  /** Re-derive ground classes after layers change (generation or sculpting). */
  classifyGround(cx0 = 0, cz0 = 0, cx1 = this.N - 1, cz1 = this.N - 1): void {
    for (let cz = Math.max(0, cz0); cz <= Math.min(this.N - 1, cz1); cz++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(this.N - 1, cx1); cx++) {
        const i = this.idx(cx, cz);
        const L = this.layer[i];
        if (!Number.isNaN(this.riverY[i])) this.ground[i] = Ground.River;
        else if (L <= 0) this.ground[i] = Ground.Water;
        else if (this.rocky[i] > 0.55) this.ground[i] = Ground.Rock;
        else if (this.sandy[i] > 0.5) this.ground[i] = Ground.Sand;
        else if (this.forest[i] > 0.45) this.ground[i] = Ground.Jungle;
        else this.ground[i] = Ground.Grass;
      }
    }
  }

  /** Nearest dry, reachable-looking land cell to a world position (spiral search). */
  nearestLand(x: number, z: number, maxR = 12): [number, number] | null {
    const [cx, cz] = this.cellOf(x, z);
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.inBounds(nx, nz)) continue;
          const i = this.idx(nx, nz);
          if (this.isLandCell(i) && this.occ[i] === 0) return [nx, nz];
        }
      }
    }
    return null;
  }
}
