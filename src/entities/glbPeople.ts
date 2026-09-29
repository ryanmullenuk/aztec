import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The two islander characters (public/models/islander_male.glb / islander_female.glb, each with a
 * colour texture .jpg): static low-poly meshes that are rigged here, at load, onto the rig's own
 * 19-bone skeleton (hips, spine, chest, neck, head, shoulders, upper arms, forearms, hands,
 * thighs, shins, feet) from measured joint positions and automatic skin weights. The islander rig
 * poses those bones every frame and skins all islanders of a model in one instanced draw.
 *
 * Each bone has a bind frame: at its joint, with limbs turned so -y runs down the bone (the rig's
 * convention for limbs) and the torso bones upright. Skin matrix = posed frame × bind frame⁻¹.
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
  /** Colour texture. */
  map: THREE.Texture;
  /** A texture coordinate on the bare face, to paint over a hidden beard. */
  skinUv: THREE.Vector2;
  /** How headdresses sit on this head (offset from the head joint, metres, and scale). */
  hat: { y: number; z: number; s: number };
  /** Limb lengths (joint to joint; hand = wrist to finger tips). */
  len: { upper: number; fore: number; thigh: number; shin: number; hand: number };
}

export type GlbPeople = Record<'m' | 'f', GlbModel>;

const FILES: Record<'m' | 'f', { mesh: string; tex: string }> = {
  m: { mesh: 'models/islander_male.glb', tex: 'models/islander_male.jpg' },
  f: { mesh: 'models/islander_female.glb', tex: 'models/islander_female.jpg' },
};

type V3 = [number, number, number];
/** Mirror a +x (L) joint to the -x (R) side. */
const mir = (p: V3): V3 => [-p[0], p[1], p[2]];

/**
 * Joint positions (metres, bind pose, facing +z, L = +x) for the two character models, measured
 * from their meshes: the elbow, wrist, knee and ankle sit where the limbs bend and the wrist and
 * boot bands are. The ends (head top, finger tips, toes) only shape the skin weights.
 */
const RIGS: Record<'m' | 'f', { joint: Record<BoneName, V3>; top: V3; tipL: V3; toeL: V3; hat: { y: number; z: number; s: number } }> = {
  m: (() => {
    const L = { shoulder: [0.06, 1.38, -0.04] as V3, upper_arm: [0.2, 1.38, -0.06] as V3, forearm: [0.28, 1.15, -0.06] as V3, hand: [0.32, 0.95, -0.01] as V3, thigh: [0.1, 0.97, -0.03] as V3, shin: [0.17, 0.48, -0.03] as V3, foot: [0.21, 0.1, -0.05] as V3 };
    return {
      joint: {
        hips: [0, 0.98, -0.02], spine: [0, 1.1, -0.02], chest: [0, 1.26, -0.03], neck: [0, 1.44, -0.02], head: [0, 1.53, -0.01],
        shoulderL: L.shoulder, upper_armL: L.upper_arm, forearmL: L.forearm, handL: L.hand,
        shoulderR: mir(L.shoulder), upper_armR: mir(L.upper_arm), forearmR: mir(L.forearm), handR: mir(L.hand),
        thighL: L.thigh, shinL: L.shin, footL: L.foot, thighR: mir(L.thigh), shinR: mir(L.shin), footR: mir(L.foot),
      },
      top: [0, 1.9, 0], tipL: [0.36, 0.68, 0.04], toeL: [0.26, 0.02, 0.12], hat: { y: 0.03, z: 0, s: 1.25 },
    };
  })(),
  f: (() => {
    const L = { shoulder: [0.06, 1.39, 0.02] as V3, upper_arm: [0.19, 1.39, 0.01] as V3, forearm: [0.25, 1.15, 0.0] as V3, hand: [0.28, 0.97, 0.06] as V3, thigh: [0.09, 0.97, 0.05] as V3, shin: [0.16, 0.47, 0.05] as V3, foot: [0.19, 0.1, 0.07] as V3 };
    return {
      joint: {
        hips: [0, 0.98, 0.04], spine: [0, 1.1, 0.04], chest: [0, 1.27, 0.03], neck: [0, 1.45, 0.01], head: [0, 1.54, 0.02],
        shoulderL: L.shoulder, upper_armL: L.upper_arm, forearmL: L.forearm, handL: L.hand,
        shoulderR: mir(L.shoulder), upper_armR: mir(L.upper_arm), forearmR: mir(L.forearm), handR: mir(L.hand),
        thighL: L.thigh, shinL: L.shin, footL: L.foot, thighR: mir(L.thigh), shinR: mir(L.shin), footR: mir(L.foot),
      },
      top: [0, 1.9, 0.02], tipL: [0.32, 0.68, 0.12], toeL: [0.23, 0.02, 0.2], hat: { y: 0.06, z: -0.01, s: 1.4 },
    };
  })(),
};

