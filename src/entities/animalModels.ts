import * as THREE from 'three';
import { ColorFn, GeoBuilder, M, P, facet } from '../render/GeoBuilder';

/**
 * Faceted low-poly animal parts, in world units (islanders stand ~0.62 tall).
 * Vertices tagged mat 2 are the "coat" and take a per-animal colour (so one mesh serves
 * white, brown and black chickens, pink and dark pigs, and so on). Parts face +z.
 */

const COAT = { color: 0xffffff, mat: 2 };
const coat = (shade: number) => ({ color: new THREE.Color(shade, shade, shade), mat: 2 });
const C = (c: number) => ({ color: c });

// ---------------- Chickens ----------------

export function chickenBody(kind: 'hen' | 'speckled' | 'rooster'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const big = kind === 'rooster' ? 1.2 : 1;
  b.add(P.sphere(0.07, 1), COAT, M.t(0, 0.085, 0, 0, 0, 0, 1 * big, 0.95 * big, 1.25 * big));
  b.add(P.sphere(0.045, 0), coat(0.92), M.t(0, 0.105, -0.075 * big, 0.4, 0, 0, 1, 1, 1.2));
  if (kind === 'rooster') {
    // Sickle tail feathers, dark green, and a cream neck hackle.
    for (let k = 0; k < 4; k++) b.add(P.box(0.02, 0.14 - k * 0.015, 0.012), C(k % 2 ? 0x1f4a3e : 0x16362e), M.t((k - 1.5) * 0.012, 0.16, -0.11, -0.7 + k * 0.12, 0, 0));
    b.add(P.cyl(0.035, 0.05, 0.06, 6), C(0xf2e3c4), M.t(0, 0.13, 0.06, 0.4, 0, 0));
  }
  if (kind === 'speckled') {
    for (let k = 0; k < 16; k++) {
      const a = k * 2.4, y = 0.06 + ((k * 37) % 7) * 0.012;
      b.add(P.box(0.014, 0.012, 0.004), C(0x3a3028), M.t(Math.cos(a) * 0.068, y, Math.sin(a) * 0.08, 0, -a, 0));
    }
  }
  return facet(b.build());
}

export function chickenHead(rooster: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const s = rooster ? 1.2 : 1;
  b.add(P.sphere(0.034 * s, 0), COAT, M.t(0, 0.02, 0.01));
  b.add(P.cone(0.012, 0.03, 4), C(0xe8b030), M.t(0, 0.018, 0.045 * s, Math.PI / 2, 0, 0));
  b.add(P.box(0.012, 0.025 * s * s, 0.04 * s), C(0xd62f22), M.t(0, 0.055 * s, 0.008));
  b.add(P.sphere(0.009 * s, 0), C(0xd62f22), M.t(0, -0.005, 0.03));
  for (const x of [-1, 1]) b.add(P.sphere(0.006, 0), C(0x151010), M.t(x * 0.027, 0.028, 0.02));
  return facet(b.build());
}

// ---------------- Pigs ----------------

export function pigHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.085, 1), COAT, M.t(0, 0, 0.03, 0, 0, 0, 1, 0.92, 1));
  b.add(P.cyl(0.042, 0.048, 0.05, 7), coat(0.82), M.t(0, -0.012, 0.11, Math.PI / 2, 0, 0));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.009, 0), C(0x3a2420), M.t(x * 0.016, -0.012, 0.137));
    b.add(P.cone(0.035, 0.06, 4), coat(0.9), M.t(x * 0.052, 0.07, 0.01, -0.3, 0, x * -0.5));
    b.add(P.sphere(0.011, 0), C(0x141010), M.t(x * 0.04, 0.025, 0.09));
  }
  return facet(b.build());
}

// ---------------- Goats ----------------

export function goatHead(curly: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.035, 0.045, 0.12, 6), COAT, M.t(0, 0.0, 0.0, 0.7, 0, 0));
  b.add(P.sphere(0.052, 1), COAT, M.t(0, 0.06, 0.06, 0, 0, 0, 0.85, 0.85, 1.3));
  b.add(P.cone(0.018, 0.05, 4), C(0xe6e0d0), M.t(0, 0.01, 0.1, Math.PI, 0, 0));
  for (const x of [-1, 1]) {
    if (curly) b.add(P.torus(0.03, 0.009, 3, 8, ), C(0x6e5a40), M.t(x * 0.03, 0.12, 0.03, 0, Math.PI / 2, 0));
    else b.add(P.cone(0.012, 0.09, 4), C(0x6e5a40), M.t(x * 0.022, 0.13, 0.02, -0.55, 0, x * -0.15));
    b.add(P.box(0.05, 0.015, 0.02), coat(0.9), M.t(x * 0.055, 0.07, 0.04, 0, 0, x * -0.3));
    b.add(P.sphere(0.008, 0), C(0x141010), M.t(x * 0.036, 0.075, 0.09));
  }
  return facet(b.build());
}

// ---------------- Tapirs ----------------

export function tapirHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.13, 1), COAT, M.t(0, 0, 0.05, 0, 0, 0, 0.85, 0.95, 1.15));
  b.add(P.box(0.18, 0.12, 0.08), C(0xc8b8a2), M.t(0, -0.03, 0.0));
  // Short trunk-like snout.
  b.add(P.cyl(0.04, 0.06, 0.16, 6), coat(0.88), M.t(0, -0.05, 0.2, 1.9, 0, 0));
  for (const x of [-1, 1]) {
    b.add(P.cone(0.04, 0.08, 5), coat(0.95), M.t(x * 0.08, 0.12, -0.02, -0.2, 0, x * -0.3));
    b.add(P.cone(0.025, 0.05, 5), C(0xb06a6a), M.t(x * 0.08, 0.12, -0.005, -0.2, 0, x * -0.3));
    b.add(P.sphere(0.012, 0), C(0x0e0c0a), M.t(x * 0.075, 0.03, 0.1));
  }
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

