import * as THREE from 'three';
import { GeoBuilder, tube } from '../render/GeoBuilder';
import { RNG } from '../world/rng';

/**
 * Close-up detail for trees and bushes: flared bark trunks with buttress roots, branches reaching
 * into the canopy, individual folded leaves breaking up the canopy silhouette, and vines.
 * Everything is closed geometry, so it works with the single-sided tree material.
 */

/** Fine detail switch: off while building the mid-distance level of detail (roots, branches, leaves and vines left out). */
export const FINE = { on: true };

const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, THREE.MathUtils.clamp(t, 0, 1));
/** Smooth-ish positional hash 0..1 (same value for coincident vertices). */
export const phash = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
};
/** Low-frequency value noise in 3D for mottled colour blending. */
export function vnoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => phash(ix + a, iy + b, iz + c);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v),
    l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v),
    w
  );
}

export const BARK = {
  dark: new THREE.Color(0x4a3220),
  mid: new THREE.Color(0x6b4a2e),
  light: new THREE.Color(0x8e6a46),
  moss: new THREE.Color(0x5e7a2c),
  root: new THREE.Color(0x5a3e28),
};

/** Bark: vertical ridges and furrows, lighter toward the top, moss creeping up the base. */
export function barkColor(p: THREE.Vector3, h: number, base = BARK.mid): THREE.Color {
  const ang = Math.atan2(p.z, p.x);
  const ridge = Math.sin(ang * 9 + p.y * 1.7 + Math.sin(p.y * 3.1) * 0.8) * 0.5 + 0.5;
  let c = mix(BARK.dark, base, 0.35 + ridge * 0.65);
  c = mix(c, BARK.light, Math.max(0, p.y / Math.max(h, 0.1) - 0.4) * 0.5 * ridge);
  const moss = (1 - THREE.MathUtils.smoothstep(p.y, 0.1, 0.9)) * THREE.MathUtils.smoothstep(vnoise3(p.x * 6, p.y * 4, p.z * 6), 0.45, 0.7);
  return mix(c, BARK.moss, moss * 0.8);
}

/** Tapered, gently curving trunk with a flared base. Returns the top point. */
export function barkTrunk(b: GeoBuilder, h: number, r0: number, r1: number, lo: boolean, rng: RNG, lean = 0.12): THREE.Vector3 {
  const dx = rng.range(-lean, lean), dz = rng.range(-lean, lean);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push(new THREE.Vector3(dx * t * t * h + Math.sin(t * 3 + dz * 9) * 0.03, t * h, dz * t * t * h + Math.cos(t * 2.4 + dx * 9) * 0.03));
  }
  b.add(tube(pts, (t) => (r0 + (r1 - r0) * t) * (1 + 0.55 * Math.pow(1 - t, 6)), lo ? 5 : 8, lo ? 3 : 8), {
    color: (p) => barkColor(p, h),
    sway: (p) => (p.y / h) * 0.06,
    ao: { y0: 0, y1: h * 0.5, min: 0.62 },
  });
  return pts[4].clone();
}

/** Buttress / surface roots spreading from the trunk base and diving into the ground. */
export function roots(b: GeoBuilder, n: number, r0: number, spread: number, rng: RNG): void {
  if (!FINE.on) return;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const ca = Math.cos(a), sa = Math.sin(a);
    const s = spread * rng.range(0.75, 1.2);
    const pts = [
      new THREE.Vector3(ca * r0 * 0.5, r0 * rng.range(1.4, 2.2), sa * r0 * 0.5),
      new THREE.Vector3(ca * r0 * 1.05, r0 * 0.55, sa * r0 * 1.05),
      new THREE.Vector3(ca * s * 0.6, 0.04, sa * s * 0.6),
      new THREE.Vector3(ca * s + rng.range(-0.1, 0.1), -0.06, sa * s + rng.range(-0.1, 0.1)),
    ];
    b.add(tube(pts, (t) => r0 * (0.42 - 0.36 * t), 5, 5), {
      color: (p) => mix(BARK.root, BARK.dark, THREE.MathUtils.clamp(0.4 - p.y * 2, 0, 1)),
      ao: { y0: -0.05, y1: 0.35, min: 0.55 },
    });
  }
}

/** A branch from a trunk point up and out into the canopy, with a side twig. */
export function branch(b: GeoBuilder, from: THREE.Vector3, to: THREE.Vector3, r0: number, rng: RNG, h: number): void {
  if (!FINE.on) return;
  const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, rng.range(0.05, 0.25), 0));
  b.add(tube([from, mid, to], (t) => r0 * (1 - 0.6 * t), 5, 4), { color: (p) => barkColor(p, h), sway: (p) => 0.05 + Math.max(0, p.y - from.y) * 0.08 });
  const tw = mid.clone().lerp(to, 0.4);
  const tip = tw.clone().add(new THREE.Vector3(rng.range(-0.4, 0.4), rng.range(0.1, 0.35), rng.range(-0.4, 0.4)));
  b.add(tube([tw, tw.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.05, 0)), tip], (t) => r0 * 0.35 * (1 - 0.7 * t), 4, 2), { color: BARK.mid, sway: 0.2 });
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);
const _a = new THREE.Vector3();

/**
 * One low-poly leaf: a diamond folded along its midrib, closed underneath (4 triangles), lying
 * along `axis` from `base`. Visible from both sides with a single-sided material.
 */