/** Distance from p to the segment ab. */
function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const t = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz || 1), 0, 1);
  return Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t, p.z - a.z - abz * t);
}

/**
 * Skin weights for a static character mesh: each vertex goes to the bones whose surface (segment
 * distance less the limb's radius, carried over the mesh surface) is nearest, blended over the
 * closest three. Arms and legs only
 * take vertices on their own side (and legs only below the hips); the head only above the neck.
 * The skirt hangs from the hips, drawn partly toward the thigh on its side lower down, so a leg
 * swinging forward carries the hem with it instead of poking through. Hair (flagged by `hair`) hangs
 * from the head, handing over to the chest down the back, so raised arms don't drag it.
 */
function autoSkin(P: THREE.BufferAttribute, index: ArrayLike<number>, rig: (typeof RIGS)['m'], hair: Uint8Array): { si: Float32Array; sw: Float32Array } {
  const v = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);
  const J = rig.joint;
  type Seg = { b: number; a: THREE.Vector3; e: THREE.Vector3; r: number; side: number; kind: 'torso' | 'head' | 'arm' | 'shoulder' | 'leg' };
  const segs: Seg[] = [
    { b: BI.hips, a: v(J.hips), e: v(J.spine), r: 0.16, side: 0, kind: 'torso' },
    { b: BI.spine, a: v(J.spine), e: v(J.chest), r: 0.15, side: 0, kind: 'torso' },
    { b: BI.chest, a: v(J.chest), e: v(J.neck), r: 0.16, side: 0, kind: 'torso' },
    { b: BI.neck, a: v(J.neck), e: v(J.head), r: 0.06, side: 0, kind: 'torso' },
    { b: BI.head, a: v(J.head), e: v(rig.top), r: 0.12, side: 0, kind: 'head' },
  ];
  for (const [s, b] of [[1, 'L'], [-1, 'R']] as const) {
    const m = (p: V3): V3 => (s > 0 ? p : mir(p));
    segs.push(
      { b: BI[`shoulder${b}`], a: v(J[`shoulder${b}`]), e: v(J[`upper_arm${b}`]), r: 0.06, side: s, kind: 'shoulder' },
      { b: BI[`upper_arm${b}`], a: v(J[`upper_arm${b}`]), e: v(J[`forearm${b}`]), r: 0.055, side: s, kind: 'arm' },
      { b: BI[`forearm${b}`], a: v(J[`forearm${b}`]), e: v(J[`hand${b}`]), r: 0.045, side: s, kind: 'arm' },
      { b: BI[`hand${b}`], a: v(J[`hand${b}`]), e: v(m(rig.tipL)), r: 0.05, side: s, kind: 'arm' },
      { b: BI[`thigh${b}`], a: v(J[`thigh${b}`]), e: v(J[`shin${b}`]), r: 0.075, side: s, kind: 'leg' },
      { b: BI[`shin${b}`], a: v(J[`shin${b}`]), e: v(J[`foot${b}`]), r: 0.06, side: s, kind: 'leg' },
      { b: BI[`foot${b}`], a: v(J[`foot${b}`]), e: v(m(rig.toeL)), r: 0.05, side: s, kind: 'leg' },
    );
  }
  const hipY = J.hips[1], kneeY = J.shinL[1], neckY = J.neck[1], chestY = J.chest[1];
  const hemY = kneeY + 0.12;
  const n = P.count;
  const si = new Float32Array(n * 4), sw = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  const thighL = segs.find((s) => s.b === BI.thighL)!, thighR = segs.find((s) => s.b === BI.thighR)!;
  const allowed = (s: Seg) =>
    !((s.kind === 'arm' && (p.x * s.side < 0.13 || segDist(p, s.a, s.e) - s.r > 0.07)) ||
      (s.kind === 'shoulder' && (p.x * s.side < 0.03 || p.y < chestY)) ||
      (s.kind === 'leg' && (p.x * s.side < -0.02 || p.y > hipY + 0.03)) ||
      (s.kind === 'head' && p.y < neckY - 0.02));

  // Weld the mesh (UV seams split vertices) and link it up, so distances can be measured over the
  // surface: the hand hanging beside the hip is close to it through the air but far from it along
  // the body (up the arm and back down the side), which is what keeps the two apart.
  const uid = new Int32Array(n);
  const key = new Map<string, number>();
  const rep: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = `${P.getX(i).toFixed(4)},${P.getY(i).toFixed(4)},${P.getZ(i).toFixed(4)}`;
    let u = key.get(k);
    if (u === undefined) key.set(k, (u = rep.push(i) - 1));
    uid[i] = u;
  }
  const U = rep.length;
  const adj: number[][] = Array.from({ length: U }, () => []);
  for (let t = 0; t < index.length; t += 3) {
    const v3 = [0, 1, 2].map((k) => uid[index[t + k]]);
    for (let k = 0; k < 3; k++) adj[v3[k]].push(v3[(k + 1) % 3]), adj[v3[(k + 1) % 3]].push(v3[k]);
  }
  const pos = (u: number, out: THREE.Vector3) => out.fromBufferAttribute(P, rep[u]);
  const q2 = new THREE.Vector3();
  // Per bone: straight-line distance to its surface (weighted up, so the surface route wins
  // wherever one exists), then spread over the mesh.
  const K = 3;
  const dist = segs.map(() => new Float64Array(U));
  segs.forEach((s, bi) => {
    const d = dist[bi];
    const heap: [number, number][] = [];
    const push = (e: [number, number]) => {
      heap.push(e);
      for (let c = heap.length - 1; c > 0; ) {
        const pa = (c - 1) >> 1;
        if (heap[pa][0] <= heap[c][0]) break;
        [heap[pa], heap[c]] = [heap[c], heap[pa]];
        c = pa;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let c = 0; ; ) {
          const l = c * 2 + 1, r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top;
    };
    for (let u = 0; u < U; u++) {
      pos(u, p);
      d[u] = allowed(s) ? K * Math.max(0, segDist(p, s.a, s.e) - s.r) : Infinity;
      if (d[u] < Infinity) push([d[u], u]);
    }
    while (heap.length) {
      const [du, u] = pop();
      if (du > d[u]) continue;
      pos(u, p);
      for (const w of adj[u]) {
        const nd = du + p.distanceTo(pos(w, q2));
        if (nd < d[w]) {
          d[w] = nd;
          push([nd, w]);
        }
      }
    }
  });
  const armIdx = segs.map((s, k) => (s.kind === 'arm' ? k : -1)).filter((k) => k >= 0);

  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(P, i);
    const u = uid[i];
    const set = (list: [number, number][]) => {
      list.sort((a, b) => b[1] - a[1]);
      const top = list.slice(0, 4);
      const tot = top.reduce((s, e) => s + e[1], 0) || 1;
      for (let k = 0; k < 4; k++) {
        si[i * 4 + k] = top[k]?.[0] ?? 0;
        sw[i * 4 + k] = top[k] ? top[k][1] / tot : 0;
      }
    };
    if (hair[i] && p.y > chestY - 0.2) {
      const t = THREE.MathUtils.clamp((neckY - p.y) / (neckY - (chestY - 0.2)), 0, 1);
      set(t > 0 ? [[BI.head, 1 - t], [BI.chest, t]] : [[BI.head, 1]]);
      continue;
    }
    // The skirt: between the hips and just above the knee, away from the legs inside it, and nearer
    // (over the surface) the hips than the arms hanging beside it.
    const dLeg = Math.min(segDist(p, thighL.a, thighL.e), segDist(p, thighR.a, thighR.e));
    const dArm = Math.min(...armIdx.map((k) => (allowed(segs[k]) ? dist[k][u] : Infinity)));
    if (p.y < hipY + 0.02 && p.y > kneeY + 0.06 && dLeg > 0.085 && dArm > dist[0][u]) {
      const t = THREE.MathUtils.clamp((hipY - p.y) / (hipY - hemY), 0, 1) * 0.55;
      const list: [number, number][] = [[BI.hips, 1 - t]];
      if (Math.abs(p.x) < 0.05) list.push([BI.thighL, t * 0.5], [BI.thighR, t * 0.5]);
      else list.push([p.x > 0 ? BI.thighL : BI.thighR, t]);
      set(list);
      continue;
    }
    const cand: [number, number][] = [];
    segs.forEach((s, k) => {
      if (!allowed(s)) return;
      const d = Math.max(0.005, dist[k][u]);
      cand.push([s.b, 1 / Math.pow(d + 0.02, 4)]);
    });
    cand.sort((a, b) => b[1] - a[1]);
    const top3 = cand.slice(0, 3);
    const tot = top3.reduce((s, e) => s + e[1], 0);
    set(top3.filter((e) => e[1] / tot > 0.05));
  }
  return { si, sw };
}

