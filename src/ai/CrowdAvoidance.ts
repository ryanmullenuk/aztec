import { Islander } from '../entities/Islander';
import { SpatialHash } from '../world/SpatialHash';

const moving = (i: Islander) => !i.sleeping && (i.anim === 'walk' || i.anim === 'run' || i.anim === 'carry');
/** Anticipate collisions; consistently pass on the right, or yield in tight passages. */
export function avoidCrowd(a: Islander, dx: number, dz: number, speed: number, grid: SpatialHash<Islander>, canStep: (x: number, z: number) => boolean): { x: number; z: number } {
  const length = Math.hypot(dx, dz);
  if (length < 0.001 || speed <= 0) return { x: 0, z: 0 };
  const fx = dx / length, fz = dz / length;
  const nearby: Islander[] = [];
  grid.query(a.x, a.z, 2.6, b => {
    if (b !== a && !b.hidden && Math.abs(a.y - b.y) < 0.5) nearby.push(b);
  });
  for (const angle of [0, 0.65, -0.65, 1.15, -1.15]) {
    const vx = (fx * Math.cos(angle) + fz * Math.sin(angle)) * speed;
    const vz = (fz * Math.cos(angle) - fx * Math.sin(angle)) * speed;
    if (![0.12, 0.3].every(t => canStep(a.x + vx * Math.min(t, length / speed), a.z + vz * Math.min(t, length / speed)))) continue;
    const safe = nearby.every(b => {
      const bx = b.x - a.x, bz = b.z - a.z;
      const bv = moving(b) ? Math.max(0, b.speed) : 0;
      const rx = vx - Math.sin(b.heading) * bv, rz = vz - Math.cos(b.heading) * bv;
      const vv = rx * rx + rz * rz;
      const t = Math.max(0, Math.min(0.8, (bx * rx + bz * rz) / (vv || 1)));
      const separation = Math.hypot(bx - rx * t, bz - rz * t);
      const radius = 0.32 * (a.child && b.child ? 0.75 : 1);
      // Allow separating from an existing overlap; the fallback resolves its remainder.
      return separation >= radius || (t === 0 && bx * rx + bz * rz <= 0);
    });
    if (safe) return { x: vx, z: vz };
  }
  return { x: 0, z: 0 };
}
