import * as THREE from 'three';
import { GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { peopleMaterial } from '../render/materials';
import { splitBody } from './animalModels';

/**
 * A jointed four-legged rig shared by dogs and jaguars. The body is two or three pieces along
 * the spine (chest, loin, pelvis) so the back arches and stretches in the gallop and curves into
 * turns; a one- or two-piece neck; a head with a hinged jaw (and optional tongue) and mobile
 * ears; a jointed tail of any number of pieces; optional shoulder blades that rock with the
 * forelegs; and legs of three or four segments (upper, lower, pastern / metatarsus, toes).
 *
 * Legs are placed by two-bone IK onto gait-driven paw targets expressed in the heading frame,
 * so planted paws stay put while the body moves over them (stride is tied to ground speed, and
 * turning on the spot steps the feet round). The toe tip is the planted point, so the heel of
 * the paw rolls up off the ground at push-off. A pose adds blend weights for sitting, lying,
 * curling up, crouching (stalking), lunging, limping, the play bow and a shake-off; a QuadDyn
 * gives an animal springy follow-through on the tail, ears, jaw and tongue.
 *
 * Vertices tagged mat 2 take the per-animal coat colour; mat 1 vertices are markings (cream
 * chest, pale belly, socks) tinted by a second per-animal colour, so one mesh serves plain,
 * tricolour and black-and-tan dogs, and golden or black jaguars.
 */

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const COAT = { color: 0xffffff, mat: 2 };
const coat = (shade: number) => ({ color: new THREE.Color(shade, shade, shade), mat: 2 });
const MARK = { color: 0xffffff, mat: 1 };
const C = (c: number) => ({ color: c });

export interface QuadDims {
  /** Spine (body centre) height standing. */
  spineY: number;
  /** Leg length basis: the front leg from shoulder joint to ground is about this long. */
  hipY: number;
  /** Shoulder and hip joint heights standing, as fractions of hipY (below 1 = legs a little bent). */
  frontK: number;
  hindK: number;
  x: number;
  zF: number;
  zR: number;
  /** Where the paws stand relative to their joint, in hipY (negative = behind). */
  footF: number;
  footH: number;
  /** Neck base (relative to the spine centre), length and resting pitch (negative rises). */
  neck: [number, number, number];
  neckLen: number;
  neckPitch: number;
  /** Jaw hinge in head space (y, z). */
  jaw: [number, number];
  /** Tail base on the rear half. */
  tail: [number, number, number];
  /** Tail segment lengths. */
  tailLen: number[];
  /** Leg segment lengths as fractions of hipY (upper, lower, paw), front and hind, and the base radius. */
  segF: [number, number, number];
  segH: [number, number, number];
  r: number;
  /** Distance covered per gait cycle at a walk, and its multiplier at a full gallop. */
  stride: number;
  gallopK: number;
  /** Speeds over which the walk blends into a trot, and the trot into a gallop. */
  trotV: [number, number];
  gallopV: [number, number];
  /** Body drop when crouched, and spine height lying down (fractions of hipY). */
  crouchDrop: number;
  lieY: number;
  /** Paw (pastern / metatarsus) angle standing, front and hind (negative = paw ahead of the joint). */
  pawF: number;
  pawH: number;
  /** Paw lift in swing, fraction of hipY. */
  clear: number;
  // ---- Optional refinements (absent = the simpler two-piece rig) ----
  /** Three-piece spine: z of the chest and pelvis joints from the body centre (the loin piece lies between). */
  spineJ?: [number, number];
  /** Second neck piece: length and resting pitch relative to the first. */
  neckLen2?: number;
  neckPitch2?: number;
  /** Shoulder blades: top pivot (x, y, z in body space), length, resting angle (negative = lower end forward), inward tilt. */
  scap?: [number, number, number, number, number, number];
  /** Toe segments (fractions of hipY) adding a joint at the ball of the paw, and the toe line's height above ground. */
  toeF?: number;
  toeH?: number;
  padH?: number;
  /** Lever arm used to step the feet round when turning on the spot (0 = turn without stepping). */
  turnR?: number;
  /** Stride at a crawl as a fraction of the walking stride, and the extra stride at a trot (default 0.2). */
  slowStride?: number;
  trotK?: number;
  /** Gallop spine flex (radians at full gather / stretch) and sideways weight shift at a walk (fraction of hipY). */
  flexK?: number;
  swayK?: number;
}

/**
 * A medium village dog, about half an islander's height at the withers: deep chest, tucked
 * waist, sloping croup; shoulder blades; four-segment legs with a toe joint.
 */
export const DOG_DIMS: QuadDims = {
  spineY: 0.218, hipY: 0.18, frontK: 1.115, hindK: 1.14, x: 0.034, zF: 0.097, zR: -0.09, footF: -0.17, footH: -0.06,
  neck: [0, 0.033, 0.103], neckLen: 0.04, neckPitch: -1.12, neckLen2: 0.036, neckPitch2: 0.52, jaw: [0.0035, 0.03],
  tail: [0, 0.032, -0.132], tailLen: [0.036, 0.034, 0.032, 0.03, 0.028],
  segF: [0.436, 0.5, 0.18], segH: [0.455, 0.485, 0.29], toeF: 0.13, toeH: 0.12, padH: 0.009,
  r: 0.017, stride: 0.24, gallopK: 2.6, trotK: 0.52, trotV: [0.55, 0.8], gallopV: [1.6, 2.1],
  crouchDrop: 0.3, lieY: 0.5, pawF: -0.25, pawH: -0.08, clear: 0.22,
  spineJ: [0.028, -0.056], scap: [0.024, 0.05, 0.068, 0.075, -0.5, 0.14], turnR: 0.12, slowStride: 0.6, flexK: 0.42, swayK: 0.05,
};

export const JAG_DIMS: QuadDims = {
  spineY: 0.24, hipY: 0.2, frontK: 0.9, hindK: 0.9, x: 0.062, zF: 0.17, zR: -0.19, footF: -0.12, footH: -0.15,
  neck: [0, 0.03, 0.2], neckLen: 0.1, neckPitch: -0.35, jaw: [-0.022, 0.035], tail: [0, 0.03, -0.27], tailLen: [0.16, 0.15, 0.14],
  segF: [0.42, 0.4, 0.2], segH: [0.44, 0.44, 0.26], r: 0.03, stride: 0.36, gallopK: 2.2, trotV: [1.25, 1.5], gallopV: [1.8, 2.4],
  crouchDrop: 0.42, lieY: 0.5, pawF: -0.2, pawH: -0.08, clear: 0.17,
};

/** Gait phase offsets per leg (LF, RF, LH, RH): lateral-sequence walk, diagonal trot, transverse gallop. */
const WALK = [0.25, 0.75, 0, 0.5];
const TROT = [0.25, 0.75, -0.25, 0.25];
const GALLOP = [0.25, 0.37, -0.25, -0.13];

// ---------------- Geometry helpers ----------------

/** Split every triangle whose longest edge exceeds maxEdge into four (coplanar, so facets stay flat). */
function subdivide(g: THREE.BufferGeometry, maxEdge: number): THREE.BufferGeometry {
  const names = Object.keys(g.attributes);
  const src = names.map((n) => g.getAttribute(n) as THREE.BufferAttribute);
  const out: number[][] = names.map(() => []);
  const pos = g.getAttribute('position');
  const tri = (a: number[][], depth: number) => {
    // a[k] = per-attribute flattened values for the three corners.
    const p = a[0];
    const e = Math.max(
      Math.hypot(p[0] - p[3], p[1] - p[4], p[2] - p[5]),
      Math.hypot(p[3] - p[6], p[4] - p[7], p[5] - p[8]),
      Math.hypot(p[6] - p[0], p[7] - p[1], p[8] - p[2]),
    );
    if (e <= maxEdge || depth >= 4) {
      for (let k = 0; k < a.length; k++) for (const v of a[k]) out[k].push(v);
      return;
    }
    const mid = (vals: number[], s: number, i: number, j: number) => {
      const r: number[] = [];
      for (let c = 0; c < s; c++) r.push((vals[i * s + c] + vals[j * s + c]) / 2);
      return r;
    };
    const quads: number[][][] = [[], [], [], []];
    for (let k = 0; k < a.length; k++) {
      const s = src[k].itemSize, v = a[k];
      const c0 = v.slice(0, s), c1 = v.slice(s, 2 * s), c2 = v.slice(2 * s, 3 * s);
      const m01 = mid(v, s, 0, 1), m12 = mid(v, s, 1, 2), m20 = mid(v, s, 2, 0);
      quads[0].push([...c0, ...m01, ...m20]);
      quads[1].push([...m01, ...c1, ...m12]);
      quads[2].push([...m20, ...m12, ...c2]);
      quads[3].push([...m01, ...m12, ...m20]);
    }
    for (const q of quads) tri(q, depth + 1);
  };
  for (let i = 0; i < pos.count; i += 3) {
    const a = src.map((s) => {
      const r: number[] = [];
      for (let k = 0; k < 3; k++) for (let c = 0; c < s.itemSize; c++) r.push(s.getComponent(i + k, c));
      return r;
    });
    tri(a, 0);
  }
  const ng = new THREE.BufferGeometry();
  names.forEach((n, k) => ng.setAttribute(n, new THREE.Float32BufferAttribute(out[k], src[k].itemSize)));
  ng.computeBoundingSphere();
  return ng;
}

/** Scale each triangle's colour by fn(centroid, normal, mat) (1 = unchanged). Non-indexed geometry. */
function paintFaces(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number, mat: number, i: number) => number): THREE.BufferGeometry {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), col = g.getAttribute('color'), mat = g.getAttribute('aMat');
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const m = mat ? mat.getX(i) : 0;
    const s = fn(x, y, z, nor.getX(i), nor.getY(i), nor.getZ(i), m, i / 3);
    if (s === 1) continue;
    for (let k = 0; k < 3; k++) col.setXYZ(i + k, col.getX(i + k) * s, col.getY(i + k) * s, col.getZ(i + k) * s);
  }
  col.needsUpdate = true;
  return g;
}

