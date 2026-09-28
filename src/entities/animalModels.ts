import * as THREE from 'three';
import { ColorFn, GeoBuilder, M, P, facet, tube } from '../render/GeoBuilder';

/**
 * Faceted low-poly animal parts, in world units (islanders stand ~0.62 tall).
 * Vertices tagged mat 2 are the "coat" and take a per-animal colour (so one mesh serves
 * white, brown and black chickens, pink and dark pigs, and so on). Parts face +z.
 */

const COAT = { color: 0xffffff, mat: 2 };
const coat = (shade: number) => ({ color: new THREE.Color(shade, shade, shade), mat: 2 });
const C = (c: number) => ({ color: c });

type V3 = [number, number, number];
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, 1);

/** Place a +y-axis primitive of height |b − a| so it runs from a to b (sx, sz scale its cross-section). */
function span(a: V3, b: V3, sx = 1, sz = sx): THREE.Matrix4 {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, d.normalize());
  return new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(sx, 1, sz));
}
const dist = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** A tapered cylinder from a to b (radius ra at a, rb at b). */
function limb(b: GeoBuilder, a: V3, c: V3, ra: number, rb: number, col: { color: number | THREE.Color; mat?: number }, seg = 6): void {
  b.add(P.cyl(rb, ra, dist(a, c), seg), col, span(a, c));
}

/** Rotation (Euler XYZ, as M.t) applied to a +y rod of length len whose base sits at `from`. */
function rod(len: number, from: V3, rx: number, ry: number, rz: number, sx = 1, sz = sx): THREE.Matrix4 {
  const c = new THREE.Vector3(0, len / 2, 0).applyEuler(new THREE.Euler(rx, ry, rz));
  return M.t(from[0] + c.x, from[1] + c.y, from[2] + c.z, rx, ry, rz, sx, 1, sz);
}

/** A flattened blob lying on a surface with the given outward normal. */
function onSurface(p: V3, n: V3, sx: number, sy: number, sz: number): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromUnitVectors(_fwd, new THREE.Vector3(n[0], n[1], n[2]).normalize());
  return new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(sx, sy, sz));
}

// ---------------- Chickens ----------------

/**
 * Chicken skeleton (body frame: origin on the ground under the hips, facing +z). The neck,
 * head, both three-piece legs and the jointed wings (birdWings) hang off these joints.
 */
export const CHICKEN = {
  /** Hip joints. */
  hipY: 0.066, hipX: 0.024,
  /** Neck base on the body, neck length (the head sits on its top). */
  neckY: 0.105, neckZ: 0.05, neck: 0.045,
  /** Drumstick (hip → hock) and scaly shank (hock → ankle) lengths; ankle height standing on the toes. */
  thigh: 0.034, shank: 0.042, ankle: 0.0065,
};

export function chickenBody(kind: 'hen' | 'speckled' | 'rooster'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rooster = kind === 'rooster';
  const big = rooster ? 1.08 : 1;
  // Egg-shaped body, back rising gently toward the tail, plump breast low at the front.
  b.add(P.sphere(0.068, 1), COAT, M.t(0, 0.09, -0.005, -0.12, 0, 0, 0.95 * big, 0.9 * big, 1.22 * big));
  b.add(P.sphere(0.048, 1), rooster ? C(0x2a2320) : coat(0.97), M.t(0, 0.08, 0.042, 0, 0, 0, 1.08, 1.05, 0.95));
  // Shoulders where the neck joins, fluffy thighs over the hips and a fluffy vent under the tail.
  b.add(P.sphere(0.034, 0), COAT, M.t(0, 0.112, 0.04, 0, 0, 0, 1, 0.9, 1.1));
  for (const x of [-1, 1]) b.add(P.sphere(0.026, 0), coat(0.9), M.t(x * 0.03, 0.066, -0.002, 0, 0, 0, 1, 1.2, 1.25));
  b.add(P.sphere(0.034, 0), coat(0.95), M.t(0, 0.078, -0.07, 0, 0, 0, 1.1, 0.9, 1));
  if (rooster) {
    // Golden neck and saddle hackles over the shoulders and back; a long arching sickle tail.
    b.add(P.sphere(0.05, 1), C(0xd99434), M.t(0, 0.122, 0.03, 0.2, 0, 0, 1.2, 0.62, 1.1));
    b.add(P.sphere(0.042, 0), C(0xc07a28), M.t(0, 0.132, -0.045, -0.2, 0, 0, 1.15, 0.5, 1.2));
    for (let k = 0; k < 5; k++) {
      const f = 1 - Math.abs(k - 2) * 0.13, x = (k - 2) * 0.007;
      const pts = [
        new THREE.Vector3(x * 0.5, 0, 0),
        new THREE.Vector3(x, 0.065 * f, -0.03 * f),
        new THREE.Vector3(x * 1.4, 0.095 * f, -0.09 * f),
        new THREE.Vector3(x * 1.8, 0.06 * f, -0.15 * f),
        new THREE.Vector3(x * 2, 0.005 * f, -0.17 * f),
      ];
      b.add(tube(pts, (t) => 0.008 * (1 - t * 0.6), 4, 9), C(k % 2 ? 0x1f4a3e : 0x16302a), M.t(0, 0.118, -0.07, 0, 0, 0, 0.5, 1, 1));
    }
  } else {
    // Hen's tail: two fans of broad feathers forming a shallow tent.
    for (const side of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        const len = 0.062 - j * 0.008;
        b.add(P.box(0.005, len, 0.028 - j * 0.004), coat(0.93 - j * 0.05), rod(len, [side * 0.006, 0.112, -0.07], -0.45 - j * 0.3, 0, -side * (0.18 + j * 0.06)));
      }
    }
  }
  if (kind === 'speckled') {
    // Dark flecks lying on the plumage.
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 22; k++) {
      const a = rnd() * Math.PI * 2, e = (rnd() - 0.35) * 1.1;
      const n: V3 = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
      const p: V3 = [n[0] * 0.063, 0.09 + n[1] * 0.059, -0.005 + n[2] * 0.08];
      b.add(P.sphere(0.008, 0), C(0x3a3028), onSurface(p, n, 1.2, 0.8, 0.35));
    }
  }
  return facet(b.build());
}

