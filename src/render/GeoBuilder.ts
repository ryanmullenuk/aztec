import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type ColorFn = (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color;

export interface AddOptions {
  color: number | THREE.Color | ColorFn;
  /** Wind sway weight: constant or function of local position (0 = rigid). */
  sway?: number | ((p: THREE.Vector3) => number);
  /** 1 for foliage: enables sunlight glowing through (translucency) and rim light. */
  leaf?: number;
  /** Multiply final vertex colour by a vertical ambient-occlusion ramp (darker low down). */
  ao?: { y0: number; y1: number; min: number };
  /** Material tag for character shading: 0 fixed colour, 1 skin (per-instance tone), 2 accent cloth (per-instance colour). */
  mat?: number;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _m3 = new THREE.Matrix3();

/**
 * Merges many small primitives into a single indexed geometry with per-vertex colour
 * and an `aVeg` attribute (x = sway weight, y = leaf flag). One draw call per model.
 */
export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private veg: number[] = [];
  private mat: number[] = [];
  private idx: number[] = [];

  add(src: THREE.BufferGeometry, opts: AddOptions, matrix?: THREE.Matrix4): this {
    const g = src.index ? src : src.clone();
    if (!g.index) {
      const n = g.getAttribute('position').count;
      const ii: number[] = [];
      for (let i = 0; i < n; i++) ii.push(i);
      g.setIndex(ii);
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const base = this.pos.length / 3;
    if (matrix) _m3.getNormalMatrix(matrix);
    const fixed = typeof opts.color === 'function' ? null : new THREE.Color(opts.color as number | THREE.Color);
    for (let i = 0; i < P.count; i++) {
      _p.set(P.getX(i), P.getY(i), P.getZ(i));
      _n.set(N.getX(i), N.getY(i), N.getZ(i));
      if (matrix) {
        _p.applyMatrix4(matrix);
        _n.applyMatrix3(_m3).normalize();
      }
      this.pos.push(_p.x, _p.y, _p.z);
      this.nor.push(_n.x, _n.y, _n.z);
      if (fixed) _c.copy(fixed);
      else _c.copy((opts.color as ColorFn)(_p, _n));
      if (opts.ao) {
        const t = THREE.MathUtils.clamp((_p.y - opts.ao.y0) / (opts.ao.y1 - opts.ao.y0), 0, 1);
        _c.multiplyScalar(opts.ao.min + (1 - opts.ao.min) * t);
      }
      this.col.push(_c.r, _c.g, _c.b);
      const sw = typeof opts.sway === 'function' ? opts.sway(_p) : opts.sway ?? 0;
      this.veg.push(sw, opts.leaf ?? 0);
      this.mat.push(opts.mat ?? 0);
    }
    const I = g.index!;
    for (let i = 0; i < I.count; i++) this.idx.push(base + I.getX(i));
    return this;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aVeg', new THREE.Float32BufferAttribute(this.veg, 2));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------- Primitive helpers (all return fresh geometries) ----------

export const M = {
  /** Compose a transform: translate, Euler rotate (radians), scale. */
  t(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    return m;
  },
};

export const P = {
  box: (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d),
  rbox: (w: number, h: number, d: number, r = 0.05, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2 - 0.001)),
  sphere: (r: number, detail = 1) => new THREE.IcosahedronGeometry(r, detail),
  uvSphere: (r: number, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs),
  cyl: (rt: number, rb: number, h: number, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open),
  cone: (r: number, h: number, seg = 10) => new THREE.ConeGeometry(r, h, seg),
  torus: (r: number, tube: number, rs = 6, ts = 16) => new THREE.TorusGeometry(r, tube, rs, ts),
  plane: (w: number, h: number) => new THREE.PlaneGeometry(w, h),
};

/** Randomly displace an icosphere's vertices (keeps shared vertices together) for organic blobs. */
export function lumpy(g: THREE.BufferGeometry, amount: number, seed: number, squashY = 1): THREE.BufferGeometry {
  const P2 = g.getAttribute('position');
  const cache = new Map<string, [number, number, number]>();
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < P2.count; i++) {
    const key = `${P2.getX(i).toFixed(3)},${P2.getY(i).toFixed(3)},${P2.getZ(i).toFixed(3)}`;
    let d = cache.get(key);
    if (!d) {
      const k = 1 + (rnd() - 0.5) * 2 * amount;
      d = [P2.getX(i) * k, P2.getY(i) * k * squashY, P2.getZ(i) * k];
      cache.set(key, d);
    }
    P2.setXYZ(i, d[0], d[1], d[2]);
  }
  g.computeVertexNormals();
  // Icosahedron is non-indexed: average normals of coincident vertices for smooth shading.
  const Nn = g.getAttribute('normal');
  const acc = new Map<string, THREE.Vector3>();
  for (let i = 0; i < P2.count; i++) {
    const key = `${P2.getX(i).toFixed(3)},${P2.getY(i).toFixed(3)},${P2.getZ(i).toFixed(3)}`;
    const v = acc.get(key) ?? new THREE.Vector3();
    v.x += Nn.getX(i);
    v.y += Nn.getY(i);
    v.z += Nn.getZ(i);
    acc.set(key, v);
  }
  for (let i = 0; i < P2.count; i++) {
    const key = `${P2.getX(i).toFixed(3)},${P2.getY(i).toFixed(3)},${P2.getZ(i).toFixed(3)}`;
    const v = acc.get(key)!.clone().normalize();
    Nn.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/**
 * A leaf/frond ribbon along a curve. `path(t)` gives the spine point, `width(t)` the half width.
 * The ribbon is folded into a shallow V along its spine so it catches light from both sides.
 */
export function ribbon(
  path: (t: number) => THREE.Vector3,
  width: (t: number) => number,
  segments: number,
  side: THREE.Vector3,
  fold = 0.35
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const up = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = path(t);
    const pn = path(Math.min(1, t + 0.01));
    const tan = pn.sub(path(Math.max(0, t - 0.01))).normalize();
    up.crossVectors(tan, side).normalize();
    const w = width(t);
    const l = p.clone().addScaledVector(side, w).addScaledVector(up, -w * fold);
    const r = p.clone().addScaledVector(side, -w).addScaledVector(up, -w * fold);
    pos.push(l.x, l.y, l.z, p.x, p.y, p.z, r.x, r.y, r.z);
    if (i > 0) {
      const a = (i - 1) * 3;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Double-sided version of a geometry (duplicates faces with flipped winding and normals). */
export function doubleSide(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const P2 = g.getAttribute('position');
  const Nn = g.getAttribute('normal');
  const I = g.index!;
  const n = P2.count;
  const pos = new Float32Array(n * 6);
  const nor = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    pos.set([P2.getX(i), P2.getY(i), P2.getZ(i)], i * 3);
    pos.set([P2.getX(i), P2.getY(i), P2.getZ(i)], (i + n) * 3);
    nor.set([Nn.getX(i), Nn.getY(i), Nn.getZ(i)], i * 3);
    nor.set([-Nn.getX(i), -Nn.getY(i), -Nn.getZ(i)], (i + n) * 3);
  }
  const idx: number[] = [];
  for (let i = 0; i < I.count; i += 3) {
    idx.push(I.getX(i), I.getX(i + 1), I.getX(i + 2));
    idx.push(I.getX(i) + n, I.getX(i + 2) + n, I.getX(i + 1) + n);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

/** Tube along a list of points (for curved palm trunks, branches). */
export function tube(points: THREE.Vector3[], radius: (t: number) => number, radial = 7, segs = 10): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const pos: number[] = [];
  const idx: number[] = [];
  const frames = curve.computeFrenetFrames(segs, false);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const nx = Math.cos(a), ny = Math.sin(a);
      pos.push(c.x + r * (nx * N.x + ny * B.x), c.y + r * (nx * N.y + ny * B.y), c.z + r * (nx * N.z + ny * B.z));
    }
    if (i > 0) {
      for (let j = 0; j < radial; j++) {
        const a = (i - 1) * (radial + 1) + j, b = a + radial + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat-shaded (faceted) copy of a geometry: every triangle gets its own normal. */
export function facet(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g.clone();
  ng.computeVertexNormals();
  ng.computeBoundingSphere();
  return ng;
}
