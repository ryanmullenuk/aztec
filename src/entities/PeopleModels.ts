import * as THREE from 'three';
import { GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { carriedChicken } from './animalModels';

/**
 * Faceted low-poly Aztec islanders, authored at human scale (metres, ~1.8 m tall) and
 * scaled into the world by the rig. Each body part is modelled in its bone's local space
 * (limbs hang down -y from the joint, the body faces +z).
 *
 * Material tags: 0 = fixed colour, 1 = skin (per-person tone), 2 = accent cloth (per-person colour).
 */

export const PAL = {
  cream: 0xefe0bf,
  creamDark: 0xd9c7a0,
  red: 0xb83a2c,
  redDark: 0x8e2a20,
  gold: 0xd9a521,
  goldDark: 0xa87a14,
  jade: 0x2fa58f,
  leather: 0x6b4226,
  sole: 0x4e321e,
  hair: 0x17100c,
  obsidian: 0x3a3a44,
  wood: 0x6e4428,
};

const SKIN = { color: 0xffffff, mat: 1 };
const ACC = { color: 0xffffff, mat: 2 };
const C = (c: number) => ({ color: c });

/** Joint offsets (metres) for each body type. */
export interface Skeleton {
  hipY: number;
  hipX: number;
  thigh: number;
  shin: number;
  chestY: number;
  neckY: number;
  shoulderX: number;
  shoulderY: number;
  upper: number;
  fore: number;
}

export const SKELETON: Record<'m' | 'f', Skeleton> = {
  m: { hipY: 0.95, hipX: 0.1, thigh: 0.45, shin: 0.44, chestY: 0.04, neckY: 0.56, shoulderX: 0.215, shoulderY: 0.47, upper: 0.3, fore: 0.27 },
  f: { hipY: 0.9, hipX: 0.095, thigh: 0.43, shin: 0.42, chestY: 0.04, neckY: 0.52, shoulderX: 0.175, shoulderY: 0.44, upper: 0.28, fore: 0.25 },
};

/** A faceted limb segment hanging down from its joint. */
function limb(b: GeoBuilder, r0: number, r1: number, len: number, seg = 6, z = 0.9): void {
  b.add(P.cyl(r1, r0, len, seg), SKIN, M.t(0, -len / 2, 0, 0, Math.PI / seg, 0, 1, 1, z));
  // Round the joint so bends don't open gaps.
  b.add(P.sphere(r0 * 1.02, 0), SKIN, M.t(0, 0, 0, 0, 0, 0, 1, 1, z));
}

/** Gold band with jade insets around a limb. */
function band(b: GeoBuilder, r: number, y: number, h: number, jade = true, accent = false): void {
  b.add(P.cyl(r, r, h, 8), accent ? ACC : C(PAL.gold), M.t(0, y, 0, 0, Math.PI / 8, 0));
  if (jade) {
    b.add(P.box(r * 0.7, h * 0.7, 0.02), C(PAL.jade), M.t(0, y, r + 0.004));
    b.add(P.box(r * 0.7, h * 0.7, 0.02), C(PAL.jade), M.t(0, y, -r - 0.004));
  }
}

/** A diamond-shaped faceted feather: base at the origin, pointing along +y. */
function feather(len: number, w: number): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(1, 0);
  g.scale(w / 2, len / 2, 0.012);
  g.translate(0, len / 2, 0);
  return g;
}

function chain(...ms: THREE.Matrix4[]): THREE.Matrix4 {
  const out = new THREE.Matrix4();
  for (const m of ms) out.multiply(m);
  return out;
}

// ---------------- Body parts ----------------

