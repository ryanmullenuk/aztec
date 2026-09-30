import * as THREE from 'three';
import type { WhaleRig } from './WhaleModel';

// ---------------- Breach ----------------
// One continuous move from cruising to cruising, in whale lengths (L) and degrees:
//   y: body-centre height, h: travel along the heading, pitch: head tilt from straight up
//   (90 = level, above 90 nose-down), roll: spin about the body axis, fin: 0 flippers swept
//   back along the flanks .. 1 flung wide, flap: how hard they beat, arch: back bend (positive
//   hollows the back, the bow of a breach), stroke: strength of the fluke strokes.
// The whale noses down and gathers speed, pulls up in a tight J and bursts out at a steep
// angle, driving up with its last strokes and slowing under gravity until about seventy per
// cent of its length is clear. It hangs a moment, twisting, then topples over faster and faster
// and slams down on its back; it goes under head-first with the flukes swinging up over it, and
// levels out back at cruising depth. About four and a half seconds of it are above water.

/** Beats of the breach (seconds from its start). */
export const BREACH_T = { breakout: 3.25, peak: 4.55, impact: 5.7, end: 12 };

interface BreachKey {
  t: number;
  y: number;
  h: number;
  pitch: number;
  /** Until the impact, the fraction of the landing roll; after it, 1 + the fraction of the way on round to a full turn. */
  roll: number;
  fin: number;
  flap: number;
  arch: number;
  stroke: number;
}
export type BreachPose = Omit<BreachKey, 't'>;

const KEYS: BreachKey[] = [
  // Cruising, then nosing down and driving deeper with ever stronger strokes.
  { t: 0, y: -0.327, h: 0, pitch: 90, roll: 0, fin: 0, flap: 0, arch: 0, stroke: 1 },
  { t: 0.8, y: -0.36, h: 0.24, pitch: 101, roll: 0, fin: 0, flap: 0, arch: -0.08, stroke: 1.4 },
  { t: 1.6, y: -0.49, h: 0.55, pitch: 105, roll: 0, fin: 0, flap: 0, arch: -0.12, stroke: 1.9 },
  { t: 2.3, y: -0.6, h: 0.93, pitch: 92, roll: 0, fin: 0.05, flap: 0, arch: 0.1, stroke: 2.4 },
  // The pull-up: a tight J, accelerating hard (the body bends into the curve).
  { t: 2.85, y: -0.48, h: 1.3, pitch: 66, roll: 0.03, fin: 0.12, flap: 0, arch: 0.55, stroke: 2.8 },
  // Breakout: the head bursts through the surface, still steepening, the flippers swinging out.
  { t: BREACH_T.breakout, y: -0.335, h: 1.56, pitch: 48, roll: 0.1, fin: 0.35, flap: 0.2, arch: 0.4, stroke: 2.2 },
  // Rising, slowing under gravity, rearing up toward vertical and starting to twist.
  { t: 3.7, y: -0.03, h: 1.77, pitch: 30, roll: 0.23, fin: 0.8, flap: 0.6, arch: 0.25, stroke: 1 },
  { t: 4.15, y: 0.13, h: 1.88, pitch: 21, roll: 0.37, fin: 1, flap: 0.85, arch: 0.05, stroke: 0.5 },
  // Highest: about 70 % of the body clear; it hangs, then begins to topple.
  { t: BREACH_T.peak, y: 0.19, h: 1.94, pitch: 21, roll: 0.5, fin: 1, flap: 0.8, arch: -0.1, stroke: 0.4 },
  // Toppling over faster and faster, twisting onto its back, the body bowing as it falls.
  { t: 4.95, y: 0.17, h: 2.0, pitch: 33, roll: 0.65, fin: 1, flap: 0.6, arch: 0.1, stroke: 0.4 },
  { t: 5.35, y: 0.11, h: 2.09, pitch: 56, roll: 0.82, fin: 1, flap: 0.4, arch: 0.35, stroke: 0.5 },
  // Slamming down flat.
  { t: BREACH_T.impact, y: 0.02, h: 2.2, pitch: 92, roll: 1, fin: 0.9, flap: 0.15, arch: 0.45, stroke: 0.5 },
  // Under head-first; the tail swings up and the flukes lift clear before following it down.
  { t: 6.2, y: -0.1, h: 2.34, pitch: 113, roll: 1.08, fin: 0.6, flap: 0, arch: 0.25, stroke: 0.5 },
  { t: 6.8, y: -0.2, h: 2.47, pitch: 131, roll: 1.22, fin: 0.35, flap: 0, arch: 0.1, stroke: 0.6 },
  { t: 7.4, y: -0.28, h: 2.6, pitch: 136, roll: 1.4, fin: 0.2, flap: 0, arch: 0.05, stroke: 1 },
  { t: 8.0, y: -0.38, h: 2.75, pitch: 122, roll: 1.62, fin: 0.1, flap: 0, arch: 0, stroke: 1.4 },
  // Rolling upright and levelling out, back up to cruising depth and speed.
  { t: 9.5, y: -0.47, h: 3.14, pitch: 98, roll: 1.9, fin: 0.03, flap: 0, arch: 0, stroke: 1.3 },
  { t: 10.7, y: -0.37, h: 3.46, pitch: 85, roll: 2, fin: 0, flap: 0, arch: 0, stroke: 1.1 },
  { t: BREACH_T.end, y: -0.327, h: 3.81, pitch: 90, roll: 2, fin: 0, flap: 0, arch: 0, stroke: 1 },
];

