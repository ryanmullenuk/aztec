import { World } from '../world/World';
import { SEA_SURFACE } from '../water/Water';

/** Bridge decks take precedence; otherwise keep swimming bodies at the water surface. */
export function escortSurfaceY(w: World, x: number, z: number, immersion = 0.18): number {
  const i = w.cellIndexAt(x, z), ground = w.groundY(x, z);
  if (i < 0 || w.bridge[i]) return ground;
  let water = w.layer[i] < 1 ? SEA_SURFACE : -Infinity;
  if (Number.isFinite(w.riverY[i])) water = Math.max(water, w.riverY[i]);
  const swamp = w.swampWaterY(x, z);
  if (Number.isFinite(swamp)) water = Math.max(water, swamp);
  return Math.max(ground, water - immersion);
}

export function leashedWalkable(w: World, x: number, z: number, fromX: number, fromZ: number, maxSlope: number, pen?: number): boolean {
  const i = w.cellIndexAt(x, z);
  if (i < 0 || w.blocked(i)) return false;
  if (w.occ[i] && w.occ[i] - 1 !== pen && !w.passable(w.occ[i] - 1)) return false;
  return Math.abs(escortSurfaceY(w, x, z) - escortSurfaceY(w, fromX, fromZ)) < maxSlope;
}
