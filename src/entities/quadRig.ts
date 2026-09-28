import * as THREE from 'three';
import { GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { peopleMaterial } from '../render/materials';
import { legSegment, splitBody } from './animalModels';

/**
 * A small jointed four-legged rig shared by dogs and jaguars: front and rear body halves with a
 * spine joint, a head, a one- or two-piece tail and three-segment legs, driven by a pose with
 * blend weights for sitting, lying, crouching (stalking), lunging and limping.
 */

const COAT = { color: 0xffffff, mat: 2 };
const coat = (shade: number) => ({ color: new THREE.Color(shade, shade, shade), mat: 2 });
const C = (c: number) => ({ color: c });

export interface QuadDims {
  spineY: number;
  /** Shoulder height above the ground (front leg length). */
  hipY: number;
  x: number;
  zF: number;
  zR: number;
  head: [number, number, number];
  tail: [number, number, number];
  /** Leg segment length ratios (upper, lower, paw) and radius. */
  seg: [number, number, number];
  r: number;
  /** Distance covered per gait cycle. */
  stride: number;
  /** Tail segment lengths (second may be 0). */
  tailLen: [number, number];
}

export const DOG_DIMS: QuadDims = {
  spineY: 0.2, hipY: 0.165, x: 0.04, zF: 0.095, zR: -0.1, head: [0, 0.085, 0.165], tail: [0, 0.02, -0.165],
  seg: [0.44, 0.38, 0.2], r: 0.017, stride: 0.24, tailLen: [0.13, 0],
};

export const JAG_DIMS: QuadDims = {
  spineY: 0.25, hipY: 0.2, x: 0.066, zF: 0.16, zR: -0.19, head: [0, 0.07, 0.29], tail: [0, 0.03, -0.3],
  seg: [0.44, 0.38, 0.2], r: 0.03, stride: 0.42, tailLen: [0.24, 0.22],
};

/** Hind legs stand with the thigh forward, shin back and paw upright. */
const HIND0 = [-0.32, 0.64, -0.32];
const hindHipY = (q: QuadDims) => q.hipY * (q.seg[0] * Math.cos(HIND0[0]) + q.seg[1] * Math.cos(HIND0[0] + HIND0[1]) + q.seg[2]);
/** Gait phase offsets per leg (LF, RF, LH, RH). */
const WALK = [0.25, 0.75, 0, 0.5];
const GALLOP = [0, 0.12, 0.5, 0.62];

// ---------------- Geometry ----------------

/** Dog body: deep chest, tucked belly, rounded haunch; 'tri' adds a cream chest and belly. */
export function dogBodyHalves(tri: boolean): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.056, 0.17, 4, 8), COAT, M.t(0, 0.205, -0.005, Math.PI / 2, 0, 0, 1, 1.05, 1));
  b.add(P.sphere(0.068, 1), COAT, M.t(0, 0.198, 0.08, 0, 0, 0, 0.92, 1.12, 1));
  b.add(P.sphere(0.062, 1), COAT, M.t(0, 0.21, -0.095, 0, 0, 0, 1, 1, 1));
  // Neck rising to the head.
  b.add(P.cyl(0.034, 0.048, 0.11, 8), COAT, M.t(0, 0.245, 0.13, 0.8, 0, 0));
  b.add(P.sphere(0.042, 1), COAT, M.t(0, 0.27, 0.15, 0, 0, 0, 0.9, 0.9, 1.1));
  if (tri) {
    b.add(P.sphere(0.05, 1), C(0xeee0c4), M.t(0, 0.18, 0.12, 0, 0, 0, 0.85, 1.1, 0.7));
    b.add(P.sphere(0.05, 0), C(0xeee0c4), M.t(0, 0.16, 0.0, 0, 0, 0, 0.8, 0.45, 1.8));
  }
  return splitBody(facet(b.build()), DOG_DIMS.spineY);
}

/** Dog head (pivot at the neck joint): skull, muzzle, nose, eyes and pricked or floppy ears. */
export function dogHead(ears: 'prick' | 'floppy', tri: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.05, 1), COAT, M.t(0, 0.025, 0.02, 0, 0, 0, 0.95, 0.9, 1.05));
  b.add(P.cyl(0.023, 0.03, 0.075, 7), tri ? C(0xeee0c4) : coat(0.9), M.t(0, 0.004, 0.085, Math.PI / 2, 0, 0));
  b.add(P.sphere(0.013, 0), C(0x1a1412), M.t(0, 0.012, 0.124));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.008, 0), C(0x120e0c), M.t(x * 0.024, 0.04, 0.058));
    if (ears === 'prick') b.add(P.cone(0.022, 0.055, 4), coat(0.8), M.t(x * 0.03, 0.075, 0.0, -0.15, 0, x * -0.3));
    else b.add(P.box(0.014, 0.055, 0.036), coat(0.75), M.t(x * 0.052, 0.018, 0.005, 0, 0, x * 0.2));
  }
  return facet(b.build());
}

