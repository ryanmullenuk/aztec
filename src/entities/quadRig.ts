import * as THREE from 'three';
import { GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { peopleMaterial } from '../render/materials';
import { splitBody } from './animalModels';

/**
 * A small jointed four-legged rig shared by dogs and jaguars: front and rear body halves with a
 * spine joint, a neck, a head with a hinged jaw and mobile ears, a jointed tail of up to three
 * pieces and three-segment legs. Legs are placed by two-bone IK onto gait-driven paw targets, so
 * planted paws stay put while the body moves over them (stride is tied to ground speed). A pose
 * adds blend weights for sitting, lying, curling up, crouching (stalking), lunging and limping.
 *
 * Vertices tagged mat 2 take the per-animal coat colour; mat 1 vertices are markings (cream
 * chest, pale belly, socks) tinted by a second per-animal colour, so one mesh serves plain,
 * tricolour and black-and-tan dogs, and golden or black jaguars.
 */

const TAU = Math.PI * 2;
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
}

export const DOG_DIMS: QuadDims = {
  spineY: 0.2, hipY: 0.165, frontK: 0.93, hindK: 0.92, x: 0.036, zF: 0.1, zR: -0.105, footF: -0.14, footH: -0.16,
  neck: [0, 0.035, 0.1], neckLen: 0.085, neckPitch: -0.75, jaw: [-0.004, 0.045], tail: [0, 0.032, -0.15], tailLen: [0.075, 0.07],
  segF: [0.4, 0.42, 0.2], segH: [0.42, 0.44, 0.26], r: 0.017, stride: 0.24, gallopK: 2.0, trotV: [0.95, 1.25], gallopV: [1.6, 2.1],
  crouchDrop: 0.3, lieY: 0.42, pawF: -0.25, pawH: -0.08, clear: 0.2,
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

// ---------------- Dog geometry ----------------

/** Dog body: deep chest, withers, tucked waist, rounded croup; cream chest bib and belly (markings). */
export function dogBodyHalves(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  const y0 = DOG_DIMS.spineY;
  b.add(P.sphere(0.066, 1), COAT, M.t(0, y0 - 0.012, 0.072, 0, 0, 0, 0.9, 1.22, 1.08));
  b.add(P.sphere(0.042, 1), COAT, M.t(0, y0 - 0.004, 0.125, 0, 0, 0, 0.95, 1.1, 0.9));
  for (const x of [-1, 1]) b.add(P.sphere(0.034, 1), COAT, M.t(x * 0.028, y0 + 0.024, 0.08, -0.4, 0, 0, 0.55, 1.35, 0.9));
  // Ribs narrowing to the waist; the underline tucks up toward the loin.
  b.add(P.cyl(0.056, 0.04, 0.13, 8), COAT, M.t(0, y0 + 0.004, -0.012, Math.PI / 2 + 0.14, 0, 0, 1, 1, 0.95));
  b.add(P.sphere(0.046, 1), COAT, M.t(0, y0 + 0.01, -0.07, 0, 0, 0, 0.92, 0.88, 1.15));
  b.add(P.sphere(0.055, 1), COAT, M.t(0, y0 + 0.006, -0.108, 0, 0, 0, 1.05, 1, 1));
  b.add(P.sphere(0.03, 1), COAT, M.t(0, y0 + 0.03, -0.145, 0, 0, 0, 1, 0.9, 1));
  // Markings: chest bib and belly strip.
  b.add(P.sphere(0.05, 1), MARK, M.t(0, y0 - 0.03, 0.118, 0, 0, 0, 0.8, 1.2, 0.75));
  b.add(P.sphere(0.04, 1), MARK, M.t(0, y0 - 0.055, 0.02, 0, 0, 0, 0.7, 0.4, 1.6));
  const g = facet(b.build());
  // Darker saddle along the back.
  paintFaces(g, (_x, y, _z, _nx, ny, _nz, m, i) => (m > 1.5 && ny > 0.5 && y > y0 + 0.025 ? 0.84 : 1) * grain(i, 0.04));
  return splitBody(g, y0);
}

/** Dog neck: pivot at its base inside the chest, running forward along +z to the head joint. */
export function dogNeck(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const len = DOG_DIMS.neckLen;
  b.add(P.sphere(0.04, 1), COAT, M.t(0, 0, 0, 0, 0, 0, 0.95, 1, 1));
  b.add(P.cyl(0.03, 0.04, len + 0.01, 7), COAT, M.t(0, 0, len / 2, Math.PI / 2, 0, 0, 1, 1, 0.95));
  b.add(P.sphere(0.031, 1), COAT, M.t(0, 0.002, len));
  // Cream throat.
  b.add(P.cyl(0.02, 0.028, len, 6), MARK, M.t(0, -0.016, len / 2, Math.PI / 2, 0, 0, 1, 1, 0.8));
  return paintFaces(facet(b.build()), (_x, _y, _z, _nx, ny, _nz, m, i) => (m > 1.5 && ny > 0.6 ? 0.86 : 1) * grain(i, 0.04));
}

/** Dog head (pivot at the neck joint): domed skull, stop, cheeks, muzzle, nose, eyes; ears and jaw are separate parts. */
export function dogHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.046, 1), COAT, M.t(0, 0.026, 0.024, 0, 0, 0, 0.95, 0.88, 1.1));
  b.add(P.sphere(0.022, 0), COAT, M.t(0, 0.05, -0.006));
  b.add(P.sphere(0.026, 1), COAT, M.t(0, 0.036, 0.058, 0, 0, 0, 1.15, 0.75, 0.9));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.024, 1), COAT, M.t(x * 0.024, 0.006, 0.046));
    // Eyes with a glint, tan "eyebrow" spots and cheek patches (markings).
    b.add(P.sphere(0.0085, 0), C(0x140e0a), M.t(x * 0.021, 0.04, 0.064));
    b.add(P.sphere(0.0025, 0), C(0xffffff), M.t(x * 0.023, 0.043, 0.071));
    b.add(P.sphere(0.007, 0), MARK, M.t(x * 0.018, 0.055, 0.061));
    b.add(P.sphere(0.016, 0), MARK, M.t(x * 0.022, 0.0, 0.06, 0, 0, 0, 1, 0.8, 1));
  }
  b.add(P.cyl(0.019, 0.026, 0.07, 7), MARK, M.t(0, 0.012, 0.09, Math.PI / 2, 0, 0, 1, 1, 0.82));
  b.add(P.sphere(0.0135, 0), C(0x1a1412), M.t(0, 0.021, 0.126, 0, 0, 0, 1.2, 0.9, 0.85));
  // Dark mouth roof, hidden by the jaw until it opens.
  b.add(P.box(0.026, 0.004, 0.056), C(0x3a1a1a), M.t(0, -0.001, 0.09));
  return paintFaces(facet(b.build()), (_x, _y, _z, _nx, _ny, _nz, _m, i) => grain(i, 0.035));
}

