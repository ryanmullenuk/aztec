import * as THREE from 'three';
import { GeoBuilder, M, P, facet } from '../render/GeoBuilder';

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

export function chickenWing(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.box(0.07, 0.012, 0.06), coat(0.9), M.t(0.035, 0, 0));
  return facet(b.build());
}

// ---------------- Pigs ----------------

export function pigBody(spotted: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.11, 0.18, 3, 7), COAT, M.t(0, 0.17, 0, Math.PI / 2, 0, 0, 1, 1, 0.95));
  // Curly tail.
  b.add(P.torus(0.016, 0.006, 3, 8), coat(0.85), M.t(0, 0.2, -0.21, 0, Math.PI / 2, 0));
  if (spotted) {
    for (const [x, y, z, r] of [[0.08, 0.22, 0.05, 0.05], [-0.06, 0.24, -0.08, 0.06], [0.05, 0.16, -0.12, 0.04], [-0.09, 0.15, 0.1, 0.035]]) {
      b.add(P.sphere(r, 0), C(0x2e2622), M.t(x * 1.25, y, z, 0, 0, 0, 1, 0.5, 1));
    }
  }
  return facet(b.build());
}

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

export function goatBody(patched: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.085, 0.2, 3, 7), COAT, M.t(0, 0.25, 0, Math.PI / 2, 0, 0));
  b.add(P.cone(0.03, 0.06, 4), COAT, M.t(0, 0.29, -0.2, -2.2, 0, 0));
  if (patched) {
    b.add(P.sphere(0.075, 0), C(0xf0ebe0), M.t(0, 0.24, 0.1, 0, 0, 0, 1.05, 0.95, 1.1));
    b.add(P.sphere(0.06, 0), C(0xf0ebe0), M.t(0, 0.19, -0.06, 0, 0, 0, 1.2, 0.6, 1.4));
  }
  return facet(b.build());
}

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

export function tapirBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.2, 0.42, 3, 8), COAT, M.t(0, 0.34, 0, Math.PI / 2, 0, 0, 1, 1.05, 1));
  // Pale saddle across the chest and shoulders, as in the reference.
  b.add(P.cyl(0.205, 0.205, 0.16, 8), C(0xc8b8a2), M.t(0, 0.33, 0.22, Math.PI / 2, 0, 0, 1.01, 1, 1.06));
  b.add(P.cone(0.03, 0.06, 4), COAT, M.t(0, 0.38, -0.42, -2.3, 0, 0));
  return facet(b.build());
}

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

export function monkeyTorso(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.05, 0.1, 3, 6), C(MONKEY), M.t(0, 0.08, 0));
  b.add(P.sphere(0.04, 1), C(MONKEY_TAN), M.t(0, 0.085, 0.024, 0, 0, 0, 0.85, 1.35, 0.55));
  // Shoulders and hips a touch wider than the capsule.
  b.add(P.sphere(0.05, 1), C(MONKEY), M.t(0, 0.145, 0, 0, 0, 0, 1.25, 0.6, 0.9));
  b.add(P.sphere(0.048, 1), C(MONKEY), M.t(0, 0.03, -0.005, 0, 0, 0, 1.1, 0.7, 1));
  return facet(b.build());
}
export function monkeyHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.045, 1), C(MONKEY), M.t(0, 0.04, 0));
  b.add(P.sphere(0.028, 0), C(0x6e5a48), M.t(0, 0.03, 0.03, 0, 0, 0, 1, 0.9, 0.7));
  for (const x of [-1, 1]) b.add(P.sphere(0.007, 0), C(0x080606), M.t(x * 0.014, 0.045, 0.045));
  return facet(b.build());
}
export function monkeyLimb(len: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.012, 0.016, len, 5), C(MONKEY), M.t(0, -len / 2, 0));
  b.add(P.sphere(0.017, 0), C(MONKEY), M.t(0, -len, 0.005));
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
  b.add(P.sphere(0.06, 1), C(0xfafaf6), M.t(0, 0, 0, 0, 0, 0, 0.75, 0.75, 1.5));
  b.add(P.sphere(0.04, 1), C(0xfafaf6), M.t(0, 0.035, 0.085));
  b.add(P.cone(0.012, 0.05, 4), C(0xf2b030), M.t(0, 0.03, 0.135, Math.PI / 2, 0, 0));
  b.add(P.box(0.06, 0.01, 0.07), C(0x9aa0a8), M.t(0, 0.02, -0.07));
  b.add(P.box(0.03, 0.008, 0.03), C(0x1a1a1a), M.t(0, 0.01, -0.12));
  for (const x of [-1, 1]) b.add(P.sphere(0.006, 0), C(0x151010), M.t(x * 0.022, 0.045, 0.1));
  return facet(b.build());
}

