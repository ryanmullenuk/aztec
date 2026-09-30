import * as THREE from 'three';
import type { WhaleRig } from './WhaleModel';

// ---------------- Coming up for air ----------------
// One continuous move from cruising to cruising, in whale lengths (L) and degrees:
//   y: body-centre height, h: travel along the heading, pitch: head tilt from straight up
//   (90 = level, above 90 nose-down), roll: lean to one side (the fraction of a small lean),
//   fin: 0 flippers swept back along the flanks .. 1 held out wide, arch: back bend (positive
//   hollows the back, negative humps it), stroke: strength of the fluke strokes.
// The whale angles up from cruising depth and its head bursts through the surface, pushing up a
// mound of water that pours off it, until the head and the front of its back are clear (never
// more than about forty per cent of it, and never the whole whale). It blows, then the head
// sinks back as the back rolls up through the surface, and it arches over into a dive: the tail
// stock humps up and the flukes lift clear, streaming water, before it slips under and levels out
// back at cruising depth.

/** Beats of the rise (seconds from its start): the head breaking out, the blow, the flukes up, the end. */
export const RISE_T = { breakout: 3.1, blow: 3.75, flukes: 8.6, end: 14.2 };

interface RiseKey {
  t: number;
  y: number;
  h: number;
  pitch: number;
  roll: number;
  fin: number;
  arch: number;
  stroke: number;
}
export type RisePose = Omit<RiseKey, 't'>;

const KEYS: RiseKey[] = [
  // Cruising, then angling up toward the light, gathering speed.
  { t: 0, y: -0.327, h: 0, pitch: 90, roll: 0, fin: 0, arch: 0, stroke: 1 },
  { t: 1.3, y: -0.34, h: 0.38, pitch: 83, roll: 0, fin: 0.05, arch: 0.05, stroke: 1.5 },
  { t: 2.5, y: -0.24, h: 0.8, pitch: 72, roll: 0.3, fin: 0.1, arch: 0.1, stroke: 1.8 },
  // The head bursts through, pushing up a mound of water that pours off it.
  { t: 3.2, y: -0.1, h: 1.03, pitch: 66, roll: 0.7, fin: 0.18, arch: 0.08, stroke: 1.1 },
  // Head and blowholes clear: the blow, and it lingers with its head up a moment.
  { t: RISE_T.blow, y: -0.04, h: 1.16, pitch: 67, roll: 1, fin: 0.22, arch: 0.02, stroke: 0.6 },
  { t: 4.7, y: -0.04, h: 1.36, pitch: 72, roll: 0.8, fin: 0.18, arch: -0.05, stroke: 0.5 },
  // The head sinks back as the back rolls up through the surface, water sheeting off it, and the
  // hump of the back and the dorsal fin roll over.
  { t: 5.8, y: -0.07, h: 1.6, pitch: 86, roll: 0.35, fin: 0.1, arch: -0.3, stroke: 0.5 },
  { t: 6.8, y: -0.13, h: 1.83, pitch: 100, roll: 0.1, fin: 0.05, arch: -0.55, stroke: 0.4 },
  // Rolling forward into the dive: the tail stock humps up and the flukes lift clear.
  { t: 7.7, y: -0.2, h: 2.02, pitch: 116, roll: 0, fin: 0.02, arch: -0.45, stroke: 0.25 },
  { t: RISE_T.flukes, y: -0.2, h: 2.17, pitch: 130, roll: 0, fin: 0, arch: -0.25, stroke: 0.2 },
  { t: 9.4, y: -0.3, h: 2.3, pitch: 130, roll: 0, fin: 0, arch: -0.1, stroke: 0.4 },
  // Slipping under and levelling out at cruising depth and speed.
  { t: 10.4, y: -0.42, h: 2.48, pitch: 112, roll: 0, fin: 0, arch: 0, stroke: 1.2 },
  { t: 11.8, y: -0.43, h: 2.84, pitch: 94, roll: 0, fin: 0, arch: 0, stroke: 1.2 },
  { t: 13.2, y: -0.327, h: 3.22, pitch: 88, roll: 0, fin: 0, arch: 0, stroke: 1 },
  { t: RISE_T.end, y: -0.327, h: 3.49, pitch: 90, roll: 0, fin: 0, arch: 0, stroke: 1 },
];