/** Neck from its base on the shoulders (pivot) up to the head joint at y = CHICKEN.neck. */
export function chickenNeck(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.018, 0.026, 0.056, 6), COAT, M.t(0, 0.022, 0.002));
  // Hackle ruff where the neck meets the body.
  b.add(P.cyl(0.024, 0.031, 0.026, 6), coat(0.94), M.t(0, 0.006, -0.002));
  return facet(b.build());
}

export function chickenHead(rooster: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const s = rooster ? 1.12 : 1;
  const RED = 0xd62f22;
  b.add(P.sphere(0.029 * s, 1), COAT, M.t(0, 0.013 * s, 0.006, 0, 0, 0, 0.88, 1, 1.12));
  // Short curved beak (upper and lower mandible).
  b.add(P.cone(0.011 * s, 0.03 * s, 5), C(0xe8b030), M.t(0, 0.012 * s, 0.043 * s, Math.PI / 2 + 0.28, 0, 0, 1, 1, 0.75));
  b.add(P.cone(0.007 * s, 0.018 * s, 4), C(0xcf9424), M.t(0, 0.002 * s, 0.036 * s, Math.PI / 2 + 0.55, 0, 0, 1, 1, 0.7));
  // Serrated comb along the crown (big and floppy on the rooster).
  const n = rooster ? 5 : 3, combH = rooster ? 0.03 : 0.016, combL = (rooster ? 0.048 : 0.034) * s;
  b.add(P.box(0.008, 0.012 * s, combL), C(RED), M.t(0, 0.04 * s, 0.012 * s));
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const h = combH * (1 - Math.abs(t - 0.4) * 0.9);
    b.add(P.cone(0.009 * s, h, 4), C(RED), M.t(0, 0.044 * s + h / 2, 0.012 * s + combL * (0.45 - t), -0.25 * (t - 0.4), 0, 0, 0.55, 1, 1));
  }
  // Wattles under the beak, earlobes and orange-ringed eyes.
  for (const x of [-1, 1]) {
    const w = rooster ? 1.5 : 1;
    b.add(P.sphere(0.008 * w, 0), C(RED), M.t(x * 0.005, -0.012 * s - 0.004 * w, 0.032 * s, 0, 0, 0, 0.6, 1.5, 0.9));
    b.add(P.sphere(0.006 * s, 0), C(rooster ? 0xe8dccb : RED), M.t(x * 0.024 * s, 0.003 * s, -0.002, 0, 0, 0, 0.45, 1, 1));
    b.add(P.sphere(0.0065 * s, 0), C(0xd8861c), M.t(x * 0.022 * s, 0.02 * s, 0.02 * s));
    b.add(P.sphere(0.0036 * s, 0), C(0x120c0a), M.t(x * 0.0265 * s, 0.0205 * s, 0.022 * s));
  }
  return facet(b.build());
}