function hash(a: number, b: number, c = 0, d = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1440662683) + Math.imul(d | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Nearest jittered-grid feature point: distance (in cells), offset from it, and its id. */
const _nf = { d: 0, dx: 0, dy: 0, dz: 0, id: 0 };
function nearestFeature(x: number, y: number, z: number, cell: number, seed: number): typeof _nf {
  const fx = x / cell, fy = y / cell, fz = z / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  let best = 1e9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const cx = ix + a, cy = iy + b, cz = iz + c;
    const px = cx + hash(cx, cy, cz, seed), py = cy + hash(cx, cy, cz, seed + 1), pz = cz + hash(cx, cy, cz, seed + 2);
    const d = (fx - px) ** 2 + (fy - py) ** 2 + (fz - pz) ** 2;
    if (d < best) {
      best = d;
      _nf.dx = fx - px;
      _nf.dy = fy - py;
      _nf.dz = fz - pz;
      _nf.id = (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
    }
  }
  _nf.d = Math.sqrt(best);
  return _nf;
}

/** Jaguar rosettes: broken dark rings of 3–5 blotches around a slightly deeper centre, sometimes a dot. */
function rosette(x: number, y: number, z: number, cell: number): number {
  const f = nearestFeature(x, y, z, cell, 11);
  const size = 0.75 + 0.45 * hash(f.id, 1);
  const rOut = 0.44 * size, rIn = 0.25 * size;
  if (f.d > rOut) return 1;
  if (f.d < rIn) return f.d < 0.1 && hash(f.id, 2) < 0.35 ? 0.2 : 0.8;
  const n = 4 + Math.floor(hash(f.id, 3) * 2);
  const a = Math.atan2(f.dy, f.dx + f.dz * 0.7);
  const seg = Math.floor((a / TAU + 0.5 + hash(f.id, 4)) * n) % n;
  return hash(f.id, 10 + seg) < 0.22 ? 0.82 : 0.15;
}

/** Solid spots (legs, head, belly). */
function spot(x: number, y: number, z: number, cell: number, rad = 0.3): number {
  const f = nearestFeature(x, y, z, cell, 23);
  return f.d < rad * (0.7 + 0.5 * hash(f.id, 5)) ? 0.16 : 1;
}

/** Subtle per-facet shade variation for the low-poly fur look. */
const grain = (i: number, amt: number) => 1 - amt + 2 * amt * hash(i, 77);

/** Compose a matrix into a GeoBuilder transform relative to a parent. */
const at = (parent: THREE.Matrix4, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => parent.clone().multiply(M.t(x, y, z, rx, ry, rz, sx, sy, sz));

// ---------------- Lofted shapes ----------------

/** A cross-section of a lofted shape: centre (x, y) at z along the axis, half width, half heights above (u) and below (d). */
interface Sec {
  z: number;
  x: number;
  y: number;
  w: number;
  u: number;
  d: number;
}
const sec = (z: number, y: number, w: number, u: number, d: number, x = 0): Sec => ({ z, x, y, w, u, d });
const spow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
/** Dome rings (angles from the section plane) used to round off the ends of a loft. */
const DOME = [1.1, 0.6];

/**
 * A closed tube through cross-sections along +z, with domed ends (a cap length of 0 leaves that
 * end open). `ex` above 2 squares the sections off a little (ribcage), `jit` jitters the rings
 * for a hand-cut look. Sections must be in increasing z.
 */
function loft(secs: Sec[], radial: number, cap0: number, cap1: number, ex = 2, jit = 0, seed = 1): THREE.BufferGeometry {
  const all: Sec[] = [];
  const sc = (s: Sec, z: number, k: number): Sec => ({ z, x: s.x, y: s.y, w: s.w * k, u: s.u * k, d: s.d * k });
  const first = secs[0], last = secs[secs.length - 1];
  if (cap0 > 0) for (const t of DOME) all.push(sc(first, first.z - cap0 * Math.sin(t), Math.cos(t)));
  all.push(...secs);
  if (cap1 > 0) for (let i = DOME.length - 1; i >= 0; i--) all.push(sc(last, last.z + cap1 * Math.sin(DOME[i]), Math.cos(DOME[i])));
  const pos: number[] = [];
  const idx: number[] = [];
  all.forEach((s, r) => {
    for (let j = 0; j < radial; j++) {
      const a = HALF_PI + (TAU * j) / radial;
      const c = Math.cos(a), sn = Math.sin(a);
      const k = jit ? 1 + jit * (2 * hash(r, j, seed) - 1) : 1;
      pos.push(s.x + s.w * spow(c, 2 / ex) * k, s.y + (sn > 0 ? s.u : s.d) * spow(sn, 2 / ex) * k, s.z);
    }
  });
  const n = all.length;
  for (let r = 0; r + 1 < n; r++) {
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      const p00 = r * radial + j, p01 = r * radial + j1, p10 = (r + 1) * radial + j, p11 = (r + 1) * radial + j1;
      idx.push(p00, p01, p10, p01, p11, p10);
    }
  }
  if (cap0 > 0) {
    const a = pos.length / 3;
    pos.push(first.x, first.y, first.z - cap0);
    for (let j = 0; j < radial; j++) idx.push(a, (j + 1) % radial, j);
  }
  if (cap1 > 0) {
    const a = pos.length / 3, b = (n - 1) * radial;
    pos.push(last.x, last.y, last.z + cap1);
    for (let j = 0; j < radial; j++) idx.push(a, b + j, b + ((j + 1) % radial));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A loft running down a bone (distance along −y): `u` is the depth toward the front (+z), `d` toward the back. */
function limb(secs: Sec[], radial: number, cap0: number, cap1: number, jit = 0.04, seed = 3): THREE.BufferGeometry {
  return loft(secs, radial, cap0, cap1, 2, jit, seed).applyMatrix4(M.t(0, 0, 0, HALF_PI, 0, 0));
}

/** Catmull-Rom through a table of sections (increasing, roughly even z), sampled at z. */
function sampleSec(tab: Sec[], z: number): Sec {
  let i = 0;
  while (i < tab.length - 2 && tab[i + 1].z < z) i++;
  const a = tab[Math.max(0, i - 1)], b = tab[i], c = tab[i + 1], d = tab[Math.min(tab.length - 1, i + 2)];
  const t = Math.min(1, Math.max(0, (z - b.z) / (c.z - b.z)));
  const cr = (p0: number, p1: number, p2: number, p3: number) =>
    0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
  return { z, x: cr(a.x, b.x, c.x, d.x), y: cr(a.y, b.y, c.y, d.y), w: cr(a.w, b.w, c.w, d.w), u: cr(a.u, b.u, c.u, d.u), d: cr(a.d, b.d, c.d, d.d) };
}

/**
 * One piece of a lofted body: its own span [z0, z1] plus overlaps ov0 / ov1 reaching into its
 * neighbours, shrunk a touch so they stay hidden at rest and fill the joint as it bends.
 */
function bodyPiece(tab: Sec[], z0: number, z1: number, ov0: number, ov1: number, radial: number, step: number, ex: number, seed: number, endCap = 0.014, jit = 0.03): THREE.BufferGeometry {
  const secs: Sec[] = [];
  const a = z0 - ov0, b = z1 + ov1;
  const n = Math.max(2, Math.ceil((b - a) / step));
  const lo = tab[0].z, hi = tab[tab.length - 1].z;
  for (let i = 0; i <= n; i++) {
    const z = a + ((b - a) * i) / n;
    const s = sampleSec(tab, Math.min(hi, Math.max(lo, z)));
    s.z = z;
    const inside = z < z0 ? (z0 - z) / ov0 : z > z1 ? (z - z1) / ov1 : 0;
    const k = 1 - 0.07 * Math.min(1, inside * 3);
    s.w *= k;
    s.u *= k;
    s.d *= k;
    secs.push(s);
  }
  const f = secs[0], l = secs[secs.length - 1];
  const cap = (s: Sec, ov: number) => (ov > 0 ? 0.75 * Math.min(s.w, s.u, s.d) : endCap);
  return loft(secs, radial, cap(f, ov0), cap(l, ov1), ex, jit, seed);
}

/** Retag faces (coat, mat 2) as markings (mat 1) where fn(centroid, normal) holds. Non-indexed geometry. */
function markFaces(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => boolean): THREE.BufferGeometry {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), mat = g.getAttribute('aMat');
  for (let i = 0; i < pos.count; i += 3) {
    if (mat.getX(i) < 1.5) continue;
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    if (fn(x, y, z, nor.getX(i), nor.getY(i), nor.getZ(i))) for (let k = 0; k < 3; k++) mat.setX(i + k, 1);
  }
  mat.needsUpdate = true;
  return g;
}

/** Coat shading: a darker saddle on upward faces above `y0`, and per-facet grain. */
const saddle = (y0: number, amt: number) => (_x: number, y: number, _z: number, _nx: number, ny: number, _nz: number, m: number, i: number) =>
  (m > 1.5 ? 1 - amt * Math.min(1, Math.max(0, (ny - 0.35) * 2.5)) * Math.min(1, Math.max(0, (y - y0) * 60)) : 1) * grain(i, 0.025);

// ---------------- Dog geometry ----------------

/**
 * Body profile in body space (y from the spine height): rounded rump and haunch, a tucked waist,
 * the deep ribcage and brisket, the point of the chest. About as long as the dog is tall at the
 * withers, like a lean village (pariah) dog.
 */
const DOG_BODY: Sec[] = [
  sec(-0.144, 0.002, 0.0229, 0.028, 0.034),
  sec(-0.1336, 0.004, 0.0317, 0.037, 0.044),
  sec(-0.12, 0.006, 0.0378, 0.045, 0.05),
  sec(-0.1, 0.009, 0.0414, 0.05, 0.05),
  sec(-0.08, 0.011, 0.0405, 0.051, 0.049),
  sec(-0.06, 0.012, 0.037, 0.049, 0.045),
  sec(-0.04, 0.01, 0.0361, 0.048, 0.046),
  sec(-0.016, 0.004, 0.0396, 0.052, 0.055),
  sec(0.008, -0.002, 0.0431, 0.058, 0.066),
  sec(0.032, -0.006, 0.0458, 0.064, 0.077),
  sec(0.056, -0.008, 0.0458, 0.068, 0.082),
  sec(0.08, -0.006, 0.044, 0.066, 0.08),
  sec(0.1024, -0.002, 0.0396, 0.058, 0.068),
  sec(0.1216, 0.0, 0.0326, 0.046, 0.054),
  sec(0.136, -0.003, 0.022, 0.031, 0.036),
];

/**
 * Dog body in three pieces, each with its pivot at its spine joint: chest (withers, ribcage, bib),
 * loin (tucked waist) and pelvis (croup, rump, hip points). Pale bib and belly are markings.
 */
export function dogBodyParts(): { chest: THREE.BufferGeometry; loin: THREE.BufferGeometry; pelvis: THREE.BufferGeometry } {
  const [jc, jp] = DOG_DIMS.spineJ!;
  const piece = (z0: number, z1: number, ov0: number, ov1: number, seed: number, extra?: (b: GeoBuilder) => void) => {
    const b = new GeoBuilder();
    b.add(bodyPiece(DOG_BODY, z0, z1, ov0, ov1, 12, 0.016, 2.25, seed, 0.014, 0.015), COAT);
    extra?.(b);
    const g = facet(b.build());
    markFaces(g, (_x, y, z, _nx, ny, nz) => ny < -0.7 && z > -0.104 && z < 0.128 || (z > 0.072 && y < 0.012 && (nz > 0.3 || ny < -0.35)));
    paintFaces(g, saddle(0.03, 0.17));
    return g;
  };
  const chest = piece(jc, 0.136, 0.026, 0, 11).translate(0, 0, -jc);
  const loin = piece(jp, jc, 0.022, 0.022, 12);
  const pelvis = piece(-0.144, jp, 0, 0.026, 13, (b) => {
    // Points of the hip either side of the croup.
    for (const x of [-1, 1]) b.add(P.sphere(0.009, 1), COAT, M.t(x * 0.025, 0.045, -0.072, 0, 0, 0, 1, 0.75, 1.4));
  }).translate(0, 0, -jp);
  return { chest, loin, pelvis };
}

/** Two-piece dog neck (pivots at the base in the chest and at the middle); cream throat. */
export function dogNeckParts(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const fin = (g: THREE.BufferGeometry) => {
    const f = facet(new GeoBuilder().add(g, COAT).build());
    markFaces(f, (_x, _y, _z, _nx, ny) => ny < -0.35);
    return paintFaces(f, saddle(0.008, 0.14));
  };
  const n1 = loft([sec(0, -0.002, 0.037, 0.037, 0.043), sec(0.016, -0.001, 0.035, 0.035, 0.041), sec(0.032, 0, 0.032, 0.032, 0.036), sec(0.04, 0, 0.031, 0.031, 0.034), sec(0.052, 0, 0.028, 0.028, 0.031)], 10, 0.022, 0.014, 2, 0.02, 21);
  const n2 = loft([sec(-0.012, 0, 0.029, 0.029, 0.032), sec(0, 0, 0.03, 0.03, 0.033), sec(0.018, 0, 0.029, 0.029, 0.031), sec(0.032, 0.001, 0.027, 0.027, 0.029), sec(0.045, 0.002, 0.023, 0.023, 0.024)], 10, 0.012, 0.012, 2, 0.02, 22);
  return [fin(n1), fin(n2)];
}

/** Dog head (pivot at the top of the neck): domed skull, a clear stop, tapering muzzle, flews, nose, eyes; jaw and ears are separate parts. */
export function dogHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const skull = loft([
    sec(-0.012, 0.027, 0.031, 0.03, 0.028),
    sec(0.004, 0.028, 0.04, 0.038, 0.034),
    sec(0.022, 0.029, 0.043, 0.04, 0.036),
    sec(0.04, 0.03, 0.039, 0.035, 0.034),
    sec(0.054, 0.027, 0.031, 0.025, 0.033),
    sec(0.066, 0.022, 0.026, 0.019, 0.031),
    sec(0.08, 0.02, 0.022, 0.017, 0.027),
    sec(0.095, 0.019, 0.0195, 0.016, 0.0255),
    sec(0.106, 0.018, 0.0172, 0.015, 0.0235),
    sec(0.115, 0.018, 0.0148, 0.013, 0.019),
  ], 12, 0.014, 0.006, 2.1, 0.035, 31);
  b.add(skull, COAT);
  for (const x of [-1, 1]) {
    // Flews: the loose upper lips hanging either side of the muzzle.
    b.add(P.sphere(0.011, 1), COAT, M.t(x * 0.0138, 0.0025, 0.085, 0, x * 0.1, 0, 0.5, 0.62, 1.75));
    // Eyes with a glint; tan brow spots (markings) above.
    b.add(P.sphere(0.0074, 1), C(0x140e0a), M.t(x * 0.0205, 0.042, 0.052, 0, 0, 0, 1, 0.9, 1));
    b.add(P.sphere(0.002, 0), C(0xffffff), M.t(x * 0.0225, 0.0445, 0.0585));
    b.add(P.sphere(0.0045, 0), MARK, M.t(x * 0.015, 0.053, 0.05, 0, 0, 0, 1.3, 0.55, 0.9));
    // Upper canines, seen when the mouth opens.
    b.add(P.cone(0.0022, 0.007, 4), C(0xf2eadc), M.t(x * 0.0105, -0.0012, 0.094, Math.PI, 0, 0));
  }
  // Nose leather and nostrils.
  b.add(P.sphere(0.0098, 1), C(0x1a1412), M.t(0, 0.027, 0.1165, -0.25, 0, 0, 1.15, 0.85, 0.8));
  // Dark mouth roof, hidden by the jaw until it opens.
  b.add(P.box(0.02, 0.003, 0.054), C(0x3a1a1a), M.t(0, 0.003, 0.066));
  const g = facet(b.build());
  // Pale muzzle, cheeks and chin (markings): the lower half of the face forward of the eyes.
  markFaces(g, (_x, y, z, _nx, ny) => z > 0.058 && y < 0.018 && ny < 0.55);
  return paintFaces(g, saddle(0.05, 0.12));
}

/** Lower jaw (pivot at the hinge): pale chin, dark mouth floor with the tongue, lower canines. */
export function dogJaw(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(loft([sec(0, -0.004, 0.016, 0.004, 0.0085), sec(0.024, -0.0045, 0.0138, 0.0038, 0.0078), sec(0.044, -0.0042, 0.0115, 0.0036, 0.0065), sec(0.06, -0.0035, 0.0088, 0.0032, 0.005)], 8, 0.008, 0.004, 2, 0.02, 41), MARK);
  b.add(P.box(0.018, 0.003, 0.054), C(0x4a2020), M.t(0, -0.0012, 0.033));
  b.add(P.box(0.014, 0.004, 0.042), C(0xd86a78), M.t(0, 0.0004, 0.033));
  for (const x of [-1, 1]) b.add(P.cone(0.0019, 0.006, 4), C(0xf2eadc), M.t(x * 0.008, 0.001, 0.056));
  return facet(b.build());
}

/** The tongue, lolled out over the lower teeth when panting (pivot inside the jaw). */
export function dogTongue(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(loft([sec(0, 0, 0.0105, 0.0028, 0.0028), sec(0.02, 0, 0.0115, 0.003, 0.003), sec(0.04, -0.0015, 0.011, 0.0028, 0.0028), sec(0.054, -0.005, 0.0085, 0.0024, 0.0024)], 8, 0.003, 0.005, 2), C(0xd8687a));
  b.add(P.box(0.0016, 0.0012, 0.045), C(0xa84a5a), M.t(0, 0.0028, 0.026));
  return facet(b.build());
}

/** Ears (pivot at the base): pricked, cupped triangles with a pink inside, or soft drop ears hanging from a fold. */
export function dogEar(kind: 'prick' | 'floppy'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  if (kind === 'prick') {
    // Loft up the ear: thin front-to-back (d = front), broad at the base, narrowing to a rounded point.
    const up = M.t(0, 0, 0, -HALF_PI, 0, 0);
    b.add(loft([sec(-0.004, 0, 0.0175, 0.0065, 0.0075), sec(0.012, 0, 0.0165, 0.0055, 0.0065), sec(0.028, 0, 0.0125, 0.004, 0.005), sec(0.042, 0, 0.0065, 0.0025, 0.003), sec(0.05, 0, 0.0022, 0.0015, 0.0018)], 8, 0.003, 0.003, 2), coat(0.86), up);
    b.add(loft([sec(0.004, 0, 0.0115, 0.001, 0.0015), sec(0.02, 0, 0.0095, 0.001, 0.0015), sec(0.036, 0, 0.005, 0.001, 0.0012)], 6, 0.002, 0.004, 2), C(0x9a6a60), M.t(0, 0, 0.0035, -HALF_PI, 0, 0));
  } else {
    // A flap hanging down the side of the head, broad and thin, with a soft fold at the top.
    b.add(P.sphere(0.0105, 1), coat(0.82), M.t(0, -0.002, 0, 0, 0, 0, 0.75, 0.9, 1.2));
    b.add(loft([sec(-0.004, 0, 0.005, 0.011, 0.011), sec(0.01, 0, 0.0055, 0.015, 0.014), sec(0.026, 0.001, 0.005, 0.018, 0.016), sec(0.042, 0.002, 0.0045, 0.015, 0.014), sec(0.052, 0.002, 0.004, 0.009, 0.009)], 8, 0.003, 0.006, 2, 0.04, 51), coat(0.78), M.t(0, 0, 0, HALF_PI, 0, 0));
  }
  return paintFaces(facet(b.build()), (_x, _y, _z, _nx, _ny, _nz, _m, i) => grain(i, 0.04));
}

/** Ear placement and resting tilt (pitch, outward roll) for each ear type, and how soft (floppy) the ear is. */
export const DOG_EARS = {
  prick: { pos: [0.024, 0.061, 0.006] as [number, number, number], rest: [-0.1, 0.32] as [number, number], soft: 0.12 },
  floppy: { pos: [0.036, 0.057, 0.004] as [number, number, number], rest: [0.12, -0.28] as [number, number], soft: 1 },
};

/** Tail radii at the joints, base to tip. */
const DOG_TAIL_R = [0.0135, 0.013, 0.0122, 0.011, 0.0088, 0.0045];

/** Dog tail pieces (pivot at each base, running back along −z): a bushy, tapering brush with a pale underside and tip. */
export function dogTail(): THREE.BufferGeometry[] {
  const L = DOG_DIMS.tailLen;
  return L.map((len, i) => {
    const r0 = DOG_TAIL_R[i], r1 = DOG_TAIL_R[i + 1];
    const b = new GeoBuilder();
    b.add(P.sphere(r0 * 1.04, 1), COAT);
    const m = (r0 + r1) / 2 * 1.08;
    b.add(loft([sec(0, 0, r0, r0, r0), sec(len * 0.5, 0, m, m, m * 1.04), sec(len, 0, r1, r1, r1)], 7, 0, i === L.length - 1 ? r1 * 1.6 : 0, 2, 0.05, 60 + i), COAT, M.t(0, 0, 0, 0, Math.PI, 0));
    const g = facet(b.build());
    const last = i === L.length - 1;
    markFaces(g, (_x, _y, z, _nx, ny) => ny < -0.55 || (last && z < -len * 0.55));
    return paintFaces(g, (_x, _y, _z, _nx, ny, _nz, m2, k) => (m2 > 1.5 && ny > 0.5 ? 0.9 : 1) * grain(k, 0.03));
  });
}

/** A dog paw (pivot at the ball joint, toes forward along +z, sole on y = −padH): toes, nails and dark pads. */
function dogPaw(len: number, padH: number, k: number, pad: number): GeoBuilder {
  const b = new GeoBuilder();
  const nail = 0x2a2220;
  b.add(P.sphere(0.0088 * k, 1), MARK);
  b.add(P.sphere(0.0115 * k, 1), MARK, M.t(0, -0.001, len * 0.34, 0, 0, 0, 1.05, 0.72, 1.25));
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.0078 * k, outer = i === 0 || i === 3;
    const z = len * (outer ? 0.72 : 0.86);
    b.add(P.sphere(0.0058 * k, 0), MARK, M.t(x, -0.0028, z, 0, 0, 0, 0.95, 0.85, 1.2));
    b.add(P.cone(0.0021 * k, 0.005 * k, 4), C(nail), M.t(x, -0.0042, z + 0.0062 * k, HALF_PI + 0.5, 0, 0));
    b.add(P.sphere(0.003 * k, 0), C(pad), M.t(x, -padH + 0.0016, z - 0.001, 0, 0, 0, 1, 0.55, 1.1));
  }
  b.add(P.sphere(0.0066 * k, 0), C(pad), M.t(0, -padH + 0.0022, len * 0.2, 0, 0, 0, 1.25, 0.4, 0.95));
  return b;
}