export function leafGeometry(len: number, w: number, fold = 0.35): THREE.BufferGeometry {
  const tip = [0, 0, len], base = [0, 0, 0];
  const l = [-w, w * fold, len * 0.42], r = [w, w * fold, len * 0.42];
  const lb = [-w * 0.9, w * fold - 0.006, len * 0.42], rb = [w * 0.9, w * fold - 0.006, len * 0.42];
  const tris = [base, l, tip, base, tip, r, base, tip, lb, base, rb, tip];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

export interface LeafOpts {
  /** Leaf colours to pick from (blended per leaf). */
  cols: THREE.Color[];
  /** Colour on sunlit top leaves. */
  sun: THREE.Color;
  len: number;
  w: number;
  /** Sway weight at the canopy centre height. */
  sway: number;
  /** 0..1: favour the lower half of the clump (where the blob edge shows). */
  lowBias?: number;
}

/** Leaves scattered over a canopy blob's surface, pointing outward and drooping at the edges. */
export function leafClump(b: GeoBuilder, cx: number, cy: number, cz: number, R: number, squash: number, n: number, rng: RNG, o: LeafOpts): void {
  if (!FINE.on) return;
  for (let k = 0; k < n; k++) {
    // Mostly around the sides and underside, where the blob outline is seen.
    const th = rng.range(0, Math.PI * 2);
    const cph = rng.range(-0.85, 0.7 - (o.lowBias ?? 0) * 0.5);
    const sph = Math.sqrt(1 - cph * cph);
    const d = new THREE.Vector3(Math.cos(th) * sph, cph, Math.sin(th) * sph);
    const base = new THREE.Vector3(cx + d.x * R * 0.97, cy + d.y * R * squash * 0.97, cz + d.z * R * 0.97);
    _a.copy(d).add(new THREE.Vector3(rng.range(-0.35, 0.35), -0.35 - rng.next() * 0.35, rng.range(-0.35, 0.35))).normalize();
    _q.setFromUnitVectors(_z, _a);
    _q2.setFromAxisAngle(_a, rng.range(0, Math.PI * 2));
    const s = rng.range(0.75, 1.25);
    const m = new THREE.Matrix4().compose(base, _q2.multiply(_q), new THREE.Vector3(s, s, s));
    const up = d.y * 0.5 + 0.5;
    const col = mix(mix(rng.pick(o.cols), rng.pick(o.cols), rng.next()), o.sun, Math.max(0, up - 0.5) * 1.5 + (rng.chance(0.25) ? 0.3 : 0)).multiplyScalar(rng.range(0.82, 1.12));
    b.add(leafGeometry(o.len, o.w), { color: col, leaf: 1, sway: o.sway + Math.max(0, base.y - cy + R) * 0.1 }, m);
  }
}

/** A vine hanging from `top` with leaves along it. */
export function hangingVine(b: GeoBuilder, top: THREE.Vector3, len: number, rng: RNG, col: THREE.Color, leafCol: THREE.Color): void {
  if (!FINE.on) return;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push(new THREE.Vector3(top.x + Math.sin(t * 5 + top.x) * 0.06, top.y - len * t, top.z + Math.cos(t * 4 + top.z) * 0.06));
  }
  b.add(tube(pts, () => 0.014, 3, 5), { color: col, sway: (p) => 0.3 + (top.y - p.y) * 0.5 });
  const nl = Math.max(2, Math.round(len * 5));
  for (let k = 0; k < nl; k++) {
    const t = (k + 0.5) / nl;
    const p = new THREE.Vector3(pts[0].x, top.y - len * t, pts[0].z);
    const a = rng.range(0, Math.PI * 2);
    _a.set(Math.cos(a), -0.6, Math.sin(a)).normalize();
    _q.setFromUnitVectors(_z, _a);
    b.add(leafGeometry(0.1, 0.045), { color: mix(leafCol, col, rng.next() * 0.4), leaf: 1, sway: 0.3 + len * t * 0.5 }, new THREE.Matrix4().compose(p, _q, new THREE.Vector3(1, 1, 1)));
  }
}

/** A vine spiralling up a trunk, with small leaves. */
export function trunkVine(b: GeoBuilder, h: number, r: number, rng: RNG, col: THREE.Color, leafCol: THREE.Color): void {
  if (!FINE.on) return;
  const pts: THREE.Vector3[] = [];
  const a0 = rng.range(0, Math.PI * 2);
  const turns = rng.range(1.1, 1.8);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const a = a0 + t * turns * Math.PI * 2;
    const rr = r * (1 + 0.5 * Math.pow(1 - t, 6)) * (1 - 0.35 * t) + 0.02;
    pts.push(new THREE.Vector3(Math.cos(a) * rr, 0.05 + t * h, Math.sin(a) * rr));
  }
  b.add(tube(pts, () => 0.018, 3, 18), { color: col, sway: (p) => (p.y / h) * 0.06 });
  for (let k = 1; k < 10; k++) {
    const p = pts[k];
    _a.set(p.x, 0.2, p.z).normalize();
    _q.setFromUnitVectors(_z, _a);
    b.add(leafGeometry(0.11, 0.05), { color: mix(leafCol, col, rng.next() * 0.5), leaf: 1, sway: (p.y / h) * 0.08 }, new THREE.Matrix4().compose(p, _q, new THREE.Vector3(1, 1, 1)));
  }
}