/** Chicken leg pieces: [feathered drumstick from the hip, scaly shank from the hock, toes from the ankle]. */
export function chickenLegParts(): [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry] {
  const Y = 0xe8b030, Yd = 0xc98e1e;
  const L = CHICKEN;
  const thigh = new GeoBuilder();
  thigh.add(P.sphere(0.016, 0), COAT, M.t(0, -0.006, 0, 0, 0, 0, 1, 1.25, 1.15));
  thigh.add(P.cyl(0.0085, 0.014, L.thigh * 0.9, 5), coat(0.95), M.t(0, -L.thigh * 0.5, 0));
  const shank = new GeoBuilder();
  shank.add(P.sphere(0.0064, 0), C(Y), M.t(0, 0, 0));
  shank.add(P.cyl(0.0046, 0.0056, L.shank, 5), C(Y), M.t(0, -L.shank / 2, 0));
  // Scales: a few slightly proud darker rings down the shank.
  for (let k = 0; k < 3; k++) shank.add(P.cyl(0.0061, 0.0061, 0.0024, 5), C(Yd), M.t(0, -0.011 - k * 0.011, 0));
  const foot = new GeoBuilder();
  foot.add(P.sphere(0.0058, 0), C(Y), M.t(0, 0, 0));
  // Three forward toes spread in a fan and a short hind toe, lying on the ground.
  for (const a of [-0.5, 0, 0.5]) {
    const len = a === 0 ? 0.03 : 0.026;
    foot.add(P.box(0.0052, 0.0045, len), C(Y), M.t(Math.sin(a) * len * 0.5, -L.ankle + 0.00225, Math.cos(a) * len * 0.5, 0, a, 0));
    foot.add(P.cone(0.0028, 0.006, 4), C(0x3a3024), M.t(Math.sin(a) * len, -L.ankle + 0.0022, Math.cos(a) * len + 0.002, Math.PI / 2, 0, 0));
  }
  foot.add(P.box(0.0045, 0.004, 0.013), C(Y), M.t(0, -L.ankle + 0.002, -0.0065));
  return [facet(thigh.build()), facet(shank.build()), facet(foot.build())];
}

// ---------------- Pigs ----------------

/** Pig head (pivot at the neck): broad skull, sagging jowls, tapering snout with a nostril disc. */
export function pigHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.075, 1), COAT, M.t(0, 0.008, 0.04, 0, 0, 0, 1.08, 0.95, 1.05));
  for (const x of [-1, 1]) b.add(P.sphere(0.04, 1), coat(0.95), M.t(x * 0.042, -0.034, 0.045, 0, 0, 0, 1, 0.85, 1.15));
  b.add(P.sphere(0.045, 0), coat(0.93), M.t(0, -0.046, 0.02, 0, 0, 0, 1.1, 0.7, 1.2));
  b.add(P.cyl(0.033, 0.048, 0.075, 8), coat(0.9), M.t(0, -0.012, 0.11, Math.PI / 2, 0, 0, 1, 1, 0.9));
  b.add(P.cyl(0.036, 0.034, 0.014, 8), coat(0.74), M.t(0, -0.013, 0.152, Math.PI / 2, 0, 0, 1.05, 1, 0.88));
  // Mouth line under the snout.
  b.add(P.box(0.052, 0.004, 0.035), C(0x5a3230), M.t(0, -0.04, 0.112, 0.12, 0, 0));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.0085, 0), C(0x3a2020), M.t(x * 0.013, -0.012, 0.159, 0, 0, 0, 0.8, 1.1, 0.5));
    b.add(P.sphere(0.011, 0), C(0x141010), M.t(x * 0.05, 0.03, 0.094));
    b.add(P.box(0.026, 0.007, 0.014), coat(0.82), M.t(x * 0.049, 0.043, 0.09, 0, 0, x * 0.3));
  }
  return facet(b.build());
}

/** Floppy ear (pivot at its root, pointing +y, inner face toward +z). */
export function pigEar(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cone(0.036, 0.075, 4), coat(0.84), M.t(0, 0.034, 0, 0, 0, 0, 1, 1, 0.28));
  b.add(P.cone(0.026, 0.055, 4), coat(0.98), M.t(0, 0.03, 0.005, 0, 0, 0, 1, 1, 0.2));
  return facet(b.build());
}

/** Corkscrew tail (pivot at the root, coiling back along −z). */
export function pigTail(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10, a = t * Math.PI * 3.2, r = 0.011 * (1 - t * 0.35);
    pts.push(new THREE.Vector3(Math.sin(a) * r, 0.004 + t * 0.01 + (1 - Math.cos(a)) * r * 0.9, -0.003 - t * 0.03));
  }
  const b = new GeoBuilder();
  b.add(tube(pts, (t) => 0.0056 * (1 - t * 0.45), 4, 16), coat(0.9));
  return facet(b.build());
}

// ---------------- Goats ----------------

/** Goat neck (pivot at the shoulders, running along +z to the head joint at z = 0.15). */
export function goatNeck(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.03, 0.047, 0.17, 7), COAT, M.t(0, 0, 0.07, Math.PI / 2, 0, 0, 0.88, 1, 1.15));
  b.add(P.box(0.012, 0.016, 0.15), coat(0.82), M.t(0, 0.036, 0.07, 0.08, 0, 0));
  b.add(P.sphere(0.03, 0), coat(0.95), M.t(0, -0.03, 0.1, 0, 0, 0, 0.85, 1, 1.25));
  return facet(b.build());
}

