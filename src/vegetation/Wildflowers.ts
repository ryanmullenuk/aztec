import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, M, tube } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { Simplex2 } from '../world/noise';
import { World } from '../world/World';
import { leafGeometry } from './detail';
import { fernGeometry } from './models';

/** Tuning for the wildflowers. */
export const WILDFLOWERS = {
  /** Chance per suitable cell of a cluster starting there (scaled by the flower noise). */
  clusterChance: 0.13,
  /** Chance per suitable cell of a lone flower. */
  singleChance: 0.07,
  /** Plants per cluster. */
  clusterSize: [2, 7] as [number, number],
  /** Hide a chunk beyond this distance from the camera. */
  drawDistance: 70,
};

type Kind = 'orchid' | 'red' | 'yellow' | 'orange' | 'purple' | 'pink' | 'fern' | 'tropical';
const KINDS: { k: Kind; w: number }[] = [
  { k: 'orchid', w: 1.2 }, { k: 'red', w: 1.3 }, { k: 'yellow', w: 1.3 }, { k: 'orange', w: 1.0 },
  { k: 'purple', w: 0.9 }, { k: 'pink', w: 0.8 }, { k: 'fern', w: 1.6 }, { k: 'tropical', w: 1.2 },
];
const PETAL: Record<string, [number, number]> = {
  orchid: [0xd8233a, 0xf05a78], red: [0xc9272b, 0xe8483e], yellow: [0xf2c21c, 0xffe05a],
  orange: [0xe8701a, 0xffa13d], purple: [0x8e44c9, 0xb877e6], pink: [0xe0629e, 0xf59ac4],
};
const LEAF = new THREE.Color(0x3f7a31), LEAF_LIGHT = new THREE.Color(0x6aa33f), STEM = new THREE.Color(0x4a7a2c);

/** A flower head: petals radiating round a small centre, facing up and a little outward. */
function flowerHead(b: GeoBuilder, at: THREE.Vector3, size: number, c0: THREE.Color, c1: THREE.Color, rng: RNG, petals = 5, cup = 0.5): void {
  const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), ax = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  const tilt = rng.range(0, Math.PI * 2);
  for (let k = 0; k < petals; k++) {
    const a = tilt + (k / petals) * Math.PI * 2;
    ax.set(Math.cos(a), cup, Math.sin(a)).normalize();
    q.setFromUnitVectors(z, ax);
    q2.setFromAxisAngle(ax, rng.range(-0.3, 0.3));
    const col = c0.clone().lerp(c1, rng.next());
    b.add(leafGeometry(size, size * 0.5, 0.2), { color: col, leaf: 1, sway: 0.6 }, new THREE.Matrix4().compose(at, q2.multiply(q), new THREE.Vector3(1, 1, 1)));
  }
  b.add(new THREE.OctahedronGeometry(size * 0.28, 0), { color: 0xf6d34a, sway: 0.6 }, M.t(at.x, at.y + size * 0.1, at.z));
}

/** A low rosette of leaves round the base. */
function rosette(b: GeoBuilder, n: number, len: number, rng: RNG, up = 0.35): void {
  const q = new THREE.Quaternion(), ax = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    ax.set(Math.cos(a), up + rng.range(-0.1, 0.15), Math.sin(a)).normalize();
    q.setFromUnitVectors(z, ax);
    const l = len * rng.range(0.8, 1.2);
    b.add(leafGeometry(l, l * 0.32, 0.35), { color: LEAF.clone().lerp(LEAF_LIGHT, rng.next() * 0.7), leaf: 1, sway: 0.3 }, new THREE.Matrix4().compose(new THREE.Vector3(0, 0.01, 0), q, new THREE.Vector3(1, 1, 1)));
  }
}