function pelvisM(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.155, 0.14, 0.16, 7), SKIN, M.t(0, -0.03, 0, 0, 0, 0, 1, 1, 0.72));
  // Red sash belt with a gold and jade buckle.
  b.add(P.cyl(0.168, 0.165, 0.08, 8), C(PAL.red), M.t(0, 0.04, 0, 0, Math.PI / 8, 0, 1, 1, 0.76));
  b.add(P.box(0.11, 0.085, 0.03), C(PAL.gold), M.t(0, 0.04, 0.128));
  b.add(P.box(0.055, 0.05, 0.03), C(PAL.jade), M.t(0, 0.04, 0.14));
  // Layered side flaps: teal (accent), red and cream, flaring out.
  const cols = [ACC, C(PAL.red), C(PAL.cream), ACC, C(PAL.red), ACC, C(PAL.cream)];
  for (let k = 0; k < 7; k++) {
    const a = 0.75 + (k / 6) * (Math.PI * 2 - 1.5);
    b.add(P.box(0.12, 0.26, 0.014), cols[k], chain(M.t(Math.sin(a) * 0.15, -0.14, Math.cos(a) * 0.115), M.t(0, 0, 0, 0, a, 0), M.t(0, 0, 0, -0.18, 0, 0)));
  }
  // Front panel (maxtlatl): cream with a red step-fret and a fringe.
  b.add(P.box(0.15, 0.36, 0.016), C(PAL.cream), M.t(0, -0.16, 0.13, -0.05, 0, 0));
  const fret: [number, number, number, number][] = [[-0.05, -0.1, 0.028, 0.16], [0, -0.03, 0.1, 0.026], [0.05, -0.08, 0.028, 0.1], [0.015, -0.13, 0.07, 0.026], [-0.01, -0.19, 0.026, 0.1], [0.02, -0.25, 0.08, 0.026], [0, -0.32, 0.15, 0.03]];
  for (const [x, y, w, h] of fret) b.add(P.box(w, h, 0.01), C(PAL.red), M.t(x, y, 0.14, -0.05, 0, 0));
  for (let k = 0; k < 5; k++) b.add(P.box(0.026, 0.05, 0.01), k % 2 ? C(PAL.red) : ACC, M.t(-0.056 + k * 0.028, -0.36, 0.148, -0.05, 0, 0));
  return facet(b.build());
}

function pelvisF(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.14, 0.165, 0.16, 7), SKIN, M.t(0, -0.02, 0, 0, 0, 0, 1, 1, 0.74));
  b.add(P.cyl(0.155, 0.16, 0.07, 8), C(PAL.red), M.t(0, 0.05, 0, 0, Math.PI / 8, 0, 1, 1, 0.76));
  b.add(P.box(0.08, 0.065, 0.03), C(PAL.gold), M.t(0, 0.05, 0.12));
  b.add(P.box(0.04, 0.04, 0.03), C(PAL.jade), M.t(0, 0.05, 0.132));
  // Knee-length layered skirt: cream wrap with teal and red over-panels, flaring out.
  const cols = [C(PAL.cream), ACC, C(PAL.cream), C(PAL.red), C(PAL.cream), ACC, C(PAL.cream), C(PAL.red), C(PAL.cream)];
  for (let k = 0; k < 9; k++) {
    const a = 0.45 + (k / 8) * (Math.PI * 2 - 0.9);
    const long = k % 2 === 0 ? 0.44 : 0.36;
    b.add(P.box(0.12, long, 0.014), cols[k], chain(M.t(Math.sin(a) * 0.16, -0.02 - long / 2, Math.cos(a) * 0.125), M.t(0, 0, 0, 0, a, 0), M.t(0, 0, 0, -0.2, 0, 0)));
  }
  // Red hem band on the cream wrap.
  for (let k = 0; k < 9; k += 2) {
    const a = 0.45 + (k / 8) * (Math.PI * 2 - 0.9);
    b.add(P.box(0.122, 0.035, 0.016), C(PAL.red), chain(M.t(Math.sin(a) * 0.205, -0.42, Math.cos(a) * 0.16), M.t(0, 0, 0, 0, a, 0), M.t(0, 0, 0, -0.2, 0, 0)));
  }
  // Front apron with the step-fret.
  b.add(P.box(0.13, 0.44, 0.016), C(PAL.cream), M.t(0, -0.2, 0.13, -0.12, 0, 0));
  b.add(P.box(0.034, 0.44, 0.012), C(PAL.red), M.t(-0.048, -0.2, 0.139, -0.12, 0, 0));
  const fret: [number, number, number, number][] = [[0.0, -0.06, 0.07, 0.024], [0.03, -0.11, 0.024, 0.1], [-0.005, -0.17, 0.07, 0.024], [0.02, -0.26, 0.05, 0.024]];
  for (const [x, y, w, h] of fret) b.add(P.box(w, h, 0.01), C(PAL.red), M.t(x, y, 0.141, -0.12, 0, 0));
  for (let k = 0; k < 4; k++) b.add(P.box(0.03, 0.05, 0.01), k % 2 ? C(PAL.red) : ACC, M.t(-0.045 + k * 0.03, -0.44, 0.19, -0.12, 0, 0));
  return facet(b.build());
}

