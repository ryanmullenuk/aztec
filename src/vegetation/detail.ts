import * as THREE from 'three';
import { GeoBuilder, M, P, lumpy, tube } from '../render/GeoBuilder';
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

/**
 * A branch from a trunk point up and out into the canopy, with a side twig. Drawn at mid distance
 * too (a lighter limb without the twig), so crowns show their wood from further away.
 */
export function branch(b: GeoBuilder, from: THREE.Vector3, to: THREE.Vector3, r0: number, rng: RNG, h: number): void {
  const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, rng.range(0.05, 0.25), 0));
  const tw = mid.clone().lerp(to, 0.4);
  const tip = tw.clone().add(new THREE.Vector3(rng.range(-0.4, 0.4), rng.range(0.1, 0.35), rng.range(-0.4, 0.4)));
  b.add(tube([from, mid, to], (t) => r0 * (1 - 0.6 * t), FINE.on ? 5 : 4, FINE.on ? 4 : 2), { color: (p) => barkColor(p, h), sway: (p) => 0.05 + Math.max(0, p.y - from.y) * 0.08 });
  if (!FINE.on) return;
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

export interface FoliageOpts {
  dark: THREE.Color;
  light: THREE.Color;
  /** Colour of the sunlit top leaves. */
  sun: THREE.Color;
  /** Leaf length and half-width at full detail. */
  len: number;
  w: number;
  /** Sway weight at the canopy centre height. */
  sway: number;
  /** Leaf sprays per unit of radius squared. */
  density?: number;
  /** Shaded inner core radius as a fraction of the canopy radius. */
  core?: number;
}

const leafCache = new Map<string, THREE.BufferGeometry>();
function cachedLeaf(len: number, w: number, fold = 0.35): THREE.BufferGeometry {
  const k = `${len.toFixed(3)}|${w.toFixed(3)}|${fold}`;
  let g = leafCache.get(k);
  if (!g) leafCache.set(k, (g = leafGeometry(len, w, fold)));
  return g;
}

const _d = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

/**
 * A living canopy: a small shaded core (the dark interior between the leaves) wrapped in leaf
 * sprays, each a twig carrying a fan of drooping leaves, so the crown reads as foliage with gaps,
 * ragged edges and sunlit tops instead of a smooth ball. All levels share one spray layout (every
 * random number is always drawn), so changing level only adds or removes detail:
 *   far  (lo)        - every third spray, with three big leaves, over the core
 *   mid  (FINE off)  - every spray with four leaves
 *   near (FINE on)   - seven leaves per spray plus the twig inside each spray
 */
