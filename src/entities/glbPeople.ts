import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Islander bodies from the rigged character models (public/models/islander_male.glb and
 * islander_female.glb), kept as smooth skinned meshes: one merged geometry per model with its
 * skin weights, remapped onto the rig's own 19-bone skeleton (hips, spine, chest, neck, head,
 * shoulders, upper arms, forearms, hands, thighs, shins, feet). The islander rig poses those
 * bones every frame and skins all islanders of a model in one instanced draw.
 *
 * Each bone has a bind frame: at its joint, with limbs turned so -y runs down the bone (the rig's
 * convention for limbs) and the torso bones upright. Skin matrix = posed frame × bind frame⁻¹.
 *
 * Skin materials become per-person skin tone (aMat 1) and the gold trims the per-person accent
 * colour (aMat 2); everything else keeps its model colour. Replace the .glb files to restyle the
 * islanders: the loader only needs the same bone names.
 */

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upper_armL', 'forearmL', 'handL',
  'shoulderR', 'upper_armR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type BoneName = (typeof BONES)[number];
export const BONE_COUNT = BONES.length;
export const BI = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

export interface GlbModel {
  /** Bind-pose geometry (metres, facing +z) with aSkinI / aSkinW (4 influences). */
  geometry: THREE.BufferGeometry;
  /** Joint positions in the bind pose. */
  joint: Record<BoneName, THREE.Vector3>;
  /** Inverse bind frames, one per bone. */
  bindInv: THREE.Matrix4[];
  /** Limb lengths (joint to joint). */
  len: { upper: number; fore: number; thigh: number; shin: number };
}

export type GlbPeople = Record<'m' | 'f', GlbModel>;

const FILES: Record<'m' | 'f', string> = { m: 'models/islander_male.glb', f: 'models/islander_female.glb' };

/** GLTFLoader strips the dots from node names ("upper_arm.L" becomes "upper_armL"). */
function boneIndex(name: string): number {
  const n = name.replace('.', '');
  return n in BI ? BI[n as BoneName] : 0; // root → hips
}

const lum = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

async function loadOne(loader: GLTFLoader, url: string): Promise<GlbModel> {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const skinned: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  if (!skinned.length) throw new Error(`${url}: no skinned meshes`);

  const joints = new Map<string, THREE.Vector3>();
  const sk0 = skinned[0].skeleton;
  sk0.bones.forEach((b, i) => joints.set(b.name.replace('.', ''), new THREE.Vector3().setFromMatrixPosition(sk0.boneInverses[i].clone().invert())));
  const joint = {} as Record<BoneName, THREE.Vector3>;
  for (const b of BONES) {
    const v = joints.get(b);
    if (!v) throw new Error(`${url}: missing bone ${b}`);
    joint[b] = v;
  }

  // Bind frames.
  const down = new THREE.Vector3(0, -1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const frame = (at: THREE.Vector3, to?: THREE.Vector3) => {
    const q = to ? new THREE.Quaternion().setFromUnitVectors(down, to.clone().sub(at).normalize()) : new THREE.Quaternion();
    return new THREE.Matrix4().compose(at, q, one);
  };
  const bind: THREE.Matrix4[] = BONES.map((b) => {
    const s = b.slice(-1);
    if (b.startsWith('upper_arm')) return frame(joint[b], joint[`forearm${s}` as BoneName]);
    if (b.startsWith('forearm')) return frame(joint[b], joint[`hand${s}` as BoneName]);
    // The hand carries on in the forearm's direction.
    if (b.startsWith('hand')) return frame(joint[b], joint[b].clone().multiplyScalar(2).sub(joint[`forearm${s}` as BoneName]));
    if (b.startsWith('thigh')) return frame(joint[b], joint[`shin${s}` as BoneName]);
    if (b.startsWith('shin')) return frame(joint[b], joint[`foot${s}` as BoneName]);
    return frame(joint[b]);
  });

  let skinRef = 0, goldRef = 0;
  for (const mesh of skinned) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (/^warm ochre skin$/i.test(mat.name)) skinRef = lum(mat.color);
    if (/^golden border$/i.test(mat.name)) goldRef = lum(mat.color);
  }

  const pos: number[] = [], nor: number[] = [], col: number[] = [], tag: number[] = [], si: number[] = [], sw: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const mesh of skinned) {
    const geo = mesh.geometry;
    const P = geo.getAttribute('position'), N = geo.getAttribute('normal');
    const SI = geo.getAttribute('skinIndex'), SW = geo.getAttribute('skinWeight');
    const bones = mesh.skeleton.bones;
    const map = bones.map((b) => boneIndex(b.name));
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const isSkin = /skin/i.test(mat.name), isGold = /gold/i.test(mat.name);
    const t = isSkin ? 1 : isGold ? 2 : 0;
    const c = mat.color.clone();
    if (isSkin && skinRef) c.setScalar(lum(mat.color) / skinRef);
    if (isGold && goldRef) c.setScalar(lum(mat.color) / goldRef);
    nm.getNormalMatrix(mesh.bindMatrix);
    const base = pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix);
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
      tag.push(t);
      // Merge influences that land on the same rig bone (root folds into hips).
      const w = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const wt = SW.getComponent(i, k);
        if (wt <= 0) continue;
        const b = map[SI.getComponent(i, k)] ?? 0;
        w.set(b, (w.get(b) ?? 0) + wt);
      }
      const top = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = top.reduce((s, e) => s + e[1], 0) || 1;
      for (let k = 0; k < 4; k++) {
        si.push(top[k]?.[0] ?? 0);
        sw.push(top[k] ? top[k][1] / tot : 0);
      }
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute('aVeg', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geometry.setAttribute('aMat', new THREE.Float32BufferAttribute(tag, 1));
  geometry.setAttribute('aSkinI', new THREE.Float32BufferAttribute(si, 4));
  geometry.setAttribute('aSkinW', new THREE.Float32BufferAttribute(sw, 4));
  geometry.setIndex(idx);
  geometry.computeBoundingSphere();
  return {
    geometry,
    joint,
    bindInv: bind.map((m) => m.clone().invert()),
    len: {
      upper: joint.upper_armL.distanceTo(joint.forearmL),
      fore: joint.forearmL.distanceTo(joint.handL),
      thigh: joint.thighL.distanceTo(joint.shinL),
      shin: joint.shinL.distanceTo(joint.footL),
    },
  };
}