/** How far the rise carries the whale along its heading (whale lengths). */
export const RISE_REACH = KEYS[KEYS.length - 1].h;
/** Body half-thickness allowance (whale lengths) when keeping it off the seabed. */
export const WHALE_GIRTH = 0.14;

/** The rise pose at time t. `lean` is the roll (degrees, signed) it leans to as its head comes out. */
export function sampleRise(t: number, lean = 12): RisePose {
  const K = KEYS;
  const tt = Math.min(Math.max(t, 0), RISE_T.end);
  let i = 0;
  while (i < K.length - 2 && tt > K[i + 1].t) i++;
  const a = K[Math.max(0, i - 1)], b = K[i], c = K[i + 1], d = K[Math.min(K.length - 1, i + 2)];
  const f = (tt - b.t) / (c.t - b.t);
  const get = (k: RiseKey, key: keyof RisePose) => (key === 'roll' ? k.roll * lean : k[key]);
  // Time-aware Hermite tangents keep velocity continuous across unequal key intervals.
  const value = (key: keyof RisePose) => {
    const m0 = ((get(c, key) - get(a, key)) / (c.t - a.t || 1)) * (c.t - b.t);
    const m1 = ((get(d, key) - get(b, key)) / (d.t - b.t || 1)) * (c.t - b.t);
    return (2 * f * f * f - 3 * f * f + 1) * get(b, key) + (f * f * f - 2 * f * f + f) * m0 + (-2 * f * f * f + 3 * f * f) * get(c, key) + (f * f * f - f * f) * m1;
  };
  return { y: value('y'), h: value('h'), pitch: value('pitch'), roll: value('roll'), fin: value('fin'), arch: value('arch'), stroke: value('stroke') };
}

/** Lowest point of a straight whale body (in whale lengths, relative to its centre) at a pitch. */
export function whaleDrop(pitch: number): number {
  return 0.5 * Math.abs(Math.cos(THREE.MathUtils.degToRad(pitch))) + WHALE_GIRTH;
}

/** Share of the body's length above the water (centre height y and pitch as in a rise pose). */
export function clearOfWater(y: number, pitch: number): number {
  const up = Math.abs(Math.cos(THREE.MathUtils.degToRad(pitch)));
  if (up < 1e-4) return y > 0 ? 1 : 0;
  return THREE.MathUtils.clamp(0.5 + y / up, 0, 1);
}

/**
 * Is there room to come up here, heading along `yaw`? The seabed must lie below `maxBed` under
 * the whole run (from behind the tail to beyond where it dives, a body width either side), and
 * nothing shallower than the deep sea (land, the reef shelf, coral) within `clear` of it.
 */
