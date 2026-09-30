import * as THREE from 'three';

/** Nine blended joints: head, shoulders, trunk and a flexible tail stock. */
export function rigWhale(geometry: THREE.BufferGeometry, material: THREE.Material): { body: THREE.SkinnedMesh; spine: THREE.Bone[] } {
  if (!geometry.hasAttribute('skinIndex')) {
    const positions = geometry.getAttribute('position');
    const indices = new Uint16Array(positions.count * 4);
    const weights = new Float32Array(positions.count * 4);
    for (let i = 0; i < positions.count; i++) {
      const joint = THREE.MathUtils.clamp((0.5 - positions.getZ(i)) * 8, 0, 8);
      const a = Math.min(7, Math.floor(joint)), mix = joint - a;
      indices[i * 4] = a;
      indices[i * 4 + 1] = a + 1;
      weights[i * 4] = 1 - mix;
      weights[i * 4 + 1] = mix;
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  }
  const spine = Array.from({ length: 9 }, (_, i) => {
    const bone = new THREE.Bone();
    bone.name = `whale-spine-${i}`;
    bone.position.z = i === 0 ? 0.5 : -0.125;
    return bone;
  });
  for (let i = 1; i < spine.length; i++) spine[i - 1].add(spine[i]);
  const body = new THREE.SkinnedMesh(geometry, material);
  body.add(spine[0]);
  body.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton(spine));
  // The animated tail can extend outside the rest-pose bounds.
  body.frustumCulled = false;
  body.castShadow = true;
  return { body, spine };
}

// ---------------- Breach ----------------
// One continuous move from cruising to cruising, in whale lengths (L) and degrees:
//   y: body-centre height, h: travel along the heading, pitch: head tilt from straight up
//   (90 = level, above 90 nose-down), roll: spin about the body axis, fin: 0 flippers swept
//   back along the flanks .. 1 flung wide, arch: back bend (positive hollows the back, the
//   bow of a breach), stroke: strength of the travelling body wave.
// The whale noses down and gathers speed, pulls up in a J and bursts out at a steep angle with
// a slow roll, until about seventy per cent of its length is clear of the water; it hangs, arcs
// over and falls on its back, slams down with one great splash, goes under head-first with the
// flukes swinging up over it, and levels out back at cruising depth. About five seconds of it
// are above water.

/** Beats of the breach (seconds from its start). */
export const BREACH_T = { breakout: 4.05, peak: 6.4, impact: 8.1, end: 14.5 };

interface BreachKey {
  t: number;
  y: number;
  h: number;
  pitch: number;
  /** Until the impact, the fraction of the landing roll; after it, 1 + the fraction of the way on round to a full turn. */
  roll: number;
  fin: number;
  arch: number;
  stroke: number;
}
export type BreachPose = Omit<BreachKey, 't'>;

const KEYS: BreachKey[] = [
  // Cruising, then nosing down and driving deeper with ever stronger strokes.
  { t: 0, y: -0.327, h: 0, pitch: 90, roll: 0, fin: 0, arch: 0, stroke: 1 },
  { t: 0.6, y: -0.345, h: 0.19, pitch: 98, roll: 0, fin: 0, arch: -0.1, stroke: 1.3 },
  { t: 1.3, y: -0.45, h: 0.42, pitch: 108, roll: 0, fin: 0, arch: -0.15, stroke: 1.6 },
  { t: 2.6, y: -0.56, h: 0.92, pitch: 92, roll: 0, fin: 0.05, arch: 0.1, stroke: 2.1 },
  // The pull-up: a tight J, accelerating (the body bends into the curve).
  { t: 3.45, y: -0.498, h: 1.272, pitch: 70, roll: 0.03, fin: 0.1, arch: 0.55, stroke: 2.3 },
  // Breakout: the head bursts through the surface, still steepening, the flippers swinging out.
  { t: BREACH_T.breakout, y: -0.32, h: 1.582, pitch: 50, roll: 0.1, fin: 0.35, arch: 0.6, stroke: 2 },
  { t: 5.0, y: -0.03, h: 1.93, pitch: 32, roll: 0.22, fin: 0.85, arch: 0.7, stroke: 0.9 },
  // Highest: about 70 % of the body clear, near-vertical, rolling.
  { t: BREACH_T.peak, y: 0.18, h: 2.1, pitch: 22, roll: 0.45, fin: 1, arch: 0.8, stroke: 0.4 },
  // Arcing over and twisting onto its back as it falls.
  { t: 7.3, y: 0.13, h: 2.24, pitch: 48, roll: 0.72, fin: 1, arch: 0.7, stroke: 0.4 },
  { t: BREACH_T.impact, y: 0.03, h: 2.42, pitch: 96, roll: 1, fin: 0.8, arch: 0.4, stroke: 0.6 },
  // Under head-first; the tail swings up and the flukes lift clear before following it down.
  { t: 8.8, y: -0.12, h: 2.6, pitch: 122, roll: 1.14, fin: 0.5, arch: 0.3, stroke: 0.5 },
  { t: 9.45, y: -0.24, h: 2.75, pitch: 138, roll: 1.35, fin: 0.3, arch: 0.25, stroke: 0.9 },
  { t: 10.1, y: -0.36, h: 2.92, pitch: 126, roll: 1.6, fin: 0.15, arch: 0.1, stroke: 1.4 },
  // Rolling upright and levelling out, back up to cruising depth and speed.
  { t: 12.0, y: -0.46, h: 3.3, pitch: 98, roll: 1.9, fin: 0.05, arch: 0, stroke: 1.3 },
  { t: 13.2, y: -0.37, h: 3.6, pitch: 84, roll: 2, fin: 0, arch: 0, stroke: 1.1 },
  { t: BREACH_T.end, y: -0.327, h: 3.95, pitch: 90, roll: 2, fin: 0, arch: 0, stroke: 1 },
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
  return { y: value('y'), h: value('h'), pitch: value('pitch'), roll: value('roll'), fin: value('fin'), arch: value('arch'), stroke: value('stroke') };
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

export function poseWhaleSpine(spine: THREE.Bone[], phase: number, strength: number, turn: number, arch = 0): void {
  spine.forEach((bone, i) => {
    const tail = i / 8;
    // Phase delay travels down the spine; the head stays comparatively steady.
    bone.rotation.x = Math.sin(phase - tail * 4.8) * (0.012 + tail * tail * 0.095) * strength
      + Math.sin(tail * Math.PI) * arch * 0.12;
    bone.rotation.y = THREE.MathUtils.clamp(turn, -0.5, 0.5) * (0.03 + tail * 0.065);
    bone.rotation.z = Math.sin(phase * 0.6 - tail * 2) * tail * 0.018 * strength;
  });
}
