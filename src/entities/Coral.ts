import * as THREE from 'three';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { patchStylised } from '../render/materials';
import { angularRockGeometry } from '../render/rocks';
import { RNG } from '../world/rng';
import { World } from '../world/World';

type CoralKind = 'branch' | 'brain' | 'table' | 'fan' | 'tube' | 'soft' | 'weed' | 'rock';

const WHITE = 0xf4f0ea;

/** Staghorn-style branching coral: a few tapering forks. */
function branchCoral(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(7);
  const limb = (x: number, y: number, z: number, len: number, r: number, rx: number, rz: number, depth: number) => {
    b.add(P.cyl(r * 0.6, r, len, 5), { color: WHITE, sway: 0.05 }, M.t(x, y, z, rx, 0, rz).multiply(M.t(0, len / 2, 0)));
    if (depth <= 0) {
      b.add(P.sphere(r * 0.75, 0), { color: 0xffffff }, M.t(x, y, z, rx, 0, rz).multiply(M.t(0, len, 0)));
      return;
    }
    const tip = new THREE.Vector3(0, len, 0).applyEuler(new THREE.Euler(rx, 0, rz));
    for (let k = 0; k < 2; k++) limb(x + tip.x, y + tip.y, z + tip.z, len * 0.72, r * 0.7, rx + rng.range(-0.6, 0.6), rz + rng.range(-0.7, 0.7), depth - 1);
  };
  for (let k = 0; k < 4; k++) limb(0, 0, 0, 0.22, 0.03, rng.range(-0.5, 0.5), rng.range(-0.6, 0.6), 2);
  return b.build();
}

/** Round, grooved brain coral. */
function brainCoral(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.22, 3);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const groove = Math.sin(v.x * 60 + Math.sin(v.z * 40) * 2) * 0.012;
    v.multiplyScalar(1 + groove / 0.22);
    if (v.y < 0) v.y *= 0.3;
    pos.setXYZ(i, v.x, v.y * 0.8, v.z);
  }
  g.computeVertexNormals();
  const b = new GeoBuilder();
  b.add(g, { color: (p) => new THREE.Color(Math.sin(p.x * 60 + Math.sin(p.z * 40) * 2) > 0.2 ? 0xffffff : 0xcfc8bc) });
  return b.build();
}

/** Flat table coral on a short stalk. */
function tableCoral(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.03, 0.05, 0.16, 6), { color: 0xd8d0c4 }, M.t(0, 0.08, 0));
  b.add(P.cyl(0.32, 0.26, 0.04, 12), { color: WHITE }, M.t(0, 0.18, 0, 0.08, 0, 0.05));
  b.add(P.cyl(0.2, 0.18, 0.035, 10), { color: 0xffffff }, M.t(0.06, 0.225, -0.04, 0.05, 0, -0.06));
  return b.build();
}

/** Sea fan: a flat lattice that sways in the current. */
function seaFan(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(11);
  b.add(P.cyl(0.012, 0.018, 0.12, 4), { color: WHITE }, M.t(0, 0.06, 0));
  for (let k = 0; k < 16; k++) {
    const a = -1.1 + (k / 15) * 2.2;
    const len = 0.28 + rng.next() * 0.14;
    b.add(P.box(0.012, len, 0.006), { color: WHITE, sway: 0.5 }, M.t(Math.sin(a) * len * 0.5, 0.1 + Math.cos(a) * len * 0.5, 0, 0, 0, -a));
  }
  // Cross ribs make it read as a lattice.
  for (let k = 0; k < 4; k++) {
    const y = 0.18 + k * 0.07, w = 0.26 - k * 0.03 + 0.1;
    b.add(P.box(w, 0.008, 0.006), { color: WHITE, sway: 0.5 }, M.t(0, y, 0));
  }
  return b.build();
}

/** Cluster of tube sponges. */
function tubeSponge(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(5);
  for (let k = 0; k < 5; k++) {
    const h = 0.16 + rng.next() * 0.22, r = 0.035 + rng.next() * 0.02;
    const x = rng.range(-0.08, 0.08), z = rng.range(-0.08, 0.08);
    b.add(P.cyl(r, r * 0.85, h, 7, true), { color: WHITE }, M.t(x, h / 2, z, rng.range(-0.2, 0.2), 0, rng.range(-0.2, 0.2)));
    b.add(P.cyl(r * 0.7, r * 0.7, 0.01, 7), { color: 0x3a2a2a }, M.t(x, h - 0.004, z));
  }
  return b.build();
}

