import { POWERS, WORLD } from '../config';
import { Economy } from '../economy/Economy';
import { Vegetation } from '../vegetation/Vegetation';
import { Water } from '../water/Water';
import { World } from '../world/World';
import { Terrain } from './Terrain';

export type SculptMode = 'raise' | 'lower' | 'flatten';

/**
 * Godus-style sculpting: click-drag to pull the land up or push it down one contour layer.
 * Each cell changes at most once per stroke; every layer step costs Belief.
 */
export class Sculptor {
  private touched = new Set<number>();
  private mode: SculptMode = 'raise';
  private target = 0;
  private dirty: [number, number, number, number] | null = null;
  private flushTimer = 0;
  active = false;
  /** Total layer steps sculpted (for the tutorial and stats). */
  total = 0;
  /** Set when the stroke ran out of Belief. */
  starved = false;

  constructor(private world: World, private terrain: Terrain, private water: Water, private veg: Vegetation, private eco: Economy) {}

  begin(mode: SculptMode, x: number, z: number): void {
    this.mode = mode;
    this.touched.clear();
    this.active = true;
    this.starved = false;
    const i = this.world.cellIndexAt(x, z);
    this.target = i >= 0 ? this.world.layer[i] : 1;
    this.apply(x, z);
  }

  apply(x: number, z: number): void {
    if (!this.active) return;
    const w = this.world;
    const r = POWERS.sculptRadius;
    const [cx, cz] = w.cellOf(x, z);
    const R = Math.ceil(r);
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (!w.inBounds(nx, nz) || nx < 2 || nz < 2 || nx > w.N - 3 || nz > w.N - 3) continue;
        const d = Math.hypot(w.centerX(nx) - x, w.centerZ(nz) - z);
        if (d > r) continue;
        const i = w.idx(nx, nz);
        if (this.touched.has(i)) continue;
        if (w.occ[i] !== 0 || !Number.isNaN(w.riverY[i])) continue;
        const L = w.layer[i];
        let nl = L;
        if (this.mode === 'raise') nl = Math.min(WORLD.maxLayer, L + 1);
        else if (this.mode === 'lower') nl = Math.max(WORLD.minLayer + 3, L - 1);
        else nl = this.target;
        if (nl === L) continue;
        const cost = Math.abs(nl - L) * POWERS.sculptCostPerCell;
        if (this.eco.res.belief < cost) {
          this.starved = true;
          continue;
        }
        this.eco.res.belief -= cost;
        this.touched.add(i);
        w.layer[i] = nl;
        this.total += Math.abs(nl - L);
        // New land from the sea becomes beach; land pushed underwater loses its plants.
        if (L <= 0 && nl >= 1) {
          w.sandy[i] = 1;
          w.forest[i] = 0;
          w.rocky[i] = 0;
        }
        if (nl >= 3 && L < 3) w.sandy[i] = Math.min(w.sandy[i], 0.3);
        this.markDirty(nx, nz);
      }
    }
    this.flushTimer = 0;
  }

  private markDirty(cx: number, cz: number): void {
    if (!this.dirty) this.dirty = [cx, cz, cx, cz];
    else {
      this.dirty[0] = Math.min(this.dirty[0], cx);
      this.dirty[1] = Math.min(this.dirty[1], cz);
      this.dirty[2] = Math.max(this.dirty[2], cx);
      this.dirty[3] = Math.max(this.dirty[3], cz);
    }
  }

  end(): void {
    this.active = false;
    this.flush(true);
  }

  /** Rebuild meshes for the changed area (throttled while dragging). */
  update(dt: number): void {
    this.flushTimer += dt;
    if (this.dirty && this.flushTimer > 0.05) this.flush(false);
  }

  private flush(final: boolean): void {
    if (!this.dirty) return;
    const [x0, z0, x1, z1] = this.dirty;
    this.dirty = null;
    const w = this.world;
    w.computeSmooth(x0, z0, x1, z1);
    w.classifyGround(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
    this.terrain.rebuild(x0, z0, x1, z1);
    this.water.updateHeight(x0, z0, x1, z1);
    this.veg.refreshHeights(x0 - 2, z0 - 2, x1 + 2, z1 + 2);
    w.version++;
    if (final) w.computeDistWater();
  }
}