function chestM(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const s = SKELETON.m;
  b.add(P.cyl(0.15, 0.13, 0.22, 6), SKIN, M.t(0, 0.11, 0, 0, Math.PI / 6, 0, 1, 1, 0.72));
  b.add(P.cyl(0.215, 0.155, 0.26, 6), SKIN, M.t(0, 0.34, 0, 0, Math.PI / 6, 0, 1, 1, 0.6));
  // Pecs and abs for the muscular, faceted look.
  for (const x of [-0.065, 0.065]) b.add(P.box(0.12, 0.09, 0.05), SKIN, M.t(x, 0.35, 0.095, 0.15, x * 1.5, 0));
  for (const [x, y] of [[-0.035, 0.2], [0.035, 0.2], [-0.035, 0.13], [0.035, 0.13]]) b.add(P.box(0.06, 0.06, 0.03), SKIN, M.t(x, y, 0.09));
  for (const x of [-s.shoulderX, s.shoulderX]) b.add(P.sphere(0.072, 0), SKIN, M.t(x, s.shoulderY, 0));
  b.add(P.cyl(0.055, 0.06, 0.12, 6), SKIN, M.t(0, 0.53, 0));
  collar(b, 0.105, 0.49, true);
  return facet(b.build());
}

function chestF(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const s = SKELETON.f;
  // Bare waist.
  b.add(P.cyl(0.12, 0.13, 0.2, 6), SKIN, M.t(0, 0.1, 0, 0, Math.PI / 6, 0, 1, 1, 0.72));
  // Cream crop top with crossing red bands and a teal hem.
  b.add(P.cyl(0.16, 0.135, 0.2, 7), C(PAL.cream), M.t(0, 0.31, 0, 0, 0, 0, 1, 1, 0.68));
  for (const x of [-0.055, 0.055]) b.add(P.sphere(0.065, 0), C(PAL.cream), M.t(x, 0.33, 0.07, 0, 0, 0, 1, 0.85, 0.9));
  b.add(P.cyl(0.14, 0.14, 0.03, 7), C(PAL.red), M.t(0, 0.215, 0, 0, 0, 0, 1, 1, 0.7));
  for (const r of [-0.5, 0.5]) b.add(P.box(0.03, 0.2, 0.012), C(PAL.red), M.t(0, 0.31, 0.118, 0, 0, r));
  b.add(P.box(0.2, 0.02, 0.01), ACC, M.t(0, 0.4, 0.105));
  // Shoulders, neck.
  b.add(P.cyl(0.12, 0.155, 0.1, 6), SKIN, M.t(0, 0.44, 0, 0, Math.PI / 6, 0, 1, 1, 0.6));
  for (const x of [-s.shoulderX, s.shoulderX]) b.add(P.sphere(0.055, 0), SKIN, M.t(x, s.shoulderY, 0));
  b.add(P.cyl(0.045, 0.05, 0.1, 6), SKIN, M.t(0, 0.5, 0));
  collar(b, 0.085, 0.465, false);
  return facet(b.build());
}

/** Gold plate collar with jade insets and a pendant. */
function collar(b: GeoBuilder, r: number, y: number, big: boolean): void {
  const n = big ? 9 : 7;
  for (let k = 0; k < n; k++) {
    const a = -1.35 + (k / (n - 1)) * 2.7;
    const x = Math.sin(a) * r, z = Math.cos(a) * r * 0.9;
    b.add(P.box(0.05, 0.04, 0.016), C(PAL.gold), M.t(x, y - Math.cos(a) * 0.035, z, 0.5, a, 0));
    if (k % 2 === 0) b.add(P.box(0.026, 0.022, 0.01), C(PAL.jade), M.t(x * 1.04, y - Math.cos(a) * 0.035, z * 1.04 + 0.006, 0.5, a, 0));
  }
  const py = y - (big ? 0.085 : 0.07);
  b.add(P.box(big ? 0.07 : 0.05, big ? 0.07 : 0.05, 0.02), C(PAL.gold), M.t(0, py, r * 0.95 + 0.01, 0.2, 0, Math.PI / 4));
  b.add(P.box(big ? 0.042 : 0.03, big ? 0.042 : 0.03, 0.02), C(PAL.jade), M.t(0, py, r * 0.95 + 0.02, 0.2, 0, Math.PI / 4));
}