export function riseSiteOk(bed: (x: number, z: number) => number, x: number, z: number, yaw: number, L: number, maxBed: number, clear: number): boolean {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const reach = RISE_REACH * L;
  for (let s = -0.6 * L; s <= reach + 0.8 * L; s += 1.5) {
    for (const o of [-0.7 * L, 0, 0.7 * L]) {
      if (bed(x + fx * s + fz * o, z + fz * s - fx * o) > maxBed) return false;
    }
  }
  // A ring search round the middle of the run for any shallows.
  const mx = x + fx * reach * 0.5, mz = z + fz * reach * 0.5;
  const R = reach * 0.5 + L + clear;
  for (let r = 4; r <= R; r += 4) {
    const n = Math.max(12, Math.ceil((r * Math.PI * 2) / 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      if (bed(mx + Math.cos(a) * r, mz + Math.sin(a) * r) > -2.2) return false;
    }
  }
  return true;
}

/** How the whale is moving, for posing its body, flippers and flukes. */
export interface WhaleDrive {
  /** Fluke-stroke phase (radians) and strength (0 still .. about 3 sprinting). */
  phase: number;
  stroke: number;
  /** Turn rate (radians a second, + = toward its left): the head leads into it, and `turnLag` (the same, lagging) bends the tail after it. */
  turn: number;
  turnLag: number;
  /** Positive hollows the back, negative humps it (rolling into a dive). */
  arch: number;
  /** Flippers: 0 held back along the flanks .. 1 flung out wide; how hard they beat, and the beat's phase. */
  fin: number;
  flap: number;
  flapPhase: number;
  /** Roll rate (degrees a second): twisting in the air, one flipper swings up as the other goes down. */
  twist: number;
}

/** Amplitude (radians at stroke 1), phase lag and share of arch / turn bend of each tail joint, front to back. */
const TAIL_AMP = [0.012, 0.02, 0.032, 0.05, 0.07, 0.09, 0.1];
const TAIL_LAG = [0.25, 0.6, 0.95, 1.3, 1.6, 1.85, 2.05];
const TAIL_ARCH = [0.05, 0.06, 0.07, 0.07, 0.06, 0.05, 0.04];
const TAIL_YAW = [0.13, 0.16, 0.19, 0.2, 0.2, 0.19, 0.16];
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

/**
 * Pose the whole skeleton. The body wave runs back along the spine, growing toward the flukes,
 * which pitch ahead of the heave (a driving stroke) with their lobes flexing behind; the head
 * nods a little against it. Turns bend the body into a curve, head first, and bank the flippers.
 */
export function poseWhale(r: WhaleRig, d: WhaleDrive): void {
  const S = d.stroke, ph = d.phase;
  const turn = THREE.MathUtils.clamp(d.turn, -0.7, 0.7), lag = THREE.MathUtils.clamp(d.turnLag, -0.7, 0.7);
  r.neck.rotation.set(-0.014 * S * Math.sin(ph + 0.5) - 0.13 * d.arch, 0.24 * turn, 0);
  r.head.rotation.set(-0.01 * S * Math.sin(ph + 0.3) - 0.07 * d.arch, 0.16 * turn, 0);
  for (let i = 0; i < r.tail.length; i++) {
    r.tail[i].rotation.set(
      TAIL_AMP[i] * S * Math.sin(ph - TAIL_LAG[i]) + TAIL_ARCH[i] * d.arch,
      -TAIL_YAW[i] * lag,
      0.012 * S * (i / 6) * Math.sin(ph * 0.5 - TAIL_LAG[i]),
    );
  }
  const fp = ph - 3.35;
  r.fluke.rotation.set(0.3 * S * Math.sin(fp), -0.06 * lag, 0);
  const flex = 0.12 * S * Math.sin(fp - 0.9), chord = 0.05 * S * Math.sin(fp - 1.6);
  r.lobeL.rotation.set(chord, 0, -flex);
  r.lobeR.rotation.set(chord, 0, flex);
  poseFlipper(r.finL, r.finRestL, 1, d, turn);
  poseFlipper(r.finR, r.finRestR, -1, d, turn);
}

/**
 * One flipper, in its own frame (x along it, z toward the leading edge): sweep forward / back,
 * raise / lower, twist; the elbow and wrist bend after the shoulder so a beat ripples out along it.
 * The right flipper's frame is mirrored, so its twist and raise are negated.
 */
function poseFlipper(bones: THREE.Bone[], rest: THREE.Quaternion[], side: 1 | -1, d: WhaleDrive, turn: number): void {
  const f = THREE.MathUtils.clamp(d.fin, 0, 1);
  const beat = d.flap * Math.sin(d.flapPhase + (side > 0 ? 0 : 0.35));
  // Slow sculling while cruising; steering in turns (the inside flipper dips); asymmetric in a twist.
  const idle = (1 - f) * 0.06 * Math.sin(d.phase * 0.5 + (side > 0 ? 0 : 1.3));
  const steer = turn * side;
  const twist = THREE.MathUtils.clamp(d.twist / 120, -1, 1) * side;
  // A beat rows the flipper round in an arc (up and forward, down and back), flexing along its length.
  const sweep = -0.72 * f + 0.1 * steer + 0.2 * d.flap * Math.sin(d.flapPhase + (side > 0 ? 0 : 0.35) + 1.2);
  const raise = 0.48 * f + 0.55 * beat + idle - 0.22 * steer + 0.45 * twist * f;
  const tw = 0.4 * f + 0.22 * d.flap * Math.sin(d.flapPhase - 0.6) + 0.1 * steer;
  const bend = [
    [tw, sweep, raise],
    [0.08 * beat, 0, 0.08 + 0.05 * f + 0.38 * d.flap * Math.sin(d.flapPhase - 0.8) + idle * 0.8],
    [0.06 * beat, 0, 0.06 + 0.45 * d.flap * Math.sin(d.flapPhase - 1.6) + idle * 0.6],
  ];
  for (let j = 0; j < 3; j++) {
    const [x, y, z] = bend[j];
    _e.set(side > 0 ? x : -x, y, side > 0 ? z : -z, 'YZX');
    bones[j].quaternion.copy(rest[j]).multiply(_q.setFromEuler(_e));
  }
}