/** Lower jaw (pivot at the hinge) with tongue. */
export function dogJaw(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.012, 0.017, 0.074, 6), MARK, M.t(0, -0.006, 0.037, Math.PI / 2, 0, 0, 1, 1, 0.65));
  b.add(P.sphere(0.012, 0), MARK, M.t(0, -0.008, 0.07, 0, 0, 0, 1, 0.7, 1));
  b.add(P.box(0.017, 0.006, 0.055), C(0xd86a78), M.t(0, 0.001, 0.042));
  return facet(b.build());
}

/** Ears (pivot at the base): pricked triangles, or soft drop ears hanging from the top. */
export function dogEar(kind: 'prick' | 'floppy'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  if (kind === 'prick') {
    b.add(P.cone(0.021, 0.054, 4).rotateY(Math.PI / 4), coat(0.85), M.t(0, 0.025, 0, 0, 0, 0, 1, 1, 0.5));
    b.add(P.cone(0.013, 0.036, 4).rotateY(Math.PI / 4), C(0x9a6a60), M.t(0, 0.02, 0.006, 0, 0, 0, 1, 1, 0.35));
  } else {
    b.add(P.sphere(0.013, 0), coat(0.8), M.t(0, -0.004, 0));
    b.add(P.sphere(0.031, 1), coat(0.78), M.t(0, -0.03, 0.002, 0, 0, 0, 0.3, 1, 0.62));
  }
  return facet(b.build());
}

/** Ear placement and resting tilt (pitch, outward roll) for each ear type. */
export const DOG_EARS = {
  prick: { pos: [0.026, 0.06, 0.012] as [number, number, number], rest: [-0.12, 0.3] as [number, number] },
  floppy: { pos: [0.042, 0.05, 0.008] as [number, number, number], rest: [0.15, -0.3] as [number, number] },
};

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
  /** One leg (0 LF, 1 RF, 2 LH, 3 RH) blended toward joint angles ov (relative) by ovW. */
  ovLeg: number;
  ovW: number;
  ov: number[];
}