/** Wing along +x from the shoulder; `tip` colours the outer part (black gull tips). */
export function wingGeometry(len: number, w: number, base: number, tip: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.box(len * 0.6, 0.01, w), C(base), M.t(len * 0.3, 0, 0));
  b.add(P.box(len * 0.42, 0.008, w * 0.75), C(tip), M.t(len * 0.78, 0, -w * 0.08, 0, -0.15, 0));
  return facet(b.build());
}

export function birdLegs(color: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const x of [-1, 1]) b.add(P.cyl(0.004, 0.004, 0.05, 3), C(color), M.t(x * 0.015, -0.045, 0));
  return facet(b.build());
}

// ---------------- Decorative reef fish ----------------

export type FishType = 'blueYellow' | 'yellow' | 'clown' | 'idol' | 'silver' | 'tang';

export function fishGeometry(t: FishType): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const body = (len: number, h: number, col: (p: THREE.Vector3) => THREE.Color) => b.add(P.sphere(0.5, 1), { color: col, sway: 0.05 }, M.t(0, 0, 0, 0, 0, 0, 0.35 * h, h, len));
  const tail = (col: number, s = 1) => b.add(P.cone(0.05 * s, 0.07 * s, 4), { color: col, sway: 0.9 }, M.t(0, 0, -0.1 * s, -Math.PI / 2, 0, 0, 0.3, 1, 1));
  const eye = (z: number, y = 0.012) => { for (const x of [-1, 1]) b.add(P.sphere(0.008, 0), C(0x0a0a0c), M.t(x * 0.018, y, z)); };
  switch (t) {
    case 'blueYellow':
      body(0.16, 0.07, () => new THREE.Color(0x2a4ac8));
      tail(0xf2d030);
      eye(0.05);
      break;
    case 'yellow':
      body(0.15, 0.08, () => new THREE.Color(0xf2d42e));
      tail(0xe8c020);
      eye(0.05);
      break;
    case 'clown':
      body(0.12, 0.07, (p) => new THREE.Color(Math.abs(p.z - 0.02) < 0.012 || Math.abs(p.z + 0.03) < 0.01 ? 0xf8f6f0 : 0xf07024));
      tail(0xf07024, 0.8);
      eye(0.045);
      break;
    case 'idol':
      body(0.1, 0.13, (p) => new THREE.Color(p.z > 0.02 ? 0xf4f0e0 : p.z > -0.015 ? 0x151515 : 0xf2d030));
      b.add(P.box(0.006, 0.12, 0.03), C(0xf4f0e0), M.t(0, 0.11, -0.01, -0.5, 0, 0));
      tail(0x151515, 0.8);
      eye(0.035, 0.02);
      break;
    case 'silver':
      body(0.17, 0.06, (p) => new THREE.Color(p.y > 0 ? 0x7fa898 : 0xd8e4dc));
      tail(0x8fb0a0);
      eye(0.055);
      break;
    case 'tang':
      body(0.2, 0.12, (p) => new THREE.Color(p.y > 0.02 && p.z > -0.04 ? 0x10205c : 0x2a5ad8));
      tail(0xf2d030, 1.2);
      eye(0.06, 0.02);
      break;
  }
  return facet(b.build());
}

/** Chicken tucked under an arm, for islanders carrying a captured hen. */
export function carriedChicken(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.13, 1), C(0xf6f0e4), M.t(0, 0, 0, 0, 0, 0, 1, 0.9, 1.3));
  b.add(P.sphere(0.07, 0), C(0xf6f0e4), M.t(0, 0.1, 0.13));
  b.add(P.box(0.02, 0.05, 0.06), C(0xd62f22), M.t(0, 0.17, 0.13));
  b.add(P.cone(0.02, 0.05, 4), C(0xe8b030), M.t(0, 0.1, 0.21, Math.PI / 2, 0, 0));
  return facet(b.build());
}