/** Goat head (pivot at the poll, where the neck ends): long face, beard, slit-pupilled eyes, horns. */
export function goatHead(curly: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const HORN = 0x6e5a40;
  b.add(P.sphere(0.042, 1), COAT, M.t(0, 0, 0.03, 0, 0, 0, 0.85, 0.95, 1.15));
  b.add(P.cyl(0.02, 0.03, 0.075, 6), COAT, M.t(0, -0.014, 0.085, Math.PI / 2, 0, 0));
  b.add(P.sphere(0.021, 0), coat(0.72), M.t(0, -0.016, 0.12, 0, 0, 0, 1, 0.9, 0.9));
  // Beard hanging from the chin.
  b.add(P.cone(0.013, 0.055, 4), coat(0.7), span([0, -0.034, 0.088], [0, -0.088, 0.096], 1, 0.6));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.004, 0), C(0x1a1210), M.t(x * 0.008, -0.01, 0.138));
    b.add(P.sphere(0.0095, 0), C(0xc9a23a), M.t(x * 0.032, 0.012, 0.048));
    b.add(P.box(0.004, 0.0024, 0.008), C(0x100c08), M.t(x * 0.04, 0.012, 0.05));
    const s = x;
    let pts: THREE.Vector3[];
    if (curly) {
      // Ram-like curl: up and back, then down and forward beside the ear.
      pts = [];
      for (let k = 0; k <= 7; k++) {
        const t = k / 7, th = 1.2 - t * 4.2, r = 0.036 + t * 0.012;
        pts.push(new THREE.Vector3(s * (0.016 + t * 0.03), 0.034 + r * Math.cos(th) - 0.036 * Math.cos(1.2), 0.02 + r * Math.sin(th) - 0.036 * Math.sin(1.2)));
      }
    } else {
      // Scimitar horns sweeping up and back.
      pts = [
        new THREE.Vector3(s * 0.016, 0.034, 0.02),
        new THREE.Vector3(s * 0.022, 0.064, -0.015),
        new THREE.Vector3(s * 0.03, 0.079, -0.065),
        new THREE.Vector3(s * 0.036, 0.074, -0.1),
      ];
    }
    b.add(tube(pts, (t) => 0.011 * (1 - t * 0.72), 5, curly ? 12 : 9), C(HORN));
  }
  return facet(b.build());
}

/** Goat ear: a leaf held out sideways (pivot at the root, pointing +y, inner face +z). */
export function goatEar(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cone(0.02, 0.07, 4), coat(0.88), M.t(0, 0.033, 0, 0, 0, 0, 1, 1, 0.35));
  b.add(P.cone(0.014, 0.05, 4), coat(1), M.t(0, 0.03, 0.004, 0, 0, 0, 1, 1, 0.25));
  return facet(b.build());
}

/** Short flat up-flicked tail (pivot at the root). */
export function goatTail(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cone(0.02, 0.06, 4), COAT, rod(0.06, [0, 0, 0], -0.55, 0, 0, 1.25, 0.5));
  b.add(P.cone(0.013, 0.04, 4), coat(0.75), rod(0.04, [0, -0.004, -0.006], -0.7, 0, 0, 1.1, 0.5));
  return facet(b.build());
}

// ---------------- Tapirs ----------------

/** Tapir head (pivot at the neck): long skull with a crest, pale cheeks and jaw (Baird's tapir). */
export function tapirHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const PALE = 0xcdbfa6;
  b.add(P.sphere(0.1, 1), COAT, M.t(0, 0.02, 0.06, 0, 0, 0, 0.78, 0.92, 1.25));
  b.add(P.sphere(0.05, 0), COAT, M.t(0, 0.085, 0.02, 0, 0, 0, 0.55, 0.7, 1.5));
  b.add(P.sphere(0.075, 1), C(PALE), M.t(0, -0.045, 0.07, 0, 0, 0, 0.95, 0.6, 1.15));
  b.add(P.cyl(0.045, 0.07, 0.12, 7), coat(0.92), M.t(0, -0.02, 0.18, Math.PI / 2, 0, 0, 0.95, 1, 0.95));
  b.add(P.sphere(0.04, 0), C(PALE), M.t(0, -0.056, 0.2, 0, 0, 0, 0.9, 0.5, 1.3));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.011, 0), C(0x0e0c0a), M.t(x * 0.068, 0.035, 0.12));
    b.add(P.box(0.022, 0.006, 0.012), coat(0.8), M.t(x * 0.066, 0.05, 0.118, 0, 0, x * 0.25));
  }
  return facet(b.build());
}

