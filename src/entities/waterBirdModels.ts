import * as THREE from 'three';
import { ColorFn, GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { WingSpec } from './birdWings';

/**
 * Pelicans and herons, in parts for jointed animation. Every part faces +z with its pivot at
 * the origin: body (centre), two neck segments (base, running up +y), head (bill along +z),
 * legs (hip, running down −y) and the shared jointed wings.
 */

const C = (c: number) => ({ color: c });
const col = (c: number): ColorFn => () => new THREE.Color(c);

// ---------------- Pelican ----------------

export const PEL = {
  body: 0.07,
  /** Neck segment lengths, leg length and wing root in the body frame. */
  neck: [0.075, 0.06] as [number, number],
  neckBase: [0, 0.035, 0.085] as [number, number, number],
  hip: [0, -0.045, -0.005] as [number, number, number],
  leg: 0.075,
  wingRoot: [0.045, 0.028, 0.035] as [number, number, number],
};

export function pelicanBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const back = new THREE.Color(0x8e857a), belly = new THREE.Color(0xc4bcb0);
  b.add(P.sphere(PEL.body, 1), { color: (p) => back.clone().lerp(belly, THREE.MathUtils.smoothstep(-p.y, -0.02, 0.04)) }, M.t(0, 0, 0, 0, 0, 0, 1, 0.82, 1.55));
  // Short wedge tail and a pale breast.
  b.add(P.cone(0.04, 0.07, 4), C(0x6e665c), M.t(0, 0.012, -0.12, -1.75, 0, 0, 1, 0.35, 1));
  b.add(P.sphere(0.045, 1), C(0xe8e2d2), M.t(0, 0.01, 0.075, 0, 0, 0, 0.9, 0.95, 0.8));
  return facet(b.build());
}

export function pelicanNeck(k: 0 | 1): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = PEL.neck[k];
  b.add(P.sphere(k ? 0.018 : 0.024, 0), C(0xf0ead8), M.t(0, 0, 0));
  b.add(P.cyl(k ? 0.017 : 0.02, k ? 0.02 : 0.026, L, 6), C(k ? 0xf0ead8 : 0x7a5a3c), M.t(0, L / 2, 0));
  return facet(b.build());
}

/** Head: small cream crown, long flat bill with a hooked tip and the big throat pouch beneath. */
export function pelicanHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.028, 1), C(0xf2ecd8), M.t(0, 0.008, 0));
  b.add(P.sphere(0.018, 0), C(0xe8c860), M.t(0, 0.026, -0.004, 0, 0, 0, 1, 0.5, 1.2));
  // Upper mandible.
  b.add(P.box(0.026, 0.012, 0.19), C(0xd8a24a), M.t(0, 0.004, 0.11, -0.03, 0, 0));
  b.add(P.cone(0.008, 0.02, 4), C(0xb04a2a), M.t(0, -0.004, 0.207, 2.4, 0, 0));
  // Throat pouch: a pale, deep scoop tapering toward the bill tip.
  b.add(P.sphere(0.04, 1), C(0xc89a62), M.t(0, -0.022, 0.1, 0, 0, 0, 0.55, 0.62, 2.3));
  for (const x of [-1, 1]) b.add(P.sphere(0.006, 0), C(0x141010), M.t(x * 0.02, 0.014, 0.012));
  return facet(b.build());
}

/** Short grey leg with a big webbed foot. */
export function pelicanLeg(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = PEL.leg;
  b.add(P.cyl(0.008, 0.011, L, 5), C(0x4a4642), M.t(0, -L / 2, 0));
  b.add(P.box(0.05, 0.006, 0.05), C(0x3e3a36), M.t(0, -L, 0.018, 0, Math.PI / 4, 0));
  return facet(b.build());
}

const pelUpper: ColorFn = (_p, n) => new THREE.Color(n.y > 0.1 ? 0x8a8276 : 0xb8b0a4);
const pelTip: ColorFn = (p, n) => new THREE.Color(p.x > 0.05 ? 0x26221e : n.y > 0.1 ? 0x6e675e : 0x9a9286);
export const PELICAN_WING: WingSpec = {
  thick: 0.016,
  segs: [
    { len: 0.11, c0: 0.1, c1: 0.095, sweep: 0.0, color: pelUpper },
    { len: 0.1, c0: 0.095, c1: 0.085, sweep: 0.012, color: pelUpper },
    { len: 0.14, c0: 0.085, c1: 0.03, sweep: 0.035, color: pelTip },
  ],
};

// ---------------- Heron ----------------