/**
 * Dog leg parts, in order: shoulder blade, upper arm (shoulder ball, triceps, point of elbow),
 * forearm (to the wrist / carpus), front pastern, front paw; thigh (ham), shin (gaskin, point
 * of hock), hind pastern (metatarsus), hind paw. Socks are markings.
 */
export function dogLegParts(pad: number): THREE.BufferGeometry[] {
  const q = DOG_DIMS, L = q.hipY;
  const fin = (b: GeoBuilder) => paintFaces(facet(b.build()), (_x, _y, _z, _nx, _ny, _nz, _m, i) => grain(i, 0.03));
  const lF = q.segF.map((f) => f * L), lH = q.segH.map((f) => f * L);
  const out: THREE.BufferGeometry[] = [];
  // Shoulder blade: a flat blade lying against the chest wall.
  {
    const b = new GeoBuilder(), ls = q.scap![3];
    b.add(limb([sec(0.006, 0, 0.005, 0.015, 0.014), sec(0.03, 0, 0.0075, 0.017, 0.016), sec(0.05, 0, 0.0095, 0.015, 0.014), sec(ls - 0.008, 0, 0.012, 0.014, 0.013)], 8, 0.006, 0.01), COAT);
    out.push(fin(b));
  }
  // Upper arm.
  {
    const b = new GeoBuilder(), l = lF[0];
    b.add(P.sphere(0.0195, 1), COAT, M.t(0, 0, 0.002, 0, 0, 0, 0.95, 1, 1.05));
    b.add(limb([sec(0, 0, 0.019, 0.02, 0.021), sec(0.018, 0, 0.018, 0.016, 0.026), sec(0.038, 0, 0.016, 0.013, 0.023), sec(0.056, 0, 0.0135, 0.011, 0.016), sec(l - 0.002, 0, 0.012, 0.011, 0.012)], 8, 0.012, 0.01, 0.04, 71), COAT);
    b.add(P.sphere(0.0095, 1), COAT, M.t(0, -l + 0.004, -0.013));
    out.push(fin(b));
  }
  // Forearm with the wrist (carpus) and its pad.
  {
    const b = new GeoBuilder(), l = lF[1];
    b.add(limb([sec(0, 0, 0.0125, 0.012, 0.013), sec(0.016, 0, 0.013, 0.014, 0.012), sec(0.04, 0, 0.011, 0.011, 0.0095), sec(0.066, 0, 0.009, 0.0085, 0.008), sec(l, 0, 0.0085, 0.0085, 0.0085)], 8, 0.01, 0.006, 0.04, 72), COAT);
    b.add(P.sphere(0.0094, 1), COAT, M.t(0, -l, 0, 0, 0, 0, 1, 0.9, 1));
    b.add(P.sphere(0.0045, 0), COAT, M.t(0, -l + 0.004, -0.009));
    out.push(fin(b));
  }
  // Front pastern (sock).
  {
    const b = new GeoBuilder(), l = lF[2];
    b.add(limb([sec(0, 0, 0.0082, 0.0085, 0.0085), sec(l * 0.5, 0, 0.0077, 0.008, 0.0077), sec(l, 0, 0.0085, 0.0088, 0.0085)], 8, 0.005, 0.005, 0.03, 73), MARK);
    out.push(fin(b));
  }
  out.push(fin(dogPaw(q.toeF! * L, q.padH!, 1, pad)));
  // Thigh: hams behind, the stifle (knee) at the bottom; the top domes up into the pelvis.
  {
    const b = new GeoBuilder(), l = lH[0];
    b.add(limb([sec(0, 0, 0.025, 0.028, 0.034), sec(0.016, 0, 0.025, 0.027, 0.038), sec(0.036, 0, 0.021, 0.022, 0.03), sec(0.056, 0, 0.016, 0.016, 0.018), sec(l - 0.001, 0, 0.0125, 0.013, 0.012)], 9, 0.022, 0.01, 0.04, 74), COAT);
    b.add(P.sphere(0.0105, 1), COAT, M.t(0, -l + 0.001, 0.007));
    out.push(fin(b));
  }
  // Shin (gaskin behind), hock joint and its point.
  {
    const b = new GeoBuilder(), l = lH[1];
    b.add(limb([sec(0, 0, 0.0125, 0.012, 0.014), sec(0.016, 0, 0.0125, 0.011, 0.02), sec(0.036, 0, 0.0105, 0.0095, 0.015), sec(0.058, 0, 0.0085, 0.008, 0.009), sec(l, 0, 0.0078, 0.0078, 0.0078)], 8, 0.01, 0.006, 0.04, 75), COAT);
    b.add(P.sphere(0.0085, 1), COAT, M.t(0, -l, 0));
    b.add(P.sphere(0.0062, 0), COAT, M.t(0, -l + 0.003, -0.0105));
    out.push(fin(b));
  }
  // Hind pastern (metatarsus, sock).
  {
    const b = new GeoBuilder(), l = lH[2];
    b.add(limb([sec(0, 0, 0.0078, 0.0078, 0.0082), sec(l * 0.5, 0, 0.0072, 0.0072, 0.0075), sec(l, 0, 0.008, 0.008, 0.008)], 8, 0.005, 0.005, 0.03, 76), MARK);
    out.push(fin(b));
  }
  out.push(fin(dogPaw(q.toeH! * L, q.padH!, 0.92, pad)));
  return out;
}