const ARM = new Set<number>([BI.upper_armL, BI.forearmL, BI.handL, BI.upper_armR, BI.forearmR, BI.handR]);

/**
 * Below the armpit, a vertex belongs wholly to the arm or wholly to the body (whichever holds most
 * of it): a hand resting against the skirt shares vertices with it, and a half-and-half vertex
 * would smear between them.
 */
function snapArms(P: THREE.BufferAttribute, si: Float32Array, sw: Float32Array, belowY: number): void {
  for (let i = 0; i < P.count; i++) {
    if (P.getY(i) >= belowY) continue;
    let a = 0;
    for (let k = 0; k < 4; k++) if (ARM.has(si[i * 4 + k])) a += sw[i * 4 + k];
    if (a <= 0 || a >= 1) continue;
    const keepArm = a >= 0.5;
    let tot = 0;
    for (let k = 0; k < 4; k++) {
      if (ARM.has(si[i * 4 + k]) !== keepArm) sw[i * 4 + k] = 0;
      tot += sw[i * 4 + k];
    }
    for (let k = 0; k < 4; k++) sw[i * 4 + k] /= tot;
  }
}

/**
 * The models' arms are joined to the body in places below the armpit (the inner arm to the side,
 * finger tips to the skirt hem): thin triangles that would stretch like webbing whenever an arm
 * lifts. Those triangles (one corner on the arm, another on the body) are dropped; the armpit and
 * shoulder above keep their blend.
 */