function headBase(g: 'm' | 'f'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // Faceless faceted head.
  b.add(P.sphere(0.115, 1), SKIN, M.t(0, 0.12, 0.005, 0, 0, 0, 0.9, 1.1, 0.96));
  b.add(P.box(0.02, 0.04, 0.03), SKIN, M.t(0, 0.1, 0.11));
  // Hair: cap and long hair down the back (longer for women).
  b.add(P.sphere(0.12, 1), C(PAL.hair), M.t(0, 0.15, -0.025, 0, 0, 0, 0.95, 1.0, 1.0));
  const len = g === 'f' ? 0.56 : 0.36;
  b.add(P.cyl(0.1, g === 'f' ? 0.13 : 0.09, len, 5), C(PAL.hair), M.t(0, 0.14 - len / 2, -0.07, 0.08, 0, 0, 1, 1, 0.38));
  if (g === 'f') for (const x of [-0.1, 0.1]) b.add(P.cyl(0.03, 0.04, 0.3, 4), C(PAL.hair), M.t(x, 0.0, -0.01, 0, 0, x > 0 ? -0.08 : 0.08));
  // Square gold earrings with jade.
  for (const x of [-0.108, 0.108]) {
    b.add(P.box(0.012, 0.05, 0.05), C(PAL.gold), M.t(x, 0.06, 0.005));
    b.add(P.box(0.014, 0.026, 0.026), C(PAL.jade), M.t(x * 1.02, 0.06, 0.005));
    if (g === 'f') b.add(P.cone(0.012, 0.04, 4), C(PAL.jade), M.t(x, 0.02, 0.005, Math.PI, 0, 0));
  }
  return facet(b.build());
}

function upperArm(g: 'm' | 'f'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const s = SKELETON[g];
  const r = g === 'm' ? 0.065 : 0.048;
  limb(b, r, r * 0.8, s.upper);
  band(b, r * 1.12, -0.09, 0.055);
  return facet(b.build());
}

function foreArm(g: 'm' | 'f'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const s = SKELETON[g];
  const r = g === 'm' ? 0.052 : 0.04;
  limb(b, r, r * 0.78, s.fore);
  // Wrist cuff: gold with an accent inset (like the reference's teal cuffs).
  b.add(P.cyl(r * 1.05, r * 0.95, 0.07, 8), C(PAL.gold), M.t(0, -s.fore + 0.06, 0, 0, Math.PI / 8, 0));
  b.add(P.box(r * 1.2, 0.035, 0.02), ACC, M.t(0, -s.fore + 0.06, r * 0.95));
  // Hand with thumb.
  b.add(P.box(0.06, 0.085, 0.035), SKIN, M.t(0, -s.fore - 0.04, 0.005));
  b.add(P.box(0.02, 0.045, 0.02), SKIN, M.t(0.03, -s.fore - 0.02, 0.025, 0, 0, -0.4));
  return facet(b.build());
}

function thigh(g: 'm' | 'f'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const s = SKELETON[g];
  const r = g === 'm' ? 0.085 : 0.075;
  limb(b, r, r * 0.74, s.thigh);
  return facet(b.build());
}

