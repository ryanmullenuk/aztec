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
}

/** One tapered slab from x = 0 to len (slightly overlapping the previous panel so joints never gap). */
function panel(s: WingSeg, thick: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const ov = 0.14;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5;
    const v = p.getZ(i) + 0.5; // 1 = leading edge
    const chord = s.c0 + (s.c1 - s.c0) * u;
    const lead = s.c0 * 0.3 - s.sweep * u;
    const x = (u * (1 + ov) - ov) * s.len;
    const z = lead - (1 - v) * chord;
    // Thicker along the leading edge, thin trailing feathers.
    const y = p.getY(i) * thick * (0.35 + 0.65 * v) * (1 - 0.4 * u);
    p.setXYZ(i, x, y, z);
  }
  return g;
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
  const right = spec.segs.map((s) => {
    const b = new GeoBuilder();
    b.add(panel(s, spec.thick), { color: s.color, mat });
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

/**
 * A flapping stroke: the outer joints lag the shoulder (the wave runs out along the wing) and the
 * wing flexes at elbow and wrist on the upstroke, then opens wide for the downstroke.
 * @param droop constant bend giving gulls their "M" silhouette when gliding.
 */
export function flapPose(ph: number, amp: number, out: WingPose, droop = 0, baseSweep = 0.2): WingPose {
  const up = Math.max(0, Math.cos(ph)) * amp; // rising: flex the wing
  out.f1 = 0.1 + droop * 0.8 + Math.sin(ph) * amp;
  out.f2 = -droop * 0.3 + Math.sin(ph - 0.7) * amp * 0.45;
  out.f3 = -droop * 1.1 + Math.sin(ph - 1.3) * amp * 0.6;
  out.s1 = 0.02 + up * 0.35;
  out.s2 = -up * 0.7;
  out.s3 = baseSweep + up * 0.8;
  out.t1 = out.t2 = 0;
  out.t3 = -up * 0.3; // the hand feathers twist open on the upstroke
  out.o2 = out.o3 = 0;
  return out;
}

/** Wing folded along the body side: arm back, forearm forward, hand back (a flat Z-fold), panels upright. */
export const FOLDED: WingPose = { f1: -0.08, f2: 0.03, f3: 0.05, s1: 1.52, s2: -3.0, s3: 2.92, t1: -1.25, t2: -1.3, t3: -1.3, o2: -0.007, o3: 0.012 };

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
  const [l1, l2] = [spec.segs[0].len, spec.segs[1].len];
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
/** Grey on top, white underneath. */
const gullGrey: ColorFn = (_p, n) => new THREE.Color(n.y > 0.2 ? 0xa4acb4 : 0xf4f5f2);
/** Black tip with a white trailing edge spot. */
const gullTip: ColorFn = (p, n) => new THREE.Color(p.x > 0.045 ? 0x1c1c1e : n.y > 0.2 ? 0xa4acb4 : 0xf4f5f2);

export const GULL_WING: WingSpec = {
  thick: 0.012,
  segs: [
    { len: 0.085, c0: 0.075, c1: 0.07, sweep: 0.0, color: gullGrey },
    { len: 0.08, c0: 0.07, c1: 0.06, sweep: 0.012, color: gullGrey },
    { len: 0.11, c0: 0.06, c1: 0.014, sweep: 0.03, color: gullTip },
  ],
};

export const TOUCAN_WING: WingSpec = {
  thick: 0.012,
  segs: [
    { len: 0.045, c0: 0.07, c1: 0.068, sweep: 0.0, color: col(0x141416) },
    { len: 0.04, c0: 0.068, c1: 0.06, sweep: 0.008, color: col(0x121214) },
    { len: 0.05, c0: 0.06, c1: 0.03, sweep: 0.012, color: col(0x0b0b0d) },
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