/** Tail piece: pivot at its base, running back along -z. */
export function tailPiece(len: number, r0: number, r1: number, tip?: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(r1, r0, len, 6), COAT, M.t(0, 0, -len / 2, Math.PI / 2, 0, 0));
  if (tip !== undefined) b.add(P.cyl(r1 * 1.05, r1 * 1.1, len * 0.3, 6), C(tip), M.t(0, 0, -len * 0.86, Math.PI / 2, 0, 0));
  return facet(b.build());
}

/** Paw under the wrist / ankle: short pastern and a rounded pad. */
export function paw(len: number, r: number, pad: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r * 1.05, 0), COAT, M.t(0, 0, 0));
  b.add(P.cyl(r * 0.9, r, len * 0.7, 6), COAT, M.t(0, -len * 0.35, 0));
  b.add(P.sphere(r * 1.25, 0), coat(0.92), M.t(0, -len * 0.82, r * 0.55, 0, 0, 0, 1, 0.6, 1.4));
  b.add(P.box(r * 1.6, r * 0.3, r * 0.6), C(pad), M.t(0, -len * 0.95, r * 1.4));
  return facet(b.build());
}

/** Jaguar body: long and low with heavy shoulders, rosettes over the back and flanks, pale belly. */
export function jaguarBodyHalves(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  const y0 = JAG_DIMS.spineY;
  b.add(new THREE.CapsuleGeometry(0.082, 0.32, 4, 9), COAT, M.t(0, y0, -0.01, Math.PI / 2, 0, 0, 1, 1.02, 1));
  b.add(P.sphere(0.095, 1), COAT, M.t(0, y0 - 0.005, 0.14, 0, 0, 0, 0.95, 1.1, 1));
  b.add(P.sphere(0.09, 1), COAT, M.t(0, y0 + 0.01, -0.17, 0, 0, 0, 1, 1, 1));
  b.add(P.cyl(0.058, 0.078, 0.12, 8), COAT, M.t(0, y0 + 0.03, 0.235, 0.95, 0, 0));
  b.add(P.sphere(0.066, 1), COAT, M.t(0, y0 + 0.05, 0.27, 0, 0, 0, 0.95, 0.9, 1.1));
  b.add(P.sphere(0.085, 1), C(0xeee0c2), M.t(0, y0 - 0.06, 0.0, 0, 0, 0, 0.78, 0.42, 2.4));
  // Rosettes: dark broken rings scattered over the back and flanks.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Each rosette is a ring of three or four small dark blotches, lying flat on the coat.
  for (let k = 0; k < 30; k++) {
    const a = (rnd() - 0.5) * 3.7;
    const z = -0.27 + rnd() * 0.47;
    const rr = z > 0.08 ? 0.095 : z < -0.12 ? 0.091 : 0.084;
    const n = 3 + Math.floor(rnd() * 2);
    const ring = 0.012 + rnd() * 0.006;
    for (let q = 0; q < n; q++) {
      const t = (q / n) * Math.PI * 2 + rnd();
      const aa = a + (Math.cos(t) * ring) / rr, zz = z + Math.sin(t) * ring;
      const x = Math.sin(aa) * rr, y = y0 + Math.cos(aa) * rr;
      b.add(P.sphere(0.0075 + rnd() * 0.003, 0), C(0x2a1c12), M.t(x, y, zz, 0, 0, -aa, 1, 0.45, 1));
    }
  }
  return splitBody(facet(b.build()), y0);
}

/** Jaguar head: broad round skull, pale muzzle, amber eyes, small round ears, a few spots. */
export function jaguarHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.072, 1), COAT, M.t(0, 0.018, 0.02, 0, 0, 0, 1.12, 0.82, 1.05));
  // Heavy jaw and a short broad muzzle, pale underneath.
  b.add(P.sphere(0.05, 1), COAT, M.t(0, -0.012, 0.062, 0, 0, 0, 1.15, 0.72, 0.95));
  b.add(P.sphere(0.04, 1), C(0xeee0c2), M.t(0, -0.022, 0.082, 0, 0, 0, 1.05, 0.62, 0.8));
  b.add(P.sphere(0.014, 0), C(0x4a2a24), M.t(0, 0.004, 0.113));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.012, 0), C(0xd8a030), M.t(x * 0.036, 0.04, 0.074));
    b.add(P.sphere(0.006, 0), C(0x120c08), M.t(x * 0.038, 0.041, 0.083));
    b.add(P.cyl(0.018, 0.021, 0.016, 7), COAT, M.t(x * 0.055, 0.066, -0.01, 0.3, 0, x * -0.7));
    b.add(P.cyl(0.011, 0.013, 0.018, 7), C(0x2a1c12), M.t(x * 0.055, 0.067, -0.016, 0.3, 0, x * -0.7));
    for (let k = 0; k < 3; k++) b.add(P.sphere(0.008, 0), C(0x2a1c12), M.t(x * (0.02 + k * 0.018), 0.07 - k * 0.012, 0.03 + k * 0.01));
  }
  return facet(b.build());
}

