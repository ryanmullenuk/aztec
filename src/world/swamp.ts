import { SWAMP } from '../config';
import { Simplex2, smoothstep } from './noise';
import { RNG } from './rng';
import { SWAMP_WATER_DROP, World } from './World';

/**
 * Swampland: one or two low-lying stretches of jungle, well away from the village, become wet
 * ground, then mud, then irregular pools of dark water. Chosen from the seed and the untouched
 * island (so it never moves between sessions and saved plants still line up); the pools are dug
 * into the surface by a separate carve field rather than by changing terrain layers.
 */
export function generateSwamps(w: World, seed: number): void {
  const rng = new RNG(seed * 131 + 77);
  const nA = new Simplex2(rng), nB = new Simplex2(rng);
  const N = w.N, m = w.meadow;
  // Candidate centres: flat, low jungle with water not far off.
  const cands: { x: number; z: number; s: number }[] = [];
  for (let k = 0; k < 6000; k++) {
    const cx = rng.int(8, N - 9), cz = rng.int(8, N - 9);
    const i = w.idx(cx, cz);
    if (!w.isLandCell(i) || w.layer[i] < 1 || w.layer[i] > 2 || w.forest[i] < 0.3 || w.sandy[i] > 0.3 || w.rocky[i] > 0.3) continue;
    const x = w.centerX(cx), z = w.centerZ(cz);
    if (Math.hypot(x - m.x, z - m.z) < SWAMP.awayFromVillage) continue;
    // Mostly one terrace level around it (a basin, not a hillside).
    let same = 0, tot = 0;
    for (let dz = -4; dz <= 4; dz += 2) for (let dx = -4; dx <= 4; dx += 2) {
      if (!w.inBounds(cx + dx, cz + dz)) continue;
      tot++;
      if (w.layer[w.idx(cx + dx, cz + dz)] === w.layer[i]) same++;
    }
    if (same / tot < 0.8) continue;
    cands.push({ x, z, s: w.forest[i] + (w.layer[i] === 1 ? 0.4 : 0) + (w.distWater[i] < 10 ? 0.3 : 0) + rng.next() * 0.4 });
  }
  cands.sort((a, b) => b.s - a.s);
  for (const c of cands) {
    if (w.swamps.length >= SWAMP.count) break;
    if (w.swamps.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 45)) continue;
    w.swamps.push({ x: c.x, z: c.z, r: rng.range(SWAMP.radius[0], SWAMP.radius[1]) });
  }
  if (!w.swamps.length) return;
  const raw = new Float32Array(N * N);
  for (const sw of w.swamps) {
    const R = Math.ceil(sw.r + 4);
    const [ccx, ccz] = w.cellOf(sw.x, sw.z);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      if (!w.inBounds(cx, cz)) continue;
      const i = w.idx(cx, cz);
      if (!w.isLandCell(i) || w.layer[i] < 1 || w.rocky[i] > 0.4) continue;
      const x = w.centerX(cx), z = w.centerZ(cz);
      // Irregular edges: the distance is bent by broad noise.
      const d = Math.hypot(x - sw.x, z - sw.z) / sw.r + nA.noise(x * 0.12, z * 0.12) * 0.35;
      const s = 1 - smoothstep(0.5, 1.05, d);
      if (s <= 0) continue;
      w.swamp[i] = Math.max(w.swamp[i], s);
      // Pools: patchy dark water in the wettest parts; wet mud sinks a little everywhere else.
      // Several irregular pools with muddy hummocks between them, not one big lake.
      const pool = s > 0.5 && nB.noise(x * 0.32, z * 0.32) + nA.noise(x * 0.9 + 17, z * 0.9) * 0.5 > 0.32;
      raw[i] = Math.max(raw[i], pool ? SWAMP.poolDepth : SWAMP.mudDepth * s);
    }
  }
  // Soften the carve so the pools have rounded beds and gentle muddy banks.
  const tmp = new Float32Array(N * N);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? raw : tmp, dst = pass === 0 ? tmp : w.swampCarve;
    for (let cz = 1; cz < N - 1; cz++) for (let cx = 1; cx < N - 1; cx++) {
      let sum = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) sum += src[(cz + dz) * N + cx + dx] * (dx === 0 && dz === 0 ? 4 : dx === 0 || dz === 0 ? 2 : 1);
      dst[cz * N + cx] = sum / 16;
    }
  }
  w.swampOn = true;
}

/**
 * After the save is applied: pool cells count as shallow water (nothing can be built in them and
 * villagers wade slowly through), like river cells.
 */
export function finishSwamps(w: World): void {
  if (!w.swampOn) return;
  for (let i = 0; i < w.N * w.N; i++) {
    if (w.swampCarve[i] < SWAMP.poolDepth * 0.45 || !Number.isNaN(w.riverY[i])) continue;
    const x = w.centerX(i % w.N), z = w.centerZ((i / w.N) | 0);
    w.riverY[i] = w.heightNoSwamp(x, z) - SWAMP_WATER_DROP;
  }
}