/** Short trunk-like proboscis (pivot at its root on the muzzle, drooping forward). */
export function tapirTrunk(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const pts = [new THREE.Vector3(0, 0, -0.012), new THREE.Vector3(0, -0.004, 0.035), new THREE.Vector3(0, -0.022, 0.07), new THREE.Vector3(0, -0.05, 0.09)];
  b.add(tube(pts, (t) => 0.042 - t * 0.018, 6, 8), coat(0.84));
  b.add(P.sphere(0.026, 0), coat(0.72), M.t(0, -0.056, 0.093, 0, 0, 0, 1, 0.8, 1));
  for (const x of [-1, 1]) b.add(P.sphere(0.0075, 0), C(0x140e0c), M.t(x * 0.009, -0.075, 0.1));
  return facet(b.build());
}

/** Small rounded ear with a pale rim (pivot at the root, pointing +y, opening toward +z). */
export function tapirEar(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.036, 1), coat(0.9), M.t(0, 0.034, -0.004, 0, 0, 0, 0.8, 1.1, 0.26));
  b.add(P.sphere(0.039, 1), C(0xe2d6c2), M.t(0, 0.035, 0, 0, 0, 0, 0.82, 1.12, 0.2));
  b.add(P.sphere(0.03, 0), C(0x2a221e), M.t(0, 0.033, 0.004, 0, 0, 0, 0.72, 1.0, 0.2));
  return facet(b.build());
}

/** Leg hanging from the hip / shoulder joint (hoof or foot at the bottom). */
export function legGeometry(len: number, r: number, hoof: number, mat: 'coat' | number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(r * 0.8, r, len, 5), mat === 'coat' ? COAT : C(mat), M.t(0, -len / 2, 0));
  b.add(P.box(r * 2.1, len * 0.12, r * 2.3), C(hoof), M.t(0, -len + len * 0.06, r * 0.3));
  return facet(b.build());
}

// ---------------- Spider monkeys ----------------

const MONKEY = 0x2a2220, MONKEY_TAN = 0xb8935e;

export function monkeyHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.045, 1), C(MONKEY), M.t(0, 0.04, 0));
  b.add(P.sphere(0.028, 0), C(0x6e5a48), M.t(0, 0.03, 0.03, 0, 0, 0, 1, 0.9, 0.7));
  for (const x of [-1, 1]) b.add(P.sphere(0.007, 0), C(0x080606), M.t(x * 0.014, 0.045, 0.045));
  return facet(b.build());
}
/** Long prehensile tail with a curl at the tip. Pivot at the base, trailing along -z. */
export function monkeyTail(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    if (t < 0.7) pts.push(new THREE.Vector3(0, Math.sin(t * 2.2) * 0.12, -t * 0.34));
    else {
      const a = (t - 0.7) / 0.3 * Math.PI * 1.5;
      pts.push(new THREE.Vector3(0, 0.12 + Math.sin(a) * 0.05, -0.24 - Math.cos(a - Math.PI / 2) * 0.05 - 0.05));
    }
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.009, 4, false);
  const b = new GeoBuilder();
  b.add(g, C(MONKEY));
  return facet(b.build());
}

// ---------------- Birds ----------------

export function toucanBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.05, 1), C(0x121214), M.t(0, 0, 0, 0, 0, 0, 0.85, 0.9, 1.3));
  b.add(P.sphere(0.034, 0), C(0xf4e6b0), M.t(0, 0.015, 0.042, 0, 0, 0, 1, 1, 0.6));
  b.add(P.sphere(0.036, 1), C(0x121214), M.t(0, 0.04, 0.05));
  // The big banana beak: orange/yellow with a black tip.
  b.add(P.cone(0.024, 0.1, 5), { color: (p) => new THREE.Color(p.z > 0.155 ? 0x151515 : p.y > 0.035 ? 0xf2c230 : 0xf07a1e) }, M.t(0, 0.035, 0.12, Math.PI / 2 + 0.25, 0, 0, 1, 1, 0.8));
  b.add(P.box(0.03, 0.01, 0.1), C(0x121214), M.t(0, -0.01, -0.1, 0.3, 0, 0));
  b.add(P.box(0.03, 0.012, 0.02), C(0xc0281e), M.t(0, -0.03, -0.045));
  for (const x of [-1, 1]) b.add(P.sphere(0.009, 0), C(0x3a8ad8), M.t(x * 0.03, 0.05, 0.065));
  return facet(b.build());
}