export function blankPose(): QuadPose {
  return {
    x: 0, y: 0, z: 0, heading: 0, scale: 1, gait: 0, speed: 0, bend: 0, sit: 0, lie: 0, curl: 0, flat: 0, crouch: 0, lunge: 0, limp: 0,
    spine: 0, wiggle: 0, neck: 0, headPitch: 0, headYaw: 0, headRoll: 0, jaw: 0, earL: 0, earR: 0, earYaw: 0,
    tailP: [0, 0, 0], tailY: [0, 0, 0], breath: 0, bob: 0, ovLeg: -1, ovW: 0, ov: [0, 0, 0],
  };
}

export interface QuadKeys {
  F: string;
  R: string;
  neck: string;
  head: string;
  jaw?: string;
  ear?: string;
  earPos?: [number, number, number];
  earRest?: [number, number];
  /** Tail pieces from the base. */
  tail: string[];
  legUF: string;
  legLF: string;
  pawF: string;
  legUH: string;
  legLH: string;
  pawH: string;
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
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
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

const _M = new THREE.Matrix4(), _F = new THREE.Matrix4(), _R = new THREE.Matrix4(), _N = new THREE.Matrix4(), _H = new THREE.Matrix4();
const _J = new THREE.Matrix4(), _T = new THREE.Matrix4(), _L = new THREE.Matrix4(), _D = new THREE.Matrix4();
const _off = [0, 0, 0, 0];
const _ik = [0, 0];

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

/** Joint poses relative to the body half: lying sphinx-style, and flat on the side (legs out). */
const LIE_F = [1.2, -2.7, -0.05], LIE_H = [-1.3, 2.75, -2.95];
const FLAT_F = [0.35, -0.15, -0.2], FLAT_H = [-0.3, 0.4, -0.3];

/** Distance covered per gait cycle at this speed (unscaled; world distance is this times the animal's scale). */
export function cycleLen(q: QuadDims, speed: number): number {
  const trot = smooth(q.trotV[0], q.trotV[1], speed), gal = smooth(q.gallopV[0], q.gallopV[1], speed);
  return q.stride * (1 + 0.2 * trot) * (1 + (q.gallopK / 1.2 - 1) * gal);
}

/** Pose and draw one animal. `headScale` enlarges the head (puppies); `mark` tints the markings. */
export function drawQuad(out: QuadMeshes, keys: QuadKeys, q: QuadDims, p: QuadPose, col: THREE.Color, headScale = 1, mark?: THREE.Color): void {
  const s = p.scale, L = q.hipY, v = p.speed;
  const g = p.gait, G = g * TAU;
  const lie = Math.max(p.lie, p.flat), flat = p.flat, curl = p.curl * (1 - flat);
  const sit = p.sit * (1 - lie), crouch = p.crouch * (1 - lie), lunge = p.lunge * (1 - lie);
  const trot = smooth(q.trotV[0], q.trotV[1], v), gal = smooth(q.gallopV[0], q.gallopV[1], v);
  // Locomotion weight: fades in with speed, out when sitting or lying.
  const mv = smooth(0.02, 0.3, v) * (1 - lie) * (1 - sit);
  const walkW = mv * (1 - trot) * (1 - gal), trotW = mv * trot * (1 - gal), galW = mv * gal;
  const beta = mix(mix(0.64, 0.46, trot), 0.36, gal);
  const S = beta * cycleLen(q, v);
  for (let k = 0; k < 4; k++) _off[k] = mix(mix(WALK[k], TROT[k], trot), GALLOP[k], gal);

  // ---- Body: height, pitch, roll and spine flex from the gait and the posture weights ----
  const bob =
    walkW * L * 0.016 * Math.cos(2 * (G - TAU * 0.32)) -
    trotW * L * 0.028 * Math.cos(2 * (G - TAU * 0.98)) +
    galW * L * (0.04 * Math.cos(G - TAU * 0.6) + 0.012 * Math.cos(2 * (G - TAU * 0.1)));
  const bodyH = q.spineY - lie * (q.spineY - q.lieY * L) - crouch * q.crouchDrop * L - sit * L * 0.35 + lunge * L * 0.14 + bob;
  const pitch = -0.62 * sit - 0.22 * lunge + crouch * 0.03 - galW * 0.07 * Math.cos(G - TAU * 0.37) + trotW * 0.015 * Math.sin(2 * G);
  const lean = -p.bend * Math.min(1, v * 0.5) * 0.6;
  const roll = lean + lie * 0.06 + curl * 0.3 + flat * 1.4;
  const flex = galW * 0.2 * Math.cos(G - TAU * 0.1) + p.spine - crouch * 0.04 - lunge * 0.22;
  // Shoulders and hips roll and swing with their own legs.
  const phF = (g + _off[0]) * TAU, phR = (g + _off[2]) * TAU;
  const rollF = (walkW * 0.05 + trotW * 0.03) * Math.sin(phF), rollR = -(walkW * 0.06 + trotW * 0.035) * Math.sin(phR);
  const yawF = p.bend * 0.5 + walkW * 0.06 * Math.cos(phF) + curl * 0.5;
  const yawR = -p.bend * 0.5 - walkW * 0.07 * Math.cos(phR) - curl * 0.55 + p.wiggle;
  compose(_M, p.x, p.y + bodyH * s + p.bob, p.z, pitch, p.heading, roll, s);
  _F.multiplyMatrices(_M, compose(_T, 0, 0, 0, flex, yawF, rollF));
  _R.multiplyMatrices(_M, compose(_T, 0, 0, 0, -flex, yawR, rollR));
  const br = p.breath;
  out.put(keys.F, _D.multiplyMatrices(_F, compose(_T, 0, 0, 0, 0, 0, 0, 1 + br * 0.5, 1 + br, 1)), col, mark);
  out.put(keys.R, _R, col, mark);

  // ---- Neck and head: the head nods with the forefeet and stays level against the body ----
  const nod = walkW * 0.05 * Math.cos(2 * (G - TAU * 0.3)) + trotW * 0.02 * Math.cos(2 * G) + p.limp * mv * 0.1 * Math.sin(phF + 1);
  const neckRel = q.neckPitch + p.neck + 0.35 * sit + 0.15 * crouch - 0.2 * lunge + galW * (0.12 + 0.05 * Math.cos(G - TAU * 0.37)) + nod * 0.4 + lie * 0.25 + curl * 0.3;
  const neckAbs = pitch + flex + neckRel;
  _N.multiplyMatrices(_F, compose(_T, q.neck[0], q.neck[1], q.neck[2], neckRel, p.headYaw * 0.45 + p.bend * 0.3 + curl * 0.6, 0));
  out.put(keys.neck, _N, col, mark);
  _H.multiplyMatrices(_N, compose(_T, 0, 0, q.neckLen, p.headPitch + nod - neckAbs, p.headYaw * 0.55 + p.bend * 0.2 + curl * 0.4, p.headRoll - curl * 0.3, headScale));
  out.put(keys.head, _H, col, mark);
  if (keys.jaw) out.put(keys.jaw, _J.multiplyMatrices(_H, compose(_T, 0, q.jaw[0], q.jaw[1], p.jaw, 0, 0)), col, mark);
  if (keys.ear && keys.earPos && keys.earRest) {
    const ep = keys.earPos, er = keys.earRest;
    for (let si = 0; si < 2; si++) {
      const side = si ? -1 : 1;
      _J.multiplyMatrices(_H, compose(_T, side * ep[0], ep[1], ep[2], er[0] + (side > 0 ? p.earL : p.earR), side * p.earYaw, -side * er[1]));
      out.put(keys.ear, _J, col, mark);
    }
  }

  // ---- Tail ----
  _J.multiplyMatrices(_R, compose(_T, q.tail[0], q.tail[1], q.tail[2], p.tailP[0], p.tailY[0], 0));
  for (let i = 0; i < keys.tail.length; i++) {
    if (i > 0) _J.multiply(compose(_T, 0, 0, -q.tailLen[i - 1], p.tailP[i], p.tailY[i], 0));
    out.put(keys.tail[i], _J, col, mark);
  }

  // ---- Legs: paw targets from the gait, two-bone IK, then posture blends ----
  const clear = q.clear * L * (1 + 0.4 * trot + 0.6 * gal) * (1 + 0.3 * crouch);
  for (let k = 0; k < 4; k++) {
    const isFront = k < 2, side = k % 2 === 0 ? 1 : -1;
    const seg = isFront ? q.segF : q.segH;
    const l1 = L * seg[0], l2 = L * seg[1], l3 = L * seg[2];
    const yA = L * (isFront ? q.frontK : q.hindK) - q.spineY, zA = isFront ? q.zF : q.zR;
    const phi = pitch + (isFront ? flex : -flex);
    const cph = Math.cos(phi), sph = Math.sin(phi);
    const hy = bodyH + yA * cph - zA * sph, hz = yA * sph + zA * cph;
    // Paw target in the heading frame (ground at y = 0).
    let fz = zA + (isFront ? q.footF : q.footH) * L, fy = 0;
    let tp = isFront ? q.pawF : q.pawH;
    const ph = (((g + _off[k]) % 1) + 1) % 1;
    if (ph < beta) {
      // Stance: the paw sweeps back at exactly ground speed; heel lifts toward push-off.
      const u = ph / beta;
      fz += mv * S * (0.5 - u);
      tp += mv * 0.7 * smooth(0.65, 1, u);
    } else {
      // Swing: lift with clearance, fold the paw back, reach forward and set down gently.
      const u = (ph - beta) / (1 - beta);
      const e = u - Math.sin(TAU * u) / TAU;
      fz += mv * S * (e - 0.5);
      fy = mv * clear * Math.pow(Math.sin(Math.PI * u), 0.8);
      tp = mix(tp, isFront ? 1.7 : 0.8, mv * Math.sin(Math.PI * Math.min(1, u * 1.15)));
    }
    if (!isFront) {
      // Sitting: hocks under the hips, hind paws flat on the ground ahead of them.
      fz = mix(fz, hz + 0.27 * L, sit);
      fy *= 1 - sit;
      tp = mix(tp, -1.42, sit);
      // Lunging: hind paws drive back.
      fz -= lunge * 0.55 * L;
      tp += lunge * 0.7;
    } else fz += sit * 0.05 * L;
    const wy = fy + l3 * Math.cos(tp), wz = fz + l3 * Math.sin(tp);
    ik2(hy, hz, wy, wz, l1, l2, isFront ? 1 : -1);
    let a1 = _ik[0] - phi, a2 = _ik[1] - _ik[0], a3 = tp - _ik[1];
    if (isFront) {
      // Lunging: forelegs reach out, paws spread.
      a1 = mix(a1, -1.35 - phi, lunge);
      a2 = mix(a2, -0.25, lunge);
      a3 = mix(a3, 0.3, lunge);
      if (k === 1 && p.limp > 0) {
        // Injured: the right foreleg is held up off the ground, paw dangling.
        a1 = mix(a1, -0.1, p.limp);
        a2 = mix(a2, -0.9, p.limp);
        a3 = mix(a3, 1.7, p.limp);
      }
    }
    if (lie > 0) {
      const Lp = isFront ? LIE_F : LIE_H, Fp = isFront ? FLAT_F : FLAT_H;
      const lf = flat / Math.max(lie, 1e-3);
      a1 = mix(a1, mix(Lp[0], Fp[0], lf), lie);
      a2 = mix(a2, mix(Lp[1], Fp[1], lf), lie);
      a3 = mix(a3, mix(Lp[2], Fp[2], lf), lie);
    }
    if (k === p.ovLeg && p.ovW > 0) {
      a1 = mix(a1, p.ov[0], p.ovW);
      a2 = mix(a2, p.ov[1], p.ovW);
      a3 = mix(a3, p.ov[2], p.ovW);
    }
    const half = isFront ? _F : _R;
    _L.multiplyMatrices(half, compose(_T, side * q.x, yA, zA, a1, 0, side * (0.03 + lie * 0.08)));
    out.put(isFront ? keys.legUF : keys.legUH, _L, col, mark);
    _L.multiply(compose(_T, 0, -l1, 0, a2, 0, 0));
    out.put(isFront ? keys.legLF : keys.legLH, _L, col, mark);
    _L.multiply(compose(_T, 0, -l2, 0, a3, 0, 0));
    out.put(isFront ? keys.pawF : keys.pawH, _L, col, mark);
  }
}

/** Advance a gait cycle by distance travelled so paws don't skate (stride grows with speed and size). */
export function stepGait(gait: number, speed: number, dt: number, q: QuadDims, scale = 1): number {
  return (gait + (speed * dt) / (cycleLen(q, speed) * scale)) % 1;
}

/** Smooth 0→1→0 envelope over [a, b] with ramps of length r. */
export function envelope(u: number, a: number, b: number, r = 0.35): number {
  return smooth(a, a + r, u) * (1 - smooth(b - r, b, u));
}

/** Deterministic 0..1 hash for idle-fidget choices. */
export function idleHash(a: number, b: number): number {
  return hash(a, b, 991);
}