/** Pig body with shoulders, hams and belly; split at the spine joint. */
export function pigBodyHalves(spotted: boolean, spineY: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.11, 0.2, 4, 8), COAT, M.t(0, 0.17, 0, Math.PI / 2, 0, 0, 1, 1, 0.95));
  b.add(P.sphere(0.1, 1), COAT, M.t(0, 0.18, 0.1, 0, 0, 0, 1.12, 1, 1.05));
  b.add(P.sphere(0.105, 1), COAT, M.t(0, 0.18, -0.11, 0, 0, 0, 1.15, 1, 1));
  b.add(P.sphere(0.1, 1), coat(0.9), M.t(0, 0.125, 0, 0, 0, 0, 0.95, 0.55, 1.7));
  b.add(P.torus(0.016, 0.006, 3, 8), coat(0.85), M.t(0, 0.21, -0.235, 0, Math.PI / 2, 0));
  if (spotted) {
    for (const [x, y, z, r] of [[0.08, 0.22, 0.05, 0.05], [-0.06, 0.24, -0.08, 0.06], [0.05, 0.16, -0.12, 0.04], [-0.09, 0.15, 0.1, 0.035]]) {
      b.add(P.sphere(r, 0), C(0x2e2622), M.t(x * 1.3, y, z, 0, 0, 0, 1, 0.5, 1));
    }
  }
  return splitBody(facet(b.build()), spineY);
}

/** Goat body: deep chest, lean haunch, short upturned tail, shaggy belly fringe. */
export function goatBodyHalves(patched: boolean, spineY: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.085, 0.22, 4, 8), COAT, M.t(0, 0.26, 0, Math.PI / 2, 0, 0));
  b.add(P.sphere(0.09, 1), COAT, M.t(0, 0.265, 0.12, 0, 0, 0, 0.95, 1.08, 1));
  b.add(P.sphere(0.086, 1), COAT, M.t(0, 0.275, -0.12, 0, 0, 0, 1.02, 1, 1));
  b.add(P.cone(0.028, 0.07, 4), COAT, M.t(0, 0.31, -0.21, -2.4, 0, 0));
  for (let k = 0; k < 5; k++) b.add(P.box(0.08, 0.035, 0.035), coat(0.85), M.t(0, 0.185, -0.1 + k * 0.05, 0.2, 0, 0));
  if (patched) {
    b.add(P.sphere(0.075, 0), C(0xf0ebe0), M.t(0, 0.25, 0.1, 0, 0, 0, 1.12, 0.95, 1.1));
    b.add(P.sphere(0.06, 0), C(0xf0ebe0), M.t(0, 0.2, -0.06, 0, 0, 0, 1.3, 0.6, 1.4));
  }
  return splitBody(facet(b.build()), spineY);
}

/** Tapir body: heavy barrel, high rounded rump, pale saddle, stubby tail. */
export function tapirBodyHalves(spineY: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.2, 0.42, 4, 9), COAT, M.t(0, 0.35, 0, Math.PI / 2, 0, 0, 1, 1.05, 1));
  b.add(P.sphere(0.205, 1), COAT, M.t(0, 0.39, -0.22, 0, 0, 0, 1.02, 1.02, 1));
  b.add(P.sphere(0.19, 1), COAT, M.t(0, 0.35, 0.25, 0, 0, 0, 1, 1, 1.05));
  b.add(P.cyl(0.207, 0.207, 0.18, 9), C(0xc8b8a2), M.t(0, 0.35, 0.2, Math.PI / 2, 0, 0, 1.01, 1, 1.06));
  b.add(P.cone(0.03, 0.06, 4), COAT, M.t(0, 0.42, -0.44, -2.3, 0, 0));
  return splitBody(facet(b.build()), spineY);
}

/** Upper or lower leg segment hanging from its joint (rounded joint at the top). */
export function legSegment(len: number, r0: number, r1: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r0 * 1.08, 0), COAT, M.t(0, 0, 0));
  b.add(P.cyl(r1, r0, len, 6), COAT, M.t(0, -len / 2, 0));
  return facet(b.build());
}

/** Foot below the wrist / ankle: short pastern and a hoof (split for pigs and goats, toes for tapirs). */
export function footSegment(len: number, r: number, hoof: number, kind: 'split' | 'toes'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r * 1.05, 0), COAT, M.t(0, 0, 0));
  b.add(P.cyl(r * 0.9, r, len * 0.6, 6), COAT, M.t(0, -len * 0.3, 0));
  if (kind === 'split') {
    for (const x of [-1, 1]) b.add(P.box(r * 0.95, len * 0.42, r * 1.9), C(hoof), M.t(x * r * 0.52, -len * 0.79, r * 0.25, 0.12, 0, 0));
  } else {
    b.add(P.cyl(r * 1.15, r * 1.25, len * 0.35, 7), C(hoof), M.t(0, -len * 0.82, r * 0.15));
    for (const x of [-0.6, 0, 0.6]) b.add(P.sphere(r * 0.42, 0), C(0x2a2420), M.t(x * r, -len * 0.92, r * 1.05));
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
  return facet(b.build());
}
