import * as THREE from 'three';
import { ColorFn, GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { WingSpec } from './birdWings';

/**
 * Pelicans and herons, in parts for jointed animation. Every part faces +z with its pivot at
 * the origin: body (centre), neck segments (base, running up +y), head (bill along +z), the
 * pelican's lower jaw and throat pouch (hinged at the gape), legs (hip, running down −y), feet
 * (toe joint) and the shared jointed wings.
 */

const C = (c: number) => ({ color: c });
const col = (c: number): ColorFn => () => new THREE.Color(c);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface BillSpec {
  z0: number;
  y0: number;
  len: number;
  h0: number;
  h1: number;
  w0: number;
  w1: number;
  curve: number;
  hook: number;
  segs: number;
  /** Flatten the top (pelican) instead of a ridged culmen (heron dagger). */
  flat?: boolean;
}

/** A tapered bill (or mandible) running forward along +z, with an optional hooked tip. */
function billGeo(o: BillSpec): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 2, o.segs);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getZ(i) + 0.5;
    const v = p.getY(i) + 0.5;
    const h = lerp(o.h0, o.h1, u), w = lerp(o.w0, o.w1, u);
    let y = o.y0 + (v - 0.5) * h - o.curve * u * u;
    if (u > 0.8) y -= o.hook * ((u - 0.8) / 0.2) ** 2 * (0.3 + 0.7 * v);
    const x = p.getX(i) * w * (!o.flat && v > 0.75 ? 0.55 : 1);
    p.setXYZ(i, x, y, o.z0 + u * o.len);
  }
  return g;
}

/** Leg segment hanging from its joint, with a rounded joint at the top. */
function legSeg(len: number, r0: number, r1: number, color: number | ColorFn): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r0 * 1.15, 0), { color });
  b.add(P.cyl(r1, r0, len, 5), { color }, M.t(0, -len / 2, 0));
  return facet(b.build());
}

// ---------------- Pelican ----------------

export const PEL = {
  body: 0.07,
  /** Neck segment lengths, leg length and wing root in the body frame. */
  neck: [0.075, 0.06] as [number, number],
  neckBase: [0, 0.035, 0.085] as [number, number, number],
  hip: [0, -0.045, -0.005] as [number, number, number],
  leg: 0.075,
  wingRoot: [0.045, 0.028, 0.035] as [number, number, number],
  /** Hinge of the lower jaw in the head frame. */
  gape: [0, -0.004, 0.016] as [number, number, number],
};

export function pelicanBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const back = new THREE.Color(0x8e857a), belly = new THREE.Color(0xb4ac9e);
  // Heavy, broad-chested body with a keel, silvery-grey streaked back.
  b.add(P.sphere(PEL.body, 1), {
    color: (p) => back.clone().lerp(belly, THREE.MathUtils.smoothstep(-p.y, -0.02, 0.04)).multiplyScalar(1 + 0.06 * Math.sin(p.z * 90 + p.x * 40)),
  }, M.t(0, 0, 0, 0, 0, 0, 1, 0.82, 1.55));
  b.add(P.sphere(0.05, 1), C(0x9e958a), M.t(0, -0.022, 0.045, 0, 0, 0, 0.95, 0.8, 1.2));
  // Short, rounded dark tail and the pale breast below the neck.
  b.add(P.cone(0.042, 0.075, 5), C(0x5e564c), M.t(0, 0.014, -0.12, -1.72, 0, 0, 1, 0.32, 1));
  b.add(P.sphere(0.045, 1), C(0xe8e2d2), M.t(0, 0.012, 0.078, 0, 0, 0, 0.88, 0.95, 0.78));
  return facet(b.build());
}

export function pelicanNeck(k: 0 | 1): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = PEL.neck[k];
  // Thick neck: dark chestnut nape stripe behind, cream in front.
  const neckCol: ColorFn = (p) => new THREE.Color(k === 0 && p.z < -0.006 ? 0x6a4a30 : k === 0 ? 0xe8dcc0 : 0xf0ead8);
  b.add(P.sphere(k ? 0.019 : 0.025, 0), { color: neckCol });
  b.add(P.cyl(k ? 0.017 : 0.02, k ? 0.021 : 0.027, L, 7), { color: neckCol }, M.t(0, L / 2, 0));
  return facet(b.build());
}

