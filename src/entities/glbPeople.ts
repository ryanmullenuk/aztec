import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Skeleton } from './PeopleModels';

/**
 * Islander bodies from the rigged character models (public/models/islander_male.glb and
 * islander_female.glb). Each skinned model is cut into the rigid parts the islander rig poses
 * (pelvis, chest, head, and per side upper arm, forearm, thigh, shin), every part moved into its
 * joint's local space (limbs hanging down -y from the joint, facing +z), so all the rig's
 * animations, tools, headdresses and carried loads work unchanged. The skeleton offsets come
 * from the models' own joints.
 *
 * Skin materials become per-person skin tone (aMat 1) and the gold trims the per-person accent
 * colour (aMat 2); everything else keeps its model colour. Replace the .glb files to restyle the
 * islanders: the loader only needs the same 20 bone names.
 */

export type GlbPart = 'pelvis' | 'chest' | 'head' | 'uarm' | 'farm' | 'thigh' | 'shin';
/** Limb parts come in two sides: L on +x (the character's left, facing +z), R on -x. */
export const GLB_SIDED = new Set<GlbPart>(['uarm', 'farm', 'thigh', 'shin']);

export interface GlbPeople {
  /** Part geometries keyed `${part}_${g}` (body) or `${part}_${g}${side}` (limbs). */
  parts: Map<string, THREE.BufferGeometry>;
  skel: Record<'m' | 'f', Skeleton>;
}

const FILES: Record<'m' | 'f', string> = { m: 'models/islander_male.glb', f: 'models/islander_female.glb' };

/** Mesh names that ride rigidly on one part whatever their skin weights say. */
const ON_PELVIS = /skirt|hem|sash|belt/i;
const ON_HEAD = /head|hair|ear|beard|sideburn|knot|bun|lock/i;
const ON_ARM = /arm|hand|wrist/i;

function boneKey(name: string): { bone: string; side: '' | 'L' | 'R' } {
  // GLTFLoader strips the dots from node names ("upper_arm.L" becomes "upper_armL").
  const m = /^(root|hips|spine|chest|neck|head|shoulder|upper_arm|forearm|hand|thigh|shin|foot)\.?([LR])?$/.exec(name);
  return m ? { bone: m[1], side: (m[2] as 'L' | 'R') ?? '' } : { bone: 'root', side: '' };
}

function partFor(bone: string, meshName: string): GlbPart {
  if (ON_PELVIS.test(meshName)) return 'pelvis';
  if (ON_HEAD.test(meshName)) return 'head';
  switch (bone) {
    case 'root':
    case 'hips':
      return 'pelvis';
    case 'spine':
    case 'chest':
    case 'neck':
      return 'chest';
    case 'head':
      return 'head';
    case 'shoulder':
      return ON_ARM.test(meshName) ? 'uarm' : 'chest';
    case 'upper_arm':
      return 'uarm';
    case 'forearm':
    case 'hand':
      return 'farm';
    case 'thigh':
      return 'thigh';
    default:
      return 'shin';
  }
}

const lum = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

interface Acc {
  pos: number[];
  nor: number[];
  col: number[];
  mat: number[];
}