export const HER = {
  neck: [0.085, 0.085] as [number, number],
  neckBase: [0, 0.02, 0.07] as [number, number, number],
  hip: [0.018, -0.02, -0.005] as [number, number, number],
  /** Upper (feathered) and lower (bare, long) leg lengths. */
  legU: 0.075,
  legL: 0.16,
  wingRoot: [0.03, 0.025, 0.035] as [number, number, number],
};

export function heronBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const back = new THREE.Color(0x76848e), belly = new THREE.Color(0xa6b0b6);
  b.add(P.sphere(0.05, 1), { color: (p) => back.clone().lerp(belly, THREE.MathUtils.smoothstep(-p.y, -0.01, 0.03)) }, M.t(0, 0, 0, 0.18, 0, 0, 0.85, 0.85, 1.8));
  // Shaggy breast plumes and long back plumes trailing over the tail.
  for (let k = 0; k < 3; k++) b.add(P.cone(0.012, 0.06, 3), C(0xc8ccc6), M.t((k - 1) * 0.01, -0.015, 0.07, 2.6, 0, 0));
  b.add(P.cone(0.035, 0.09, 4), C(0x5e6a74), M.t(0, 0.012, -0.1, -1.7, 0, 0, 1, 0.3, 1));
  return facet(b.build());
}

export function heronNeck(k: 0 | 1): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = HER.neck[k];
  b.add(P.sphere(k ? 0.011 : 0.014, 0), C(0xc4c8c6), M.t(0, 0, 0));
  b.add(P.cyl(k ? 0.01 : 0.012, k ? 0.012 : 0.016, L, 6), C(k ? 0xd4d6d2 : 0xb8bcbc), M.t(0, L / 2, 0));
  // The dark streak down the front of the neck.
  b.add(P.box(0.004, L * 0.9, 0.003), C(0x3a3e44), M.t(0, L / 2, 0.011));
  return facet(b.build());
}

/** Head: white face, black crest stripe running back into a plume, long yellow dagger bill. */
export function heronHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.018, 1), C(0xeeeeea), M.t(0, 0, 0, 0, 0, 0, 1, 0.95, 1.2));
  b.add(P.box(0.03, 0.006, 0.03), C(0x1c1e22), M.t(0, 0.014, -0.004));
  b.add(P.cone(0.004, 0.06, 3), C(0x1c1e22), M.t(0, 0.012, -0.045, -1.9, 0, 0));
  b.add(P.cone(0.009, 0.1, 5), C(0xd8b040), M.t(0, -0.002, 0.066, Math.PI / 2, 0, 0));
  for (const x of [-1, 1]) b.add(P.sphere(0.004, 0), C(0xe8c030), M.t(x * 0.014, 0.004, 0.01));
  return facet(b.build());
}

export function heronLegUpper(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.006, 0.01, HER.legU, 5), C(0x8e989c), M.t(0, -HER.legU / 2, 0));
  return facet(b.build());
}

/** Long bare lower leg with three spread forward toes and a hind toe. */
export function heronLegLower(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = HER.legL;
  b.add(P.sphere(0.006, 0), C(0x9c9460), M.t(0, 0, 0));
  b.add(P.cyl(0.004, 0.005, L, 4), C(0xa09860), M.t(0, -L / 2, 0));
  for (const a of [-0.45, 0, 0.45]) b.add(P.box(0.003, 0.003, 0.045), C(0x8a8250), M.t(Math.sin(a) * 0.02, -L, Math.cos(a) * 0.02, 0, a, 0));
  b.add(P.box(0.003, 0.003, 0.025), C(0x8a8250), M.t(0, -L, -0.012));
  return facet(b.build());
}

const herUpper: ColorFn = (_p, n) => new THREE.Color(n.y > 0.1 ? 0x76848e : 0x9aa4aa);
const herTip: ColorFn = (p) => new THREE.Color(p.x > 0.04 ? 0x22262c : 0x5a6670);
export const HERON_WING: WingSpec = {
  thick: 0.012,
  segs: [
    { len: 0.095, c0: 0.085, c1: 0.082, sweep: 0.0, color: herUpper },
    { len: 0.09, c0: 0.082, c1: 0.075, sweep: 0.01, color: herUpper },
    { len: 0.12, c0: 0.075, c1: 0.035, sweep: 0.03, color: herTip },
  ],
};

/** A small silver fish held crosswise in a bill while swallowing. */
export function heldFish(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.02, 1), { color: (p) => new THREE.Color(p.y > 0 ? 0x5a8a94 : 0xdce6e4) }, M.t(0, 0, 0, 0, 0, 0, 2.3, 0.7, 0.45));
  b.add(P.cone(0.014, 0.022, 3), { color: col(0x7aa0a8) }, M.t(-0.055, 0, 0, 0, 0, Math.PI / 2, 1, 1, 0.3));
  return facet(b.build());
}

