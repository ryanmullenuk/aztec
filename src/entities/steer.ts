import { World } from '../world/World';

export interface Mover {
  x: number;
  z: number;
  heading: number;
}

/** Can an animal stand here? Land, bridges, shallow water if it swims; not inside buildings or rocks. */
export function walkable(w: World, x: number, z: number, swim: boolean): boolean {
  const i = w.cellIndexAt(x, z);
  if (i < 0) return false;
  const o = w.occ[i];
  if (o && !w.passableBuildings.has(o - 1)) return false;
  if (w.blocked(i)) return false;
  if (w.bridge[i]) return true;
  return w.heightAt(x, z) > (swim ? -1.7 : -0.12);
}

/**
 * Step toward a target, feeling ahead for a clear way (straight, then angling left and right),
 * and turn the facing smoothly. Returns true on arrival.
 */
export function steer(w: World, o: Mover, tx: number, tz: number, speed: number, dt: number, swim = false, arrive = 0.08): boolean {
  const dx = tx - o.x, dz = tz - o.z;
  const d = Math.hypot(dx, dz);
  if (d < arrive) return true;
  const want = Math.atan2(dx, dz);
  const step = Math.min(d, speed * dt);
  const look = Math.max(step, 0.4);
  const stuck = !walkable(w, o.x, o.z, swim);
  for (const off of [0, 0.45, -0.45, 0.95, -0.95, 1.5, -1.5, 2.2, -2.2]) {
    const a = want + off;
    const sx = Math.sin(a), sz = Math.cos(a);
    if (!stuck && !walkable(w, o.x + sx * look, o.z + sz * look, swim)) continue;
    o.x += sx * step;
    o.z += sz * step;
    turnTo(o, a, dt, 9);
    return false;
  }
  return false;
}

export function turnTo(o: Mover, a: number, dt: number, rate: number): void {
  let dh = a - o.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  o.heading += dh * Math.min(1, dt * rate);
}