/** Tail piece: pivot at its base (with a joint knob), tapering back along -z. */
export function tailPiece(len: number, r0: number, r1: number, tip?: number, paint?: (x: number, y: number, z: number, i: number) => number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r0 * 1.05, 0), COAT, M.t(0, 0, 0));
  b.add(new THREE.CylinderGeometry(r0, r1, len, 6, 3), COAT, M.t(0, 0, -len / 2, Math.PI / 2, 0, 0));
  if (tip !== undefined) {
    b.add(P.cyl(r1 * 1.08, r1 * 1.12, len * 0.34, 6), C(tip), M.t(0, 0, -len * 0.84, Math.PI / 2, 0, 0));
    b.add(P.sphere(r1 * 1.08, 0), C(tip), M.t(0, 0, -len));
  } else b.add(P.sphere(r1 * 1.02, 0), COAT, M.t(0, 0, -len));
  const g = facet(b.build());
  if (paint) {
    const sg = subdivide(g, r0 * 0.8);
    return paintFaces(sg, (x, y, z, _nx, _ny, _nz, m, i) => (m > 1.5 ? paint(x, y, z, i) : 1));
  }
  return g;
}

// ---------------- Legs ----------------

/**
 * Leg parts for a rig: front upper arm (shoulder muscle, point of elbow), forearm, front paw;
 * hind thigh (ham), shin (gaskin, point of hock), hind paw. Paws are built so their soles sit
 * flat on the ground at the standing paw angle.
 */
export function legParts(q: QuadDims, pad: number, cat: boolean): THREE.BufferGeometry[] {
  const L = q.hipY, r = q.r;
  const out: THREE.BufferGeometry[] = [];
  const I = new THREE.Matrix4();
  const fin = (b: GeoBuilder) => {
    const g = facet(b.build());
    if (!cat) return paintFaces(g, (_x, _y, _z, _nx, _ny, _nz, _m, i) => grain(i, 0.04));
    return paintFaces(subdivide(g, r * 0.9), (x, y, z, _nx, _ny, _nz, m, i) => (m > 1.5 ? spot(x, y, z, r * 1.3, 0.27) : 1) * grain(i, 0.03));
  };
  const heavy = cat ? 1.18 : 1;
  // Front upper arm.
  {
    const b = new GeoBuilder(), len = L * q.segF[0];
    b.add(P.sphere(r * 1.1 * heavy, 1), COAT, I);
    b.add(P.sphere(r * 1.15 * heavy, 1), COAT, M.t(0, -len * 0.38, -r * 0.2, 0, 0, 0, 0.8, 1.55, 1.0));
    b.add(P.cyl(r * 1.0 * heavy, r * 0.72 * heavy, len, 6), COAT, M.t(0, -len / 2, 0));
    b.add(P.sphere(r * 0.75 * heavy, 0), COAT, M.t(0, -len, -r * 0.55));
    out.push(fin(b));
  }
  // Forearm.
  {
    const b = new GeoBuilder(), len = L * q.segF[1], k = cat ? 1.3 : 1;
    b.add(P.cyl(r * 0.85 * k, r * 0.62 * k, len, 6), COAT, M.t(0, -len / 2, 0));
    b.add(P.sphere(r * 0.95 * k, 1), COAT, M.t(0, -len * 0.25, r * 0.1, 0, 0, 0, 1, 2.2, 1));
    b.add(P.sphere(r * 0.64 * k, 0), COAT, M.t(0, -len, 0));
    out.push(fin(b));
  }
  out.push(pawGeo(L * q.segF[2], r * (cat ? 0.95 : 0.66), pad, q.pawF, cat, fin));
  // Hind thigh.
  {
    const b = new GeoBuilder(), len = L * q.segH[0];
    b.add(P.sphere(r * 1.15 * heavy, 1), COAT, I);
    b.add(P.sphere(r * 1.5 * heavy, 1), COAT, M.t(0, -len * 0.3, -r * 0.15, 0, 0, 0, 0.7, 1.45, 1.1));
    b.add(P.cyl(r * 1.1 * heavy, r * 0.78 * heavy, len, 6), COAT, M.t(0, -len / 2, 0));
    b.add(P.sphere(r * 0.8 * heavy, 0), COAT, M.t(0, -len, r * 0.2));
    out.push(fin(b));
  }
  // Shin with the point of the hock.
  {
    const b = new GeoBuilder(), len = L * q.segH[1];
    b.add(P.sphere(r * 1.0 * heavy, 1), COAT, M.t(0, -len * 0.28, -r * 0.35, 0, 0, 0, 0.9, 2, 1.1));
    b.add(P.cyl(r * 0.9 * heavy, r * 0.55 * heavy, len, 6), COAT, M.t(0, -len / 2, 0));
    b.add(P.sphere(r * 0.6 * heavy, 0), COAT, M.t(0, -len, -r * 0.5));
    out.push(fin(b));
  }
  out.push(pawGeo(L * q.segH[2], r * (cat ? 0.85 : 0.6), pad, q.pawH, cat, fin));
  return out;
}

/** Pastern / metatarsus and paw: toes, pads (sole pre-tilted so it is level at the standing angle). */
function pawGeo(len: number, r: number, pad: number, tilt: number, cat: boolean, fin: (b: GeoBuilder) => THREE.BufferGeometry): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const sock = cat ? COAT : MARK;
  b.add(P.sphere(r * 1.0, 0), COAT, M.t(0, 0, 0));
  b.add(P.cyl(r * 0.95, r * 0.85, len * 0.8, 6), sock, M.t(0, -len * 0.42, 0));
  const foot = M.t(0, -len, 0, -tilt, 0, 0);
  b.add(P.sphere(r * 1.1, 1), sock, at(foot, 0, r * 0.62, r * 0.45, 0, 0, 0, 1.08, 0.62, 1.35));
  for (let i = 0; i < 4; i++) b.add(P.sphere(r * 0.38, 0), sock, at(foot, (i - 1.5) * r * 0.5, r * 0.3, r * 1.3 - Math.abs(i - 1.5) * r * 0.15));
  b.add(P.box(r * 1.5, r * 0.25, r * 1.3), C(pad), at(foot, 0, r * 0.12, r * 0.5));
  return fin(b);
}

// ---------------- Jaguar geometry ----------------

const JAG_DARK = 0x1c140e;

