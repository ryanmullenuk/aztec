import * as THREE from 'three';
import { View } from '../render/View';
import { ISLANDER } from '../config';
import { peopleMaterial, peopleSkinnedMaterial } from '../render/materials';
import { Islander } from './Islander';
import { PartKey, SKELETON, Skeleton, buildPeopleParts } from './PeopleModels';
import { BI, BONE_COUNT, GlbModel, loadGlbPeople } from './glbPeople';

/** World units per metre: islanders are modelled at ~1.8 m and stand ~0.62 units tall. */
const S0 = 0.62 / 1.8;

/**
 * Joint angles for one frame of animation (radians; metres for offsets). Conventions:
 * negative thigh / upper-arm X swings forward (upper arm -π is straight up), positive shin X
 * bends the knee, negative forearm X bends the elbow, positive wrist X cocks the hand back,
 * positive foot offset points the toes down (0 keeps the foot flat on the ground), positive
 * lean / hipPitch bend forward, negative headX looks up. "L" is the -x side, "R" the +x side
 * (which holds the tool).
 */
interface Pose {
  drop: number;
  bob: number;
  lean: number;
  twist: number;
  headX: number;
  headY: number;
  headZ: number;
  thL: number;
  thR: number;
  shL: number;
  shR: number;
  uaLx: number;
  uaLz: number;
  uaRx: number;
  uaRz: number;
  faL: number;
  faR: number;
  /** Hip rotation (yaw) and side-to-side sway (roll); the shoulders counter-rotate. */
  hipYaw: number;
  roll: number;
  /** Pelvis tilt forward (a hinge at the hips), extra bend in the lower back and upper chest. */
  hipPitch: number;
  spineX: number;
  chestX: number;
  wrLx: number;
  wrLz: number;
  wrRx: number;
  wrRz: number;
  ftL: number;
  ftR: number;
  /** Legs apart (each thigh out to the side). */
  spread: number;
  /** Shoulder lift (clavicle) per side. */
  shrugL: number;
  shrugR: number;
  lying: boolean;
}

const tri = (s: number) => (s < 0.7 ? s / 0.7 : 1 - (s - 0.7) / 0.3);
const ease = (x: number) => x * x * (3 - 2 * x);
const pos = (x: number) => Math.max(0, x);

function blankPose(): Pose {
  return {
    drop: 0, bob: 0, lean: 0, twist: 0, headX: 0, headY: 0, headZ: 0, thL: 0, thR: 0, shL: 0.05, shR: 0.05,
    uaLx: 0, uaLz: 0.16, uaRx: 0, uaRz: 0.16, faL: -0.14, faR: -0.14, hipYaw: 0, roll: 0, hipPitch: 0, spineX: 0, chestX: 0,
    wrLx: 0.08, wrLz: 0, wrRx: 0.08, wrRz: 0, ftL: 0, ftR: 0, spread: 0, shrugL: 0, shrugR: 0, lying: false,
  };
}

/** A walking stride: legs, knees, ankles, hips and the arm swing that goes with them. */
function stride(p: Pose, ph: number, amp: number, knee: number, stance: number, armK: number): void {
  const s = Math.sin(ph), c = Math.cos(ph);
  // Thigh swings (L = -x side leads when s < 0).
  p.thL = s * amp;
  p.thR = -s * amp;
  // Knee: folds most as the leg passes forward (mid-swing), with a small give at heel strike.
  p.shL = stance + Math.pow(pos(-c), 1.4) * knee + pos(-s) * pos(c) * stance * 1.5;
  p.shR = stance + Math.pow(pos(c), 1.4) * knee + pos(s) * pos(-c) * stance * 1.5;
  // Ankles: toe up reaching forward, pushing off (toe down) behind.
  p.ftL = 0.5 * pos(s - 0.2) * (0.6 + pos(-c)) - 0.22 * pos(-s);
  p.ftR = 0.5 * pos(-s - 0.2) * (0.6 + pos(c)) - 0.22 * pos(s);
  // Hips swing with the leading leg and drop on the swing side; shoulders counter-rotate.
  p.hipYaw = -s * 0.17 * (amp / 0.5);
  p.roll = c * 0.06;
  p.hipPitch = 0.05;
  // Arms swing against the legs, the elbow bending more on the forward swing.
  p.uaLx = -p.thL * armK;
  p.uaRx = -p.thR * armK;
  p.faL = -0.3 - pos(-p.uaLx) * 0.75;
  p.faR = -0.3 - pos(-p.uaRx) * 0.75;
  p.wrLx = p.wrRx = -0.1;
  p.uaLz = p.uaRz = 0.18;
  // The head stays steady against the body's bounce.
  p.headX = -0.04 - Math.sin(ph * 2) * 0.03;
}

