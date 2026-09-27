import { World } from '../world/World';

/** Binary min-heap keyed by f-score, storing cell indices. */
class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.items.length;
  }
  clear(): void {
    this.items.length = 0;
    this.keys.length = 0;
  }
  push(item: number, key: number): void {
    const it = this.items, ks = this.keys;
    let i = it.length;
    it.push(item);
    ks.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= key) break;
      it[i] = it[p];
      ks[i] = ks[p];
      i = p;
    }
    it[i] = item;
    ks[i] = key;
  }
  pop(): number {
    const it = this.items, ks = this.keys;
    const top = it[0];
    const lastI = it.pop()!;
    const lastK = ks.pop()!;
    if (it.length > 0) {
      let i = 0;
      const n = it.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        let mk = lastK;
        if (l < n && ks[l] < mk) { m = l; mk = ks[l]; }
        if (r < n && ks[r] < mk) { m = r; mk = ks[r]; }
        if (m === i) break;
        it[i] = it[m];
        ks[i] = ks[m];
        i = m;
      }
      it[i] = lastI;
      ks[i] = lastK;
    }
    return top;
  }
}

export interface PathOptions {
  /** Building id whose cells may be entered (the destination building). */
  allowBuilding?: number;
  /** Accept any cell within this many cells of the goal. */
  goalRadius?: number;
  maxIterations?: number;
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

/**
 * A* over the terrain grid. Walkers can climb or descend one contour layer per step,
 * prefer worn dirt paths, slow down in dense jungle and can wade shallow rivers.
 */
export class Pathfinder {
  private g: Float32Array;
  private from: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap = new Heap();

  constructor(private world: World) {
    const n = world.N * world.N;
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  walkable(i: number, allowBuilding = -1): boolean {
    const w = this.world;
    if (w.layer[i] < 1 && !w.bridge[i]) return false;
    const occ = w.occ[i];
    if (occ !== 0 && occ - 1 !== allowBuilding && !w.passable(occ - 1)) return false;
    return true;
  }

  /** Layer for walking purposes (bridge decks count as shore level). */
  private walkLayer(i: number): number {
    const w = this.world;
    return w.bridge[i] ? Math.max(1, w.layer[i]) : w.layer[i];
  }

  private stepCost(from: number, to: number, base: number): number {
    const w = this.world;
    const dl = Math.abs(this.walkLayer(to) - this.walkLayer(from));
    if (dl > 1) return -1;
    let c = base;
    if (dl === 1) c += 0.9;
    c *= 1 + w.forest[to] * 0.9;
    if (!Number.isNaN(w.riverY[to])) c *= 4;
    // Worn paths are preferred.
    c *= 1 - w.wear[to] * 0.45;
    // Stone paths are strongly preferred.
    if (w.path[to]) c *= w.path[to] === 1 ? 0.5 : 0.7;
    return c;
  }

  /** Returns world-space waypoints from start to goal (inclusive), or null. */
  find(sx: number, sz: number, tx: number, tz: number, opts: PathOptions = {}): { x: number; z: number }[] | null {
    const w = this.world;
    const N = w.N;
    const [scx, scz] = w.cellOf(sx, sz);
    const [tcx, tcz] = w.cellOf(tx, tz);
    if (!w.inBounds(scx, scz) || !w.inBounds(tcx, tcz)) return null;
    const start = scz * N + scx;
    const allow = opts.allowBuilding ?? -1;
    const gr = opts.goalRadius ?? 0;
    const maxIt = opts.maxIterations ?? 30000;
    const gen = ++this.gen;
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.from[start] = -1;
    const h = (cx: number, cz: number) => Math.hypot(cx - tcx, cz - tcz) * 0.75;
    heap.push(start, h(scx, scz));
    let found = -1;
    let best = start, bestH = h(scx, scz);
    let it = 0;
    while (heap.size > 0 && it++ < maxIt) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      const cx = cur % N, cz = (cur / N) | 0;
      const dGoal = Math.max(Math.abs(cx - tcx), Math.abs(cz - tcz));
      if (dGoal <= gr) {
        found = cur;
        break;
      }
      const hh = h(cx, cz);
      if (hh < bestH) {
        bestH = hh;
        best = cur;
      }
      for (const [dx, dz, base] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const ni = nz * N + nx;
        if (this.closed[ni] === gen) continue;
        if (!this.walkable(ni, allow)) continue;
        // No corner cutting past unwalkable cells.
        if (dx !== 0 && dz !== 0) {
          if (!this.walkable(cz * N + nx, allow) || !this.walkable(nz * N + cx, allow)) continue;
        }
        const sc = this.stepCost(cur, ni, base);
        if (sc < 0) continue;
        const ng = this.g[cur] + sc;
        if (this.stamp[ni] !== gen || ng < this.g[ni]) {
          this.stamp[ni] = gen;
          this.g[ni] = ng;
          this.from[ni] = cur;
          heap.push(ni, ng + h(nx, nz));
        }
      }
    }
    if (found < 0) {
      // Unreachable: go as close as we can if that's meaningfully closer.
      if (bestH > 6 || best === start) return null;
      found = best;
    }
    const cells: number[] = [];
    for (let c = found; c !== -1; c = this.from[c]) cells.push(c);
    cells.reverse();
    const pts = this.smooth(cells, allow);
    // Replace the final waypoint with the exact goal when it lies inside the goal cell.
    if (found === tcz * N + tcx) pts[pts.length - 1] = { x: tx, z: tz };
    return pts;
  }

  /** String-pull the cell path using straight-line walkability checks. */
  private smooth(cells: number[], allow: number): { x: number; z: number }[] {
    const w = this.world;
    const N = w.N;
    const pt = (i: number) => ({ x: w.centerX(i % N), z: w.centerZ((i / N) | 0) });
    if (cells.length <= 2) return cells.map(pt);
    const out: { x: number; z: number }[] = [pt(cells[0])];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      if (!this.clearLine(cells[anchor], cells[i], allow)) {
        out.push(pt(cells[i - 1]));
        anchor = i - 1;
      }
    }
    out.push(pt(cells[cells.length - 1]));
    return out;
  }

  private clearLine(a: number, b: number, allow: number): boolean {
    const w = this.world;
    const N = w.N;
    const ax = a % N, az = (a / N) | 0, bx = b % N, bz = (b / N) | 0;
    const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2);
    if (steps > 24) return false;
    let prev = a;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const cx = Math.round(ax + (bx - ax) * t), cz = Math.round(az + (bz - az) * t);
      const i = cz * N + cx;
      if (i === prev) continue;
      if (!this.walkable(i, allow)) return false;
      if (Math.abs(this.walkLayer(i) - this.walkLayer(prev)) > 1) return false;
      // Keep jungle detours where paths exist: don't cut across forest if the path is worn.
      if (w.forest[i] > 0.6 && w.wear[prev] > 0.4) return false;
      prev = i;
    }
    return true;
  }
}