/** Jaguar body: long, low and heavy-shouldered; rosettes painted over the coat, spotted pale belly. */
export function jaguarBodyHalves(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  const y0 = JAG_DIMS.spineY;
  b.add(P.sphere(0.1, 1), COAT, M.t(0, y0 - 0.008, 0.13, 0, 0, 0, 0.95, 1.12, 1.1));
  for (const x of [-1, 1]) b.add(P.sphere(0.05, 1), COAT, M.t(x * 0.045, y0 + 0.04, 0.14, -0.35, 0, 0, 0.62, 1.3, 1));
  b.add(P.cyl(0.088, 0.075, 0.26, 9), COAT, M.t(0, y0, -0.03, Math.PI / 2 + 0.04, 0, 0));
  b.add(P.sphere(0.088, 1), COAT, M.t(0, y0 + 0.012, -0.17, 0, 0, 0, 1.02, 1, 1.05));
  b.add(P.sphere(0.05, 1), COAT, M.t(0, y0 + 0.03, -0.235));
  // Pale belly (with the loose skin of the pouch) and chest.
  b.add(P.sphere(0.08, 1), MARK, M.t(0, y0 - 0.05, -0.01, 0, 0, 0, 0.8, 0.5, 2.2));
  b.add(P.sphere(0.06, 1), MARK, M.t(0, y0 - 0.06, 0.17, 0, 0, 0, 0.8, 0.7, 1));
  const g = subdivide(facet(b.build()), 0.027);
  paintFaces(g, (x, y, z, _nx, _ny, _nz, m, i) => (m > 1.5 ? rosette(x, y, z, 0.056) : spot(x, y, z, 0.04, 0.26)) * grain(i, 0.03));
  return splitBody(g, y0);
}

/** Jaguar neck: thick, pivot at its base, forward along +z. */
export function jaguarNeck(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const len = JAG_DIMS.neckLen;
  b.add(P.sphere(0.072, 1), COAT, M.t(0, 0, 0, 0, 0, 0, 0.95, 1, 1));
  b.add(P.cyl(0.058, 0.072, len + 0.01, 8), COAT, M.t(0, 0, len / 2, Math.PI / 2, 0, 0));
  b.add(P.sphere(0.058, 1), COAT, M.t(0, 0, len));
  b.add(P.cyl(0.04, 0.05, len, 7), MARK, M.t(0, -0.03, len / 2, Math.PI / 2, 0, 0, 1, 1, 0.8));
  const g = subdivide(facet(b.build()), 0.026);
  return paintFaces(g, (x, y, z, _nx, _ny, _nz, m, i) => (m > 1.5 ? spot(x, y, z, 0.034, 0.3) : 1) * grain(i, 0.03));
}

/** Jaguar head: broad skull, heavy cheek ruffs, short muzzle with pale whisker pads, amber eyes, fangs. */
export function jaguarHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.068, 1), COAT, M.t(0, 0.022, 0.025, 0, 0, 0, 1.15, 0.85, 1.05));
  b.add(P.sphere(0.04, 1), COAT, M.t(0, 0.036, 0.062, 0, 0, 0, 1.3, 0.7, 0.9));
  b.add(P.sphere(0.04, 1), COAT, M.t(0, -0.004, 0.085, 0, 0, 0, 1.15, 0.75, 0.9));
  b.add(P.sphere(0.035, 1), MARK, M.t(0, -0.028, 0.035, 0, 0, 0, 1, 0.6, 1.1));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.036, 1), COAT, M.t(x * 0.046, -0.004, 0.035, 0, 0, 0, 1, 0.95, 1.1));
    b.add(P.sphere(0.022, 1), MARK, M.t(x * 0.019, -0.012, 0.104, 0, 0, 0, 1, 0.85, 0.8));
    b.add(P.sphere(0.012, 0), C(0xd8a030), M.t(x * 0.034, 0.03, 0.08));
    b.add(P.sphere(0.006, 0), C(0x120c08), M.t(x * 0.035, 0.031, 0.089));
    b.add(P.sphere(0.008, 0), MARK, M.t(x * 0.031, 0.018, 0.083, 0, 0, 0, 1.3, 0.6, 0.8));
    b.add(P.cone(0.0045, 0.016, 4), C(0xf2eadc), M.t(x * 0.016, -0.03, 0.108, Math.PI, 0, 0));
  }
  b.add(P.sphere(0.014, 0), C(0x6a3a30), M.t(0, 0.01, 0.12, 0, 0, 0, 1.3, 0.8, 0.8));
  b.add(P.box(0.05, 0.005, 0.05), C(0x3a1414), M.t(0, -0.028, 0.08));
  const g = subdivide(facet(b.build()), 0.017);
  return paintFaces(g, (x, y, z, _nx, ny, nz, m, i) => (m > 1.5 && (ny > 0.2 || nz < 0.4) ? spot(x, y, z, 0.021, 0.26) : 1) * grain(i, 0.03));
}

/** Jaguar lower jaw: pale chin, tongue and lower fangs. Pivot at the hinge. */
export function jaguarJaw(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.034, 1), MARK, M.t(0, -0.01, 0.042, 0, 0, 0, 1.05, 0.55, 1.25));
  b.add(P.box(0.03, 0.006, 0.05), C(0xc86070), M.t(0, -0.001, 0.045));
  for (const x of [-1, 1]) b.add(P.cone(0.004, 0.012, 4), C(0xf2eadc), M.t(x * 0.014, 0.004, 0.072));
  return facet(b.build());
}

/** Small round jaguar ear: dark back with a pale centre. Pivot at the base. */
export function jaguarEar(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.021, 0.024, 0.012, 7), C(0x241a12), M.t(0, 0.02, -0.002, Math.PI / 2, 0, 0));
  b.add(P.cyl(0.013, 0.015, 0.006, 7), MARK, M.t(0, 0.019, 0.005, Math.PI / 2, 0, 0));
  b.add(P.sphere(0.012, 0), COAT, M.t(0, 0.004, 0));
  return facet(b.build());
}

export const JAG_EAR = { pos: [0.052, 0.056, -0.005] as [number, number, number], rest: [0.1, 0.55] as [number, number] };

/** The three jaguar tail pieces: spotted at the base, ringed toward the black tip. */
export function jaguarTail(): THREE.BufferGeometry[] {
  const L = JAG_DIMS.tailLen;
  return [
    tailPiece(L[0], 0.027, 0.022, undefined, (x, y, z) => spot(x, y, z, 0.03, 0.3)),
    tailPiece(L[1], 0.022, 0.018, undefined, (x, y, z) => (z < -0.06 ? ((-z / 0.042) % 1 < 0.38 ? 0.16 : 1) : spot(x, y, z, 0.028, 0.3))),
    tailPiece(L[2], 0.018, 0.014, JAG_DARK, (_x, _y, z) => ((-z / 0.04) % 1 < 0.4 ? 0.16 : 1)),
  ];
}

// ---------------- Drawing ----------------

export interface QuadPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  scale: number;
  /** Gait cycle 0..1 (advanced by stepGait) and ground speed (drives gait blend, stride and lift). */
  gait: number;
  speed: number;
  /** Turning rate (rad/s, + = heading increasing): steps the feet round when turning on the spot, swings the tail. */
  yaw: number;
  /** Frame time for the springy follow-through (0 = hold). */
  dt: number;
  /** Spine bend into turns. */
  bend: number;
  sit: number;
  lie: number;
  /** Curled up asleep (on its side, nose to tail). */
  curl: number;
  /** Lying flat on its side, legs out (dead). */
  flat: number;
  crouch: number;
  lunge: number;
  limp: number;
  /** Play bow / stretch: elbows down, rump up. */
  bow: number;
  /** Shake-off: weight 0..1 and phase (radians, advanced by the caller); a roll wave running from the head to the tail. */
  shake: number;
  shakePh: number;
  /** Extra spine flex (+ arched / gathered, − extended). */
  spine: number;
  /** Rear-end wiggle (yaw of the hindquarters) with a hard wag. */
  wiggle: number;
  /** Extra neck pitch (+ lowers the neck). */
  neck: number;
  /** Head orientation: pitch is absolute (0 level, + nose down), yaw and roll relative to the body. */
  headPitch: number;
  headYaw: number;
  headRoll: number;
  jaw: number;
  /** Tongue lolled out (0..1), for rigs with a tongue. */
  tongue: number;
  /** Ear pitch offsets (left, right) and spread. */
  earL: number;
  earR: number;
  earYaw: number;
  /** Tail pitch (+ up) and yaw per segment, relative to the previous segment. */
  tailP: number[];
  tailY: number[];
  /** Breathing signal (chest swell). */
  breath: number;
  bob: number;
  /** One leg (0 LF, 1 RF, 2 LH, 3 RH) blended toward joint angles ov (relative: upper, lower, pastern, toe, then an outward swing of the whole leg) by ovW. */
  ovLeg: number;
  ovW: number;
  ov: number[];
}

export function blankPose(): QuadPose {
  return {
    x: 0, y: 0, z: 0, heading: 0, scale: 1, gait: 0, speed: 0, yaw: 0, dt: 0, bend: 0, sit: 0, lie: 0, curl: 0, flat: 0, crouch: 0, lunge: 0, limp: 0,
    bow: 0, shake: 0, shakePh: 0, spine: 0, wiggle: 0, neck: 0, headPitch: 0, headYaw: 0, headRoll: 0, jaw: 0, tongue: 0, earL: 0, earR: 0, earYaw: 0,
    tailP: [0, 0, 0, 0, 0, 0, 0, 0], tailY: [0, 0, 0, 0, 0, 0, 0, 0], breath: 0, bob: 0, ovLeg: -1, ovW: 0, ov: [0, 0, 0, 0, 0],
  };
}

export interface QuadKeys {
  /** Front and rear body pieces; with `M` (and dims spineJ) the body has a middle (loin) piece too. */
  F: string;
  R: string;
  M?: string;
  neck: string;
  /** Upper neck piece (with dims neckLen2). */
  neck2?: string;
  head: string;
  jaw?: string;
  tongue?: string;
  ear?: string;
  earPos?: [number, number, number];
  earRest?: [number, number];
  /** How soft the ears are (0 stiff and pricked … 1 floppy, swinging and hanging with gravity). */
  earSoft?: number;
  /** Tail pieces from the base. */
  tail: string[];
  /** Shoulder blades (with dims scap). */
  scap?: string;
  legUF: string;
  legLF: string;
  pawF: string;
  legUH: string;
  legLH: string;
  pawH: string;
  /** Toe pieces (with dims toeF / toeH): the paw then hinges at the ball of the foot. */
  toeF?: string;
  toeH?: string;
}

const TAIL_MAX = 8;

/**
 * Per-animal state for springy secondary motion: tail pieces that lag and whip behind the wag and
 * turns, ears that bounce with the stride and hang with gravity, a loose jaw and tongue. Keep one
 * per animal and pass it to drawQuad; set `ready = false` to snap back to rest (e.g. after the
 * animal has been off screen).
 */
export class QuadDyn {
  ready = false;
  /** Unwrapped heading, and the last heading seen. */
  yaw = 0;
  lastHeading = 0;
  /** Tail pieces: absolute pitch / yaw and their rates. */
  readonly tP = new Float64Array(TAIL_MAX);
  readonly tPv = new Float64Array(TAIL_MAX);
  readonly tY = new Float64Array(TAIL_MAX);
  readonly tYv = new Float64Array(TAIL_MAX);
  p0 = 0;
  y0 = 0;
  /** Ears: pitch (L, R) and outward flare (L, R), and their rates. */
  readonly ear = new Float64Array(4);
  readonly earV = new Float64Array(4);
  jaw = 0;
  jawV = 0;
  tng = 0;
  tngV = 0;
  /** Head height, pitch and roll with their rates and accelerations; ground speed and its rate. */
  hy = 0;
  hvy = 0;
  hay = 0;
  hp = 0;
  hvp = 0;
  hap = 0;
  hr = 0;
  hvr = 0;
  har = 0;
  v = 0;
  av = 0;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function compose(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1, sy = s, sz = s): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(s, sy, sz));
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const frac = (x: number) => x - Math.floor(x);
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapPi = (a: number) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};

