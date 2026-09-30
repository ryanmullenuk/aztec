import { WORLD } from '../config';
import { Simplex2, lerp, smoothstep } from './noise';
import { RNG } from './rng';
import { World } from './World';

/** Cells from each cell to the nearest land (0 on land), by a breadth-first flood over the grid. */
export function landDistance(w: World): Float32Array {
  const N = w.N;
  const d = new Float32Array(N * N).fill(1e9);
  const q = new Int32Array(N * N);
  let head = 0, tail = 0;
  for (let i = 0; i < N * N; i++) if (w.layer[i] >= 1) (d[i] = 0), (q[tail++] = i);
  while (head < tail) {
    const i = q[head++];
    const cx = i % N;
    for (const j of [cx > 0 ? i - 1 : -1, cx < N - 1 ? i + 1 : -1, i - N, i + N]) {
      if (j < 0 || j >= N * N || d[j] <= d[i] + 1) continue;
      d[j] = d[i] + 1;
      q[tail++] = j;
    }
  }
  return d;
}

/**
 * Let the sea floor fall away into the deep toward the edge of the map along a rounded, wandering
 * line, so the shallows round the outer islets and the islands' reef shelves never run on to the
 * map's square edge and get cut off straight. Only open water is lowered (never land, canals,
 * bridges, rivers or anything built), and never right beside land: the islets keep their beaches
 * and a band of shallows, dropping away steeply on the seaward side like a real reef wall.
 * Sea rocks keep a small mound of shallows under them (`rocks`: the cells they stand in). Applied
 * after a save is loaded too, so every island gets it; running it again changes nothing. Returns
 * how many cells were lowered.
 */
export function softenMapEdge(w: World, rocks: number[] = []): number {
  const N = w.N;
  const dl = landDistance(w);
  const n = new Simplex2(new RNG(w.seed * 7 + 5));
  // A rounded square a little inside the map: its corners are cut round so no right angle shows.
  const H = (N - 1) / 2, Rc = 36;
  // Sea rocks stand on the shallows (they'd be left floating over deep water).
  const keepCells = new Set<number>();
  for (const i of rocks) {
    const cx = i % N, cz = (i / N) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (w.inBounds(cx + dx, cz + dz)) keepCells.add(w.idx(cx + dx, cz + dz));
  }
  let changed = 0;
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const i = cz * N + cx;
      const L = w.layer[i];
      if (L >= 1 || L <= WORLD.minLayer || w.canal[i] || w.bridge[i] || w.occ[i] || !Number.isNaN(w.riverY[i]) || keepCells.has(i)) continue;
      const qx = Math.abs(cx - H) - (H - Rc), qz = Math.abs(cz - H) - (H - Rc);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - Rc;
      // Distance in from that edge (cells), wandering a little with broad noise (less right at the edge).
      const e0 = -outside;
      const de = e0 + n.noise(cx * 0.045, cz * 0.045) * 4 * smoothstep(0, 12, e0);
      if (de > 34) continue;
      // The reef shelf may reach this far from the coast: narrowing toward the edge, so its outer
      // line follows the shape of the islands (offset from their coasts) rather than the map, with
      // the width wandering. Past it the floor slopes away into the deep over a few cells, and the
      // last few cells before the edge are always deep water.
      const shelf = (1.5 + 38.5 * smoothstep(3, 34, de)) * (0.75 + 0.5 * (0.5 + 0.5 * n.noise(cx * 0.09 + 11, cz * 0.09 - 4)));
      const keep = (1 - smoothstep(0, 5, dl[i] - shelf)) * smoothstep(0, 4, e0 + 1);
      if (keep >= 1) continue;
      // The shallowest the sea floor may be here (set by position alone, so a second pass changes nothing).
      const L2 = Math.min(L, Math.round(lerp(WORLD.minLayer, 0, keep)));
      if (L2 === L) continue;
      w.layer[i] = L2;
      changed++;
    }
  }
  if (changed) {
    w.computeSmooth();
    w.computeDistWater();
    w.classifyGround();
    w.version++;
  }
  return changed;
}