export function gullBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // Streamlined body: full chest tapering to the tail, pale grey back, white below.
  const bodyCol: ColorFn = (p, n) => new THREE.Color(n.y > 0.55 && p.z < 0.05 ? 0xb4bcc4 : 0xfafaf6);
  b.add(P.sphere(0.06, 1), { color: bodyCol }, M.t(0, 0, 0.01, 0, 0, 0, 0.72, 0.7, 1.35));
  b.add(P.cone(0.042, 0.1, 6), { color: bodyCol }, M.t(0, 0.004, -0.085, -Math.PI / 2, 0, 0, 1, 1, 0.75));
  // Head on a short neck.
  b.add(P.sphere(0.036, 1), C(0xfafaf6), M.t(0, 0.035, 0.085, 0, 0, 0, 0.92, 0.95, 1.1));
  // Yellow hooked bill with the red spot.
  b.add(P.cone(0.011, 0.055, 4), C(0xf2c030), M.t(0, 0.03, 0.14, Math.PI / 2, 0, 0, 1, 1, 0.8));
  b.add(P.sphere(0.005, 0), C(0xd8342a), M.t(0, 0.022, 0.138));
  // Wedge tail, white with a black band at the tip.
  b.add(P.box(0.055, 0.008, 0.05), C(0xf4f5f2), M.t(0, 0.008, -0.14, 0.08, 0, 0));
  b.add(P.box(0.056, 0.009, 0.014), C(0x1c1c1e), M.t(0, 0.006, -0.168, 0.08, 0, 0));
  for (const x of [-1, 1]) b.add(P.sphere(0.0055, 0), C(0x151010), M.t(x * 0.024, 0.045, 0.1));
  return facet(b.build());
}

export function birdLegs(color: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const x of [-1, 1]) b.add(P.cyl(0.004, 0.004, 0.05, 3), C(color), M.t(x * 0.015, -0.045, 0));
  return facet(b.build());
}

// ---------------- Jointed quadrupeds (pig, goat, tapir) ----------------

/**
 * Split a faceted body into front and rear halves around the mid-body joint at z = 0 (the
 * halves overlap a little so no gap opens when the spine bends). Geometry must be non-indexed.
 */
export function splitBody(g: THREE.BufferGeometry, spineY: number, ov = 0.035): [THREE.BufferGeometry, THREE.BufferGeometry] {
  g.translate(0, -spineY, 0);
  const pos = g.getAttribute('position');
  const pick = (keep: (cz: number) => boolean) => {
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      const arr: number[] = [];
      for (let i = 0; i < pos.count; i += 3) {
        const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
        if (!keep(cz)) continue;
        for (let k = 0; k < 3; k++) for (let c = 0; c < a.itemSize; c++) arr.push(a.getComponent(i + k, c));
      }
      out.setAttribute(name, new THREE.Float32BufferAttribute(arr, a.itemSize));
    }
    out.computeBoundingSphere();
    return out;
  };
  return [pick((cz) => cz > -ov), pick((cz) => cz < ov)];
}

/** Pig body: round barrel with an arched back, heavy shoulders and hams, sagging belly; split at the spine joint. */
export function pigBodyHalves(spotted: boolean, spineY: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.112, 0.2, 4, 10), COAT, M.t(0, 0.172, 0, Math.PI / 2, 0, 0, 1.1, 1, 1));
  b.add(P.sphere(0.104, 1), COAT, M.t(0, 0.178, 0.1, 0, 0, 0, 1.08, 1.02, 1));
  b.add(P.sphere(0.11, 1), COAT, M.t(0, 0.182, -0.11, 0, 0, 0, 1.12, 1.04, 1));
  b.add(P.sphere(0.08, 1), COAT, M.t(0, 0.215, -0.03, 0, 0, 0, 1.1, 0.7, 1.6));
  b.add(P.sphere(0.1, 1), coat(0.92), M.t(0, 0.128, 0, 0, 0, 0, 1, 0.58, 1.65));
  // Thick neck merging into the jowls.
  b.add(P.sphere(0.085, 1), COAT, M.t(0, 0.168, 0.19, 0, 0, 0, 1.02, 0.95, 0.8));
  // Two rows of small teats along the belly.
  for (const x of [-1, 1]) for (let k = 0; k < 4; k++) b.add(P.sphere(0.006, 0), coat(0.8), M.t(x * 0.03, 0.072, 0.07 - k * 0.05));
  if (spotted) {
    for (const [x, y, z, r] of [[0.08, 0.22, 0.05, 0.05], [-0.06, 0.25, -0.08, 0.06], [0.05, 0.16, -0.12, 0.04], [-0.09, 0.15, 0.1, 0.035], [0.02, 0.27, 0.1, 0.03]]) {
      b.add(P.sphere(r, 0), C(0x2e2622), M.t(x * 1.35, y, z, 0, 0, 0, 1, 0.5, 1));
    }
  }
  return splitBody(facet(b.build()), spineY);
}