/** Head with the upper mandible: small cream crown with a yellow wash, long flat bill with a red hooked nail. */
export function pelicanHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.028, 1), C(0xf2ecd8), M.t(0, 0.008, 0, 0, 0, 0, 0.95, 1, 1.05));
  b.add(P.sphere(0.018, 0), C(0xe8c860), M.t(0, 0.026, -0.004, 0, 0, 0, 1, 0.5, 1.2));
  // Bare skin around the eye, and the eye.
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.008, 0), C(0xa8b0a0), M.t(x * 0.019, 0.012, 0.014, 0, 0, 0, 0.6, 1, 1.2));
    b.add(P.sphere(0.0048, 0), C(0xe8e0b0), M.t(x * 0.022, 0.013, 0.015));
    b.add(P.sphere(0.0025, 0), C(0x101010), M.t(x * 0.0245, 0.0132, 0.016));
  }
  // Upper mandible: long, flat, ridged down the middle, greyish at the base warming to orange,
  // with the red hooked nail at the tip.
  const up: BillSpec = { z0: 0.012, y0: 0.004, len: 0.2, h0: 0.014, h1: 0.009, w0: 0.03, w1: 0.022, curve: 0.004, hook: 0.012, segs: 6, flat: true };
  b.add(billGeo(up), { color: (p) => new THREE.Color(p.z > 0.198 ? 0xb03a22 : p.z > 0.1 ? 0xd8a24a : 0xb89a70) });
  b.add(P.box(0.006, 0.004, 0.17), C(0xc8903c), M.t(0, 0.012, 0.11, -0.02, 0, 0));
  return facet(b.build());
}

/**
 * Lower jaw with the throat pouch slung between its two thin mandibles, from the gape hinge.
 * The pouch is its own rounded bag underneath so it can be distended (scaled in y) when full.
 */
export function pelicanJaw(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const x of [-1, 1]) b.add(P.box(0.005, 0.006, 0.19), C(0xc89458), M.t(x * 0.012, -0.004, 0.095, 0, x * -0.02, 0));
  b.add(P.box(0.022, 0.004, 0.012), C(0xb03a22), M.t(0, -0.002, 0.188));
  // Pouch: a deep scoop tapering toward the tip, darker near the throat.
  b.add(P.sphere(0.04, 1), { color: (p) => new THREE.Color(p.z < 0.05 ? 0x8a7050 : 0xa8865a) }, M.t(0, -0.022, 0.085, 0.05, 0, 0, 0.5, 0.58, 2.2));
  return facet(b.build());
}

/** Short, stout grey leg (tarsus) from the hip. */
export function pelicanLeg(): THREE.BufferGeometry {
  return legSeg(PEL.leg, 0.011, 0.008, 0x4a4642);
}

/** Big totipalmate foot: all four toes joined by the web; pivot at the toe joint. */
export function pelicanFoot(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.009, 0), C(0x3e3a36));
  for (const a of [-0.55, -0.18, 0.18, 0.55]) b.add(P.box(0.006, 0.006, 0.05), C(0x3a3632), M.t(Math.sin(a) * 0.025, -0.003, Math.cos(a) * 0.025, 0, a, 0));
  b.add(P.cone(0.03, 0.05, 3), C(0x46403a), M.t(0, -0.004, 0.024, Math.PI / 2, 0, 0, 1, 1, 0.1));
  return facet(b.build());
}

const pelUpper: ColorFn = (p, n) => new THREE.Color(n.y > 0.1 ? (p.z < -0.06 ? 0x5e574e : 0x8a8276) : 0xb8b0a4);
const pelTip: ColorFn = (p, n) => new THREE.Color(p.x > 0.05 ? 0x26221e : n.y > 0.1 ? 0x6e675e : 0x9a9286);
export const PELICAN_WING: WingSpec = {
  thick: 0.016,
  fingers: 5,
  segs: [
    { len: 0.11, c0: 0.1, c1: 0.095, sweep: 0.0, color: pelUpper },
    { len: 0.1, c0: 0.095, c1: 0.085, sweep: 0.012, color: pelUpper },
    { len: 0.13, c0: 0.085, c1: 0.045, sweep: 0.03, color: pelTip },
  ],
};

// ---------------- Heron ----------------

export const HER = {
  /** Three neck segments, so the neck can coil into an S and shoot straight out. */
  neck: [0.058, 0.06, 0.054] as [number, number, number],
  neckBase: [0, 0.02, 0.07] as [number, number, number],
  hip: [0.018, -0.02, -0.005] as [number, number, number],
  /** Upper (feathered tibia) and lower (bare, long tarsus) leg lengths. */
  legU: 0.075,
  legL: 0.16,
  wingRoot: [0.03, 0.025, 0.035] as [number, number, number],
};

export function heronBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const back = new THREE.Color(0x76848e), belly = new THREE.Color(0xa6b0b6);
  b.add(P.sphere(0.05, 1), { color: (p) => back.clone().lerp(belly, THREE.MathUtils.smoothstep(-p.y, -0.01, 0.03)) }, M.t(0, 0, 0, 0.18, 0, 0, 0.85, 0.85, 1.8));
  // Black shoulder patches at the bend of the folded wing.
  for (const x of [-1, 1]) b.add(P.sphere(0.014, 0), C(0x1e2226), M.t(x * 0.036, 0.004, 0.06, 0, 0, 0, 0.5, 0.9, 1.3));
  // Shaggy breast plumes hanging from the base of the neck, and long back plumes over the tail.
  for (let k = 0; k < 4; k++) b.add(P.cone(0.011, 0.065, 3), C(k % 2 ? 0xd4d8d2 : 0xbcc2c0), M.t((k - 1.5) * 0.009, -0.018, 0.07, 2.6 + (k % 2) * 0.12, 0, 0));
  for (let k = 0; k < 3; k++) b.add(P.cone(0.018, 0.1, 3), C(k === 1 ? 0x8e9aa2 : 0x6e7a84), M.t((k - 1) * 0.014, 0.02, -0.07, -1.75, 0, 0, 1, 0.3, 1));
  b.add(P.cone(0.03, 0.08, 4), C(0x5e6a74), M.t(0, 0.008, -0.1, -1.7, 0, 0, 1, 0.3, 1));
  return facet(b.build());
}