function shin(g: 'm' | 'f'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const s = SKELETON[g];
  const r = g === 'm' ? 0.062 : 0.052;
  limb(b, r, r * 0.72, s.shin);
  if (g === 'm') {
    // Leather greaves with gold bands, jade studs and a feather tuft behind the calf.
    b.add(P.cyl(r * 1.08, r * 0.9, 0.22, 7), C(PAL.leather), M.t(0, -s.shin + 0.16, 0));
    band(b, r * 1.12, -s.shin + 0.24, 0.045);
    band(b, r * 0.95, -s.shin + 0.07, 0.03, false);
    for (const [a, col] of [[-0.35, PAL.red], [0.05, -1], [0.4, PAL.red]] as [number, number][]) {
      b.add(feather(0.13, 0.04), col < 0 ? ACC : C(col), chain(M.t(0, -s.shin + 0.25, -r * 0.9), M.t(0, 0, 0, -0.5, 0, a)));
    }
  } else {
    band(b, r * 0.98, -s.shin + 0.07, 0.035);
  }
  // Foot with a leather sandal and straps.
  b.add(P.box(0.08, 0.05, 0.18), SKIN, M.t(0, -s.shin - 0.025, 0.04));
  b.add(P.box(0.09, 0.018, 0.2), C(PAL.sole), M.t(0, -s.shin - 0.058, 0.042));
  b.add(P.box(0.085, 0.015, 0.02), C(PAL.leather), M.t(0, -s.shin - 0.01, 0.07));
  b.add(P.box(0.085, 0.015, 0.02), C(PAL.leather), M.t(0, -s.shin - 0.015, 0.0));
  return facet(b.build());
}

// ---------------- Headdresses ----------------

function headband(b: GeoBuilder, gem = true): void {
  b.add(P.cyl(0.123, 0.12, 0.045, 10, true), C(PAL.gold), M.t(0, 0.2, -0.01));
  // Stepped trim.
  for (let k = 0; k < 8; k++) {
    const a = -1.2 + (k / 7) * 2.4;
    b.add(P.box(0.026, 0.02, 0.012), C(PAL.jade), M.t(Math.sin(a) * 0.124, 0.2, Math.cos(a) * 0.124 - 0.01, 0, a, 0));
  }
  if (gem) {
    b.add(P.box(0.06, 0.06, 0.02), C(PAL.gold), M.t(0, 0.215, 0.12));
    b.add(P.box(0.038, 0.038, 0.02), C(PAL.jade), M.t(0, 0.215, 0.128));
  }
}

/** Grand feather fan like the reference: teal, red and gold diamond feathers radiating behind the head. */
function headdressFan(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  headband(b);
  const rows: { n: number; len: number; spread: number; cols: (typeof ACC | { color: number })[]; tilt: number; z: number }[] = [
    { n: 13, len: 0.4, spread: 1.45, cols: [ACC, C(PAL.red), ACC, C(PAL.gold)], tilt: -0.45, z: -0.07 },
    { n: 9, len: 0.28, spread: 1.15, cols: [C(PAL.red), C(PAL.gold), C(PAL.red)], tilt: -0.3, z: -0.04 },
  ];
  for (const r of rows) {
    for (let k = 0; k < r.n; k++) {
      const a = -r.spread + (k / (r.n - 1)) * r.spread * 2;
      const len = r.len * (1 - Math.abs(a) * 0.18);
      b.add(feather(len, 0.07), r.cols[k % r.cols.length], chain(M.t(0, 0.2, r.z), M.t(0, 0, 0, r.tilt, 0, 0), M.t(0, 0, 0, 0, 0, a)), );
    }
  }
  return facet(b.build());
}

function headdressBand(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  headband(b, false);
  for (const [a, col] of [[-0.3, PAL.red], [0, -1], [0.3, PAL.gold]] as [number, number][]) {
    b.add(feather(0.17, 0.05), col < 0 ? ACC : C(col), chain(M.t(0, 0.2, -0.1), M.t(0, 0, 0, -0.4, 0, a)));
  }
  return facet(b.build());
}

function headdressPlume(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  headband(b);
  for (const [a, len, col] of [[-0.12, 0.42, -1], [0.12, 0.4, -1], [0, 0.3, PAL.red]] as [number, number, number][]) {
    b.add(feather(len, 0.06), col < 0 ? ACC : C(col), chain(M.t(0, 0.21, -0.08), M.t(0, 0, 0, -0.55, 0, a)));
  }
  return facet(b.build());
}

