import * as THREE from 'three';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { BRIDGE_DECK_Y, World } from '../world/World';

const PLANK = [new THREE.Color(0x9a6a3e), new THREE.Color(0x8a5c34), new THREE.Color(0xa87848)];
const POST = new THREE.Color(0x5e3b22);
const ROPE = new THREE.Color(0xc9a86a);

/**
 * Rope bridges across shallow water, laid cell by cell with the Build menu's bridge tool:
 * a plank deck on piles, with posts and rope rails along the open sides.
 */
export class Bridges {
  readonly mesh: THREE.Mesh;

  constructor(private world: World) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), stylisedMaterial());
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'bridges';
    this.rebuild();
  }

  /** Can a bridge deck go on this cell? Shallow water next to land or another deck. */
  canBridge(i: number): boolean {
    const w = this.world;
    if (w.bridge[i] || w.layer[i] > 0 || w.layer[i] < -3 || w.occ[i]) return false;
    const N = w.N, cx = i % N, cz = (i / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!w.inBounds(cx + dx, cz + dz)) continue;
      const j = w.idx(cx + dx, cz + dz);
      if (w.bridge[j] || w.layer[j] >= 1) return true;
    }
    return false;
  }

  rebuild(): void {
    const w = this.world;
    const N = w.N;
    const b = new GeoBuilder();
    const open = (cx: number, cz: number) => {
      if (!w.inBounds(cx, cz)) return 0;
      const j = w.idx(cx, cz);
      return w.bridge[j] || w.layer[j] >= 1 ? 1 : 0;
    };
    let n = 0;
    for (let i = 0; i < N * N; i++) {
      if (!w.bridge[i]) continue;
      n++;
      const cx = i % N, cz = (i / N) | 0;
      const x = w.centerX(cx), z = w.centerZ(cz);
      const ex = open(cx + 1, cz) + open(cx - 1, cz), ez = open(cx, cz + 1) + open(cx, cz - 1);
      const alongX = ex >= ez;
      const y = BRIDGE_DECK_Y;
      // Planks laid across the direction of travel, with small gaps.
      for (let k = 0; k < 5; k++) {
        const o = -0.4 + k * 0.2;
        const col = PLANK[(cx * 3 + cz * 5 + k) % 3];
        if (alongX) b.add(P.box(0.18, 0.05, 1.02), { color: col }, M.t(x + o, y - 0.025, z, 0, 0, ((k % 2) - 0.5) * 0.04));
        else b.add(P.box(1.02, 0.05, 0.18), { color: col }, M.t(x, y - 0.025, z + o, ((k % 2) - 0.5) * 0.04, 0, 0));
      }
      // Piles down to the seabed.
      const bed = w.heightAt(x, z);
      const ph = Math.max(0.2, y - bed + 0.1);
      for (const s of [-0.42, 0.42]) {
        const px = alongX ? x : x + s, pz = alongX ? z + s : z;
        b.add(P.cyl(0.05, 0.06, ph, 5), { color: POST }, M.t(px, y - ph / 2, pz));
      }
      // Posts and rope rails along the sides with no neighbouring deck.
      const sides: [number, number][] = alongX ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
      for (const [sx, sz] of sides) {
        if (w.inBounds(cx + sx, cz + sz) && w.bridge[w.idx(cx + sx, cz + sz)]) continue;
        const rx = x + sx * 0.48, rz = z + sz * 0.48;
        for (const t of [-0.45, 0.45]) {
          const px = alongX ? x + t : rx, pz = alongX ? rz : z + t;
          b.add(P.cyl(0.03, 0.035, 0.5, 5), { color: POST }, M.t(px, y + 0.22, pz));
        }
        const len = 1.0;
        for (const ry of [0.3, 0.44]) {
          if (alongX) b.add(P.cyl(0.012, 0.012, len, 4), { color: ROPE }, M.t(x, y + ry, rz, 0, 0, Math.PI / 2));
          else b.add(P.cyl(0.012, 0.012, len, 4), { color: ROPE }, M.t(rx, y + ry, z, Math.PI / 2, 0, 0));
        }
      }
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = n ? b.build() : new THREE.BufferGeometry();
    this.mesh.visible = n > 0;
  }
}