export function foliage(b: GeoBuilder, cx: number, cy: number, cz: number, R: number, squash: number, seed: number, lo: boolean, o: FoliageOpts): void {
  const rng = new RNG(seed * 7 + 3);
  const core = o.core ?? 0.7;
  const shade = o.dark.clone().multiplyScalar(0.72);
  b.add(lumpy(P.sphere(R * core, lo ? 0 : 1), 0.2, seed, squash), {
    color: (p, nn) => mix(shade, o.dark, nn.y * 0.4 + 0.35 + (p.y - cy) / (R * 3) + (vnoise3(p.x * 3, p.y * 3, p.z * 3) - 0.5) * 0.4),
    leaf: 1,
    sway: o.sway,
    ao: { y0: cy - R, y1: cy + R * 0.5, min: 0.55 },
  }, M.t(cx, cy, cz));
  const fine = FINE.on && !lo;
  const full = Math.max(7, Math.round(R * R * (o.density ?? 19)));
  // Far away: every third spray, with bigger leaves to cover the same crown.
  const step = lo ? 3 : 1;
  const sz = lo ? 1.8 : fine ? 1 : 1.2;
  for (let k = 0; k < full; k++) {
    // Evenly spread over the crown (golden-angle spiral) with jitter.
    const cph = THREE.MathUtils.clamp(0.95 - 1.85 * ((k + 0.5) / full) + rng.range(-0.08, 0.08), -0.92, 0.98);
    const th = k * 2.39996 + rng.range(-0.4, 0.4);
    const sph = Math.sqrt(1 - cph * cph);
    _d.set(Math.cos(th) * sph, cph, Math.sin(th) * sph);
    const reach = rng.range(0.8, 1.02);
    const sc = new THREE.Vector3(cx + _d.x * R * reach, cy + _d.y * R * squash * reach, cz + _d.z * R * reach);
    const up = _d.y * 0.5 + 0.5;
    const tone = mix(o.dark, o.light, rng.range(0.25, 0.95) * (0.55 + up * 0.6));
    const sprayRoll = rng.range(0, Math.PI * 2);
    const droop = rng.range(0.25, 0.6);
    const tw = rng.range(0.3, 0.5);
    const sway = o.sway + Math.max(0, sc.y - cy + R) * 0.1;
    const show = k % step === 0;
    // Tangent frame around the spray direction.
    _t1.set(-_d.z, 0, _d.x);
    if (_t1.lengthSq() < 1e-4) _t1.set(1, 0, 0);
    _t1.normalize();
    _t2.crossVectors(_d, _t1).normalize();
    for (let j = 0; j < 7; j++) {
      const a = sprayRoll + (j / 7) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const spread = rng.range(0.55, 1.0);
      const ls = rng.range(0.8, 1.2) * sz;
      const bright = rng.range(0.85, 1.12);
      const twist = rng.range(0, Math.PI * 2);
      const pick = lo ? j === 0 || j === 2 || j === 5 : fine || j % 2 === 0;
      if (!show || !pick) continue;
      _a.copy(_d).multiplyScalar(0.55).addScaledVector(_t1, Math.cos(a) * spread).addScaledVector(_t2, Math.sin(a) * spread);
      _a.y -= droop;
      _a.normalize();
      _q.setFromUnitVectors(_z, _a);
      _q2.setFromAxisAngle(_a, twist);
      _p.copy(sc).addScaledVector(_d, -0.04 * R);
      let col = mix(tone, o.sun, Math.max(0, up - 0.55) * 1.6 + Math.max(0, _a.y) * 0.3);
      if (_d.y < -0.2) col = mix(col, shade, 0.35);
      col = col.multiplyScalar(bright);
      b.add(cachedLeaf(o.len * ls, o.w * ls), { color: col, leaf: 1, sway }, new THREE.Matrix4().compose(_p, _q2.multiply(_q), _one));
    }
    if (fine) {
      // The twig carrying the spray, running back into the crown.
      const from = sc.clone().addScaledVector(_d, -R * tw);
      from.y -= R * 0.08;
      const mid = from.clone().lerp(sc, 0.5);
      mid.y += 0.03;
      const h = cy + R;
      b.add(tube([from, mid, sc], (t) => 0.018 * (1 - 0.6 * t) * Math.min(1.4, R + 0.3), 3, 2), { color: (p) => barkColor(p, h), sway: sway * 0.8 });
    }
  }
}

/**
 * A vine hanging from `top` with leaves along it. Mid distance draws the (slightly thicker) cord
 * only; the random numbers are drawn either way so both levels share one shape.
 */