function jaguarHelm(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const spot = (p: THREE.Vector3) => (Math.sin(p.x * 70) * Math.sin(p.z * 70 + p.y * 50) > 0.45 ? new THREE.Color(0x2a1a10) : new THREE.Color(0xe0a82e));
  b.add(P.sphere(0.135, 1), { color: spot }, M.t(0, 0.16, -0.02, 0, 0, 0, 1, 0.9, 1.05));
  b.add(P.box(0.16, 0.05, 0.1), { color: 0xe0a82e }, M.t(0, 0.26, 0.09));
  for (const x of [-0.08, 0.08]) b.add(P.cone(0.03, 0.06, 4), { color: 0xe0a82e }, M.t(x, 0.3, -0.02));
  b.add(P.box(0.24, 0.4, 0.02), { color: spot }, M.t(0, -0.1, -0.13, 0.12, 0, 0));
  for (const [a, col] of [[-0.25, PAL.red], [0.25, -1]] as [number, number][]) b.add(feather(0.2, 0.05), col < 0 ? ACC : C(col), chain(M.t(0, 0.26, -0.08), M.t(0, 0, 0, -0.5, 0, a)));
  return facet(b.build());
}

function eagleHelm(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.135, 1), { color: (p) => (p.y > 0.18 ? new THREE.Color(0xf4eee0) : new THREE.Color(0x6e4428)) }, M.t(0, 0.16, -0.02, 0, 0, 0, 1, 0.9, 1.05));
  b.add(P.cone(0.05, 0.14, 4), C(0xf2c230), M.t(0, 0.26, 0.15, Math.PI / 2 + 0.35, 0, 0));
  for (let k = 0; k < 7; k++) {
    const a = -0.9 + (k / 6) * 1.8;
    b.add(feather(0.26, 0.06), C(k % 2 ? 0xf4eee0 : 0x6e4428), chain(M.t(0, 0.22, -0.1), M.t(0, 0, 0, -0.6, 0, a)));
  }
  return facet(b.build());
}

// ---------------- Held items ----------------

function tool(kind: string): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // Tools point forward (+z) from the grip at the hand.
  const shaft = (len: number) => b.add(P.cyl(0.018, 0.018, len, 5), C(PAL.wood), M.t(0, 0, len / 2 - 0.12, Math.PI / 2, 0, 0));
  switch (kind) {
    case 'axe':
      shaft(0.6);
      b.add(P.box(0.03, 0.14, 0.1), C(PAL.obsidian), M.t(0, 0.04, 0.44));
      b.add(P.box(0.035, 0.04, 0.04), C(PAL.gold), M.t(0, -0.02, 0.44));
      break;
    case 'pick':
      shaft(0.62);
      b.add(P.box(0.03, 0.34, 0.04), C(0x8a8a92), M.t(0, 0, 0.47, 0, 0, 0));
      break;
    case 'hoe':
      shaft(0.95);
      b.add(P.box(0.13, 0.12, 0.02), C(0x6e5a40), M.t(0, -0.06, 0.8));
      break;
    case 'spear': {
      // Like the reference: long shaft, obsidian blade, jade and gold rings, feather tassel.
      b.add(P.cyl(0.016, 0.02, 1.7, 5), C(PAL.wood), M.t(0, 0, 0.35, Math.PI / 2, 0, 0));
      const blade = new THREE.OctahedronGeometry(1, 0);
      blade.scale(0.06, 0.2, 0.02);
      b.add(blade, C(PAL.obsidian), M.t(0, 0, 1.38, Math.PI / 2, 0, 0));
      b.add(P.cyl(0.032, 0.032, 0.05, 6), C(PAL.gold), M.t(0, 0, 1.15, Math.PI / 2, 0, 0));
      b.add(P.cyl(0.03, 0.03, 0.04, 6), C(PAL.jade), M.t(0, 0, 1.08, Math.PI / 2, 0, 0));
      for (const [a, col] of [[-0.5, PAL.red], [0.5, PAL.jade], [3.14, PAL.red]] as [number, number][]) b.add(feather(0.14, 0.04), C(col), chain(M.t(0, 0, 1.06), M.t(0, 0, 0, Math.PI / 2 + 0.3, a, 0)));
      break;
    }
    case 'hammer':
      shaft(0.4);
      b.add(P.box(0.07, 0.07, 0.12), C(0x9d907f), M.t(0, 0, 0.26, 0, Math.PI / 2, 0));
      break;
  }
  return facet(b.build());
}

