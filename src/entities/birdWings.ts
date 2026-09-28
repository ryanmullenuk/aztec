import * as THREE from 'three';
import { ColorFn, GeoBuilder, facet } from '../render/GeoBuilder';

/**
 * Low-poly articulated bird wings: three flat, tapered panels per wing (arm, forearm, hand)
 * joined at the shoulder, elbow and wrist, so a wing can flex through each stroke and fold
 * flat against the body. Panels are built for the right wing (+x) and mirrored for the left.
 */

export interface WingSeg {
  len: number;
  /** Chord (front-to-back width) at the inner and outer end. */
  c0: number;
  c1: number;
  /** How far the outer end sits behind the inner end. */
  sweep: number;
  color: ColorFn;
}

export interface WingSpec {
  segs: [WingSeg, WingSeg, WingSeg];
  thick: number;
  /**
   * Separated primary feathers ("fingers") fanning from the hand's tip, for broad soaring wings
   * (pelicans, herons, toucans). Omit or 0 for pointed wings (gulls).
   */
  fingers?: number;
}

/** One tapered slab from x = 0 to len (slightly overlapping the previous panel so joints never gap). */
function panel(s: WingSeg, thick: number, hand: boolean): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, hand ? 5 : 2, 1, 3);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const ov = 0.14;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5;
    const v = p.getZ(i) + 0.5; // 1 = leading edge
    // The hand's leading edge curves back toward a rounded tip; its chord narrows faster near the end.
    const shape = hand ? 1 - 0.35 * u * u : 1;
    const chord = (s.c0 + (s.c1 - s.c0) * u) * shape + (hand ? s.c1 * (1 - shape) * 0.4 : 0);
    const lead = s.c0 * 0.3 - s.sweep * u - (hand ? s.c0 * 0.18 * u * u : 0);
    const x = (u * (1 + ov) - ov) * s.len;
    // A gentle camber: the middle of the chord bulges up a touch (the wing looks less like a plank).
    const camber = Math.sin(v * Math.PI) * thick * 0.6 * (1 - 0.6 * u);
    const z = lead - (1 - v) * chord;
    // Thicker along the leading edge, thin trailing feathers.
    const y = p.getY(i) * thick * (0.35 + 0.65 * v) * (1 - 0.4 * u) + camber;
    p.setXYZ(i, x, y, z);
  }
  return g;
}

/** Separated primaries: thin tapered feathers fanning back from the hand's outer end. */
function fingers(s: WingSeg, thick: number, n: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const lead = s.c0 * 0.3 - s.sweep - s.c0 * 0.18;
  for (let k = 0; k < n; k++) {
    const f = n > 1 ? k / (n - 1) : 0;
    const g = new THREE.BoxGeometry(1, 1, 1);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const len = s.len * (0.42 - f * 0.14);
    const w = Math.max(0.006, s.c1 * 0.34);
    const ang = f * 0.55; // fanning back
    const z0 = lead - f * s.c1 * 0.9 - w * 0.2;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5;
      const lx = u * len;
      const lz = p.getZ(i) * w * (1 - 0.75 * u);
      const x = s.len * 0.9 + lx * Math.cos(ang) + lz * Math.sin(ang);
      const z = z0 - lx * Math.sin(ang) + lz * Math.cos(ang);
      // Tips curl up a little, as primaries bend under load.
      p.setXYZ(i, x, p.getY(i) * thick * 0.35 + u * u * len * 0.12, z);
    }
    out.push(g);
  }
  return out;
}

function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  const p = m.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
  // Reverse each triangle's winding so the mirrored faces still point outward.
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  for (const k of Object.keys(m.attributes)) {
    if (k === 'position') continue;
    const a = m.getAttribute(k) as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i += 3) {
      for (let c = 0; c < a.itemSize; c++) {
        const t = a.getComponent(i + 1, c);
        a.setComponent(i + 1, c, a.getComponent(i + 2, c));
        a.setComponent(i + 2, c, t);
      }
    }
  }
  m.computeVertexNormals();
  return m;
}

/** Geometries for [right arm, right forearm, right hand, left arm, left forearm, left hand]. */
export function wingParts(spec: WingSpec, mat = 0): THREE.BufferGeometry[] {
  const right = spec.segs.map((s, k) => {
    const b = new GeoBuilder();
    b.add(panel(s, spec.thick, k === 2), { color: s.color, mat });
    if (k === 2 && spec.fingers) for (const f of fingers(s, spec.thick, spec.fingers)) b.add(f, { color: s.color, mat });
    return facet(b.build());
  });
  return [...right, ...right.map(mirrorX)];
}

/**
 * Joint angles for one wing: flap (f, tip up +) and sweep (s, tip back +) at the shoulder, elbow
 * and wrist; each panel's own twist (t, trailing edge down −) and a small sideways offset (o) so
 * folded panels lie flat against the body without overlapping.
 */