/** Soft coral / anemone: waving tentacle tufts. */
function softCoral(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2;
    b.add(P.cone(0.018, 0.16, 4), { color: WHITE, sway: (p) => Math.max(0, p.y) * 5 }, M.t(Math.cos(a) * 0.05, 0.08, Math.sin(a) * 0.05, Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4));
  }
  b.add(P.sphere(0.06, 1), { color: 0xe8ddd4 }, M.t(0, 0.02, 0, 0, 0, 0, 1, 0.5, 1));
  return b.build();
}

/** A clump of seaweed ribbons that wave in the current. */
function seaweed(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(19);
  for (let k = 0; k < 6; k++) {
    const x = rng.range(-0.12, 0.12), z = rng.range(-0.12, 0.12);
    const segs = 4 + Math.floor(rng.next() * 3);
    let px = x, py = 0, pz = z, lean = rng.range(-0.3, 0.3);
    const ry = rng.range(0, Math.PI);
    for (let j = 0; j < segs; j++) {
      const len = 0.1 + rng.next() * 0.04;
      lean += rng.range(-0.25, 0.25);
      b.add(P.box(0.045, len, 0.006), { color: j === segs - 1 ? 0xf0f4e0 : WHITE, sway: (p) => Math.min(1.2, p.y * 2.2) }, M.t(px, py + len / 2, pz, 0, ry, lean));
      px += Math.sin(-lean) * len * Math.cos(ry);
      pz += Math.sin(-lean) * len * -Math.sin(ry);
      py += Math.cos(lean) * len;
    }
  }
  return b.build();
}

const PALETTE: Record<CoralKind, number[]> = {
  rock: [0x756e62, 0x8b8576, 0x667873],
  weed: [0x4f8a3a, 0x6b8f2e, 0x3f7a4a, 0x8a7a2e, 0x7a4a3a],
  branch: [0xff8a5c, 0xff6f91, 0xc07bff, 0xffb347, 0x7fd6c8],
  brain: [0xd9c65a, 0xb8c96a, 0xe0a86a, 0x9ec27a],
  table: [0x6fb8a8, 0xc9a26e, 0x8fbf8a],
  fan: [0xb04ad0, 0xe0457a, 0xff7a4a, 0x8a5ae0],
  tube: [0xff9a3c, 0xffd23f, 0xa45ad6, 0xe85a8a],
  soft: [0xff9ec8, 0xffc2e0, 0xfff09a, 0x9af0e8],
};
const WEIGHTS: [CoralKind, number][] = [['branch', 7], ['brain', 3], ['table', 1], ['fan', 3], ['tube', 3], ['soft', 4]];

export interface ReefPatch {
  x: number;
  z: number;
  r: number;
}

/**
 * Coral reef patches in the shallow turquoise water around the island: branching, brain and table
 * corals, swaying sea fans, tube sponges and soft corals in bright colours, clustered into reefs.
 */
export class Coral {
  readonly group = new THREE.Group();
  readonly patches: ReefPatch[] = [];

