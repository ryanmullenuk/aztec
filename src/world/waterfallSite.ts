import { World } from './World';

/**
 * Give the waterfall the ground it needs: a sheer step under the lip with high banks either side,
 * a basin one layer deep under the plunge pool and a low sandy rim round it (the rock columns stand
 * on it as the gorge walls), dipping to a spill lip where the river flows out. The generator carves these too, but the river
 * running on downstream lowers the basin's far side and terrain smoothing rounds the cliff away;
 * this runs after a save is applied, so old saves get the fixed ground as well.
 *
 * Also marks the plunge pool, the curtain and the cliff face as places nobody can walk.
 */
export function shapeWaterfall(w: World): void {
  const f = w.waterfall;
  if (!f) return;
  const H = w.H;
  // Layers: the river at the lip, and the pool bed.
  const top = Math.round(f.topY / H + 0.5 - 0.7);
  const bot = Math.round(f.poolY / H + 0.5 - 0.7);
  if (top - bot < 2) return;
  const px = -f.dz, pz = f.dx;
  const l0 = f.poolR + 1.2;
  const inner = f.poolR + 0.6, rim = f.poolR + 2.4;
  const N = w.N;
  const [ccx, ccz] = w.cellOf(f.x + f.dx * l0 * 0.5, f.z + f.dz * l0 * 0.5);
  const R = Math.ceil(rim + l0);
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      if (!w.inBounds(cx, cz)) continue;
      const i = cz * N + cx;
      if (w.layer[i] <= 0) continue;
      const ox = w.centerX(cx) - f.x, oz = w.centerZ(cz) - f.z;
      const a = ox * px + oz * pz, l = ox * f.dx + oz * f.dz;
      const d = Math.hypot(a, l - l0);
      const aa = Math.abs(a);
      if (l <= 0.35 && l >= -3.5 && aa <= 5) {
        // Above the drop: the river channel at the lip's layer, high banks either side of it.
        if (aa <= 1.0) {
          w.layer[i] = top;
          w.riverY[i] = f.topY;
        } else {
          w.layer[i] = Math.max(w.layer[i], top + 1);
          w.rocky[i] = Math.max(w.rocky[i], 0.85);
          w.forest[i] *= 0.5;
        }
        continue;
      }
      if (l > 0.35 && d <= inner) {
        // The plunge pool.
        w.layer[i] = bot;
        w.riverY[i] = f.poolY;
        w.sandy[i] = 0;
        w.rocky[i] = 0;
        w.forest[i] = 0;
        continue;
      }
      if (l > 0.35 && d <= rim) {
        // Sandy rim, left open where the river runs out downstream.
        const outlet = l > l0 && aa < 1.4;
        if (outlet) {
          w.layer[i] = Math.min(w.layer[i], bot);
          w.riverY[i] = Number.isNaN(w.riverY[i]) ? f.poolY : Math.min(w.riverY[i], f.poolY);
        } else {
          w.layer[i] = Math.max(Math.min(w.layer[i], bot + 2), bot + 1);
          w.riverY[i] = NaN;
          w.sandy[i] = 1;
          w.forest[i] *= 0.4;
        }
      }
    }
  }
  // Nobody walks under the fall, into the plunge pool or up the cliff face.
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      if (!w.inBounds(cx, cz)) continue;
      const ox = w.centerX(cx) - f.x, oz = w.centerZ(cz) - f.z;
      const a = ox * px + oz * pz, l = ox * f.dx + oz * f.dz;
      const d = Math.hypot(a, l - l0);
      const curtain = l > -1.2 && l < 2.2 && Math.abs(a) < 2.2;
      if (curtain || (l > 0.35 && d <= inner + 0.3)) w.blockFixed[cz * N + cx] = 1;
    }
  }
  // The sharp shape itself (the layer field above is too blurred to hold a cliff).
  w.fallSite = {
    x: f.x, z: f.z, dx: f.dx, dz: f.dz, l0, inner, rim: f.poolR + 2.6,
    lipH: f.topY - 0.3, bankH: f.topY + 0.35, bedH: f.poolY - 0.45, rimH: f.poolY + 0.35, spillH: f.poolY - 0.04, bound: l0 + f.poolR + 4,
  };
  w.computeDistWater();
  w.classifyGround();
  w.computeSmooth();
  w.version++;
}