/** Instanced meshes for the rig parts, tinted per animal through the accent (coat) and optional marking colours. */
export class QuadMeshes {
  readonly group = new THREE.Group();
  private meshes = new Map<string, { mesh: THREE.InstancedMesh; acc: THREE.InstancedBufferAttribute; n: number; marks: boolean }>();

  /** `marks`: the part has mat-1 markings tinted by a second per-instance colour (see put). */
  add(key: string, geo: THREE.BufferGeometry, cap: number, marks = false): void {
    const acc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    acc.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAccent', acc);
    const mesh = new THREE.InstancedMesh(geo, peopleMaterial(), cap);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (marks) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    this.meshes.set(key, { mesh, acc, n: 0, marks });
    this.group.add(mesh);
  }

  begin(): void {
    for (const e of this.meshes.values()) e.n = 0;
  }

  put(key: string, m: THREE.Matrix4, col: THREE.Color, mark?: THREE.Color): void {
    const e = this.meshes.get(key);
    if (!e || e.n >= e.mesh.instanceMatrix.count) return;
    e.mesh.setMatrixAt(e.n, m);
    e.acc.setXYZ(e.n, col.r, col.g, col.b);
    if (e.marks) {
      const c = mark ?? col;
      e.mesh.instanceColor!.setXYZ(e.n, c.r, c.g, c.b);
    }
    e.n++;
  }

  end(): void {
    for (const e of this.meshes.values()) {
      e.mesh.count = e.n;
      e.mesh.visible = e.n > 0;
      if (e.n) {
        e.mesh.instanceMatrix.needsUpdate = true;
        e.acc.needsUpdate = true;
        if (e.marks) e.mesh.instanceColor!.needsUpdate = true;
      }
    }
  }
}

const _W = new THREE.Matrix4(), _Mid = new THREE.Matrix4(), _F = new THREE.Matrix4(), _R = new THREE.Matrix4(), _N = new THREE.Matrix4(), _N2 = new THREE.Matrix4();
const _H = new THREE.Matrix4(), _J = new THREE.Matrix4(), _T = new THREE.Matrix4(), _L = new THREE.Matrix4(), _O = new THREE.Matrix4(), _A = new THREE.Matrix4();
const _Hp = new THREE.Matrix4(), _Inv = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _off = [0, 0, 0, 0];
const _ik = [0, 0];
/** Per-leg gait targets in the heading frame: toe tip (x, y, z), pastern angle, toe angle, load. */
const _tx = [0, 0, 0, 0], _ty = [0, 0, 0, 0], _tz = [0, 0, 0, 0], _tp = [0, 0, 0, 0], _tt = [0, 0, 0, 0], _ld = [0, 0, 0, 0];
/** Relative tail angles actually drawn. */
const _rp = new Float64Array(TAIL_MAX), _ry = new Float64Array(TAIL_MAX);

/**
 * Two-bone IK in a leg's sagittal plane. Angles are about x, with 0 hanging straight down and
 * + swinging back. sign +1 bends the middle joint backward (elbow), -1 forward (stifle).
 */
function ik2(hy: number, hz: number, ty: number, tz: number, l1: number, l2: number, sign: number): void {
  const dy = ty - hy, dz = tz - hz;
  const line = Math.atan2(-dz, -dy);
  const d = clamp(Math.hypot(dy, dz), Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.999);
  const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const t1 = line + sign * a;
  const ey = hy - l1 * Math.cos(t1), ez = hz - l1 * Math.sin(t1);
  const cy = hy - d * Math.cos(line), cz = hz - d * Math.sin(line);
  _ik[0] = t1;
  _ik[1] = Math.atan2(-(cz - ez), -(cy - ey));
}

/** Leg joint angles (relative: upper, lower, pastern, toe) lying flat on the side, legs out (dead). */
const FLAT_F = [0.35, -0.15, -0.2, 0.3], FLAT_H = [-0.3, 0.4, -0.3, 0.3];

/** The shake-off roll wave at a lag of `lag` radians behind the head. */
const shk = (p: QuadPose, lag: number) => (p.shake > 0 ? p.shake * Math.sin(p.shakePh - lag) : 0);

/** Distance covered per gait cycle at this speed (unscaled; world distance is this times the animal's scale). */
export function cycleLen(q: QuadDims, speed: number): number {
  const trot = smooth(q.trotV[0], q.trotV[1], speed), gal = smooth(q.gallopV[0], q.gallopV[1], speed);
  const slow = q.slowStride ?? 1;
  const crawl = slow + (1 - slow) * smooth(0, q.trotV[0], speed);
  return q.stride * crawl * (1 + (q.trotK ?? 0.2) * trot) * (1 + (q.gallopK / 1.2 - 1) * gal);
}

/** Speed that drives the gait cycle: ground speed plus stepping round while turning. */
export function gaitSpeed(q: QuadDims, speed: number, yaw: number, scale = 1): number {
  return speed + Math.abs(yaw) * (q.turnR ?? 0) * scale;
}