let pending: Promise<GlbPeople> | null = null;

/** Load (once) both character models. */
export function loadGlbPeople(): Promise<GlbPeople> {
  if (pending) return pending;
  const loader = new GLTFLoader();
  const url = (g: 'm' | 'f') => new URL(FILES[g], document.baseURI).href;
  pending = Promise.all([loadOne(loader, url('m')), loadOne(loader, url('f'))]).then(([m, f]) => ({ m, f }));
  return pending;
}

const PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', upper_armL: 'shoulderL', forearmL: 'upper_armL', handL: 'forearmL',
  shoulderR: 'chest', upper_armR: 'shoulderR', forearmR: 'upper_armR', handR: 'forearmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};

/**
 * A static copy of a model in a fixed pose (CPU skinned), for figures that never move on their
 * own, such as canoe passengers. Rotations are Euler XYZ per bone with the islander rig's
 * conventions: limbs hang straight down at zero (so upper arms and thighs are absolute to their
 * parent, not the model's A-pose), negative X swings a thigh / upper arm forward, positive shin X
 * bends the knee, negative forearm X bends the elbow. The hips sit at the origin.
 */
export function bakePose(model: GlbModel, rot: Partial<Record<BoneName, [number, number, number]>>): THREE.BufferGeometry {
  const J = model.joint, L = model.len;
  const W: THREE.Matrix4[] = [];
  const e = new THREE.Euler(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), o = new THREE.Vector3();
  for (const b of BONES) {
    const par = PARENT[b];
    if (!par) o.set(0, 0, 0);
    else if (b.startsWith('forearm')) o.set(0, -L.upper, 0);
    else if (b.startsWith('hand')) o.set(0, -L.fore, 0);
    else if (b.startsWith('shin')) o.set(0, -L.thigh, 0);
    else if (b.startsWith('foot')) o.set(0, -L.shin, 0);
    else o.copy(J[b]).sub(J[par]);
    const r = rot[b] ?? [0, 0, 0];
    q.setFromEuler(e.set(r[0], r[1], r[2]));
    const local = new THREE.Matrix4().compose(o, q, one);
    W.push(par ? W[BI[par]].clone().multiply(local) : local);
  }
  // Bind-pose hips at the origin: shift every skin matrix down by the hip height.
  const lift = new THREE.Matrix4().makeTranslation(0, J.hips.y, 0);
  const S = W.map((w, i) => w.clone().multiply(model.bindInv[i]).multiply(lift));
  const src = model.geometry;
  const geo = src.clone();
  geo.deleteAttribute('iAccent');
  const P = geo.getAttribute('position'), N = geo.getAttribute('normal');
  const SI = src.getAttribute('aSkinI'), SW = src.getAttribute('aSkinW');
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    m.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = SW.getComponent(i, k);
      if (w <= 0) continue;
      const s = S[SI.getComponent(i, k)].elements;
      for (let j = 0; j < 16; j++) m.elements[j] += s[j] * w;
    }
    // Vertices were stored relative to the bind hips; put them back before skinning.
    p.fromBufferAttribute(P, i).sub(o.set(0, J.hips.y, 0)).applyMatrix4(m);
    P.setXYZ(i, p.x, p.y, p.z);
    n.fromBufferAttribute(N, i).applyMatrix3(nm.setFromMatrix4(m)).normalize();
    N.setXYZ(i, n.x, n.y, n.z);
  }
  geo.deleteAttribute('aSkinI');
  geo.deleteAttribute('aSkinW');
  geo.computeBoundingSphere();
  return geo;
}