function load(kind: string): THREE.BufferGeometry {
  const b = new GeoBuilder();
  switch (kind) {
    case 'log':
      b.add(P.cyl(0.11, 0.11, 0.95, 7), { color: (p) => (Math.abs(p.x) > 0.44 ? new THREE.Color(0xdcbb8c) : new THREE.Color(0x7a5234)) }, M.t(0, 0, 0, 0, 0, Math.PI / 2));
      break;
    case 'stone':
      b.add(P.sphere(0.17, 0), C(0xa89a90), M.t(0, 0, 0, 0, 0, 0, 1, 0.8, 1));
      break;
    case 'basket':
      b.add(P.cyl(0.19, 0.14, 0.17, 8), C(0xc9a86a));
      for (let i = 0; i < 5; i++) b.add(P.sphere(0.065, 0), C([0xd8352a, 0xf2d33a, 0xe8a23a][i % 3]), M.t(Math.cos(i * 1.3) * 0.08, 0.1, Math.sin(i * 1.3) * 0.08));
      break;
    case 'sack':
      b.add(P.sphere(0.17, 1), C(0xd8c08a), M.t(0, 0.04, 0, 0, 0, 0, 1.25, 0.9, 0.9));
      b.add(P.cyl(0.05, 0.07, 0.08, 6), C(0xc4a870), M.t(0.19, 0.06, 0, 0, 0, Math.PI / 2));
      break;
    case 'fish':
      b.add(P.cyl(0.012, 0.012, 0.75, 4), C(PAL.wood), M.t(0, 0.05, 0, 0, 0, Math.PI / 2));
      for (let i = 0; i < 3; i++) b.add(P.sphere(0.07, 0), C([0x7fb8d0, 0xe0a060, 0x9ac8d8][i]), M.t(-0.22 + i * 0.22, -0.07, 0, 0, 0, 0, 0.6, 1.4, 0.4));
      break;
    case 'meat':
      b.add(P.sphere(0.15, 1), C(0xb2503a), M.t(0, 0, 0, 0, 0, 0, 1.3, 0.9, 0.9));
      b.add(P.cyl(0.03, 0.03, 0.24, 5), C(0xf0e6d0), M.t(0.22, 0, 0, 0, 0, Math.PI / 2));
      break;
  }
  return facet(b.build());
}

export type PartKey =
  | 'pelvis_m' | 'chest_m' | 'head_m' | 'uarm_m' | 'farm_m' | 'thigh_m' | 'shin_m'
  | 'pelvis_f' | 'chest_f' | 'head_f' | 'uarm_f' | 'farm_f' | 'thigh_f' | 'shin_f'
  | 'hd_band' | 'hd_fan' | 'hd_plume' | 'jaguar' | 'eagle'
  | 'axe' | 'pick' | 'hoe' | 'spear' | 'hammer'
  | 'log' | 'stone' | 'basket' | 'sack' | 'fish' | 'meat' | 'chicken';

export function buildPeopleParts(): Record<PartKey, THREE.BufferGeometry> {
  return {
    pelvis_m: pelvisM(), chest_m: chestM(), head_m: headBase('m'), uarm_m: upperArm('m'), farm_m: foreArm('m'), thigh_m: thigh('m'), shin_m: shin('m'),
    pelvis_f: pelvisF(), chest_f: chestF(), head_f: headBase('f'), uarm_f: upperArm('f'), farm_f: foreArm('f'), thigh_f: thigh('f'), shin_f: shin('f'),
    hd_band: headdressBand(), hd_fan: headdressFan(), hd_plume: headdressPlume(), jaguar: jaguarHelm(), eagle: eagleHelm(),
    axe: tool('axe'), pick: tool('pick'), hoe: tool('hoe'), spear: tool('spear'), hammer: tool('hammer'),
    log: load('log'), stone: load('stone'), basket: load('basket'), sack: load('sack'), fish: load('fish'), meat: load('meat'), chicken: carriedChicken(),
  };
}