async function loadOne(loader: GLTFLoader, g: 'm' | 'f', url: string, out: GlbPeople): Promise<void> {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const skinned: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  if (!skinned.length) throw new Error(`${url}: no skinned meshes`);

  // Joint rest positions (bind pose, world space).
  const joints = new Map<string, THREE.Vector3>();
  const sk0 = skinned[0].skeleton;
  sk0.bones.forEach((b, i) => {
    const k = boneKey(b.name);
    joints.set(k.bone + k.side, new THREE.Vector3().setFromMatrixPosition(sk0.boneInverses[i].clone().invert()));
  });
  const J = (n: string) => {
    const v = joints.get(n);
    if (!v) throw new Error(`${url}: missing bone ${n}`);
    return v;
  };

  // Rest frame of each part: its joint, with the limb's bone direction turned to -y.
  const down = new THREE.Vector3(0, -1, 0);
  const frames = new Map<string, THREE.Matrix4>();
  const at = (p: THREE.Vector3) => new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
  frames.set('pelvis', at(new THREE.Vector3(0, J('hips').y, 0)));
  frames.set('chest', at(new THREE.Vector3(0, J('spine').y, 0)));
  frames.set('head', at(new THREE.Vector3(0, J('head').y, 0)));
  const limb = (part: GlbPart, from: string, to: string) => {
    for (const s of ['L', 'R']) {
      const a = J(from + s), b = J(to + s);
      const q = new THREE.Quaternion().setFromUnitVectors(down, b.clone().sub(a).normalize());
      frames.set(part + s, new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
    }
  };
  limb('uarm', 'upper_arm', 'forearm');
  limb('farm', 'forearm', 'hand');
  limb('thigh', 'thigh', 'shin');
  limb('shin', 'shin', 'foot');
  const inv = new Map<string, { m: THREE.Matrix4; n: THREE.Matrix3 }>();
  for (const [k, f] of frames) {
    const m = f.clone().invert();
    inv.set(k, { m, n: new THREE.Matrix3().getNormalMatrix(m) });
  }

  // Reference colours for the per-person tints.
  let skinRef = 0, goldRef = 0;
  for (const mesh of skinned) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (/^warm ochre skin$/i.test(mat.name)) skinRef = lum(mat.color);
    if (/^golden border$/i.test(mat.name)) goldRef = lum(mat.color);
  }

  const acc = new Map<string, Acc>();
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (const mesh of skinned) {
    const geo = mesh.geometry;
    const P = geo.getAttribute('position'), N = geo.getAttribute('normal');
    const SI = geo.getAttribute('skinIndex'), SW = geo.getAttribute('skinWeight');
    const bones = mesh.skeleton.bones;
    // Multi-primitive meshes load as a group of meshes: the group carries the model's mesh name.
    const meshName = `${mesh.name} ${mesh.parent?.name ?? ''}`;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const isSkin = /skin/i.test(mat.name), isGold = /gold/i.test(mat.name);
    const tag = isSkin ? 1 : isGold ? 2 : 0;
    const col = mat.color.clone();
    if (isSkin && skinRef) col.setScalar(lum(mat.color) / skinRef);
    if (isGold && goldRef) col.setScalar(lum(mat.color) / goldRef);
    // Each vertex goes with the bone that moves it most.
    const vPart: string[] = [];
    for (let i = 0; i < P.count; i++) {
      let best = 0, bw = -1;
      for (let c = 0; c < 4; c++) {
        const w = SW.getComponent(i, c);
        if (w > bw) (bw = w), (best = SI.getComponent(i, c));
      }
      const k = boneKey(bones[best]?.name ?? 'root');
      const part = partFor(k.bone, meshName);
      // Limbs take their side from the bone, or from which side of the body they sit.
      const side = k.side || (P.getX(i) >= 0 ? 'L' : 'R');
      vPart.push(GLB_SIDED.has(part) ? part + side : part);
    }
    const index = geo.index;
    const tris = index ? index.count / 3 : P.count / 3;
    for (let t = 0; t < tris; t++) {
      const ids = [0, 1, 2].map((c) => (index ? index.getX(t * 3 + c) : t * 3 + c));
      // A triangle stays whole on one part (the majority of its corners).
      const [a, b, c] = ids.map((i) => vPart[i]);
      const key = a === b || a === c ? a : b === c ? b : a;
      const T = inv.get(key)!;
      let dst = acc.get(key);
      if (!dst) acc.set(key, (dst = { pos: [], nor: [], col: [], mat: [] }));
      for (const i of ids) {
        p.fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(T.m);
        n.fromBufferAttribute(N, i).applyMatrix3(T.n).normalize();
        dst.pos.push(p.x, p.y, p.z);
        dst.nor.push(n.x, n.y, n.z);
        dst.col.push(col.r, col.g, col.b);
        dst.mat.push(tag);
      }
    }
  }
  for (const [key, a] of acc) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
    geo.setAttribute('aVeg', new THREE.Float32BufferAttribute(new Float32Array((a.pos.length / 3) * 2), 2));
    geo.setAttribute('aMat', new THREE.Float32BufferAttribute(a.mat, 1));
    geo.computeBoundingSphere();
    const part = key.replace(/[LR]$/, '') as GlbPart;
    const side = GLB_SIDED.has(part) ? key.slice(-1) : '';
    out.parts.set(`${part}_${g}${side}`, geo);
  }

  const hips = J('hips'), spine = J('spine'), thighL = J('thighL'), shinL = J('shinL'), footL = J('footL');
  const uaL = J('upper_armL'), faL = J('forearmL'), handL = J('handL');
  out.skel[g] = {
    hipY: hips.y,
    hipX: Math.abs(thighL.x),
    hipDY: thighL.y - hips.y,
    thigh: thighL.distanceTo(shinL),
    shin: shinL.distanceTo(footL) + footL.y,
    chestY: spine.y - hips.y,
    neckY: J('head').y - spine.y,
    shoulderX: Math.abs(uaL.x),
    shoulderY: uaL.y - spine.y,
    upper: uaL.distanceTo(faL),
    fore: faL.distanceTo(handL),
  };
}

let pending: Promise<GlbPeople> | null = null;

/** Load (once) and cut up both character models. */
export function loadGlbPeople(): Promise<GlbPeople> {
  if (pending) return pending;
  const loader = new GLTFLoader();
  const out: GlbPeople = { parts: new Map(), skel: {} as GlbPeople['skel'] };
  pending = Promise.all((['m', 'f'] as const).map((g) => loadOne(loader, g, new URL(FILES[g], document.baseURI).href, out))).then(() => out);
  return pending;
}
