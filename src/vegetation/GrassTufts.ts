import * as THREE from 'three';
import { COLORS, VEG } from '../config';
import { GeoBuilder, M } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { World } from '../world/World';

/** A clump of 5 thin blades, pivoting at the ground and swaying at the tips. */
function tuftGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.03, 0, 0, 0.03, 0, 0, 0, 1, 0], 3));
  // Normals point up so blades light like the meadow under them (seen from above, not edge-on).
  blade.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  // Both windings share the upward normals, so either side lights the same (no back-face flip).
  blade.setIndex([0, 1, 2, 2, 1, 0]);
  const base = new THREE.Color(COLORS.grassOlive), tip = new THREE.Color(COLORS.grassBright);
  const n = 6;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + k * 0.7;
    const h = 0.16 + ((k * 37) % 7) * 0.014;
    // Blades fan outward so the clump reads from the tilted top-down camera.
    b.add(blade, { color: (p) => base.clone().lerp(tip, Math.min(1, 0.35 + p.y / h)), sway: (p) => Math.min(1, p.y / h) * 0.9 }, M.t(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03, Math.sin(a) * 0.55, a, -Math.cos(a) * 0.55, 1, h, 1));
  }
  return b.build();
}

interface Tuft {
  x: number;
  y: number;
  z: number;
  cell: number;
  rot: number;
  s: number;
  chunk: number;
}

/**
 * Decorative grass clumps over open meadows (not plants: nothing harvests them). Split into chunks
 * for frustum culling; clumps on buildings, fields and worn paths are hidden automatically.
 */
export class GrassTufts {
  readonly group = new THREE.Group();
  private tufts: Tuft[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private timer = 0;
  private C = VEG.chunks;

  constructor(private world: World, density: number) {
    const w = world;
    const rng = new RNG(w.seed * 311 + 7);
    const N = w.N;
    for (let cz = 1; cz < N - 1; cz++) {
      for (let cx = 1; cx < N - 1; cx++) {
        const i = cz * N + cx;
        if (!w.isLandCell(i) || w.sandy[i] > 0.4 || w.rocky[i] > 0.35) continue;
        // Thick in open meadows, sparser on the shaded jungle floor.
        const want = VEG.tuftsPerCell * density * (1 - w.forest[i] * 0.7);
        const n = Math.floor(want + rng.next());
        for (let k = 0; k < n; k++) {
          const x = w.centerX(cx) + rng.range(-0.5, 0.5), z = w.centerZ(cz) + rng.range(-0.5, 0.5);
          // Only on flat ground (not terrace faces).
          const y = w.heightAt(x, z);
          if (Math.abs(w.heightAt(x + 0.25, z) - y) > 0.05 || Math.abs(w.heightAt(x, z + 0.25) - y) > 0.05) continue;
          const chunk = Math.min(this.C - 1, Math.floor((cx / N) * this.C)) + Math.min(this.C - 1, Math.floor((cz / N) * this.C)) * this.C;
          this.tufts.push({ x, y, z, cell: i, rot: rng.range(0, 6.28), s: rng.range(0.7, 1.35), chunk });
        }
      }
    }
    const geo = tuftGeometry();
    const mat = stylisedMaterial();
    const col = new THREE.Color();
    const lime = new THREE.Color(0xffffff), olive = new THREE.Color(0xc8d0a0);
    for (let c = 0; c < this.C * this.C; c++) {
      const list = this.tufts.filter((t) => t.chunk === c);
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      m.castShadow = false;
      m.receiveShadow = true;
      m.count = 0;
      list.forEach((t, k) => m.setColorAt(k, col.copy(lime).lerp(olive, ((t.rot * 13) % 1) * 0.8)));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      // Bounds for frustum culling.
      const size = (w.N / this.C) * 1.0;
      const ccx = c % this.C, ccz = Math.floor(c / this.C);
      const bx = (ccx + 0.5) * size - w.half, bz = (ccz + 0.5) * size - w.half;
      m.geometry = geo;
      (m as unknown as { _list: Tuft[] })._list = list;
      m.frustumCulled = true;
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(bx, 3, bz), size * 0.75 + 4);
      this.meshes.push(m);
      this.group.add(m);
    }
    this.refresh();
  }

  /** Re-pack visible clumps (hides those under buildings, farms and worn paths; follows sculpting). */
  refresh(): void {
    const w = this.world;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const m of this.meshes) {
      const list = (m as unknown as { _list: Tuft[] })._list;
      let n = 0;
      for (const t of list) {
        const i = t.cell;
        if (w.occ[i] !== 0 || w.path[i] || w.wear[i] > 0.3 || w.soil[i] > 0.05 || !w.isLandCell(i)) continue;
        const y = w.heightAt(t.x, t.z);
        q.setFromAxisAngle(up, t.rot);
        mtx.compose(p.set(t.x, y - 0.01, t.z), q, s.setScalar(t.s));
        m.setMatrixAt(n++, mtx);
      }
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 2.5;
      this.refresh();
    }
  }
}