function cutBridges(P: THREE.BufferAttribute, index: ArrayLike<number>, si: Float32Array, sw: Float32Array, belowY: number): number[] {
  const arm = (i: number) => {
    let a = 0;
    for (let k = 0; k < 4; k++) if (ARM.has(si[i * 4 + k])) a += sw[i * 4 + k];
    return a;
  };
  const out: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const v = [0, 1, 2].map((k) => index[t + k]);
    const a = v.map(arm);
    const bridge = Math.max(...a) - Math.min(...a) > 0.5 && Math.max(...v.map((i) => P.getY(i))) < belowY;
    if (!bridge) out.push(...v);
  }
  return out;
}

/**
 * Vertices whose texture colour matches the hair (the colour at the top of the head): so long hair
 * can be skinned to the head rather than whatever limb it hangs beside.
 */
function hairMask(P: THREE.BufferAttribute, uv: THREE.BufferAttribute, map: THREE.Texture): Uint8Array {
  const out = new Uint8Array(P.count);
  const img = map.image as CanvasImageSource & { width: number; height: number };
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  if (!cx) return out;
  cx.drawImage(img, 0, 0);
  const D = cx.getImageData(0, 0, cv.width, cv.height).data;
  const texel = (i: number) => {
    const x = THREE.MathUtils.clamp(Math.floor(uv.getX(i) * cv.width), 0, cv.width - 1);
    const y = THREE.MathUtils.clamp(Math.floor(uv.getY(i) * cv.height), 0, cv.height - 1);
    const k = (y * cv.width + x) * 4;
    return [D[k], D[k + 1], D[k + 2]];
  };
  let top = 0;
  for (let i = 1; i < P.count; i++) if (P.getY(i) > P.getY(top)) top = i;
  const h = texel(top);
  for (let i = 0; i < P.count; i++) {
    const c = texel(i);
    if (Math.hypot(c[0] - h[0], c[1] - h[1], c[2] - h[2]) < 28) out[i] = 1;
  }
  return out;
}