function plantGeometry(kind: Kind, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  if (kind === 'fern') {
    const g = fernGeometry(false, seed).clone();
    g.scale(0.55, 0.55, 0.55);
    return g;
  }
  const b = new GeoBuilder();
  if (kind === 'tropical') {
    // Small broad-leaved plant: big glossy arching leaves on short stalks.
    const q = new THREE.Quaternion(), ax = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
    const n = rng.int(5, 7);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      ax.set(Math.cos(a), rng.range(0.5, 0.9), Math.sin(a)).normalize();
      q.setFromUnitVectors(z, ax);
      const l = rng.range(0.16, 0.24);
      b.add(leafGeometry(l, l * 0.48, 0.3), { color: LEAF.clone().lerp(LEAF_LIGHT, rng.next()), leaf: 1, sway: 0.45 }, new THREE.Matrix4().compose(new THREE.Vector3(0, 0.02, 0), q, new THREE.Vector3(1, 1, 1)));
    }
    return b.build();
  }
  const [h0, h1] = PETAL[kind];
  const c0 = new THREE.Color(h0), c1 = new THREE.Color(h1);
  if (kind === 'orchid') {
    // Red orchid: two broad leaves and an arching spray of blooms.
    rosette(b, 3, 0.13, rng, 0.2);
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.02, 0.12, 0.01), new THREE.Vector3(0.07, 0.2, 0.03), new THREE.Vector3(0.13, 0.22, 0.05)];
    b.add(tube(pts, () => 0.005, 3, 3), { color: STEM, sway: (p) => p.y * 2.5 });
    const curve = new THREE.CatmullRomCurve3(pts);
    for (let k = 0; k < 4; k++) flowerHead(b, curve.getPoint(0.45 + k * 0.17), 0.035, c0, c1, rng, 5, 0.1);
    return b.build();
  }
  // Plain flower clump: leaves and two to four blooms on stems.
  rosette(b, rng.int(4, 6), 0.1, rng);
  const n = rng.int(2, 3);
  for (let k = 0; k < n; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0, 0.05);
    const top = new THREE.Vector3(Math.cos(a) * r * 2, rng.range(0.1, 0.18), Math.sin(a) * r * 2);
    b.add(tube([new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), top.clone().multiply(new THREE.Vector3(0.7, 0.55, 0.7)), top], () => 0.005, 3, 2), { color: STEM, sway: (p) => p.y * 2.5 });
    flowerHead(b, top, rng.range(0.035, 0.05), c0, c1, rng, kind === 'purple' ? 6 : 5);
  }
  return b.build();
}

interface Bloom {
  kind: number;
  x: number;
  z: number;
  cell: number;
  rot: number;
  s: number;
}

interface Chunk {
  list: Bloom[];
  mesh: THREE.Mesh | null;
  /** Visibility key of the blooms in the current mesh (rebuilt when it changes). */
  key: string;
  cx: number;
  cz: number;
}

/**
 * Wildflowers and small plants scattered over the island: red orchids, red, yellow, orange,
 * purple and pink flowers, little ferns and broad-leaved plants, mostly in small clumps of one kind
 * with the odd one alone, placed by a patchy noise field so they bunch irregularly. Decoration only
 * (not saved, nothing harvests them). Clearings, beaches, cliffs, water and the village plain stay
 * open, and flowers under buildings, fields and paths drop out. Each map chunk is one merged mesh,
 * hidden when far away, so this costs a handful of draw calls.
 */
export class Wildflowers {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private variants: THREE.BufferGeometry[][] = [];
  private timer = 0;
  private C = 8;

