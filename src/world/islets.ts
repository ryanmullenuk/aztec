import { Simplex2, smoothstep } from './noise';
import { RNG } from './rng';
import { World } from './World';

/**
 * Grow the outer islets into their current shape: bigger and fuller, further in from the map
 * edge, several joined to the coast by a sand spit. The generator works out the new layers while
 * building the original island; they are applied here, after the plants have been generated from
 * the original, so the saved plant list keeps its order (new islet plants are appended after it).
 * Returns the cells that became land or new shallows, for the new plants and reefs.
 */
export function growIslets(w: World): number[] {
  const next = w.isletNext;
  if (!next) return [];
  w.isletNext = null;
  const N = w.N;
  const newLand: number[] = [];
  const oldLayer = new Int8Array(next.cells.length);
  next.cells.forEach((i, k) => {
    oldLayer[k] = w.layer[i];
    w.layer[i] = next.layer[k];
    if ((w.layer[i] >= 1 && oldLayer[k] < 1) || (w.layer[i] <= 0 && w.layer[i] >= -2 && oldLayer[k] < -2)) newLand.push(i);
  });
  w.computeDistWater();
  // Beaches round the edge, thick jungle inside, bare rock on the higher crowns.
  const n = new Simplex2(new RNG(w.seed * 17 + 911));
  const sandy = new Float32Array(next.cells.length), forest = new Float32Array(next.cells.length), rocky = new Float32Array(next.cells.length);
  next.cells.forEach((i, k) => {
    const L = w.layer[i];
    const cx = i % N, cz = (i / N) | 0;
    if (L < 1) {
      w.sandy[i] = w.forest[i] = w.rocky[i] = 0;
    } else {
      const dw = w.distWater[i];
      const nv = n.noise(cx * 0.21, cz * 0.21);
      w.sandy[i] = dw <= 1.5 || (L === 1 && dw <= 3) ? 1 : 0;
      w.rocky[i] = L >= 4 && nv > 0.25 ? 0.8 : 0;
      w.forest[i] = (0.78 + nv * 0.2) * smoothstep(1, 3, dw) * (1 - w.sandy[i]) * (1 - w.rocky[i] * 0.7);
    }
    sandy[k] = w.sandy[i];
    forest[k] = w.forest[i];
    rocky[k] = w.rocky[i];
  });
  w.isletGrown = { cells: next.cells, layer: next.layer, sandy, forest, rocky };
  w.classifyGround();
  w.computeSmooth();
  w.version++;
  return newLand;
}

/** Saves from before the islets grew store the old islet terrain: put the grown islets back. */
export function regrowSavedIslets(w: World): void {
  const g = w.isletGrown;
  if (!g) return;
  g.cells.forEach((i, k) => {
    w.layer[i] = g.layer[k];
    w.sandy[i] = g.sandy[k];
    w.forest[i] = g.forest[k];
    w.rocky[i] = g.rocky[k];
  });
}