/** Goat body: narrow deep chest, lean belly, angular hips and a shaggy fringe; split at the spine joint. */
export function goatBodyHalves(patched: boolean, spineY: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.08, 0.2, 4, 8), COAT, M.t(0, 0.262, -0.01, Math.PI / 2, 0, 0, 0.84, 1, 1.06));
  b.add(P.sphere(0.088, 1), COAT, M.t(0, 0.252, 0.1, 0, 0, 0, 0.8, 1.12, 1.1));
  b.add(P.sphere(0.05, 0), COAT, M.t(0, 0.305, 0.12, 0, 0, 0, 0.7, 0.7, 1.3));
  b.add(P.sphere(0.05, 0), COAT, M.t(0, 0.2, 0.165, 0, 0, 0, 0.9, 1, 0.9));
  b.add(P.sphere(0.078, 1), COAT, M.t(0, 0.27, -0.125, 0, 0, 0, 0.86, 1, 1.05));
  b.add(P.sphere(0.058, 1), COAT, M.t(0, 0.29, 0.17, 0, 0, 0, 0.8, 1, 1));
  b.add(P.sphere(0.08, 1), coat(0.92), M.t(0, 0.21, -0.01, 0, 0, 0, 0.8, 0.55, 1.5));
  for (const x of [-1, 1]) b.add(P.sphere(0.021, 0), COAT, M.t(x * 0.05, 0.308, -0.1));
  for (let k = 0; k < 3; k++) b.add(P.box(0.07, 0.035, 0.035), coat(0.84), M.t(0, 0.182, 0.1 - k * 0.06, 0.3, 0, 0));
  if (patched) {
    b.add(P.sphere(0.075, 0), C(0xf0ebe0), M.t(0, 0.25, 0.1, 0, 0, 0, 0.92, 0.98, 1.1));
    b.add(P.sphere(0.06, 0), C(0xf0ebe0), M.t(0, 0.2, -0.06, 0, 0, 0, 1.2, 0.6, 1.4));
  }
  return splitBody(facet(b.build()), spineY);
}

/** Tapir body: low wedge front, heavy high rounded rump, pale throat, stubby tail; split at the spine joint. */
export function tapirBodyHalves(spineY: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.19, 0.38, 4, 10), COAT, M.t(0, 0.36, -0.01, Math.PI / 2, 0, 0, 0.96, 1, 1.04));
  b.add(P.sphere(0.205, 1), COAT, M.t(0, 0.39, -0.21, 0, 0, 0, 1.02, 1.04, 1));
  b.add(P.sphere(0.17, 1), COAT, M.t(0, 0.35, 0.22, 0, 0, 0, 0.95, 1, 1.1));
  b.add(P.cyl(0.11, 0.15, dist([0, 0.37, 0.26], [0, 0.335, 0.45]), 9), COAT, span([0, 0.37, 0.26], [0, 0.335, 0.45], 1, 1.08));
  b.add(P.sphere(0.17, 1), coat(0.9), M.t(0, 0.25, 0, 0, 0, 0, 0.92, 0.55, 1.9));
  b.add(P.sphere(0.08, 1), C(0xcdbfa6), M.t(0, 0.27, 0.4, 0, 0, 0, 0.9, 0.8, 1.1));
  // Short bristly mane along the top of the neck.
  b.add(P.box(0.022, 0.03, 0.2), coat(0.7), M.t(0, 0.47, 0.33, 0.28, 0, 0));
  b.add(P.cone(0.03, 0.06, 5), COAT, M.t(0, 0.43, -0.415, -2.3, 0, 0));
  return splitBody(facet(b.build()), spineY);
}

/** Upper or lower leg segment hanging from its joint (rounded joint at the top). */
export function legSegment(len: number, r0: number, r1: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r0 * 1.08, 0), COAT, M.t(0, 0, 0));
  b.add(P.cyl(r1, r0, len, 6), COAT, M.t(0, -len / 2, 0));
  return facet(b.build());
}


/** Upper leg (upper arm / thigh) from the shoulder or hip: rounded joint and a muscle bulge. */
export function limbUpper(len: number, r0: number, r1: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r0 * 1.12, 0), COAT, M.t(0, 0, 0));
  b.add(P.cyl(r1, r0 * 1.05, len, 6), COAT, M.t(0, -len / 2, 0));
  b.add(P.sphere(r0 * 1.05, 0), COAT, M.t(0, -len * 0.35, -r0 * 0.15, 0, 0, 0, 1, 1.9, 1.15));
  return facet(b.build());
}

/**
 * Foot below the wrist / hock: a knobbly knee or hock joint, cannon, fetlock and a sloping pastern
 * ending in a split hoof with dew claws (pigs, goats) or a padded foot with three hoofed toes (tapirs).
 * The sole sits exactly `len` below the joint.
 */