export function heronNeck(k: 0 | 1 | 2): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = HER.neck[k];
  const r0 = [0.016, 0.0125, 0.0105][k], r1 = [0.0125, 0.0105, 0.0095][k];
  b.add(P.sphere(r0 * 0.95, 0), C(0xc4c8c6));
  b.add(P.cyl(r1, r0, L, 6), C(k === 2 ? 0xe4e6e2 : k === 1 ? 0xd4d6d2 : 0xb8bcbc), M.t(0, L / 2, 0));
  // The dark streaks down the front of the neck.
  b.add(P.box(0.004, L * 0.9, 0.003), C(0x3a3e44), M.t(0, L / 2, r0 * 0.85));
  return facet(b.build());
}

/** Head: white face, black stripe over the eye running back into two plumes, long yellow dagger bill. */
export function heronHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.018, 1), C(0xeeeeea), M.t(0, 0, 0, 0, 0, 0, 1, 0.92, 1.25));
  b.add(P.box(0.03, 0.006, 0.032), C(0x1c1e22), M.t(0, 0.013, -0.004));
  for (const x of [-1, 1]) b.add(P.cone(0.0035, 0.07, 3), C(0x1c1e22), M.t(x * 0.004, 0.01, -0.05, -1.85 - x * 0.06, 0, 0));
  // Dagger bill: straight, sharp, deep at the base, darker along the culmen.
  const bill: BillSpec = { z0: 0.014, y0: -0.002, len: 0.11, h0: 0.013, h1: 0.002, w0: 0.011, w1: 0.002, curve: 0, hook: 0, segs: 4 };
  b.add(billGeo(bill), { color: (p) => new THREE.Color(p.y > 0.002 && p.z < 0.08 ? 0x8a7a3a : 0xe0b440) });
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.0045, 0), C(0xe8c030), M.t(x * 0.0145, 0.004, 0.01));
    b.add(P.sphere(0.0022, 0), C(0x101010), M.t(x * 0.0175, 0.0045, 0.0115));
  }
  return facet(b.build());
}

export function heronLegUpper(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.0105, 0), C(0x8e989c));
  b.add(P.cyl(0.006, 0.01, HER.legU, 5), { color: (p) => new THREE.Color(p.y > -HER.legU * 0.55 ? 0x8e989c : 0xa09860) }, M.t(0, -HER.legU / 2, 0));
  return facet(b.build());
}

/** Long bare lower leg (tarsus) down to the toe joint; the toes are a separate foot part. */
export function heronLegLower(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = HER.legL;
  b.add(P.sphere(0.0065, 0), C(0x9c9460));
  b.add(P.cyl(0.004, 0.005, L, 4), C(0xa09860), M.t(0, -L / 2, 0));
  return facet(b.build());
}

/** Three long spread forward toes and a hind toe, from the toe joint. */
export function heronFoot(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.005, 0), C(0x8a8250));
  for (const a of [-0.45, 0, 0.45]) b.add(P.box(0.003, 0.003, 0.048), C(0x8a8250), M.t(Math.sin(a) * 0.022, -0.002, Math.cos(a) * 0.022, 0, a, 0));
  b.add(P.box(0.003, 0.003, 0.026), C(0x8a8250), M.t(0, -0.002, -0.012));
  return facet(b.build());
}

const herUpper: ColorFn = (_p, n) => new THREE.Color(n.y > 0.1 ? 0x76848e : 0x9aa4aa);
const herTip: ColorFn = (p) => new THREE.Color(p.x > 0.04 ? 0x22262c : 0x5a6670);
export const HERON_WING: WingSpec = {
  thick: 0.012,
  fingers: 4,
  segs: [
    { len: 0.095, c0: 0.085, c1: 0.082, sweep: 0.0, color: herUpper },
    { len: 0.09, c0: 0.082, c1: 0.075, sweep: 0.01, color: herUpper },
    { len: 0.11, c0: 0.075, c1: 0.042, sweep: 0.028, color: herTip },
  ],
};

/** A small silver fish held crosswise in a bill while swallowing. */
export function heldFish(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.02, 1), { color: (p) => new THREE.Color(p.y > 0 ? 0x5a8a94 : 0xdce6e4) }, M.t(0, 0, 0, 0, 0, 0, 2.3, 0.7, 0.45));
  b.add(P.cone(0.014, 0.022, 3), { color: col(0x7aa0a8) }, M.t(-0.055, 0, 0, 0, 0, Math.PI / 2, 1, 1, 0.3));
  return facet(b.build());
}