/** Procedural animation for every islander activity. */
function poseFor(isl: Islander, female: boolean, skel?: Skeleton): Pose {
  const t = isl.animT;
  const p = blankPose();
  const sk = skel ?? SKELETON[female ? 'f' : 'm'];
  switch (isl.anim) {
    case 'idle': {
      // Breathing, a slow weight shift onto one hip, relaxed arms, looking around.
      const br = Math.sin(t * 1.7);
      const shift = Math.sin(t * 0.43);
      p.chestX = -br * 0.025;
      p.shrugL = p.shrugR = br * 0.02;
      p.bob = br * 0.004;
      p.roll = shift * 0.045;
      p.hipYaw = shift * 0.05;
      p.thL = -0.04 + shift * 0.04;
      p.thR = 0.05 - shift * 0.04;
      p.shL = 0.06 + pos(shift) * 0.2;
      p.shR = 0.06 + pos(-shift) * 0.2;
      p.spread = 0.03;
      p.uaLx = Math.sin(t * 1.1) * 0.06;
      p.uaRx = -Math.sin(t * 1.1) * 0.06;
      p.faL = -0.18 + Math.sin(t * 0.9) * 0.05;
      p.faR = -0.2 - Math.sin(t * 0.8) * 0.05;
      p.headY = Math.sin(t * 0.37) * 0.5;
      p.headX = Math.sin(t * 0.23) * 0.08;
      p.twist = Math.sin(t * 0.37) * 0.1;
      break;
    }
    case 'walk': {
      stride(p, t * 7.5, 0.38, 0.9, 0.1, 0.9);
      p.lean = 0.06;
      break;
    }
    case 'carry': {
      const kind = isl.carry?.kind;
      stride(p, t * 6.8, 0.38, 0.8, 0.16, 0.8);
      p.lean = 0.02;
      p.roll *= 1.4;
      if (kind === 'log') {
        // Log across the shoulders: both hands up beside the head holding it, elbows out.
        p.uaLx = p.uaRx = -2.35;
        p.uaLz = p.uaRz = 0.62;
        p.faL = p.faR = -1.75;
        p.wrLx = p.wrRx = 0.35;
        p.lean = 0.12;
        p.headX = 0.12;
      } else if (kind === 'chicken') {
        // Bird tucked under the right arm; the left arm swings.
        p.uaRx = -0.15;
        p.uaRz = 0.4;
        p.faR = -1.45;
        p.wrRx = -0.3;
      } else {
        // Load balanced on the head: both arms up steadying it, elbows bent, hands flat.
        p.uaLx = p.uaRx = -2.7 + Math.sin(t * 6.8) * 0.05;
        p.uaLz = p.uaRz = 0.32;
        p.faL = p.faR = -0.7;
        p.wrLx = p.wrRx = 0.55;
        p.headX = 0.02;
      }
      break;
    }
    case 'run': {
      const ph = t * 11;
      stride(p, ph, 0.85, 1.7, 0.2, 1.0);
      p.faL = p.faR = -1.35;
      p.faL -= pos(-p.uaLx) * 0.3;
      p.faR -= pos(-p.uaRx) * 0.3;
      p.wrLx = p.wrRx = -0.2;
      p.lean = 0.22;
      p.hipPitch = 0.1;
      p.hipYaw *= 1.2;
      p.roll = Math.cos(ph) * 0.05;
      // Both feet off the ground for a moment each stride.
      p.bob = pos(Math.sin(ph * 2)) * 0.05;
      break;
    }
    case 'chop':
    case 'mine': {
      const mine = isl.anim === 'mine';
      const s = (t * (mine ? 1.05 : 1.35)) % 1;
      // Slow wind-up overhead, a fast strike, then the follow-through settles.
      const k = s < 0.6 ? ease(s / 0.6) : s < 0.72 ? 1 - Math.pow((s - 0.6) / 0.12, 2) : 0;
      const hit = s > 0.7 && s < 0.9 ? Math.sin(((s - 0.7) / 0.2) * Math.PI) : 0;
      p.uaLx = p.uaRx = -0.55 - k * 2.4;
      p.uaLz = p.uaRz = -0.26 + k * 0.2;
      p.faL = p.faR = -0.22 - k * 0.7;
      p.wrLx = p.wrRx = k * 0.6 - hit * 0.35;
      // Arch back and turn to the tool side on the wind-up; drive down and forward through the strike.
      p.lean = (mine ? 0.2 : 0.08) + (1 - k) * (mine ? 0.34 : 0.26) - k * 0.14 + hit * 0.06;
      p.hipPitch = 0.06 + (1 - k) * (mine ? 0.16 : 0.1);
      p.twist = (k - 0.4) * 0.4;
      p.hipYaw = (k - 0.4) * 0.12;
      p.spread = 0.07;
      p.thL = -0.3;
      p.thR = 0.2;
      p.shL = 0.3 + (1 - k) * 0.22 + hit * 0.1;
      p.shR = 0.22 + (1 - k) * 0.16 + hit * 0.08;
      p.ftR = 0.12;
      p.headX = -k * 0.35 + (1 - k) * 0.3;
      p.drop = 0.03;
      break;
    }
    case 'farm': {
      // Hoeing: hinged at the hips, knees flexed, arms swinging the hoe down in an arc.
      const ph = t * 3.2;
      const k = Math.sin(ph) * 0.5 + 0.5;
      p.uaLx = p.uaRx = -0.75 - k * 1.55;
      p.uaLz = p.uaRz = -0.2;
      p.faL = p.faR = -0.4 - k * 0.7;
      p.wrLx = p.wrRx = k * 0.35 - (1 - k) * 0.2;
      p.hipPitch = 0.25 + (1 - k) * 0.08;
      p.lean = 0.32 + (1 - k) * 0.22;
      p.twist = (k - 0.5) * 0.18;
      p.headX = 0.25;
      p.spread = 0.06;
      p.thL = -0.5;
      p.shL = 0.7;
      p.thR = 0.1;
      p.shR = 0.45;
      p.drop = 0.1;
      break;
    }
    case 'harvest': {
      const ph = t * 4;
      if (isl.reachHigh) {
        // Up on tiptoe, reaching into the branches with alternating hands.
        p.uaLx = -2.75 + Math.sin(ph) * 0.2;
        p.uaRx = -2.55 + Math.cos(ph) * 0.25;
        p.uaLz = p.uaRz = 0.1;
        p.faL = -0.3 - pos(Math.sin(ph)) * 0.5;
        p.faR = -0.3 - pos(Math.cos(ph)) * 0.5;
        p.wrLx = p.wrRx = -0.3;
        p.headX = -0.45;
        p.chestX = -0.08;
        const tip = pos(Math.sin(ph * 0.5));
        p.ftL = p.ftR = 0.35 + tip * 0.35;
        p.bob = tip * 0.03;
      } else {
        // Squatting low, reaching down and forward to pick, weight rocking side to side.
        const k = Math.sin(ph * 0.6) * 0.5 + 0.5;
        p.thL = p.thR = -1.25 - k * 0.15;
        p.shL = p.shR = 1.9 + k * 0.2;
        p.spread = 0.12;
        p.hipPitch = 0.3;
        p.lean = 0.45 + k * 0.15;
        p.roll = Math.sin(ph * 0.3) * 0.05;
        p.uaLx = -1.05 + Math.sin(ph) * 0.3;
        p.uaRx = -1.05 - Math.sin(ph) * 0.3;
        p.uaLz = p.uaRz = 0.12;
        p.faL = -0.5 - pos(Math.sin(ph)) * 0.4;
        p.faR = -0.5 - pos(-Math.sin(ph)) * 0.4;
        p.wrLx = p.wrRx = -0.35;
        p.headX = 0.25;
        p.drop = 0.12;
      }
      break;
    }
    case 'fish': {
      const s = (t * 0.6) % 1;
      const k = tri(s);
      // Spear raised and drawn back, then thrown down with the whole body.
      p.uaRx = -2.65 + k * 1.8;
      p.uaRz = 0.1;
      p.faR = -0.25 - (1 - k) * 0.5;
      p.wrRx = k * 0.3;
      p.uaLx = -1.0 + k * 0.3;
      p.faL = -0.6;
      p.lean = 0.08 + k * 0.28;
      p.twist = -(1 - k) * 0.25;
      p.hipYaw = -(1 - k) * 0.1;
      p.thL = -0.28;
      p.shL = 0.25 + k * 0.2;
      p.thR = 0.22;
      p.shR = 0.15;
      p.ftR = 0.2;
      p.headX = 0.2;
      break;
    }
    case 'build': {
      // Down on one knee, hammering with the right hand, steadying the work with the left.
      const ph = t * 9;
      const hit = Math.sin(ph);
      p.thL = -1.4;
      p.shL = 1.5;
      p.thR = 0.35;
      p.shR = 1.95;
      p.ftR = 1.0;
      p.hipPitch = 0.15;
      p.lean = 0.35;
      p.uaRx = -1.35 + hit * 0.6;
      p.faR = -0.95 + hit * 0.45;
      p.wrRx = pos(hit) * 0.4 - pos(-hit) * 0.3;
      p.uaLx = -0.95;
      p.uaLz = 0.05;
      p.faL = -0.9;
      p.twist = 0.12;
      p.headX = 0.35;
      p.drop = 0.22;
      break;
    }
    case 'pray': {
      // Kneeling back on the heels, arms raised, bowing slowly to the ground and up again.
      const ph = t * 0.9;
      const bow = Math.sin(ph) * 0.5 + 0.5;
      p.drop = sk.hipY - sk.thigh - 0.07;
      p.thL = p.thR = 0.05 - bow * 0.3;
      p.shL = p.shR = 1.55 + bow * 0.3;
      p.ftL = p.ftR = 1.35;
      p.hipPitch = bow * 0.35;
      p.uaLx = p.uaRx = -2.6 + bow * 0.4;
      p.uaLz = p.uaRz = 0.35;
      p.faL = p.faR = -0.2 - bow * 0.3;
      p.wrLx = p.wrRx = -0.3;
      p.lean = 0.1 + bow * 0.55;
      p.headX = -0.2 + bow * 0.4;
      break;
    }
    case 'wave': {
      // Looking up at the player, leaning back a touch, one arm high and waving from the elbow and wrist.
      const ph = t * 8.5;
      p.headX = -0.62;
      p.lean = -0.08;
      p.chestX = -0.06;
      p.uaRx = -2.75 + Math.sin(ph * 0.5) * 0.08;
      p.uaRz = -0.55;
      p.faR = -0.35 + Math.sin(ph) * 0.5;
      p.wrRz = Math.sin(ph) * 0.3;
      p.shrugR = 0.05;
      p.uaLx = -0.15;
      p.uaLz = 0.14;
      p.faL = -0.3;
      p.roll = -0.04;
      p.shL = 0.18;
      p.bob = pos(Math.sin(ph * 0.5)) * 0.012;
      break;
    }
    case 'eat': {
      const ph = t * 3;
      const bite = pos(Math.sin(ph));
      p.uaRx = -0.75 + bite * -0.2;
      p.faR = -1.75 - bite * 0.2;
      p.wrRx = -0.4;
      p.uaRz = -0.15;
      p.uaLx = -0.4;
      p.faL = -1.05;
      p.wrLx = -0.2;
      p.headX = 0.12 - bite * 0.1;
      p.chestX = 0.04;
      p.bob = Math.sin(t * 2) * 0.004;
      p.shL = 0.15;
      break;
    }
    case 'sleep':
      // Curled on the side a little, knees drawn up, breathing slowly.
      p.lying = true;
      p.uaLz = p.uaRz = 0.18;
      p.uaLx = -0.6;
      p.faL = p.faR = -0.9;
      p.thL = -0.55;
      p.thR = -0.35;
      p.shL = 0.9;
      p.shR = 0.7;
      p.ftL = p.ftR = 0.3;
      p.chestX = Math.sin(t * 1.2) * 0.03;
      p.bob = Math.sin(t * 1.2) * 0.004;
      break;
  }
  return p;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const BODY: PartKey[] = ['pelvis', 'chest', 'head', 'uarm', 'farm', 'thigh', 'shin'].flatMap((b) => [`${b}_m`, `${b}_f`] as PartKey[]);
const PAIRED = new Set(['uarm_m', 'uarm_f', 'farm_m', 'farm_f', 'thigh_m', 'thigh_f', 'shin_m', 'shin_f']);
const TOOLS = ['axe', 'pick', 'hoe', 'spear', 'hammer'] as const;
const LOADS: Record<string, PartKey> = { log: 'log', stone: 'stone', fruit: 'basket', grain: 'sack', fish: 'fish', meat: 'meat', chicken: 'chicken' };
/** Ankle height (metres) the planted foot keeps, and the knee's radius when kneeling. */
const FOOT_H = 0.1;
const KNEE_R = 0.06;

/** One character model drawn with GPU skinning: every islander of that model in one draw. */
interface SkinSet {
  model: GlbModel;
  mesh: THREE.InstancedMesh;
  accent: THREE.InstancedBufferAttribute;
  tex: THREE.DataTexture;
  data: Float32Array;
  /** Rows (islanders) the bone texture holds: grown by doubling, so each frame uploads little. */
  rows: number;
  n: number;
}

/**
 * Articulated islanders. Once the rigged character models load, each islander is a smoothly
 * skinned body on a 19-bone skeleton (hips, spine, chest, neck, head, shoulders, elbows,
 * wrists, knees, ankles) posed every frame, with its feet kept on the ground; all islanders of
 * a model are one instanced draw. Until then (or if the models fail to load) the built-in
 * faceted bodies are used, one InstancedMesh per rigid part. Tools, headdresses and carried
 * loads ride on the posed hands, head and chest either way.
 */
export class IslanderRig {
  readonly group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private accents = new Map<string, THREE.InstancedBufferAttribute>();
  private count = new Map<string, number>();
  private e = new THREE.Euler();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private tmp = new THREE.Matrix4();
  private tmp2 = new THREE.Matrix4();
  private m = {
    base: new THREE.Matrix4(),
    pelvis: new THREE.Matrix4(),
    chest: new THREE.Matrix4(),
    head: new THREE.Matrix4(),
    ua: new THREE.Matrix4(),
    fa: new THREE.Matrix4(),
    th: new THREE.Matrix4(),
    sh: new THREE.Matrix4(),
    out: new THREE.Matrix4(),
  };
  /** Posed bone frames for the islander being drawn (model space, metres). */
  private W = Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
  private skins: Partial<Record<'m' | 'f', SkinSet>> = {};
  private skin = new THREE.Color();
  private accent = new THREE.Color();
  readonly ring: THREE.Mesh;

  constructor() {
    const parts = buildPeopleParts();
    for (const [key, geo] of Object.entries(parts) as [PartKey, THREE.BufferGeometry][]) this.addMesh(key, geo, ISLANDER.max * (PAIRED.has(key) ? 2 : 1));
    // The rigged character models replace the built-in bodies once they have loaded.
    loadGlbPeople()
      .then((glb) => {
        for (const g of ['m', 'f'] as const) this.skins[g] = this.makeSkin(glb[g]);
        for (const k of BODY) {
          const m = this.meshes.get(k);
          if (m) m.visible = false;
        }
      })
      .catch((err) => console.warn('Islander models failed to load; keeping the built-in ones.', err));
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.9, depthWrite: false })
    );
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    this.group.add(this.ring);
  }

  private addMesh(key: string, geo: THREE.BufferGeometry, cap: number): void {
    const acc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    acc.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAccent', acc);
    const mesh = new THREE.InstancedMesh(geo, peopleMaterial(), cap);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.meshes.set(key, mesh);
    this.accents.set(key, acc);
    this.group.add(mesh);
  }

  private makeSkin(model: GlbModel): SkinSet {
    const cap = ISLANDER.max;
    const rows = 32;
    const data = new Float32Array(BONE_COUNT * 16 * rows);
    const tex = new THREE.DataTexture(data, BONE_COUNT * 4, rows, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    const { mat, depth } = peopleSkinnedMaterial(tex);
    const geo = model.geometry;
    const accent = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    accent.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAccent', accent);
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.customDepthMaterial = depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(mesh);
    return { model, mesh, accent, tex, data, rows, n: 0 };
  }

  private rot(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, order: THREE.EulerOrder = 'XYZ', s = 1): THREE.Matrix4 {
    this.e.set(rx, ry, rz, order);
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(s, s, s);
    return out.compose(this.v, this.q, this.s);
  }

  /** out = parent × T(x, y, z) × R(rx, ry, rz). */
  private child(out: THREE.Matrix4, parent: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, order: THREE.EulerOrder = 'XYZ', s = 1): void {
    out.multiplyMatrices(parent, this.rot(this.tmp, x, y, z, rx, ry, rz, order, s));
  }

  /** Write one instance of a part (packed), with skin tone and accent colour. */
  private put(key: string, m: THREE.Matrix4): void {
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    const i = this.count.get(key) ?? 0;
    if (i >= mesh.instanceMatrix.count) return;
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, this.skin);
    this.accents.get(key)?.setXYZ(i, this.accent.r, this.accent.g, this.accent.b);
    this.count.set(key, i + 1);
  }

  /**
   * Pose the full skeleton (model space, metres). The pelvis height comes from the legs: it sits
   * so the lower foot's ankle (or a kneeling knee) rests on the ground, so crouches, lunges and
   * strides stay planted without hand-tuned drops.
   */
  private poseSkeleton(model: GlbModel, p: Pose, headScale: number): void {
    const J = model.joint, L = model.len, W = this.W;
    const hips = J.hips;
    if (p.lying) {
      this.rot(W[BI.hips], 0, 0.16 + p.bob, 0.35, -Math.PI / 2, 0, 0.3);
    } else {
      const hipDY = J.thighL.y - hips.y;
      // The hips sit where no leg dips below the ground: the leg reaching lowest touches it.
      let need = -Infinity;
      for (const [th, sh] of [[p.thL, p.shL], [p.thR, p.shR]]) {
        const a = p.hipPitch + th;
        const kneeY = -L.thigh * Math.cos(a);
        const ankleY = kneeY - L.shin * Math.cos(a + sh);
        need = Math.max(need, Math.max(FOOT_H - ankleY, KNEE_R - kneeY) - hipDY);
      }
      this.rot(W[BI.hips], 0, need + p.bob, 0, p.hipPitch, p.twist * 0.4 + p.hipYaw, p.roll, 'YXZ');
    }
    // Torso: the bend and counter-twist spread over the lower back and chest.
    const tw = (p.twist - p.hipYaw * 1.9) * 0.5;
    this.child(W[BI.spine], W[BI.hips], J.spine.x - hips.x, J.spine.y - hips.y, J.spine.z - hips.z, p.lean * 0.55 + p.spineX, tw, -p.roll * 0.6, 'YXZ');
    this.child(W[BI.chest], W[BI.spine], J.chest.x - J.spine.x, J.chest.y - J.spine.y, J.chest.z - J.spine.z, p.lean * 0.45 + p.chestX, tw, -p.roll * 0.7, 'YXZ');
    this.child(W[BI.neck], W[BI.chest], J.neck.x - J.chest.x, J.neck.y - J.chest.y, J.neck.z - J.chest.z, p.headX * 0.4, p.headY * 0.35, p.headZ * 0.4, 'YXZ');
    this.child(W[BI.head], W[BI.neck], J.head.x - J.neck.x, J.head.y - J.neck.y, J.head.z - J.neck.z, p.headX * 0.6, p.headY * 0.65, p.headZ * 0.6, 'YXZ', headScale);
    // Arms (L = -x side = the model's .R bones) and legs.
    for (const side of [-1, 1] as const) {
      const L_ = side < 0;
      const b = L_ ? 'R' : 'L';
      const sh = BI[`shoulder${b}`], ua = BI[`upper_arm${b}`], fa = BI[`forearm${b}`], hd = BI[`hand${b}`];
      const jS = J[`shoulder${b}`], jU = J[`upper_arm${b}`];
      const shrug = L_ ? p.shrugL : p.shrugR;
      this.child(W[sh], W[BI.chest], jS.x - J.chest.x, jS.y - J.chest.y, jS.z - J.chest.z, 0, 0, side * shrug);
      this.child(W[ua], W[sh], jU.x - jS.x, jU.y - jS.y, jU.z - jS.z, L_ ? p.uaLx : p.uaRx, 0, side * (L_ ? p.uaLz : p.uaRz));
      this.child(W[fa], W[ua], 0, -L.upper, 0, L_ ? p.faL : p.faR, 0, 0);
      this.child(W[hd], W[fa], 0, -L.fore, 0, L_ ? p.wrLx : p.wrRx, 0, side * (L_ ? p.wrLz : p.wrRz));
      const th = BI[`thigh${b}`], sn = BI[`shin${b}`], ft = BI[`foot${b}`];
      const jT = J[`thigh${b}`];
      const a = L_ ? p.thL : p.thR, k = L_ ? p.shL : p.shR;
      this.child(W[th], W[BI.hips], jT.x - hips.x, jT.y - hips.y, jT.z - hips.z, a, 0, side * (0.05 + p.spread));
      this.child(W[sn], W[th], 0, -L.thigh, 0, k, 0, 0);
      // Feet stay flat to the ground unless the pose tips them.
      const flat = p.lying ? 0 : -(p.hipPitch + a + k);
      this.child(W[ft], W[sn], 0, -L.shin, 0, flat + (L_ ? p.ftL : p.ftR), 0, 0);
    }
  }

  update(list: Islander[], selected: number, _dt: number): void {
    this.count.clear();
    const M = this.m;
    const skinned = !!this.skins.m && !!this.skins.f;
    if (skinned) this.skins.m!.n = this.skins.f!.n = 0;
    for (const isl of list) {
      if (isl.hidden) continue;
      // Off screen: skip posing the jointed body (the villager keeps working as normal).
      if (!View.sees(isl.x, isl.y + 0.35, isl.z, 0.6)) continue;
      const g = isl.gender;
      const sk = SKELETON[g];
      const p = poseFor(isl, g === 'f', sk);
      this.skin.setHex(isl.skin);
      this.accent.setHex(isl.cloth2);
      const sc = S0 * (isl.child ? ISLANDER.childScale : 1) * (g === 'f' ? 0.98 : 1);
      this.rot(M.base, isl.x, isl.y, isl.z, 0, isl.heading, 0, 'XYZ', sc);
      const hs = isl.child ? 1.22 : 1;
      if (skinned) this.drawSkinned(isl, this.skins[g]!, p, hs);
      else this.drawRigid(isl, g, sk, p, hs);
    }
    for (const [key, mesh] of this.meshes) {
      const n = this.count.get(key) ?? 0;
      mesh.count = n;
      if (n === 0) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const acc = this.accents.get(key);
      if (acc) acc.needsUpdate = true;
    }
    if (skinned) {
      for (const s of [this.skins.m!, this.skins.f!]) {
        s.mesh.count = s.n;
        if (!s.n) continue;
        s.mesh.instanceMatrix.needsUpdate = true;
        if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
        s.accent.needsUpdate = true;
        s.tex.needsUpdate = true;
      }
    }
    const sel = list.find((l) => l.id === selected);
    this.ring.visible = !!sel && !sel.hidden;
    if (sel) {
      this.ring.position.set(sel.x, sel.y + 0.04, sel.z);
      this.ring.scale.setScalar(sel.child ? 0.7 : 1);
    }
    void ZERO;
    void TOOLS;
  }

  /** Skinned character model: pose the skeleton, write its skin matrices, then attach props. */
  private drawSkinned(isl: Islander, set: SkinSet, p: Pose, hs: number): void {
    const i = set.n;
    if (i >= set.mesh.instanceMatrix.count) return;
    const M = this.m, W = this.W, J = set.model.joint;
    if (i >= set.rows) {
      // More islanders on screen than the bone texture holds: double it.
      const rows = Math.min(ISLANDER.max, set.rows * 2);
      const data = new Float32Array(BONE_COUNT * 16 * rows);
      data.set(set.data);
      set.data = data;
      set.rows = rows;
      set.tex.dispose();
      set.tex.image = { data, width: BONE_COUNT * 4, height: rows };
      set.tex.needsUpdate = true;
    }
    this.poseSkeleton(set.model, p, hs);
    const row = i * BONE_COUNT * 16;
    for (let b = 0; b < BONE_COUNT; b++) {
      this.tmp2.multiplyMatrices(W[b], set.model.bindInv[b]);
      set.data.set(this.tmp2.elements, row + b * 16);
    }
    set.mesh.setMatrixAt(i, M.base);
    set.mesh.setColorAt(i, this.skin);
    set.accent.setXYZ(i, this.accent.r, this.accent.g, this.accent.b);
    set.n = i + 1;
    // Headdress: warriors wear jaguar or eagle helms, priests the grand feather fan.
    const hd = isl.warrior ? isl.warrior : isl.role === 'priest' && !isl.child ? 'hd_fan' : null;
    if (hd) {
      M.out.multiplyMatrices(M.base, W[BI.head]);
      this.put(hd as PartKey, M.out);
    }
    // Tool in the right (+x) hand.
    const tool = isl.carry || isl.anim === 'sleep' || isl.anim === 'pray' || isl.anim === 'eat' ? 'none' : isl.tool;
    if (tool !== 'none') {
      M.out.multiplyMatrices(M.base, W[BI.handL]);
      M.out.multiply(this.rot(this.tmp, 0, -0.04, 0.01, 0, 0, 0));
      this.put(tool as PartKey, M.out);
    }
    // Carried load: on the head, across the shoulders (log) or under the arm (chicken).
    const c = isl.carry?.kind;
    if (c && LOADS[c]) {
      M.chest.multiplyMatrices(M.base, W[BI.chest]);
      const up = J.head.y - J.chest.y;
      if (c === 'chicken') M.out.multiplyMatrices(M.chest, this.rot(this.tmp, 0.2, up - 0.3, 0.12, 0, 0.3, 0));
      else if (c === 'log') M.out.multiplyMatrices(M.chest, this.rot(this.tmp, 0, J.upper_armL.y - J.chest.y + 0.1, -0.12, 0, 0.25, 0));
      else M.out.multiplyMatrices(M.chest, this.rot(this.tmp, 0, up + 0.36, 0.02, 0, 0, 0));
      this.put(LOADS[c], M.out);
    }
  }

  /** Built-in faceted bodies: one rigid instance per body part. */
  private drawRigid(isl: Islander, g: 'm' | 'f', sk: Skeleton, p: Pose, hs: number): void {
    const M = this.m;
    // Pelvis (root of the skeleton).
    if (p.lying) {
      M.pelvis.multiplyMatrices(M.base, this.rot(this.tmp, 0, 0.16 + p.bob, 0.35, -Math.PI / 2, 0, 0));
    } else {
      M.pelvis.multiplyMatrices(M.base, this.rot(this.tmp, 0, sk.hipY - p.drop + p.bob, 0, 0, p.twist * 0.4 + p.hipYaw, p.roll, 'YXZ'));
    }
    this.put(`pelvis_${g}`, M.pelvis);
    for (const [side, th, sh] of [[-1, p.thL, p.shL], [1, p.thR, p.shR]] as [number, number, number][]) {
      M.th.multiplyMatrices(M.pelvis, this.rot(this.tmp, side * sk.hipX, sk.hipDY ?? -0.03, 0, th, 0, side * 0.03));
      this.put(`thigh_${g}`, M.th);
      M.sh.multiplyMatrices(M.th, this.rot(this.tmp, 0, -sk.thigh, 0, sh, 0, 0));
      this.put(`shin_${g}`, M.sh);
    }
    M.chest.multiplyMatrices(M.pelvis, this.rot(this.tmp, 0, sk.chestY, 0, p.lean, p.twist - p.hipYaw * 1.9, -p.roll * 1.3));
    this.put(`chest_${g}`, M.chest);
    M.head.multiplyMatrices(M.chest, this.rot(this.tmp, 0, sk.neckY, 0, p.headX, p.headY, 0, 'YXZ', hs));
    this.put(`head_${g}`, M.head);
    const hd = isl.warrior ? isl.warrior : isl.role === 'priest' && !isl.child ? 'hd_fan' : null;
    if (hd) this.put(hd as PartKey, M.head);
    for (const [side, uax, uaz, fa] of [[-1, p.uaLx, p.uaLz, p.faL], [1, p.uaRx, p.uaRz, p.faR]] as [number, number, number, number][]) {
      M.ua.multiplyMatrices(M.chest, this.rot(this.tmp, side * sk.shoulderX, sk.shoulderY, 0, uax, 0, side * uaz));
      this.put(`uarm_${g}`, M.ua);
      M.fa.multiplyMatrices(M.ua, this.rot(this.tmp, 0, -sk.upper, 0, fa, 0, 0));
      this.put(`farm_${g}`, M.fa);
      if (side === 1) {
        const tool = isl.carry || isl.anim === 'sleep' || isl.anim === 'pray' || isl.anim === 'eat' ? 'none' : isl.tool;
        if (tool !== 'none') {
          M.out.multiplyMatrices(M.fa, this.rot(this.tmp, 0, -sk.fore - 0.04, 0.01, 0, 0, 0));
          this.put(tool as PartKey, M.out);
        }
      }
    }
    const c = isl.carry?.kind;
    if (c && LOADS[c]) {
      const log = c === 'log';
      if (c === 'chicken') M.out.multiplyMatrices(M.chest, this.rot(this.tmp, 0.2, sk.neckY - 0.3, 0.12, 0, 0.3, 0));
      else M.out.multiplyMatrices(M.chest, this.rot(this.tmp, 0, log ? sk.shoulderY + 0.15 : sk.neckY + 0.42, log ? -0.02 : 0.02, 0, log ? 0.25 : 0, 0));
      this.put(LOADS[c], M.out);
    }
  }
}