export function hangingVine(b: GeoBuilder, top: THREE.Vector3, len: number, rng: RNG, col: THREE.Color, leafCol: THREE.Color): void {
  const pts: THREE.Vector3[] = [];
  const wob = rng.range(0, Math.PI * 2);
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push(new THREE.Vector3(top.x + Math.sin(t * 5 + wob) * 0.07 * t, top.y - len * t, top.z + Math.cos(t * 4 + wob) * 0.07 * t));
  }
  b.add(tube(pts, (t) => (FINE.on ? 0.016 : 0.022) * (1 - 0.4 * t), 3, FINE.on ? 6 : 3), { color: col, sway: (p) => 0.3 + (top.y - p.y) * 0.5 });
  const nl = Math.max(3, Math.round(len * 7));
  for (let k = 0; k < nl; k++) {
    const t = (k + 0.5) / nl;
    const a = rng.range(0, Math.PI * 2);
    const tint = rng.next();
    const s = rng.range(0.8, 1.3);
    if (!FINE.on) continue;
    const p = new THREE.Vector3(pts[0].x + Math.sin(t * 5 + wob) * 0.07 * t, top.y - len * t, pts[0].z + Math.cos(t * 4 + wob) * 0.07 * t);
    _a.set(Math.cos(a), -0.5, Math.sin(a)).normalize();
    _q.setFromUnitVectors(_z, _a);
    b.add(leafGeometry(0.11 * s, 0.05 * s), { color: mix(leafCol, col, tint * 0.4), leaf: 1, sway: 0.3 + len * t * 0.5 }, new THREE.Matrix4().compose(p, _q, new THREE.Vector3(1, 1, 1)));
  }
  // A curled tip.
  if (FINE.on) b.add(leafGeometry(0.14, 0.07), { color: leafCol, leaf: 1, sway: 0.3 + len * 0.5 }, new THREE.Matrix4().compose(pts[5], _q.setFromUnitVectors(_z, _a.set(0.2, -1, 0.1).normalize()), new THREE.Vector3(1, 1, 1)));
}

/** A liana slung between two points (branch to branch), sagging in the middle, leafy up close. */
export function liana(b: GeoBuilder, from: THREE.Vector3, to: THREE.Vector3, sag: number, rng: RNG, col: THREE.Color, leafCol: THREE.Color): void {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const p = from.clone().lerp(to, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  const top = Math.max(from.y, to.y);
  b.add(tube(pts, () => (FINE.on ? 0.018 : 0.024), 3, FINE.on ? 8 : 4), { color: col, sway: (p) => 0.2 + (top - p.y) * 0.4 });
  for (let k = 1; k < 9; k++) {
    const t = k / 9;
    const a = rng.range(0, Math.PI * 2);
    const tint = rng.next();
    if (!FINE.on) continue;
    const p = from.clone().lerp(to, t);
    p.y -= sag * 4 * t * (1 - t);
    _a.set(Math.cos(a), -0.7, Math.sin(a)).normalize();
    _q.setFromUnitVectors(_z, _a);
    b.add(leafGeometry(0.1, 0.05), { color: mix(leafCol, col, tint * 0.4), leaf: 1, sway: 0.2 + (top - p.y) * 0.4 }, new THREE.Matrix4().compose(p, _q, new THREE.Vector3(1, 1, 1)));
  }
}

/** A vine spiralling up a trunk, with small leaves (cord only at mid distance). */
export function trunkVine(b: GeoBuilder, h: number, r: number, rng: RNG, col: THREE.Color, leafCol: THREE.Color): void {
  const pts: THREE.Vector3[] = [];
  const a0 = rng.range(0, Math.PI * 2);
  const turns = rng.range(1.1, 1.8);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const a = a0 + t * turns * Math.PI * 2;
    const rr = r * (1 + 0.5 * Math.pow(1 - t, 6)) * (1 - 0.35 * t) + 0.02;
    pts.push(new THREE.Vector3(Math.cos(a) * rr, 0.05 + t * h, Math.sin(a) * rr));
  }
  b.add(tube(pts, () => (FINE.on ? 0.02 : 0.026), 3, FINE.on ? 18 : 9), { color: col, sway: (p) => (p.y / h) * 0.06 });
  for (let k = 1; k < 10; k++) {
    const tint = rng.next();
    if (!FINE.on) continue;
    for (let s = 0; s < 2; s++) {
      const p = pts[k].clone().lerp(pts[k + 1], s * 0.5);
      _a.set(p.x, 0.25 - s * 0.4, p.z).normalize();
      _q.setFromUnitVectors(_z, _a);
      b.add(leafGeometry(0.12, 0.055), { color: mix(leafCol, col, tint * 0.5), leaf: 1, sway: (p.y / h) * 0.08 }, new THREE.Matrix4().compose(p, _q, new THREE.Vector3(1, 1, 1)));
    }
  }
}