  constructor(private world: World, density: number) {
    const w = world, N = w.N;
    const rng = new RNG(w.seed * 571 + 43);
    const noise = new Simplex2(rng);
    // Two shape variants of each kind.
    for (let k = 0; k < KINDS.length; k++) this.variants.push([plantGeometry(KINDS[k].k, 900 + k * 7), plantGeometry(KINDS[k].k, 901 + k * 7)]);
    for (let i = 0; i < this.C * this.C; i++) this.chunks.push({ list: [], mesh: null, key: '', cx: i % this.C, cz: Math.floor(i / this.C) });
    const tot = KINDS.reduce((s, k) => s + k.w, 0);
    const pickKind = () => {
      let r = rng.next() * tot;
      for (let k = 0; k < KINDS.length; k++) if ((r -= KINDS[k].w) <= 0) return k;
      return 0;
    };
    const ok = (x: number, z: number) => {
      const i = w.cellIndexAt(x, z);
      if (i < 0 || !w.isLandCell(i) || w.sandy[i] > 0.4 || w.rocky[i] > 0.4 || w.swamp[i] > 0.3 || w.blocked(i)) return -1;
      if (Math.hypot(x - w.meadow.x, z - w.meadow.z) < w.meadow.r - 2) return -1;
      const y = w.heightAt(x, z);
      if (Math.abs(w.heightAt(x + 0.2, z) - y) > 0.06 || Math.abs(w.heightAt(x, z + 0.2) - y) > 0.06) return -1;
      return i;
    };
    const add = (kind: number, x: number, z: number, s: number) => {
      const i = ok(x, z);
      if (i < 0) return;
      const cx = Math.min(this.C - 1, Math.floor(((x + w.half) / N) * this.C)), cz = Math.min(this.C - 1, Math.floor(((z + w.half) / N) * this.C));
      this.chunks[cz * this.C + cx].list.push({ kind: kind * 2 + (rng.chance(0.5) ? 1 : 0), x, z, cell: i, rot: rng.range(0, 6.28), s });
    };
    for (let cz = 1; cz < N - 1; cz++) {
      for (let cx = 1; cx < N - 1; cx++) {
        const x0 = w.centerX(cx), z0 = w.centerZ(cz);
        if (ok(x0, z0) < 0) continue;
        // Patchy: flowers gather where the noise is high, especially at woodland edges.
        const i = cz * N + cx;
        const patch = noise.noise(cx * 0.07, cz * 0.07) * 0.5 + 0.5;
        const edge = 1 - Math.abs(w.forest[i] - 0.45) * 1.4;
        const want = WILDFLOWERS.clusterChance * density * Math.max(0, patch * 1.6 - 0.35) * (0.5 + Math.max(0, edge));
        if (rng.chance(want)) {
          // A clump: mostly one kind, sometimes a second mixed in.
          const k1 = pickKind(), k2 = rng.chance(0.25) ? pickKind() : k1;
          const n = rng.int(WILDFLOWERS.clusterSize[0], WILDFLOWERS.clusterSize[1]);
          const r0 = rng.range(0.35, 1.1);
          for (let k = 0; k < n; k++) {
            const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * r0;
            add(rng.chance(0.8) ? k1 : k2, x0 + Math.cos(a) * d, z0 + Math.sin(a) * d, rng.range(0.75, 1.25));
          }
        } else if (rng.chance(WILDFLOWERS.singleChance * density * (0.4 + patch))) {
          add(pickKind(), x0 + rng.range(-0.45, 0.45), z0 + rng.range(-0.45, 0.45), rng.range(0.7, 1.15));
        }
      }
    }
    this.refresh();
  }

  get count(): number {
    return this.chunks.reduce((s, c) => s + c.list.length, 0);
  }

  /** Every flowering plant (not the ferns and leafy plants): where it is and how high its blooms stand. */
  blooms(): { x: number; z: number; top: number }[] {
    const out: { x: number; z: number; top: number }[] = [];
    const fern = KINDS.findIndex((k) => k.k === 'fern'), tropical = KINDS.findIndex((k) => k.k === 'tropical');
    for (const c of this.chunks) {
      for (const b of c.list) {
        const k = b.kind >> 1;
        if (k === fern || k === tropical) continue;
        out.push({ x: b.x, z: b.z, top: 0.16 * b.s });
      }
    }
    return out;
  }

  /** Rebuild the chunks whose visible flowers changed (buildings, fields, paths, sculpting). */
  refresh(): void {
    const w = this.world;
    // Not the tree material: small plants never dither see-through like trees near the camera.
    const mat = stylisedMaterial();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const c of this.chunks) {
      if (!c.list.length) continue;
      let key = '';
      const show: Bloom[] = [];
      for (const b of c.list) {
        const i = b.cell;
        const vis = w.occ[i] === 0 && !w.path[i] && w.wear[i] <= 0.3 && w.soil[i] <= 0.05 && w.isLandCell(i) && !w.blocked(i);
        key += vis ? '1' : '0';
        if (vis) show.push(b);
      }
      if (key === c.key) continue;
      c.key = key;
      if (c.mesh) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.mesh = null;
      }
      if (!show.length) continue;
      const parts = show.map((b) => {
        const g = this.variants[b.kind >> 1][b.kind & 1].clone();
        q.setFromAxisAngle(up, b.rot);
        g.applyMatrix4(m.compose(p.set(b.x, w.heightAt(b.x, b.z) - 0.01, b.z), q, s.setScalar(b.s)));
        return g;
      });
      const geo = mergeGeometries(parts)!;
      for (const g of parts) g.dispose();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      c.mesh = mesh;
      this.group.add(mesh);
    }
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 3;
      this.refresh();
    }
    // Far chunks drop out (small plants are invisible from high up anyway).
    const d2 = WILDFLOWERS.drawDistance * WILDFLOWERS.drawDistance;
    for (const c of this.chunks) {
      if (!c.mesh) continue;
      const bs = c.mesh.geometry.boundingSphere!;
      c.mesh.visible = View.dist2(bs.center.x, bs.center.y, bs.center.z) < d2 + bs.radius * bs.radius * 2;
    }
  }
}