/** How far the breach carries the whale along its heading (whale lengths). */
export const BREACH_REACH = KEYS[KEYS.length - 1].h;
/** Body half-thickness allowance (whale lengths) when keeping it off the seabed. */
export const WHALE_GIRTH = 0.14;

/**
 * The breach pose at time t. `landRoll` is the roll (degrees, signed) it lands with: about 90 on
 * its side, 180 on its back; it always finishes a whole turn upright.
 */
export function sampleBreach(t: number, landRoll = 170): BreachPose {
  const K = KEYS;
  const tt = Math.min(Math.max(t, 0), BREACH_T.end);
  let i = 0;
  while (i < K.length - 2 && tt > K[i + 1].t) i++;
  const a = K[Math.max(0, i - 1)], b = K[i], c = K[i + 1], d = K[Math.min(K.length - 1, i + 2)];
  const f = (tt - b.t) / (c.t - b.t);
  const full = Math.sign(landRoll || 1) * 360;
  const get = (k: BreachKey, key: keyof BreachPose) => (key !== 'roll' ? k[key] : k.roll <= 1 ? k.roll * landRoll : landRoll + (k.roll - 1) * (full - landRoll));
  // Time-aware Hermite tangents keep velocity continuous across unequal key intervals.
  const value = (key: keyof BreachPose) => {
    const m0 = ((get(c, key) - get(a, key)) / (c.t - a.t || 1)) * (c.t - b.t);
    const m1 = ((get(d, key) - get(b, key)) / (d.t - b.t || 1)) * (c.t - b.t);
    return (2 * f * f * f - 3 * f * f + 1) * get(b, key) + (f * f * f - 2 * f * f + f) * m0 + (-2 * f * f * f + 3 * f * f) * get(c, key) + (f * f * f - f * f) * m1;
  };
  return { y: value('y'), h: value('h'), pitch: value('pitch'), roll: value('roll'), fin: value('fin'), flap: value('flap'), arch: value('arch'), stroke: value('stroke') };
}

/** Lowest point of a straight whale body (in whale lengths, relative to its centre) at a pitch. */
export function whaleDrop(pitch: number): number {
  return 0.5 * Math.abs(Math.cos(THREE.MathUtils.degToRad(pitch))) + WHALE_GIRTH;
}

/** Share of the body's length above the water (centre height y and pitch as in a breach pose). */
export function clearOfWater(y: number, pitch: number): number {
  const up = Math.abs(Math.cos(THREE.MathUtils.degToRad(pitch)));
  if (up < 1e-4) return y > 0 ? 1 : 0;
  return THREE.MathUtils.clamp(0.5 + y / up, 0, 1);
}

/**
 * Is there room to breach here, heading along `yaw`? The seabed must lie below `maxBed` under
 * the whole run (from behind the tail to beyond the re-entry, a body width either side), and
 * nothing shallower than the deep sea (land, the reef shelf, coral) within `clear` of it.
 */
export function breachSiteOk(bed: (x: number, z: number) => number, x: number, z: number, yaw: number, L: number, maxBed: number, clear: number): boolean {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const reach = BREACH_REACH * L;
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
  /** Positive hollows the back (the bow of a breach), negative humps it (rolling into a dive). */
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