/** Pose and draw one animal. `headScale` enlarges the head (puppies); `mark` tints the markings; `dyn` adds springy follow-through. */
export function drawQuad(out: QuadMeshes, keys: QuadKeys, q: QuadDims, p: QuadPose, col: THREE.Color, headScale = 1, mark?: THREE.Color, dyn?: QuadDyn): void {
  const s = p.scale, L = q.hipY, v = p.speed, w = p.yaw || 0;
  const ve = gaitSpeed(q, v, w, s);
  const g = p.gait, G = g * TAU;
  const lie = Math.max(p.lie, p.flat), flat = p.flat, curl = p.curl * (1 - flat);
  const sit = p.sit * (1 - lie), crouch = p.crouch * (1 - lie), lunge = p.lunge * (1 - lie);
  const bow = (p.bow || 0) * (1 - lie) * (1 - sit);
  const trot = smooth(q.trotV[0], q.trotV[1], v), gal = smooth(q.gallopV[0], q.gallopV[1], v);
  // Locomotion weight: fades in with speed (or turning), out when sitting, lying or bowing.
  const mv = smooth(0.02, 0.3, ve) * (1 - lie) * (1 - sit) * (1 - bow);
  const walkW = mv * (1 - trot) * (1 - gal), trotW = mv * trot * (1 - gal), galW = mv * gal;
  const beta = mix(mix(0.64, 0.46, trot), 0.36, gal);
  const S = beta * cycleLen(q, ve);
  // Stance sweep per unit of planted-paw velocity (stance lasts beta of a cycle).
  const kD = (S / Math.max(ve, 1e-3)) * mv;
  for (let k = 0; k < 4; k++) _off[k] = mix(mix(WALK[k], TROT[k], trot), GALLOP[k], gal);
  const three = !!(keys.M && q.spineJ);
  const jc = three ? q.spineJ![0] : 0, jp = three ? q.spineJ![1] : 0;
  const toes = !!(keys.toeF && keys.toeH && q.toeF && q.toeH);
  const padH = toes ? q.padH ?? 0 : 0;
  const sc = q.scap;

  // Rest shoulder (the lower end of the blade) and hip positions in body space, and the paws under them.
  let shY = L * q.frontK - q.spineY, shZ = q.zF;
  if (sc) {
    const ct = Math.cos(sc[5]);
    shY = sc[1] - sc[3] * ct * Math.cos(sc[4]);
    shZ = sc[2] - sc[3] * ct * Math.sin(sc[4]);
  }
  const hpY = L * q.hindK - q.spineY;
  const nzF = shZ + q.footF * L, nzH = q.zR + q.footH * L;
  const splay = L * 0.04;

  // ---- Gait targets for each paw (heading frame): stance sweeps back with the ground, swing lifts and reaches ----
  const clear = q.clear * L * (1 + 0.4 * trot + 0.6 * gal) * (1 + 0.3 * crouch);
  for (let k = 0; k < 4; k++) {
    const isF = k < 2, side = k % 2 === 0 ? 1 : -1;
    const l4 = toes ? L * (isF ? q.toeF! : q.toeH!) : 0;
    const nx = side * (q.x + splay), nz = isF ? nzF : nzH;
    // A planted paw moves against the body's motion: back at ground speed, and round when turning.
    const dx = -w * nz * s * kD, dz = (w * nx * s - v) * kD;
    const tp0 = isF ? q.pawF : q.pawH;
    const push = isF ? 0.95 : 0.75, roll = (isF ? 0.9 : 0.75) * (1 + 0.3 * gal);
    let tx = nx, ty = padH, tz = nz + l4, tp = tp0, tt = 0, ld = 0;
    const ph = frac(g + _off[k]);
    if (ph < beta) {
      // Stance: the toe tip stays put; the wrist / fetlock gives under load, then the heel rolls up to push off.
      const u = ph / beta;
      tx += dx * (u - 0.5);
      tz += dz * (u - 0.5);
      ld = mv * Math.sin(Math.PI * u);
      tp += mv * ((isF ? -0.12 : -0.05) * Math.sin(Math.PI * u) + push * smooth(0.5, 1, u) - (isF ? 0.1 : 0.15) * (1 - smooth(0, 0.3, u)));
      if (toes) tt = mv * roll * smooth(0.6, 1, u);
    } else {
      // Swing: lift early, fold the wrist (the paw flips up behind) or trail the hind paw, reach, set down flat.
      const u = (ph - beta) / (1 - beta);
      const e = u - Math.sin(TAU * u) / TAU;
      tx += dx * (0.5 - e);
      tz += dz * (0.5 - e);
      ty += mv * clear * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.8);
      const tpEnd = tp0 + push;
      let sw: number;
      if (isF) {
        sw = mix(mix(tpEnd, 1.45 + 0.25 * gal, smooth(0, 0.3, u)), tp0 - 0.3, smooth(0.35, 0.8, u));
        sw = mix(sw, tp0 - 0.1, smooth(0.82, 1, u));
      } else {
        sw = mix(mix(tpEnd, 0.5 + 0.2 * gal, smooth(0, 0.3, u)), tp0 - 0.25, smooth(0.4, 0.85, u));
        sw = mix(sw, tp0 - 0.15, smooth(0.85, 1, u));
      }
      tp = mix(tp0, sw, mv);
      if (toes) {
        // Toes curl through the swing, then open flat for touchdown.
        const a4 = mix(roll - tpEnd, -tp0 + (isF ? 0.7 : 0.5), smooth(0, 0.3, u));
        tt = mv * mix(sw + a4, 0, smooth(0.55, 0.92, u));
      }
    }
    _tx[k] = tx;
    _ty[k] = ty;
    _tz[k] = tz;
    _tp[k] = tp;
    _tt[k] = tt;
    _ld[k] = ld;
  }

  // ---- Body: height, pitch, roll, sway and spine flex from the gait and the posture weights ----
  const meanLd = (4 * beta) / Math.PI;
  const ldF = _ld[0] + _ld[1];
  const Sn = Math.max(S, 1e-3);
  const lF = toes ? L * q.toeF! : 0, lH = toes ? L * q.toeH! : 0;
  // Gathered (+: hind paws forward, fore paws back) or stretched out (−), from where the paws actually are.
  const gather = clamp((_tz[2] + _tz[3] - 2 * (nzH + lH) - (_tz[0] + _tz[1] - 2 * (nzF + lF))) / (2 * Sn), -1.2, 1.2);
  const bob =
    walkW * L * 0.016 * Math.cos(2 * (G - TAU * 0.32)) -
    trotW * L * 0.028 * Math.cos(2 * (G - TAU * 0.98)) +
    galW * L * (0.04 * Math.cos(G - TAU * 0.6) + 0.012 * Math.cos(2 * (G - TAU * 0.1)));
  const bodyH = q.spineY - lie * (q.spineY - q.lieY * L) - crouch * q.crouchDrop * L - sit * L * 0.35 + lunge * L * 0.14 - bow * L * 0.32 + bob - (p.shake || 0) * L * 0.05 - flat * L * 0.16;
  const pitch = -0.62 * sit - 0.22 * lunge + crouch * 0.03 + bow * 0.45 - galW * 0.07 * Math.cos(G - TAU * 0.37) + trotW * 0.015 * Math.sin(2 * G);
  const lean = -p.bend * Math.min(1, v * 0.5) * 0.6;
  const roll = lean + lie * 0.06 + curl * 0.35 + flat * 1.4;
  const flex = p.spine + (galW * (q.flexK ?? 0.2) + trotW * 0.03) * gather - crouch * 0.04 - lunge * 0.22 - bow * 0.12;
  // Weight shift toward the supporting legs; shoulders and hips roll and swing with their own legs.
  const sway = (walkW + 0.35 * trotW) * L * (q.swayK ?? 0) * (_ld[0] + _ld[2] - _ld[1] - _ld[3]);
  const rollF = (walkW * 0.05 + trotW * 0.03) * (_ld[0] - _ld[1]), rollR = (walkW * 0.06 + trotW * 0.035) * (_ld[2] - _ld[3]);
  const yawF = -(walkW * 0.07 + trotW * 0.025) * (_tz[0] - _tz[1]) / Sn, yawR = -(walkW * 0.08 + trotW * 0.03) * (_tz[2] - _tz[3]) / Sn;
  // Looking round while standing curves the whole spine a little.
  const look = p.headYaw * (1 - mv) * (three ? 0.14 : 0);
  const kf = three ? 0.6 : 1;
  const flexC = flex * kf, flexP = flex * kf;
  const yawC = p.bend * 0.5 + yawF + curl * (three ? 0.62 : 0.5) + look;
  const yawP = -p.bend * 0.5 + yawR - curl * (three ? 0.62 : 0.55) + p.wiggle - look * 0.5;
  compose(_W, p.x, p.y + p.bob, p.z, 0, p.heading, 0, s);
  compose(_Mid, sway, bodyH, 0, pitch, 0, roll + 0.35 * shk(p, 1.8));
  _F.multiplyMatrices(_Mid, compose(_T, 0, 0, jc, flexC, yawC, rollF + 0.45 * shk(p, 1.2)));
  _R.multiplyMatrices(_Mid, compose(_T, 0, 0, jp, -flexP, yawP, rollR + 0.3 * shk(p, 2.4)));
  const br = p.breath;
  out.put(keys.F, _O.multiplyMatrices(_W, _L.multiplyMatrices(_F, compose(_T, 0, 0, 0, 0, 0, 0, 1 + br * 0.5, 1 + br, 1))), col, mark);
  if (three) out.put(keys.M!, _O.multiplyMatrices(_W, _Mid), col, mark);
  out.put(keys.R, _O.multiplyMatrices(_W, _R), col, mark);

  // ---- Neck and head: the head nods as each forefoot takes the weight and stays level against the body ----
  const nod = (walkW * 0.07 + trotW * 0.05 + galW * 0.05) * (ldF - meanLd) + p.limp * mv * 0.12 * (_ld[0] - 0.4);
  const dN = p.neck + 0.35 * sit + 0.15 * crouch - 0.2 * lunge + galW * (0.12 + 0.05 * Math.cos(G - TAU * 0.37)) + nod * 0.4 + lie * 0.25 + curl * 0.3 - bow * 0.55;
  const two = !!(keys.neck2 && q.neckLen2);
  const hy = p.headYaw;
  const n1 = q.neckPitch + dN * (two ? 0.62 : 1);
  _N.multiplyMatrices(_F, compose(_T, q.neck[0], q.neck[1], q.neck[2] - jc, n1, hy * (two ? 0.3 : 0.45) + p.bend * 0.3 + curl * (two ? 0.5 : 0.6), two ? 0.3 * shk(p, 0.7) : 0));
  out.put(keys.neck, _O.multiplyMatrices(_W, _N), col, mark);
  let absP = pitch + flexC + n1, headLen = q.neckLen;
  let hpar = _N;
  if (two) {
    const n2 = q.neckPitch2! + dN * 0.5;
    _N2.multiplyMatrices(_N, compose(_T, 0, 0, q.neckLen, n2, hy * 0.3 + p.bend * 0.1 + curl * 0.45, 0.3 * shk(p, 0.35)));
    out.put(keys.neck2!, _O.multiplyMatrices(_W, _N2), col, mark);
    absP += n2;
    headLen = q.neckLen2!;
    hpar = _N2;
  }
  const headPAbs = p.headPitch + nod;
  const hRoll = p.headRoll - curl * 0.3 + 0.9 * shk(p, 0);
  _H.multiplyMatrices(hpar, compose(_T, 0, 0, headLen, headPAbs - absP, hy * (two ? 0.3 : 0.55) + p.bend * 0.2 + curl * (two ? 0.3 : 0.4), hRoll, headScale));
  out.put(keys.head, _O.multiplyMatrices(_W, _H), col, mark);

  // ---- Secondary motion (tail, ears, jaw, tongue) ----
  const soft = keys.earSoft ?? 0;
  const nT = Math.min(keys.tail.length, TAIL_MAX);
  const shT = 0.7 * shk(p, 3.2);
  const baseP = pitch - flexP + p.tailP[0], baseY = yawP + p.tailY[0] + shT;
  if (dyn && p.dt > 0) stepDyn(dyn, p, keys, q, nT, baseP, baseY, _O.elements[13], headPAbs, hRoll + roll, soft);
  _rp[0] = p.tailP[0];
  _ry[0] = p.tailY[0] + shT;
  for (let i = 1; i < nT; i++) {
    if (dyn && dyn.ready) {
      _rp[i] = dyn.tP[i] - dyn.tP[i - 1];
      _ry[i] = dyn.tY[i] - dyn.tY[i - 1];
    } else {
      _rp[i] = p.tailP[i];
      _ry[i] = p.tailY[i];
    }
  }

  if (keys.jaw) {
    const jaw = Math.max(-0.02, p.jaw + (dyn && dyn.ready ? dyn.jaw : 0));
    _J.multiplyMatrices(_H, compose(_T, 0, q.jaw[0], q.jaw[1], jaw, 0, 0));
    out.put(keys.jaw, _O.multiplyMatrices(_W, _J), col, mark);
    const t = p.tongue || 0;
    if (keys.tongue && t > 0.02) {
      const tb = dyn && dyn.ready ? dyn.tng : 0;
      _L.multiplyMatrices(_J, compose(_T, 0, 0.0015, 0.022 + 0.012 * t, 0.12 + 0.28 * t + tb, 0, 0, 1, 1, 0.42 + 0.42 * t));
      out.put(keys.tongue, _O.multiplyMatrices(_W, _L), col, mark);
    }
  }
  if (keys.ear && keys.earPos && keys.earRest) {
    const ep = keys.earPos, er = keys.earRest;
    for (let si = 0; si < 2; si++) {
      const side = si ? -1 : 1;
      let pit = er[0] + (side > 0 ? p.earL : p.earR), fl = 0;
      if (dyn && dyn.ready) {
        pit = dyn.ear[si];
        fl = dyn.ear[2 + si];
      }
      _J.multiplyMatrices(_H, compose(_T, side * ep[0], ep[1], ep[2], pit, side * p.earYaw, side * (fl - er[1])));
      out.put(keys.ear, _O.multiplyMatrices(_W, _J), col, mark);
    }
  }

  // ---- Tail ----
  _J.multiplyMatrices(_R, compose(_T, q.tail[0], q.tail[1], q.tail[2] - jp, _rp[0], _ry[0], 0));
  for (let i = 0; i < nT; i++) {
    if (i > 0) _J.multiply(compose(_T, 0, 0, -q.tailLen[i - 1], _rp[i], _ry[i], 0));
    out.put(keys.tail[i], _O.multiplyMatrices(_W, _J), col, mark);
  }

  // ---- Legs: posture targets blended over the gait targets, then IK from the shoulder / hip ----
  for (let k = 0; k < 4; k++) {
    const isF = k < 2, side = k % 2 === 0 ? 1 : -1;
    const seg = isF ? q.segF : q.segH;
    const l1 = L * seg[0], l2 = L * seg[1], l3 = L * seg[2], l4 = toes ? L * (isF ? q.toeF! : q.toeH!) : 0;
    const tp0 = isF ? q.pawF : q.pawH;
    const tzN = (isF ? nzF : nzH) + l4;
    let tx = _tx[k], ty = _ty[k], tz = _tz[k], tp = _tp[k], tt = _tt[k];
    // Joint frame: the lower end of the shoulder blade (which rocks with the leg), or the hip.
    if (isF) {
      if (sc) {
        const sig = sc[4] - 0.6 * clamp((tz - tzN) / L, -0.75, 0.75) - 0.25 * bow - 0.15 * lie + 0.1 * sit - 0.3 * lunge;
        _A.multiplyMatrices(_F, compose(_T, side * sc[0], sc[1], sc[2] - jc, sig, 0, side * sc[5]));
        if (keys.scap) out.put(keys.scap, _O.multiplyMatrices(_W, _A), col, mark);
        _Hp.multiplyMatrices(_A, compose(_T, 0, -sc[3], 0, 0, 0, 0));
      } else _Hp.multiplyMatrices(_F, compose(_T, side * q.x, L * q.frontK - q.spineY, q.zF - jc, 0, 0, 0));
    } else _Hp.multiplyMatrices(_R, compose(_T, side * q.x, hpY, q.zR - jp, 0, 0, 0));
    const he = _Hp.elements;
    const Sz = he[14], phi = Math.atan2(he[6], he[5]);
    if (sit > 0) {
      if (isF) {
        tz = mix(tz, tzN + 0.1 * L, sit);
        ty = mix(ty, padH, sit);
        tp = mix(tp, tp0, sit);
        tt = mix(tt, 0, sit);
      } else {
        // Sitting: hocks down on the ground under the hips, hind feet flat ahead of them.
        tx = mix(tx, side * (q.x + splay + 0.012), sit);
        tz = mix(tz, Sz - 0.08 * L + l3 + l4, sit);
        ty = mix(ty, padH, sit);
        tp = mix(tp, -HALF_PI + 0.04, sit);
        tt = mix(tt, 0, sit);
      }
    }
    const lw = lie * (1 - flat);
    const down = isF ? Math.max(lw, bow) : lw;
    if (down > 0) {
      // Lying (sphinx) and the play bow: elbows on the ground, forearms and paws flat out in front;
      // hind legs folded beside the belly, hocks and feet flat.
      let X: number, Z: number, Tp: number, Tt: number;
      if (isF) {
        X = side * (q.x + splay * 0.5);
        Z = Sz - 0.2 * l1 + l2 + l3 + l4;
        Tp = -HALF_PI;
        Tt = 0;
      } else {
        X = side * (q.x + splay + L * 0.18);
        Z = Sz - 0.09 * L + l3 + l4;
        Tp = -HALF_PI;
        Tt = 0;
      }
      tx = mix(tx, X, down);
      tz = mix(tz, Z, down);
      ty = mix(ty, padH, down);
      tp = mix(tp, Tp, down);
      tt = mix(tt, Tt, down);
    }
    if (lunge > 0) {
      if (isF) {
        // Lunging: forelegs reach out, paws spread.
        tz = mix(tz, Sz + 0.95 * L, lunge);
        ty = mix(ty, 0.3 * L, lunge);
        tp = mix(tp, -0.3, lunge);
        tt = mix(tt, 0.3, lunge);
      } else {
        // Hind paws drive back.
        tz -= lunge * 0.55 * L;
        tp += lunge * 0.7;
        tt += lunge * 0.6;
      }
    }
    if (k === 1 && p.limp > 0) {
      // Injured: the right foreleg is held up off the ground, paw dangling.
      ty = mix(ty, 0.36 * L + padH, p.limp);
      tz = mix(tz, tzN + 0.04 * L, p.limp);
      tp = mix(tp, 1.45, p.limp);
      tt = mix(tt, 2.0, p.limp);
    }
    tx += side * crouch * L * 0.07;
    // From the toe tip back up the paw: ball of the foot, then the wrist / hock.
    const by = ty + l4 * Math.sin(tt), bz = tz - l4 * Math.cos(tt);
    const wy = by + l3 * Math.cos(tp), wz = bz + l3 * Math.sin(tp);
    _v.set(tx, wy, wz).applyMatrix4(_Inv.copy(_Hp).invert());
    let r = clamp(Math.atan2(_v.x, Math.max(-_v.y, 0.02)), -0.6, 0.6);
    const yr = -_v.x * Math.sin(r) + _v.y * Math.cos(r);
    ik2(0, 0, yr, _v.z, l1, l2, isF ? 1 : -1);
    let a1 = _ik[0], a2 = _ik[1] - _ik[0], a3 = tp - phi - _ik[1], a4 = tt - tp, ovYaw = 0;
    if (flat > 0) {
      const Fp = isF ? FLAT_F : FLAT_H;
      a1 = mix(a1, Fp[0], flat);
      a2 = mix(a2, Fp[1], flat);
      a3 = mix(a3, Fp[2], flat);
      a4 = mix(a4, Fp[3], flat);
      r = mix(r, side * 0.1, flat);
    }
    if (k === p.ovLeg && p.ovW > 0) {
      const ov = p.ov;
      a1 = mix(a1, ov[0], p.ovW);
      a2 = mix(a2, ov[1], p.ovW);
      a3 = mix(a3, ov[2], p.ovW);
      a4 = mix(a4, ov[3] ?? 0, p.ovW);
      ovYaw = side * (ov[4] ?? 0) * p.ovW;
    }
    _L.multiplyMatrices(_Hp, compose(_T, 0, 0, 0, 0, ovYaw, r));
    _L.multiply(compose(_T, 0, 0, 0, a1, 0, 0));
    out.put(isF ? keys.legUF : keys.legUH, _O.multiplyMatrices(_W, _L), col, mark);
    _L.multiply(compose(_T, 0, -l1, 0, a2, 0, 0));
    out.put(isF ? keys.legLF : keys.legLH, _O.multiplyMatrices(_W, _L), col, mark);
    _L.multiply(compose(_T, 0, -l2, 0, a3, 0, 0));
    out.put(isF ? keys.pawF : keys.pawH, _O.multiplyMatrices(_W, _L), col, mark);
    if (toes) {
      _L.multiply(compose(_T, 0, -l3, 0, a4, 0, 0));
      out.put(isF ? keys.toeF! : keys.toeH!, _O.multiplyMatrices(_W, _L), col, mark);
    }
  }
}

