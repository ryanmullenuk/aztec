import * as THREE from 'three';
import { ISLANDER } from '../config';
import { peopleMaterial } from '../render/materials';
import { Islander } from './Islander';
import { PartKey, SKELETON, Skeleton, buildPeopleParts } from './PeopleModels';

/** World units per metre: islanders are modelled at ~1.8 m and stand ~0.62 units tall. */
const S0 = 0.62 / 1.8;

/** Joint angles for one frame of animation (radians; metres for offsets). */
interface Pose {
  drop: number;
  bob: number;
  lean: number;
  twist: number;
  headX: number;
  headY: number;
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
  lying: boolean;
}

const tri = (s: number) => (s < 0.7 ? s / 0.7 : 1 - (s - 0.7) / 0.3);

/**
 * Procedural animation. Conventions: negative thigh / upper-arm X swings forward,
 * positive shin X bends the knee, negative forearm X bends the elbow.
 */
function poseFor(isl: Islander, female: boolean, skel?: Skeleton): Pose {
  const t = isl.animT;
  const p: Pose = { drop: 0, bob: 0, lean: 0, twist: 0, headX: 0, headY: 0, thL: 0, thR: 0, shL: 0.05, shR: 0.05, uaLx: 0, uaLz: 0.12, uaRx: 0, uaRz: 0.12, faL: -0.12, faR: -0.12, hipYaw: 0, roll: 0, lying: false };
  const sk = skel ?? SKELETON[female ? 'f' : 'm'];
  switch (isl.anim) {
    case 'idle': {
      p.bob = Math.sin(t * 2) * 0.006;
      p.uaLx = Math.sin(t * 1.1) * 0.05;
      p.uaRx = -Math.sin(t * 1.1) * 0.05;
      p.headY = Math.sin(t * 0.37) * 0.5;
      p.twist = Math.sin(t * 0.37) * 0.08;
      p.thL = -0.04;
      p.thR = 0.06;
      break;
    }
    case 'walk':
    case 'carry': {
      const ph = t * 7.5;
      const s = Math.sin(ph);
      p.thL = s * 0.45;
      p.thR = -s * 0.45;
      p.shL = 0.12 + Math.max(0, -Math.cos(ph)) * 0.65;
      p.shR = 0.12 + Math.max(0, Math.cos(ph)) * 0.65;
      p.bob = Math.abs(Math.cos(ph)) * 0.035;
      p.lean = 0.06;
      // Hips swing with the leading leg and drop on the swing side; shoulders counter.
      p.hipYaw = -s * 0.14;
      p.roll = Math.cos(ph) * 0.07;
      if (isl.anim === 'carry') {
        p.uaLx = p.uaRx = -2.85;
        p.uaLz = p.uaRz = 0.22;
        p.faL = p.faR = -0.35;
      } else {
        p.uaLx = -p.thL * 0.8;
        p.uaRx = -p.thR * 0.8;
        p.faL = -0.25 - Math.max(0, -p.uaLx) * 0.5;
        p.faR = -0.25 - Math.max(0, -p.uaRx) * 0.5;
      }
      break;
    }
    case 'run': {
      const ph = t * 11;
      const s = Math.sin(ph);
      p.thL = s * 0.8;
      p.thR = -s * 0.8;
      p.shL = 0.25 + Math.max(0, -Math.cos(ph)) * 1.2;
      p.shR = 0.25 + Math.max(0, Math.cos(ph)) * 1.2;
      p.uaLx = -p.thL * 0.9;
      p.uaRx = -p.thR * 0.9;
      p.faL = p.faR = -1.3;
      p.bob = Math.abs(Math.cos(ph)) * 0.06;
      p.lean = 0.28;
      p.hipYaw = -s * 0.2;
      p.roll = Math.cos(ph) * 0.05;
      break;
    }
    case 'chop':
    case 'mine': {
      const s = (t * (isl.anim === 'mine' ? 1.1 : 1.4)) % 1;
      const k = tri(s);
      p.uaLx = p.uaRx = -0.5 - k * 2.3;
      p.uaLz = p.uaRz = -0.28;
      p.faL = p.faR = -0.25 - k * 0.35;
      p.lean = (isl.anim === 'mine' ? 0.3 : 0.15) + (1 - k) * 0.22;
      p.thL = -0.3;
      p.shL = 0.3;
      p.thR = 0.22;
      p.shR = 0.15;
      p.drop = 0.03;
      break;
    }
    case 'farm': {
      const ph = t * 3.2;
      p.uaLx = p.uaRx = -0.95 + Math.sin(ph) * 0.45;
      p.uaLz = p.uaRz = -0.2;
      p.faL = p.faR = -0.55;
      p.lean = 0.4 + Math.sin(ph) * 0.08;
      p.thL = -0.35;
      p.shL = 0.45;
      p.thR = 0.25;
      p.shR = 0.2;
      p.drop = 0.05;
      break;
    }
    case 'harvest': {
      const ph = t * 4;
      p.uaLx = -2.7 + Math.sin(ph) * 0.15;
      p.uaRx = -2.5 + Math.cos(ph) * 0.2;
      p.faL = p.faR = -0.25;
      p.headX = -0.4;
      p.bob = Math.max(0, Math.sin(ph * 0.5)) * 0.025;
      break;
    }
    case 'fish': {
      const s = (t * 0.6) % 1;
      p.uaRx = -2.6 + tri(s) * 1.8;
      p.faR = -0.3;
      p.uaLx = -1.0;
      p.faL = -0.6;
      p.lean = 0.1;
      p.thL = -0.25;
      p.shL = 0.2;
      p.thR = 0.2;
      break;
    }
    case 'build': {
      const ph = t * 9;
      p.drop = 0.22;
      p.thL = -1.15;
      p.shL = 1.45;
      p.thR = -0.55;
      p.shR = 1.25;
      p.lean = 0.45;
      p.uaRx = -1.1 + Math.sin(ph) * 0.55;
      p.faR = -0.6;
      p.uaLx = -0.7;
      p.faL = -0.5;
      break;
    }
    case 'pray': {
      // Kneel: thighs upright, shins flat along the ground behind; arms raised, bowing.
      const ph = t * 0.9;
      p.drop = sk.hipY - sk.thigh - 0.07;
      p.thL = p.thR = 0.05;
      p.shL = p.shR = 1.52;
      p.uaLx = p.uaRx = -2.6;
      p.uaLz = p.uaRz = 0.35;
      p.faL = p.faR = -0.2;
      p.lean = 0.12 + (Math.sin(ph) * 0.5 + 0.5) * 0.6;
      break;
    }
    case 'eat': {
      const ph = t * 3;
      p.uaRx = -0.8 + Math.sin(ph) * 0.15;
      p.faR = -1.7;
      p.uaRz = -0.15;
      p.uaLx = -0.4;
      p.faL = -1.0;
      p.headX = 0.12;
      p.bob = Math.sin(t * 2) * 0.005;
      break;
    }
    case 'sleep':
      p.lying = true;
      p.uaLz = p.uaRz = 0.18;
      p.thL = -0.05;
      p.thR = 0.08;
      p.shL = p.shR = 0.12;
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

/**
 * Articulated, faceted islanders. Each body part is one InstancedMesh; every frame the skeleton
 * (pelvis → chest → head / upper arm → forearm, pelvis → thigh → shin) is posed per islander and
 * visible instances are packed, so 150 people cost ~30 draw calls.
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
  private skin = new THREE.Color();
  private accent = new THREE.Color();
  readonly ring: THREE.Mesh;

  constructor() {
    const mat = peopleMaterial();
    const parts = buildPeopleParts();
    for (const [key, geo] of Object.entries(parts) as [PartKey, THREE.BufferGeometry][]) {
      const cap = ISLANDER.max * (PAIRED.has(key) ? 2 : 1);
      const acc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      acc.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iAccent', acc);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
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
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.9, depthWrite: false })
    );
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    this.group.add(this.ring);
  }

  private rot(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, order: THREE.EulerOrder = 'XYZ', s = 1): THREE.Matrix4 {
    this.e.set(rx, ry, rz, order);
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(s, s, s);
    return out.compose(this.v, this.q, this.s);
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

  update(list: Islander[], selected: number, _dt: number): void {
    this.count.clear();
    const M = this.m;
    for (const isl of list) {
      if (isl.hidden) continue;
      const g = isl.gender;
      const sk = SKELETON[g];
      const p = poseFor(isl, g === 'f', sk);
      const side_ = (base: string, _s: number) => `${base}_${g}`;
      this.skin.setHex(isl.skin);
      this.accent.setHex(isl.cloth2);
      const sc = S0 * (isl.child ? ISLANDER.childScale : 1) * (g === 'f' ? 0.98 : 1);
      this.rot(M.base, isl.x, isl.y, isl.z, 0, isl.heading, 0, 'XYZ', sc);
      // Pelvis (root of the skeleton).
      if (p.lying) {
        M.pelvis.multiplyMatrices(M.base, this.rot(this.tmp, 0, 0.16 + p.bob, 0.35, -Math.PI / 2, 0, 0));
      } else {
        M.pelvis.multiplyMatrices(M.base, this.rot(this.tmp, 0, sk.hipY - p.drop + p.bob, 0, 0, p.twist * 0.4 + p.hipYaw, p.roll, 'YXZ'));
      }
      this.put(`pelvis_${g}`, M.pelvis);
      // Legs.
      for (const [side, th, sh] of [[-1, p.thL, p.shL], [1, p.thR, p.shR]] as [number, number, number][]) {
        M.th.multiplyMatrices(M.pelvis, this.rot(this.tmp, side * sk.hipX, -0.03, 0, th, 0, side * 0.03));
        this.put(side_(`thigh`, side), M.th);
        M.sh.multiplyMatrices(M.th, this.rot(this.tmp, 0, -sk.thigh, 0, sh, 0, 0));
        this.put(side_(`shin`, side), M.sh);
      }
      // Torso and head.
      M.chest.multiplyMatrices(M.pelvis, this.rot(this.tmp, 0, sk.chestY, 0, p.lean, p.twist - p.hipYaw * 1.9, -p.roll * 1.3));
      this.put(`chest_${g}`, M.chest);
      const hs = isl.child ? 1.22 : 1;
      M.head.multiplyMatrices(M.chest, this.rot(this.tmp, 0, sk.neckY, 0, p.headX, p.headY, 0, 'YXZ', hs));
      this.put(`head_${g}`, M.head);
      // Headdress: warriors wear jaguar or eagle helms, priests the grand feather fan.
      const hd = isl.warrior ? isl.warrior : isl.role === 'priest' && !isl.child ? 'hd_fan' : isl.child ? (isl.headdress === 2 ? 'hd_band' : null) : [null, 'hd_band', 'hd_fan', 'hd_plume'][isl.headdress];
      if (hd) this.put(hd as PartKey, M.head);
      // Arms.
      for (const [side, uax, uaz, fa] of [[-1, p.uaLx, p.uaLz, p.faL], [1, p.uaRx, p.uaRz, p.faR]] as [number, number, number, number][]) {
        M.ua.multiplyMatrices(M.chest, this.rot(this.tmp, side * sk.shoulderX, sk.shoulderY, 0, uax, 0, side * uaz));
        this.put(side_('uarm', side), M.ua);
        M.fa.multiplyMatrices(M.ua, this.rot(this.tmp, 0, -sk.upper, 0, fa, 0, 0));
        this.put(side_('farm', side), M.fa);
        // Tool in the right hand.
        if (side === 1) {
          const tool = isl.carry || isl.anim === 'sleep' || isl.anim === 'pray' || isl.anim === 'eat' ? 'none' : isl.tool;
          if (tool !== 'none') {
            M.out.multiplyMatrices(M.fa, this.rot(this.tmp, 0, -sk.fore - 0.04, 0.01, 0, 0, 0));
            this.put(tool as PartKey, M.out);
          }
        }
      }
      // Carried load: above the head (log across the shoulders).
      const c = isl.carry?.kind;
      if (c && LOADS[c]) {
        const log = c === 'log';
        // A captured chicken is tucked under the arm; everything else rides on the head.
        if (c === 'chicken') M.out.multiplyMatrices(M.chest, this.rot(this.tmp, 0.2, sk.neckY - 0.3, 0.12, 0, 0.3, 0));
        else M.out.multiplyMatrices(M.chest, this.rot(this.tmp, 0, log ? 0.62 : sk.neckY + 0.42, log ? -0.02 : 0.02, 0, log ? 0.25 : 0, 0));
        this.put(LOADS[c], M.out);
      }
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
    const sel = list.find((l) => l.id === selected);
    this.ring.visible = !!sel && !sel.hidden;
    if (sel) {
      this.ring.position.set(sel.x, sel.y + 0.04, sel.z);
      this.ring.scale.setScalar(sel.child ? 0.7 : 1);
    }
    void ZERO;
    void BODY;
    void TOOLS;
  }
}