async function loadOne(loader: GLTFLoader, g: 'm' | 'f'): Promise<GlbModel> {
  const url = (u: string) => new URL(u, document.baseURI).href;
  const [gltf, map] = await Promise.all([loader.loadAsync(url(FILES[g].mesh)), new THREE.TextureLoader().loadAsync(url(FILES[g].tex))]);
  map.flipY = false;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  gltf.scene.updateMatrixWorld(true);
  let mesh: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) throw new Error(`${FILES[g].mesh}: no mesh`);
  const m = mesh as THREE.Mesh;
  const src = m.geometry.clone().applyMatrix4(m.matrixWorld);
  const rig = RIGS[g];
  const joint = {} as Record<BoneName, THREE.Vector3>;
  for (const b of BONES) joint[b] = new THREE.Vector3(...rig.joint[b]);

  // Bind frames: at each joint, limbs turned so -y runs down the bone.
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

  const P = src.getAttribute('position') as THREE.BufferAttribute;
  const hair = hairMask(P, src.getAttribute('uv') as THREE.BufferAttribute, map);
  const tris = src.index ? Array.from(src.index.array as ArrayLike<number>) : Array.from({ length: P.count }, (_, i) => i);
  // Twice: the second time without the arm-to-body bridges, so no weight leaks across them.
  const armpit = joint.upper_armL.y - 0.12;
  const first = autoSkin(P, tris, rig, hair);
  const kept = cutBridges(P, tris, first.si, first.sw, armpit);
  const { si, sw } = autoSkin(P, kept, rig, hair);
  snapArms(P, si, sw, armpit);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', P);
  geometry.setAttribute('normal', src.getAttribute('normal'));
  geometry.setAttribute('uv', src.getAttribute('uv'));
  // Colour comes from the texture: white vertex colour, no per-person tint.
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(P.count * 3).fill(1), 3));
  geometry.setAttribute('aVeg', new THREE.Float32BufferAttribute(new Float32Array(P.count * 2), 2));
  geometry.setAttribute('aMat', new THREE.Float32BufferAttribute(new Float32Array(P.count), 1));
  // Hair vertices, so elders' hair can be drawn grey or white; and the beard (hair on the front of
  // the face, below the eyes), which boys don't have.
  const UV = src.getAttribute('uv') as THREE.BufferAttribute;
  const beardTop = joint.head.y + 0.09;
  const beard = new Float32Array(P.count);
  let skinUv = new THREE.Vector2(0.5, 0.5), best = Infinity;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (g === 'm' && hair[i] && z > joint.head.z + 0.03 && y < beardTop) beard[i] = 1;
    // The bare face: front of the head, between the eyes and the mouth.
    if (!hair[i] && z > joint.head.z + 0.06) {
      const d = Math.abs(x) + Math.abs(y - (joint.head.y + 0.1)) * 2;
      if (d < best) {
        best = d;
        skinUv = new THREE.Vector2(UV.getX(i), UV.getY(i));
      }
    }
  }
  // One attribute for both (0 skin/cloth, 1 hair, 2 beard): WebGL allows only 16 vertex inputs.
  const hb = new Float32Array(P.count);
  for (let i = 0; i < P.count; i++) hb[i] = beard[i] ? 2 : hair[i] ? 1 : 0;
  geometry.setAttribute('aHairB', new THREE.Float32BufferAttribute(hb, 1));
  geometry.setAttribute('aSkinI', new THREE.Float32BufferAttribute(si, 4));
  geometry.setAttribute('aSkinW', new THREE.Float32BufferAttribute(sw, 4));
  geometry.setIndex(cutBridges(P, kept, si, sw, armpit));
  geometry.computeBoundingSphere();
  const tip = new THREE.Vector3(...rig.tipL);
  return {
    geometry,
    map,
    skinUv,
    hat: rig.hat,
    joint,
    bindInv: bind.map((mm) => mm.clone().invert()),
    len: {
      upper: joint.upper_armL.distanceTo(joint.forearmL),
      fore: joint.forearmL.distanceTo(joint.handL),
      thigh: joint.thighL.distanceTo(joint.shinL),
      shin: joint.shinL.distanceTo(joint.footL),
      hand: joint.handL.distanceTo(tip),
    },
  };
}

let pending: Promise<GlbPeople> | null = null;

/** Load (once) both character models. */
export function loadGlbPeople(): Promise<GlbPeople> {
  if (pending) return pending;
  const loader = new GLTFLoader();
  pending = Promise.all([loadOne(loader, 'm'), loadOne(loader, 'f')]).then(([m, f]) => ({ m, f }));
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