export interface WingPose {
  f1: number; f2: number; f3: number;
  s1: number; s2: number; s3: number;
  t1: number; t2: number; t3: number;
  o2: number; o3: number;
}

const KEYS = ['f1', 'f2', 'f3', 's1', 's2', 's3', 't1', 't2', 't3', 'o2', 'o3'] as const;

export const pose = (): WingPose => ({ f1: 0, f2: 0, f3: 0, s1: 0, s2: 0, s3: 0, t1: 0, t2: 0, t3: 0, o2: 0, o3: 0 });

export function mixPose(a: WingPose, b: WingPose, t: number, out: WingPose = pose()): WingPose {
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export function copyPose(a: WingPose, out: WingPose): WingPose {
  for (const k of KEYS) out[k] = a[k];
  return out;
}

/** Fraction of the beat spent on the (slower, powered) downstroke is set by this phase warp. */
const STROKE_WARP = 0.3;

/**
 * A flapping stroke. The phase is warped so the powered downstroke takes ~60% of the beat and
 * the recovery upstroke is quicker. On the downstroke the wing is fully spread, reaching slightly
 * forward with the hand pronated (leading edge down); on the upstroke the elbow and wrist flex so
 * the hand sweeps back and folds in toward the body with its feathers twisted open, the wrist
 * leading and the hand trailing. The outer joints lag the shoulder, so the wave runs out along
 * the wing.
 * @param droop constant bend giving gulls their "M" silhouette when gliding.
 */
export function flapPose(ph: number, amp: number, out: WingPose, droop = 0, baseSweep = 0.2): WingPose {
  const q = ph + STROKE_WARP * Math.sin(ph);
  const s = Math.sin(q), c = Math.cos(q);
  const k = Math.min(1, amp * 1.4);
  const U = Math.max(0, c) * k; // rising (recovery): flex the wing
  const D = Math.max(0, -c) * k; // falling (power): spread and pronate
  out.f1 = 0.1 + droop * 0.8 + s * amp;
  out.f2 = -droop * 0.3 + Math.sin(q - 0.6) * amp * 0.42 - U * 0.12;
  out.f3 = -droop * 1.1 + Math.sin(q - 1.2) * amp * 0.6 - U * 0.3;
  out.s1 = 0.02 + U * 0.42 - D * 0.1;
  out.s2 = -U * 0.95;
  out.s3 = baseSweep * (1 - D * 0.45) + U * 1.15;
  out.t1 = D * 0.06 - U * 0.04;
  out.t2 = D * 0.12 - U * 0.18;
  out.t3 = D * 0.2 - U * 0.5;
  out.o2 = out.o3 = 0;
  return out;
}

/**
 * Per-wing gliding corrections on top of a pose: the wing on the inside of a banked turn flexes a
 * little at the wrist (less lift), the outer one stretches, and both make small, out-of-step twitches
 * of the hand, like a bird trimming against gusts.
 * @param roll body bank (positive raises the +x wing); @param t time; @param k strength 0..1.
 */
export function trimPose(p: WingPose, side: 1 | -1, roll: number, t: number, k: number, out: WingPose): WingPose {
  copyPose(p, out);
  const inner = Math.max(0, -roll * side), outer = Math.max(0, roll * side);
  out.s3 += (inner * 0.45 - outer * 0.15) * k;
  out.s2 -= inner * 0.25 * k;
  out.f3 += (outer * 0.12 - inner * 0.08) * k;
  const tw = Math.sin(t * 2.3 + side * 1.7) * 0.6 + Math.sin(t * 5.1 + side) * 0.4;
  out.t3 += tw * 0.07 * k;
  out.f3 += Math.sin(t * 1.7 + side * 2.1) * 0.05 * k;
  out.f1 += Math.sin(t * 1.1 + side * 0.9) * 0.025 * k;
  return out;
}

/** Wing folded along the body side: arm back, forearm forward, hand back (a flat Z-fold), panels upright. */
export const FOLDED: WingPose = { f1: -0.08, f2: 0.03, f3: 0.05, s1: 1.52, s2: -3.0, s3: 2.92, t1: -1.25, t2: -1.3, t3: -1.3, o2: -0.007, o3: 0.012 };

/**
 * Landing flare: wings raised and reaching forward, cupped (trailing edges down, a high angle of
 * attack) with the hands spread, so the bird stalls onto its feet.
 */
export const FLARE: WingPose = { f1: 0.75, f2: -0.15, f3: -0.25, s1: -0.3, s2: 0.1, s3: 0.25, t1: -0.35, t2: -0.5, t3: -0.65, o2: 0, o3: 0 };

/**
 * Plunge dive: wings swept right back into a narrow arrowhead, half folded at elbow and wrist.
 * Blend on toward FOLDED just before hitting the water.
 */
export const DIVE: WingPose = { f1: 0.12, f2: -0.05, f3: 0.0, s1: 1.0, s2: -1.55, s3: 1.75, t1: -0.3, t2: -0.45, t3: -0.55, o2: 0, o3: 0 };

const _j = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

function joint(x: number, y: number, z: number, sweep: number, flap: number): THREE.Matrix4 {
  _e.set(0, sweep, flap, 'YXZ');
  _q.setFromEuler(_e);
  return _t.compose(_v.set(x, y, z), _q, _one);
}

/** Panel twist about its own length axis (not passed on down the chain). */
function twist(out: THREE.Matrix4, off: number, a: number): void {
  _e.set(a, 0, 0);
  _q.setFromEuler(_e);
  out.multiply(_t.compose(_v.set(0, 0, off), _q, _one));
}

/**
 * Instance matrices for the three panels of one wing.
 * @param side 1 right, -1 left (left angles are mirrored).
 * @param root shoulder position in the body's frame (right side; x is mirrored for the left).
 */
export function wingMatrices(body: THREE.Matrix4, side: 1 | -1, root: [number, number, number], spec: WingSpec, p: WingPose, out: THREE.Matrix4[]): void {
  const l1 = spec.segs[0].len, l2 = spec.segs[1].len;
  _j.multiplyMatrices(body, joint(root[0] * side, root[1], root[2], p.s1 * side, p.f1 * side));
  out[0].copy(_j);
  twist(out[0], 0, p.t1);
  _j.multiply(joint(l1 * side, 0, 0, p.s2 * side, p.f2 * side));
  out[1].copy(_j);
  twist(out[1], p.o2, p.t2);
  _j.multiply(joint(l2 * side, 0, 0, p.s3 * side, p.f3 * side));
  out[2].copy(_j);
  twist(out[2], p.o3, p.t3);
}

const col = (c: number) => () => new THREE.Color(c);

// Gull: pale grey mantle above, white below, a white trailing edge on the inner wing, and the black
// wingtip with white "mirror" spots.
const G_TOP = new THREE.Color(0xa4acb4), G_UNDER = new THREE.Color(0xf4f5f2), G_BLACK = new THREE.Color(0x1c1c1e);
const gullInner = (s: { c0: number; c1: number; len: number; sweep: number }): ColorFn => (p, n) => {
  const u = THREE.MathUtils.clamp(p.x / s.len, 0, 1);
  const chord = s.c0 + (s.c1 - s.c0) * u;
  const lead = s.c0 * 0.3 - s.sweep * u;
  const trailing = p.z < lead - chord * 0.8;
  return (n.y > 0.2 && !trailing ? G_TOP : G_UNDER).clone();
};
const gullTip: ColorFn = (p, n) => {
  const mirror = p.x > 0.085 && p.x < 0.1 && p.z < -0.019 && p.z > -0.034;
  if (p.x > 0.05 && !mirror) return G_BLACK.clone();
  return (n.y > 0.2 ? G_TOP : G_UNDER).clone();
};
const GULL_ARM = { len: 0.085, c0: 0.075, c1: 0.07, sweep: 0.0 };
const GULL_FORE = { len: 0.08, c0: 0.07, c1: 0.06, sweep: 0.012 };

export const GULL_WING: WingSpec = {
  thick: 0.012,
  segs: [
    { ...GULL_ARM, color: gullInner(GULL_ARM) },
    { ...GULL_FORE, color: gullInner(GULL_FORE) },
    { len: 0.12, c0: 0.06, c1: 0.012, sweep: 0.034, color: gullTip },
  ],
};

// Toucan: short, broad, rounded wings, glossy black with a faint blue sheen on top.
const tBlack: ColorFn = (_p, n) => new THREE.Color(n.y > 0.3 ? 0x1a1a22 : 0x101012);
export const TOUCAN_WING: WingSpec = {
  thick: 0.012,
  fingers: 4,
  segs: [
    { len: 0.045, c0: 0.07, c1: 0.068, sweep: 0.0, color: tBlack },
    { len: 0.04, c0: 0.068, c1: 0.062, sweep: 0.008, color: tBlack },
    { len: 0.045, c0: 0.062, c1: 0.04, sweep: 0.01, color: col(0x0b0b0d) },
  ],
};

/** Chicken wings take the coat colour (mat 2), darker flight feathers toward the tip. */
export const CHICKEN_WING: WingSpec = {
  thick: 0.014,
  segs: [
    { len: 0.035, c0: 0.07, c1: 0.066, sweep: 0.0, color: col(0xf2f2f2) },
    { len: 0.03, c0: 0.066, c1: 0.058, sweep: 0.006, color: col(0xe4e4e4) },
    { len: 0.04, c0: 0.058, c1: 0.03, sweep: 0.012, color: col(0xcfcfcf) },
  ],
};