  constructor(private world: World) {
    const rng = new RNG(world.seed * 41 + 13);
    const w = world;
    // Reef sites: shallow sea a little way off the beaches, spread out around the island.
    const want = rng.int(28, 36);
    for (let k = 0; k < 9000 && this.patches.length < want; k++) {
      const cx = rng.int(3, w.N - 4), cz = rng.int(3, w.N - 4);
      const x = w.centerX(cx) + rng.range(-0.5, 0.5), z = w.centerZ(cz) + rng.range(-0.5, 0.5);
      const bed = w.heightAt(x, z);
      if (bed > -0.8 || bed < -2.3) continue;
      if (this.patches.some((p) => Math.hypot(p.x - x, p.z - z) < 9)) continue;
      this.patches.push({ x, z, r: rng.range(2.5, 4.5) });
    }
    const geos: Record<CoralKind, THREE.BufferGeometry> = { branch: branchCoral(), brain: brainCoral(), table: tableCoral(), fan: seaFan(), tube: tubeSponge(), soft: softCoral(), weed: seaweed(), rock: angularRockGeometry(913) };
    const items: Record<CoralKind, { m: THREE.Matrix4; c: THREE.Color }[]> = { branch: [], brain: [], table: [], fan: [], tube: [], soft: [], weed: [], rock: [] };
    const tot = WEIGHTS.reduce((s, [, n]) => s + n, 0);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const patch of this.patches) {
      const n = rng.int(50, 85);
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * patch.r;
        const x = patch.x + Math.cos(a) * d, z = patch.z + Math.sin(a) * d;
        const bed = w.heightAt(x, z);
        if (bed > -0.45 || bed < -2.8) continue;
        let r = rng.next() * tot, kind: CoralKind = 'branch';
        for (const [kk, wt] of WEIGHTS) if ((r -= wt) <= 0) {
          kind = kk;
          break;
        }
        // Bigger pieces toward the middle of the reef.
        const s = rng.range(0.6, 1.2) * (1.25 - (d / patch.r) * 0.5) * (kind === 'table' ? 0.75 : kind === 'branch' ? 1.5 : kind === 'fan' ? 1.3 : 1);
        e.set(rng.range(-0.12, 0.12), rng.range(0, Math.PI * 2), rng.range(-0.12, 0.12));
        q.setFromEuler(e);
        const m = new THREE.Matrix4().compose(p.set(x, bed - 0.02, z), q, sc.setScalar(s));
        const pal = PALETTE[kind];
        const c = new THREE.Color(pal[Math.floor(rng.next() * pal.length)]);
        // Vivid under the water tint: push saturation a little.
        const hsl = { h: 0, s: 0, l: 0 };
        c.getHSL(hsl);
        c.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), hsl.l * (0.9 + rng.next() * 0.2));
        items[kind].push({ m, c });
      }
    }
    // Seaweed beds: clumps scattered in drifts across the whole shelf.
    for (let c = 0; c < 6500 && items.weed.length < 1600; c++) {
      const cx = w.centerX(rng.int(3, w.N - 4)), cz = w.centerZ(rng.int(3, w.N - 4));
      const bed0 = w.heightAt(cx, cz);
      if (bed0 > -0.5 || bed0 < -2.6) continue;
      const n = rng.int(9, 20);
      const pal = PALETTE.weed[Math.floor(rng.next() * PALETTE.weed.length)];
      for (let k = 0; k < n && items.weed.length < 1600; k++) {
        const x = cx + rng.range(-2.2, 2.2), z = cz + rng.range(-2.2, 2.2);
        const bed = w.heightAt(x, z);
        if (bed > -0.4 || bed < -2.8) continue;
        e.set(0, rng.range(0, Math.PI * 2), 0);
        q.setFromEuler(e);
        const m = new THREE.Matrix4().compose(p.set(x, bed - 0.02, z), q, sc.setScalar(rng.range(0.8, 1.6) * Math.min(1.4, -bed * 0.8)));
        items.weed.push({ m, c: new THREE.Color(pal).multiplyScalar(0.85 + rng.next() * 0.3) });
      }
    }
    // Low submerged boulder clusters give reefs a rocky base without blocking the surface.
    for (const patch of this.patches) {
      for (let k = 0, n = rng.int(8, 14); k < n; k++) {
        const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * (patch.r + 1);
        const x = patch.x + Math.cos(a) * d, z = patch.z + Math.sin(a) * d;
        const bed = w.heightAt(x, z);
        if (bed > -0.8 || bed < -3.2) continue;
        const size = rng.range(0.35, 0.85);
        q.setFromEuler(e.set(0, rng.range(0, Math.PI * 2), 0));
        const m = new THREE.Matrix4().compose(p.set(x, bed - 0.08, z), q,
          sc.set(size, Math.min(size * 0.55, (-bed - 0.3) * 0.4), size * rng.range(0.7, 1.3)));
        items.rock.push({ m, c: new THREE.Color(PALETTE.rock[rng.int(0, 2)]) });
      }
    }
    const mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 }), 0.2);
    // Split each kind into spatial chunks so reefs off screen are culled (one island-wide mesh
    // per kind would always be drawn).
    const CH = 24;
    const pos = new THREE.Vector3();
    for (const kind of Object.keys(items) as CoralKind[]) {
      const buckets = new Map<string, { m: THREE.Matrix4; c: THREE.Color }[]>();
      for (const it of items[kind]) {
        pos.setFromMatrixPosition(it.m);
        const k = `${Math.floor(pos.x / CH)},${Math.floor(pos.z / CH)}`;
        let b = buckets.get(k);
        if (!b) buckets.set(k, (b = []));
        b.push(it);
      }
      for (const list of buckets.values()) this.addChunk(geos[kind], mat, list);
    }
  }

  private addChunk(geo: THREE.BufferGeometry, mat: THREE.Material, list: { m: THREE.Matrix4; c: THREE.Color }[]): void {
    {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        mesh.setColorAt(i, it.c);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  /** Grid cells covered by reefs (boats steer around them). */
  cells(): number[] {
    const out: number[] = [];
    for (const p of this.patches) {
      for (let dz = -Math.ceil(p.r); dz <= Math.ceil(p.r); dz++) {
        for (let dx = -Math.ceil(p.r); dx <= Math.ceil(p.r); dx++) {
          if (dx * dx + dz * dz > p.r * p.r) continue;
          const i = this.world.cellIndexAt(p.x + dx, p.z + dz);
          if (i >= 0) out.push(i);
        }
      }
    }
    return out;
  }
}
