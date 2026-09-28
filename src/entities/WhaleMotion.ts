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

export const IMPACT_T = 3.2;
export const BREACH_END = 4.6;
export const FLUKE_T = 3.65;
export const DIVE_T = 2.6;
const KEYS = [
  { t: 0, y: -0.64, h: 0, pitch: 36, roll: 0, fin: 0.3 },
  { t: 0.65, y: -0.34, h: 0.08, pitch: 18, roll: 15, fin: 0.6 },
  { t: 1.1, y: 0.28, h: 0.22, pitch: 14, roll: 85, fin: 1.1 },
  { t: 1.6, y: 0.78, h: 0.4, pitch: 25, roll: 185, fin: 1.25 },
  { t: 1.95, y: 0.88, h: 0.53, pitch: 42, roll: 265, fin: 1.2 },
  { t: 2.4, y: 0.69, h: 0.7, pitch: 62, roll: 350, fin: 1.05 },
  { t: 2.85, y: 0.35, h: 0.88, pitch: 80, roll: 420, fin: 1.3 },
  { t: IMPACT_T, y: 0.08, h: 1.02, pitch: 92, roll: 450, fin: 1.35 },
  { t: FLUKE_T, y: -0.33, h: 1.13, pitch: 138, roll: 450, fin: 0.7 },
  { t: BREACH_END, y: -0.95, h: 1.23, pitch: 180, roll: 450, fin: 0.3 },
];

/** Launch, airborne spin, broadside impact and submerged follow-through. */
export function sampleBreach(t: number): Omit<typeof KEYS[number], 't'> {
  if (t <= 0) return KEYS[0];
  if (t >= BREACH_END) return KEYS[KEYS.length - 1];
  let i = 0;
  while (t > KEYS[i + 1].t) i++;
  const a = KEYS[Math.max(0, i - 1)], b = KEYS[i], c = KEYS[i + 1], d = KEYS[Math.min(KEYS.length - 1, i + 2)];
  const f = (t - b.t) / (c.t - b.t);
  // Time-aware Hermite tangents keep velocity continuous across unequal key intervals.
  const value = (key: 'y' | 'h' | 'pitch' | 'roll' | 'fin') => {
    const m0 = (c[key] - a[key]) / (c.t - a.t) * (c.t - b.t);
    const m1 = (d[key] - b[key]) / (d.t - b.t) * (c.t - b.t);
    return (2*f*f*f - 3*f*f + 1)*b[key] + (f*f*f - 2*f*f + f)*m0 + (-2*f*f*f + 3*f*f)*c[key] + (f*f*f - f*f)*m1;
  };
  return { y: value('y'), h: value('h'), pitch: value('pitch'), roll: value('roll'), fin: value('fin') };
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