export function footSegment(len: number, r: number, hoof: number, kind: 'split' | 'toes'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r * 1.28, 0), COAT, M.t(0, 0, 0, 0, 0, 0, 1, 1.15, 1.1));
  if (kind === 'split') {
    const hh = len * 0.22;
    const fl = -len + hh + len * 0.14;
    b.add(P.cyl(r * 0.78, r * 0.92, -fl, 6), COAT, M.t(0, fl / 2, 0));
    b.add(P.sphere(r * 0.92, 0), COAT, M.t(0, fl, -r * 0.08));
    b.add(P.cyl(r * 0.72, r * 0.8, len * 0.17, 6), coat(0.9), M.t(0, fl - len * 0.07, r * 0.18, -0.4, 0, 0));
    for (const x of [-1, 1]) {
      b.add(P.cyl(r * 0.4, r * 0.6, hh, 5), C(hoof), M.t(x * r * 0.4, -len + hh / 2, r * 0.38, -0.15, 0, x * 0.06));
      b.add(P.sphere(r * 0.26, 0), C(hoof), M.t(x * r * 0.45, fl - r * 0.1, -r * 0.8));
    }
  } else {
    const fl = -len * 0.7;
    b.add(P.cyl(r * 0.9, r, -fl, 6), COAT, M.t(0, fl / 2, 0));
    b.add(P.cyl(r * 1.12, r * 0.95, len * 0.32, 7), coat(0.85), M.t(0, -len + len * 0.16, r * 0.1));
    b.add(P.cyl(r * 1.08, r * 1.14, len * 0.06, 7), C(0x2a2420), M.t(0, -len + len * 0.03, r * 0.1));
    for (const x of [-0.62, 0, 0.62]) b.add(P.sphere(r * 0.4, 0), C(hoof), M.t(x * r, -len + r * 0.3, r * 0.95, 0, 0, 0, 1, 0.75, 1.2));
  }
  return facet(b.build());
}

// ---------------- Jointed monkey parts ----------------

/** Pelvis (hips) with the joint to the chest at y = 0.08. */
export function monkeyPelvis(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.046, 0.04, 3, 6), C(MONKEY), M.t(0, 0.05, 0));
  b.add(P.sphere(0.048, 1), C(MONKEY), M.t(0, 0.03, -0.005, 0, 0, 0, 1.1, 0.7, 1));
  b.add(P.sphere(0.03, 0), C(MONKEY_TAN), M.t(0, 0.05, 0.028, 0, 0, 0, 0.9, 1.1, 0.5));
  return facet(b.build());
}
/** Chest and shoulders above the waist joint (origin at the waist). */
export function monkeyChest(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.05, 0.04, 3, 6), C(MONKEY), M.t(0, 0.035, 0));
  b.add(P.sphere(0.034, 0), C(MONKEY_TAN), M.t(0, 0.03, 0.026, 0, 0, 0, 0.9, 1.2, 0.55));
  b.add(P.sphere(0.05, 1), C(MONKEY), M.t(0, 0.065, 0, 0, 0, 0, 1.25, 0.6, 0.9));
  return facet(b.build());
}
/** One limb segment (upper arm, forearm, thigh or shin) from its joint. */
export function monkeySeg(len: number, r0: number, r1: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r0 * 1.1, 0), C(MONKEY), M.t(0, 0, 0));
  b.add(P.cyl(r1, r0, len, 5), C(MONKEY), M.t(0, -len / 2, 0));
  return facet(b.build());
}
/** Long-fingered hand or foot from the wrist / ankle. */
export function monkeyHand(len: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.012, 0), C(MONKEY), M.t(0, 0, 0));
  b.add(P.box(0.022, len, 0.012), C(0x3a302a), M.t(0, -len / 2, 0.004));
  for (const x of [-0.007, 0, 0.007]) b.add(P.box(0.005, len * 0.45, 0.006), C(0x3a302a), M.t(x, -len * 1.1, 0.007, 0.3, 0, 0));
  return facet(b.build());
}

// ---------------- Decorative reef fish ----------------

export { fishGeometry } from "./fishModels";
export type { FishType } from "./fishModels";

/** Chicken tucked under an arm, for islanders carrying a captured hen. */
export function carriedChicken(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.13, 1), C(0xf6f0e4), M.t(0, 0, 0, 0, 0, 0, 1, 0.9, 1.3));
  b.add(P.sphere(0.07, 0), C(0xf6f0e4), M.t(0, 0.1, 0.13));
  b.add(P.box(0.02, 0.05, 0.06), C(0xd62f22), M.t(0, 0.17, 0.13));
  b.add(P.cone(0.02, 0.05, 4), C(0xe8b030), M.t(0, 0.1, 0.21, Math.PI / 2, 0, 0));
  // Wattle, eyes, folded wings and a tail fan (same size and pivot as before).
  b.add(P.sphere(0.014, 0), C(0xd62f22), M.t(0, 0.06, 0.18, 0, 0, 0, 0.7, 1.4, 0.9));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.011, 0), C(0x120c0a), M.t(x * 0.052, 0.12, 0.16));
    b.add(P.sphere(0.09, 0), C(0xe6ddcc), M.t(x * 0.1, 0.01, -0.02, 0.15, 0, 0, 0.35, 0.75, 1.25));
  }
  for (let k = -1; k <= 1; k++) b.add(P.box(0.012, 0.13, 0.07), C(0xece4d4), rod(0.13, [k * 0.02, 0.04, -0.14], -0.7, 0, -k * 0.3));
  return facet(b.build());
}