/**
 * Advance the springs: head motion is differentiated to drive the ears (which also hang with
 * gravity when soft), a loose jaw and tongue; each tail piece chases its target angle relative to
 * the piece before, with damping against that piece's motion, so wags and turns whip down the tail.
 */
function stepDyn(d: QuadDyn, p: QuadPose, keys: QuadKeys, q: QuadDims, nT: number, baseP: number, baseY: number, headY: number, headP: number, headR: number, soft: number): void {
  const dt = Math.min(p.dt, 0.1), s = p.scale;
  const er = keys.earRest;
  const e0 = er ? er[0] : 0;
  if (!d.ready) {
    d.lastHeading = p.heading;
    d.yaw = p.heading;
    d.hy = headY;
    d.hp = headP;
    d.hr = headR;
    d.v = p.speed;
    d.hvy = d.hay = d.hvp = d.hap = d.hvr = d.har = d.av = 0;
    let ap = baseP, ay = d.yaw + baseY;
    d.tP[0] = ap;
    d.tY[0] = ay;
    for (let i = 1; i < nT; i++) {
      ap += p.tailP[i];
      ay += p.tailY[i];
      d.tP[i] = ap;
      d.tY[i] = ay;
      d.tPv[i] = d.tYv[i] = 0;
    }
    d.p0 = baseP;
    d.y0 = d.yaw + baseY;
    d.ear[0] = e0 + p.earL - soft * 0.7 * headP;
    d.ear[1] = e0 + p.earR - soft * 0.7 * headP;
    d.ear[2] = -soft * 0.7 * headR;
    d.ear[3] = soft * 0.7 * headR;
    d.earV.fill(0);
    d.jaw = d.jawV = d.tng = d.tngV = 0;
    d.ready = true;
    return;
  }
  d.yaw += wrapPi(p.heading - d.lastHeading);
  d.lastHeading = p.heading;
  // Head kinematics (lightly smoothed rates and accelerations; world heights over scale).
  const vy = (headY - d.hy) / dt / s, vp = (headP - d.hp) / dt, vr = (headR - d.hr) / dt;
  d.hay = mix(d.hay, clamp((vy - d.hvy) / dt, -40, 40), 0.5);
  d.hap = mix(d.hap, clamp((vp - d.hvp) / dt, -200, 200), 0.5);
  d.har = mix(d.har, clamp((vr - d.hvr) / dt, -300, 300), 0.5);
  d.av = mix(d.av, clamp((p.speed - d.v) / dt / s, -30, 30), 0.3);
  d.hvy = vy;
  d.hvp = vp;
  d.hvr = clamp(vr, -30, 30);
  d.hy = headY;
  d.hp = headP;
  d.hr = headR;
  d.v = p.speed;
  const n = Math.min(14, Math.max(1, Math.ceil(dt / 0.007))), h = dt / n;
  // Tail.
  const A0p = baseP, A0y = d.yaw + baseY;
  const v0p = (A0p - d.p0) / dt, v0y = (A0y - d.y0) / dt;
  // Ears: stiff pricked ears barely wobble; soft ears swing back with speed-ups, flap with the
  // stride (vertical head bounce), fling out in a shake and hang with gravity.
  const wE = mix(38, 11, soft), zE = mix(0.6, 0.18, soft);
  const tp0 = e0 + p.earL - soft * 0.7 * headP, tp1 = e0 + p.earR - soft * 0.7 * headP;
  const fBase = soft * (-12 * d.hay + 0.25 * d.hvr * d.hvr);
  const pBase = soft * (1.5 * d.av - 0.8 * d.hap);
  const open = clamp(p.jaw * 2.5, 0, 1);
  for (let j = 0; j < n; j++) {
    const f = (j + 1) / n;
    const pp = mix(d.p0, A0p, f), py = mix(d.y0, A0y, f);
    for (let i = 1; i < nT; i++) {
      const w = TAIL_W - 4 * (i - 1), z = TAIL_Z;
      const parP = i === 1 ? pp : d.tP[i - 1], parY = i === 1 ? py : d.tY[i - 1];
      const parVp = i === 1 ? v0p : d.tPv[i - 1], parVy = i === 1 ? v0y : d.tYv[i - 1];
      d.tPv[i] += (w * w * (parP + p.tailP[i] - d.tP[i]) - 2 * z * w * (d.tPv[i] - parVp)) * h;
      d.tYv[i] += (w * w * (parY + p.tailY[i] - d.tY[i]) - 2 * z * w * (d.tYv[i] - parVy)) * h;
      d.tP[i] += d.tPv[i] * h;
      d.tY[i] += d.tYv[i] * h;
      d.tP[i] = parP + p.tailP[i] + clamp(d.tP[i] - parP - p.tailP[i], -0.7, 0.7);
      d.tY[i] = parY + p.tailY[i] + clamp(d.tY[i] - parY - p.tailY[i], -0.7, 0.7);
    }
    for (let si = 0; si < 2; si++) {
      const side = si ? -1 : 1;
      const tgtP = si ? tp1 : tp0, tgtF = -side * soft * 0.7 * headR;
      d.earV[si] += (wE * wE * (tgtP - d.ear[si]) - 2 * zE * wE * d.earV[si] + pBase) * h;
      d.earV[2 + si] += (wE * wE * (tgtF - d.ear[2 + si]) - 2 * zE * wE * d.earV[2 + si] + fBase - side * soft * 0.8 * d.har) * h;
      d.ear[si] = tgtP + clamp(d.ear[si] + d.earV[si] * h - tgtP, -1.1, 1.1);
      d.ear[2 + si] = clamp(d.ear[2 + si] + d.earV[2 + si] * h, -0.7, 1.3);
    }
    d.jawV += (-784 * d.jaw - 19.6 * d.jawV + 3 * open * d.hay) * h;
    d.jaw = clamp(d.jaw + d.jawV * h, -0.1, 0.3);
    d.tngV += (-256 * d.tng - 7 * d.tngV + 7 * d.hay - 0.5 * d.hap) * h;
    d.tng = clamp(d.tng + d.tngV * h, -0.6, 0.6);
  }
  d.tP[0] = A0p;
  d.tY[0] = A0y;
  d.p0 = A0p;
  d.y0 = A0y;
  void q;
}

/** Tail spring stiffness (rad/s, base piece; each piece after is a little softer) and damping ratio. */
const TAIL_W = 46, TAIL_Z = 0.5;

/** Advance a gait cycle by distance travelled (and turning steps) so paws don't skate (stride grows with speed and size). */
export function stepGait(gait: number, speed: number, dt: number, q: QuadDims, scale = 1, yaw = 0): number {
  const v = gaitSpeed(q, speed, yaw, scale);
  return (gait + (v * dt) / (cycleLen(q, v) * scale)) % 1;
}

/** Smooth 0→1→0 envelope over [a, b] with ramps of length r. */
export function envelope(u: number, a: number, b: number, r = 0.35): number {
  return smooth(a, a + r, u) * (1 - smooth(b - r, b, u));
}

/** Deterministic 0..1 hash for idle-fidget choices. */
export function idleHash(a: number, b: number): number {
  return hash(a, b, 991);
}