// ---------------- Drawing ----------------

export interface QuadPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  scale: number;
  /** Gait cycle 0..1 and stride amplitude (0 standing still). */
  gait: number;
  amp: number;
  gallop: boolean;
  /** Spine bend into turns. */
  bend: number;
  sit: number;
  lie: number;
  crouch: number;
  lunge: number;
  limp: number;
  headPitch: number;
  headYaw: number;
  tailPitch: number;
  tailYaw: number;
  /** Second tail piece curl (jaguar). */
  tailCurl: number;
  bob: number;
}

export function blankPose(): QuadPose {
  return { x: 0, y: 0, z: 0, heading: 0, scale: 1, gait: 0, amp: 0, gallop: false, bend: 0, sit: 0, lie: 0, crouch: 0, lunge: 0, limp: 0, headPitch: 0, headYaw: 0, tailPitch: 0, tailYaw: 0, tailCurl: 0, bob: 0 };
}

export interface QuadKeys {
  F: string;
  R: string;
  head: string;
  tail0: string;
  tail1?: string;
  legU: string;
  legL: string;
  paw: string;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function compose(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Instanced meshes for the rig parts, tinted per animal through the accent colour. */
export class QuadMeshes {
  readonly group = new THREE.Group();
  private meshes = new Map<string, { mesh: THREE.InstancedMesh; acc: THREE.InstancedBufferAttribute; n: number }>();

  add(key: string, geo: THREE.BufferGeometry, cap: number): void {
    const acc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    acc.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAccent', acc);
    const mesh = new THREE.InstancedMesh(geo, peopleMaterial(), cap);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.meshes.set(key, { mesh, acc, n: 0 });
    this.group.add(mesh);
  }

  begin(): void {
    for (const e of this.meshes.values()) e.n = 0;
  }

  put(key: string, m: THREE.Matrix4, col: THREE.Color): void {
    const e = this.meshes.get(key);
    if (!e || e.n >= e.mesh.instanceMatrix.count) return;
    e.mesh.setMatrixAt(e.n, m);
    e.acc.setXYZ(e.n, col.r, col.g, col.b);
    e.n++;
  }

  end(): void {
    for (const e of this.meshes.values()) {
      e.mesh.count = e.n;
      if (e.n) {
        e.mesh.instanceMatrix.needsUpdate = true;
        e.acc.needsUpdate = true;
      }
    }
  }
}

const _M = new THREE.Matrix4(), _F = new THREE.Matrix4(), _R = new THREE.Matrix4(), _H = new THREE.Matrix4();
const _J = new THREE.Matrix4(), _T = new THREE.Matrix4(), _L = new THREE.Matrix4();

/** Pose and draw one animal. `headScale` enlarges the head (puppies). */
export function drawQuad(out: QuadMeshes, keys: QuadKeys, q: QuadDims, p: QuadPose, col: THREE.Color, headScale = 1): void {
  const s = p.scale;
  const G = p.gait * Math.PI * 2;
  const lie = p.lie, sit = p.sit * (1 - lie), crouch = p.crouch * (1 - lie), lunge = p.lunge;
  const moving = p.amp > 0.01;
  const flex = p.gallop ? Math.sin(G * 2) * 0.12 : 0;
  // Sitting pitches the body up about its middle; lying lowers it to the ground; crouching lowers it.
  const pitch = -0.5 * sit - 0.22 * lunge;
  const y = p.y + (q.spineY - lie * (q.spineY - q.hipY * 0.3) - crouch * q.hipY * 0.32 - sit * q.hipY * 0.2) * s + p.bob;
  compose(_M, p.x, y, p.z, pitch, p.heading, lie * 0.06, s);
  _F.multiplyMatrices(_M, compose(_T, 0, 0, 0, flex, p.bend * 0.5, 0));
  _R.multiplyMatrices(_M, compose(_T, 0, 0, 0, -flex, -p.bend * 0.5, 0));
  out.put(keys.F, _F, col);
  out.put(keys.R, _R, col);
  // Head stays roughly level while sitting.
  _H.multiplyMatrices(_F, compose(_T, q.head[0], q.head[1], q.head[2], p.headPitch - pitch * 0.8, p.headYaw + p.bend * 0.5, 0, headScale));
  out.put(keys.head, _H, col);
  // Tail.
  _J.multiplyMatrices(_R, compose(_T, q.tail[0], q.tail[1], q.tail[2], p.tailPitch, p.tailYaw, 0));
  out.put(keys.tail0, _J, col);
  if (keys.tail1) {
    _J.multiply(compose(_T, 0, 0, -q.tailLen[0], p.tailCurl, p.tailYaw * 0.8, 0));
    out.put(keys.tail1, _J, col);
  }
  // Legs.
  const L = q.hipY, l1 = L * q.seg[0], l2 = L * q.seg[1];
  const offs = p.gallop ? GALLOP : WALK;
  const hindY = hindHipY(q);
  const ampK = p.amp / 0.34;
  for (let k = 0; k < 4; k++) {
    const isFront = k < 2, side = k % 2 === 0 ? 1 : -1;
    const ph = G + offs[k] * Math.PI * 2;
    const sw = Math.sin(ph);
    const lift = moving ? Math.max(0, -Math.cos(ph)) : 0;
    let a1: number, a2: number, a3: number;
    if (isFront) {
      a1 = p.amp * sw;
      a2 = lift * 0.75 * ampK;
      a3 = lift * 1.2 * ampK - a1 * 0.3;
      // Sitting: forelegs straight down under the raised chest.
      a1 += 0.5 * sit;
      // Crouching / stalking: elbows bent, body slung low.
      a1 += -0.35 * crouch;
      a2 += 0.75 * crouch;
      a3 += -0.4 * crouch;
      // Lunging: forelegs reaching forward.
      a1 = mix(a1, -1.25, lunge);
      a2 = mix(a2, 0.2, lunge);
      if (k === 1 && p.limp > 0) {
        // Injured: the right foreleg is held up off the ground.
        a1 = mix(a1, -0.45, p.limp);
        a2 = mix(a2, 1.5, p.limp);
        a3 = mix(a3, 0.7, p.limp);
      }
      a1 = a1 * (1 - lie) - 1.15 * lie;
      a2 = a2 * (1 - lie) + 2.5 * lie;
      a3 = a3 * (1 - lie) - 1.2 * lie;
    } else {
      a1 = HIND0[0] + p.amp * sw;
      a2 = HIND0[1] + lift * 0.7 * ampK;
      a3 = HIND0[2] - lift * 0.8 * ampK;
      // Sitting: haunches down, thighs forward, shins folded back along the ground.
      a1 = mix(a1, -1.0, sit);
      a2 = mix(a2, 2.35, sit);
      a3 = mix(a3, -1.2, sit);
      a1 += -0.4 * crouch;
      a2 += 0.8 * crouch;
      a3 += -0.4 * crouch;
      a1 = mix(a1, 0.35, lunge);
      a2 = mix(a2, 0.25, lunge);
      a1 = a1 * (1 - lie) - 1.5 * lie;
      a2 = a2 * (1 - lie) + 2.7 * lie;
      a3 = a3 * (1 - lie) - 0.9 * lie;
    }
    const half = isFront ? _F : _R;
    const hipYo = (isFront ? L : hindY) - q.spineY;
    _L.multiplyMatrices(half, compose(_T, side * q.x, hipYo, isFront ? q.zF : q.zR, a1, 0, side * 0.03));
    out.put(keys.legU, _L, col);
    _L.multiply(compose(_T, 0, -l1, 0, a2, 0, 0));
    out.put(keys.legL, _L, col);
    _L.multiply(compose(_T, 0, -l2, 0, a3, 0, 0));
    out.put(keys.paw, _L, col);
  }
}

/** Leg segments for a rig (upper, lower, paw). */
export function legParts(q: QuadDims, pad: number): [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry] {
  const L = q.hipY;
  return [legSegment(L * q.seg[0], q.r, q.r * 0.8), legSegment(L * q.seg[1], q.r * 0.78, q.r * 0.64), paw(L * q.seg[2], q.r * 0.66, pad)];
}

/** Advance a gait cycle by distance travelled so feet don't skate. */
export function stepGait(gait: number, speed: number, dt: number, q: QuadDims, gallop: boolean): number {
  return (gait + (speed * dt) / q.stride / (gallop ? 1.7 : 1)) % 1;
}
