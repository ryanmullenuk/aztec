import * as THREE from 'three';
import { FAUNA, SPECIES, SpeciesDef, SpeciesKey, WARRIOR, WILDLIFE } from '../config';
import { Building } from '../buildings/Buildings';
import { peopleMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';
import * as models from './animalModels';
import { CHICKEN_WING, FOLDED, flapPose, mixPose, pose, wingMatrices, wingParts } from './birdWings';

const _fp = pose();
const _wp = pose();
const _wm = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];

type State = 'idle' | 'walk' | 'feed' | 'rest' | 'alert' | 'avoid' | 'flee' | 'held' | 'penned';
type Feed = 'peck' | 'scratch' | 'graze' | 'sniff' | 'drink';

export interface Animal {
  id: number;
  sp: SpeciesKey;
  /** Geometry keys for this individual (e.g. 'chicken_rooster', 'pig_spotted'). */
  bodyKey: string;
  headKey: string;
  color: THREE.Color;
  scale: number;
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  state: State;
  feed: Feed;
  timer: number;
  tx: number;
  tz: number;
  group: number;
  pen: number;
  alive: boolean;
  respawn: number;
  stamina: number;
  /** Seconds a pursuer has stayed close (for capture). */
  caught: number;
  lookYaw: number;
  phase: number;
  flap: number;
  /** Wings 0 folded … 1 spread (smoothed). */
  wingOpen: number;
  /** Gait cycle position (advances with distance walked), heading last frame, smoothed turn rate. */
  gait: number;
  prevHeading: number;
  turn: number;
  /** 0 standing … 1 lying down (smoothed). */
  lie: number;
  chasedBy: Islander | null;
  heldBy: Islander | null;
  heldMode: 'carry' | 'lead' | null;
  tick: number;
  /** Individual timing so the herd never moves in lockstep. */
  tempo: number;
}

interface Group {
  sp: SpeciesKey;
  x: number;
  z: number;
  homeX: number;
  homeZ: number;
  r: number;
}

/** Colour variants per species (coat colours from the reference sheets). */
const VARIANTS: Record<SpeciesKey, { body: string; head: string; colors: number[]; weight: number; scale: [number, number] }[]> = {
  chicken: [
    { body: 'hen', head: 'hen', colors: [0xf6f2ea, 0xa85428, 0x2a2624, 0xefe0b8, 0xc8883e, 0x6e3218], weight: 7, scale: [0.9, 1.05] },
    { body: 'speckled', head: 'hen', colors: [0xf2ece0], weight: 2, scale: [0.9, 1.0] },
    { body: 'rooster', head: 'rooster', colors: [0x8e3e1c], weight: 1, scale: [1.0, 1.1] },
  ],
  pig: [
    { body: 'plain', head: 'pig', colors: [0xeea39a, 0xeea39a, 0xb06a3c, 0x3a3230], weight: 7, scale: [0.8, 1.15] },
    { body: 'spotted', head: 'pig', colors: [0xeea39a, 0xc8864a], weight: 3, scale: [0.85, 1.1] },
  ],
  goat: [
    { body: 'plain', head: 'straight', colors: [0xece6d8, 0x8a5a38, 0x5a4030], weight: 5, scale: [0.85, 1.1] },
    { body: 'patched', head: 'curly', colors: [0x8a5a38, 0x6e4a30], weight: 4, scale: [0.9, 1.1] },
  ],
  tapir: [{ body: 'plain', head: 'tapir', colors: [0x4a3e38, 0x3e3430, 0x564842], weight: 1, scale: [0.9, 1.1] }],
};

/** Per-species skeleton for drawing: leg joints, leg length, head joint. */
const RIG: Record<SpeciesKey, { legs: [number, number, number][]; legLen: number; head: [number, number, number]; wings: boolean }> = {
  chicken: { legs: [[-0.025, 0.055, 0], [0.025, 0.055, 0]], legLen: 0.055, head: [0, 0.14, 0.08], wings: true },
  pig: { legs: [[-0.06, 0.1, 0.12], [0.06, 0.1, 0.12], [-0.06, 0.1, -0.12], [0.06, 0.1, -0.12]], legLen: 0.1, head: [0, 0.2, 0.22], wings: false },
  goat: { legs: [[-0.05, 0.18, 0.12], [0.05, 0.18, 0.12], [-0.05, 0.18, -0.12], [0.05, 0.18, -0.12]], legLen: 0.18, head: [0, 0.3, 0.2], wings: false },
  tapir: { legs: [[-0.11, 0.2, 0.24], [0.11, 0.2, 0.24], [-0.11, 0.2, -0.24], [0.11, 0.2, -0.24]], legLen: 0.2, head: [0, 0.4, 0.42], wings: false },
};

/**
 * Jointed quadruped skeletons: a spine joint mid-body (front and rear halves bend when turning
 * and flex at speed), and legs of three segments: hip/shoulder → knee/elbow → ankle/wrist → foot.
 */
type Quad = 'pig' | 'goat' | 'tapir';
interface QuadRig {
  spineY: number;
  /** Shoulder / hip joint height above the ground (front legs stand straight). */
  hipY: number;
  x: number;
  zF: number;
  zR: number;
  /** Head joint in the front half's frame. */
  head: [number, number, number];
  /** Segment length ratios (upper, lower, foot) and radii. */
  seg: [number, number, number];
  r: number;
  /** Distance covered per gait cycle. */
  stride: number;
  hoof: number;
  foot: 'split' | 'toes';
}
const QUAD: Record<Quad, QuadRig> = {
  pig: { spineY: 0.17, hipY: 0.12, x: 0.066, zF: 0.12, zR: -0.13, head: [0, 0.03, 0.22], seg: [0.42, 0.36, 0.22], r: 0.03, stride: 0.26, hoof: 0x3a2a22, foot: 'split' },
  goat: { spineY: 0.26, hipY: 0.21, x: 0.05, zF: 0.13, zR: -0.13, head: [0, 0.04, 0.2], seg: [0.38, 0.38, 0.24], r: 0.021, stride: 0.34, hoof: 0x2a2018, foot: 'split' },
  tapir: { spineY: 0.35, hipY: 0.25, x: 0.11, zF: 0.24, zR: -0.24, head: [0, 0.05, 0.42], seg: [0.4, 0.37, 0.23], r: 0.052, stride: 0.5, hoof: 0x1e1814, foot: 'toes' },
};
/** Hind legs stand with the thigh forward, shin back and cannon upright; their hip sits a little lower. */
const HIND0 = [-0.32, 0.64, -0.32];
const hindHipY = (q: QuadRig) => q.hipY * (q.seg[0] * Math.cos(HIND0[0]) + q.seg[1] * Math.cos(HIND0[0] + HIND0[1]) + q.seg[2]);
/** Gait phase offsets per leg (LF, RF, LH, RH): lateral-sequence walk and diagonal trot. */
const WALK = [0.25, 0.75, 0, 0.5];
const TROT = [0, 0.5, 0.5, 0];

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function compose(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(s, s, s);
  return out.compose(_p, _q, _s);
}

/**
 * Chickens, pigs, goats and tapirs living on their own. A shared, data-driven state machine
 * (wander, feed, rest, follow the group, alert → avoid → flee from islanders) with per-species
 * habitats and tuning. Animals only become food through explicit capture orders.
 */
export class Animals {
  readonly group = new THREE.Group();
  list: Animal[] = [];
  private groups: Group[] = [];
  private rng: RNG;
  private meshes = new Map<string, { mesh: THREE.InstancedMesh; acc: THREE.InstancedBufferAttribute; n: number }>();
  private pens = new Map<number, { x: number; z: number; r: number }>();
  private leash: THREE.LineSegments;
  private time = 0;
  /** Settlement points (buildings) that chickens and goats hang around. */
  settlement: () => { x: number; z: number }[] = () => [];

  constructor(private world: World) {
    this.rng = new RNG(world.seed * 131 + 9);
    this.buildMeshes();
    this.spawnAll();
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 12), 3));
    this.leash = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xc9a86a, fog: true }));
    this.leash.frustumCulled = false;
    this.group.add(this.leash);
  }

  // ---------------- Meshes ----------------

  private buildMeshes(): void {
    const mat = peopleMaterial();
    const add = (key: string, geo: THREE.BufferGeometry, cap: number) => {
      const acc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      acc.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iAccent', acc);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.set(key, { mesh, acc, n: 0 });
      this.group.add(mesh);
    };
    const cap = 40;
    add('chicken_hen', models.chickenBody('hen'), cap);
    add('chicken_speckled', models.chickenBody('speckled'), cap);
    add('chicken_rooster', models.chickenBody('rooster'), cap);
    add('head_hen', models.chickenHead(false), cap);
    add('head_rooster', models.chickenHead(true), cap);
    // Jointed wings (arm, forearm, hand; right then left), tinted with the coat colour.
    wingParts(CHICKEN_WING, 2).forEach((g, k) => add(`wing_chicken${k}`, g, cap));
    add('leg_chicken', models.legGeometry(0.055, 0.008, 0xe8b030, 0xe8b030), cap * 2);
    // Quadrupeds: front / rear body halves (split at the spine joint) and three-segment legs.
    const halves = (key: string, h: [THREE.BufferGeometry, THREE.BufferGeometry], n: number) => {
      add(`${key}_F`, h[0], n);
      add(`${key}_R`, h[1], n);
    };
    halves('pig_plain', models.pigBodyHalves(false, QUAD.pig.spineY), cap);
    halves('pig_spotted', models.pigBodyHalves(true, QUAD.pig.spineY), cap);
    add('head_pig', models.pigHead(), cap);
    halves('goat_plain', models.goatBodyHalves(false, QUAD.goat.spineY), cap);
    halves('goat_patched', models.goatBodyHalves(true, QUAD.goat.spineY), cap);
    add('head_straight', models.goatHead(false), cap);
    add('head_curly', models.goatHead(true), cap);
    halves('tapir_plain', models.tapirBodyHalves(QUAD.tapir.spineY), 12);
    add('head_tapir', models.tapirHead(), 12);
    for (const sp of ['pig', 'goat', 'tapir'] as Quad[]) {
      const q = QUAD[sp], L = q.hipY, n = sp === 'tapir' ? 48 : cap * 4;
      add(`legU_${sp}`, models.legSegment(L * q.seg[0], q.r, q.r * 0.78), n);
      add(`legL_${sp}`, models.legSegment(L * q.seg[1], q.r * 0.74, q.r * 0.6), n);
      add(`legP_${sp}`, models.footSegment(L * q.seg[2], q.r * 0.62, q.hoof, q.foot), n);
    }
  }

  // ---------------- Spawning ----------------

  /** Habitat preference score (higher is better; -Infinity = not allowed). */
  habitat(sp: SpeciesKey, x: number, z: number): number {
    const w = this.world;
    const i = w.cellIndexAt(x, z);
    if (i < 0 || w.layer[i] < 1 || !Number.isNaN(w.riverY[i]) || (w.occ[i] && !w.passable(w.occ[i] - 1))) return -Infinity;
    const f = w.forest[i];
    const m = w.meadow;
    const dm = Math.hypot(x - m.x, z - m.z);
    // Most wild game lives on the wild island across the strait.
    const wild = SPECIES[sp].habitat !== 'settlement' ? (w.isle[i] === 2 ? 4 : 0) : 0;
    return this.habitatBase(sp, i, x, z, f, dm) + wild;
  }

  private habitatBase(sp: SpeciesKey, i: number, x: number, z: number, f: number, dm: number): number {
    const w = this.world;
    const m = w.meadow;
    switch (SPECIES[sp].habitat) {
      case 'settlement': {
        // Around the village, not on top of it: a ring roughly 5–9 units out from the buildings.
        let d = dm;
        for (const p of this.settlement()) d = Math.min(d, Math.hypot(p.x - x, p.z - z));
        return -Math.max(0, Math.abs(d - 7) - 2) * 0.5 - (d < 3.5 ? 6 : 0) - f * 3 - w.sandy[i] * 1.5;
      }
      case 'jungleEdge':
        return -Math.abs(f - 0.45) * 5 - (dm < m.r + 4 ? 4 : 0) - w.sandy[i] * 3;
      case 'hills':
        return w.layer[i] * 0.45 + w.rocky[i] * 1.5 - f * 2 - (dm < 8 ? 2 : 0);
      case 'jungle': {
        const river = this.nearRiver(x, z) ? 1.5 : 0;
        return f * 5 + river - (dm < m.r + 10 ? 6 : 0);
      }
    }
  }

  private nearRiver(x: number, z: number): boolean {
    const w = this.world;
    const [cx, cz] = w.cellOf(x, z);
    for (let dz = -3; dz <= 3; dz += 3) for (let dx = -3; dx <= 3; dx += 3) {
      if (w.inBounds(cx + dx, cz + dz) && !Number.isNaN(w.riverY[w.idx(cx + dx, cz + dz)])) return true;
    }
    return false;
  }

  /** Best of several random candidates around a point, by habitat. */
  private pickSpot(sp: SpeciesKey, x: number, z: number, r: number, tries = 8): [number, number] | null {
    let best: [number, number] | null = null, bs = -Infinity;
    for (let k = 0; k < tries; k++) {
      const a = this.rng.next() * Math.PI * 2, d = Math.sqrt(this.rng.next()) * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const s = this.habitat(sp, px, pz) + this.rng.next() * 0.8;
      if (s > bs) {
        bs = s;
        best = [px, pz];
      }
    }
    return bs > -Infinity ? best : null;
  }

  private spawnAll(): void {
    // Centre of the wild island, where most game lives.
    const w = this.world;
    let wx = 0, wz = 0, wn = 0;
    for (let i = 0; i < w.N * w.N; i++) {
      if (w.isle[i] !== 2) continue;
      wx += w.centerX(i % w.N);
      wz += w.centerZ((i / w.N) | 0);
      wn++;
    }
    const wild = wn ? { x: wx / wn, z: wz / wn } : null;
    for (const sp of Object.keys(SPECIES) as SpeciesKey[]) {
      const def = SPECIES[sp];
      const total = this.rng.int(def.count[0], def.count[1]);
      let made = 0;
      for (let tries = 0; made < total && tries < 60; tries++) {
        // Find a good habitat spot for the group: chickens by the village, and about three in
        // four groups of wild game over on the wild island.
        const m = this.world.meadow;
        const onWild = def.habitat !== 'settlement' && wild && this.rng.next() < 0.75;
        const c = onWild ? wild! : m;
        const far = def.habitat === 'settlement' ? 14 : onWild ? 32 : def.habitat === 'jungle' ? 70 : 45;
        const spot = this.pickSpot(sp, c.x, c.z, far, 40);
        if (!spot) continue;
        const size = Math.min(total - made, this.rng.int(def.group[0], def.group[1]));
        const gi = this.groups.length;
        this.groups.push({ sp, x: spot[0], z: spot[1], homeX: spot[0], homeZ: spot[1], r: sp === 'chicken' ? 5 : sp === 'tapir' ? 7 : 5 });
        for (let k = 0; k < size; k++) {
          const p = this.pickSpot(sp, spot[0], spot[1], 2) ?? spot;
          this.list.push(this.makeAnimal(sp, p[0], p[1], gi, k === 1 && sp === 'tapir' && size > 1));
          made++;
        }
      }
    }
  }

  private makeAnimal(sp: SpeciesKey, x: number, z: number, group: number, juvenile = false): Animal {
    const vs = VARIANTS[sp];
    const tot = vs.reduce((s, v) => s + v.weight, 0);
    let r = this.rng.next() * tot, v = vs[0];
    for (const c of vs) {
      if ((r -= c.weight) <= 0) {
        v = c;
        break;
      }
    }
    const def = SPECIES[sp];
    return {
      id: this.list.length, sp, bodyKey: `${sp}_${v.body}`, headKey: `head_${v.head}`,
      color: new THREE.Color(v.colors[Math.floor(this.rng.next() * v.colors.length)]).multiplyScalar(0.92 + this.rng.next() * 0.16),
      scale: this.rng.range(v.scale[0], v.scale[1]) * (juvenile ? 0.55 : 1),
      x, z, y: this.world.groundY(x, z), heading: this.rng.range(0, 6.28), speed: 0,
      state: 'idle', feed: 'graze', timer: this.rng.range(0.5, 6), tx: x, tz: z, group, pen: -1, alive: true, respawn: 0,
      stamina: def.stamina, caught: 0, lookYaw: 0, phase: this.rng.range(0, 10), flap: 0, wingOpen: 0, gait: this.rng.next(), prevHeading: 0, turn: 0, lie: 0,
      chasedBy: null, heldBy: null, heldMode: null, tick: this.rng.next() * 0.3, tempo: this.rng.range(0.8, 1.25),
    };
  }

  // ---------------- Pens & capture API ----------------

  registerPen(b: Building): void {
    this.pens.set(b.id, { x: b.penX, z: b.penZ, r: 0.9 });
  }
  releasePen(id: number): void {
    for (const a of this.list) if (a.pen === id) {
      a.pen = -1;
      a.state = 'flee';
      a.timer = 2;
    }
    this.pens.delete(id);
  }
  penCount(b: Building): number {
    return this.list.filter((a) => a.alive && a.pen === b.id).length;
  }
  takeFromPen(b: Building): boolean {
    const a = this.list.find((x) => x.alive && x.pen === b.id);
    if (!a) return false;
    this.consume(a.id);
    return true;
  }

  get(id: number): Animal | undefined {
    return this.list[id];
  }

  /** Can this animal be targeted for capture right now? */
  capturable(a: Animal): boolean {
    return a.alive && a.pen < 0 && !a.heldBy && !a.chasedBy;
  }

  /** An islander starts pursuing this animal (it notices and flees). */
  beginChase(id: number, isl: Islander): void {
    const a = this.list[id];
    if (!a) return;
    a.chasedBy = isl;
    a.caught = 0;
  }

  /** True once the pursuer has been close enough, long enough (or the animal is exhausted). */
  catchable(id: number, isl: Islander): boolean {
    const a = this.list[id];
    if (!a || !a.alive) return false;
    const d = Math.hypot(a.x - isl.x, a.z - isl.z);
    const def = SPECIES[a.sp];
    return d < (a.sp === 'chicken' ? 0.5 : 0.8) * a.scale + 0.25 && (a.caught >= def.captureTime || a.stamina <= 0);
  }

  /** Captured: carried (chickens), led on a leash (pigs, goats) or hunted (tapirs → meat). */
  grab(id: number, isl: Islander): 'carry' | 'lead' | 'hunt' {
    const a = this.list[id];
    const mode = SPECIES[a.sp].capture;
    a.chasedBy = null;
    if (mode === 'hunt') {
      this.consume(id);
      return 'hunt';
    }
    a.heldBy = isl;
    a.heldMode = mode;
    a.state = 'held';
    return mode;
  }

  /** Pursuit abandoned or the carrier dropped it: the animal runs off. */
  release(id: number): void {
    const a = this.list[id];
    if (!a) return;
    a.chasedBy = null;
    if (a.heldBy) {
      a.x = a.heldBy.x + 0.3;
      a.z = a.heldBy.z + 0.3;
    }
    a.heldBy = null;
    a.heldMode = null;
    if (a.alive && a.pen < 0) {
      a.state = 'flee';
      a.timer = 1.5;
    }
  }

  putInPen(id: number, b: Building): void {
    const a = this.list[id];
    const pc = this.pens.get(b.id);
    if (!a || !pc) return;
    a.heldBy = null;
    a.heldMode = null;
    a.chasedBy = null;
    a.pen = b.id;
    a.x = pc.x + (this.rng.next() - 0.5) * pc.r;
    a.z = pc.z + (this.rng.next() - 0.5) * pc.r;
    a.state = 'penned';
    a.timer = 1;
  }

  /** Animal eaten: it is replaced in the wild after a while (population stays healthy). */
  consume(id: number): void {
    const a = this.list[id];
    if (!a) return;
    a.alive = false;
    a.pen = -1;
    a.heldBy = null;
    a.chasedBy = null;
    a.respawn = SPECIES[a.sp].regrow;
  }

  /** Screen-space pick of the nearest animal to the pointer. */
  pick(camera: THREE.Camera, sx: number, sy: number, rect: DOMRect, radius = 24): Animal | null {
    const v = new THREE.Vector3();
    let best: Animal | null = null, bd = radius * radius;
    for (const a of this.list) {
      if (!a.alive || a.heldMode === 'carry') continue;
      v.set(a.x, a.y + 0.15 * a.scale, a.z).project(camera);
      if (v.z > 1) continue;
      const px = (v.x * 0.5 + 0.5) * rect.width + rect.left, py = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      const d = (px - sx) ** 2 + (py - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  describe(a: Animal): string {
    if (a.pen >= 0) return 'In the pen';
    if (a.heldBy) return a.heldMode === 'carry' ? 'Being carried home' : 'Being led to the pen';
    if (a.chasedBy) return 'Running from a hunter';
    const map: Record<State, string> = { idle: 'Looking around', walk: 'Wandering', feed: a.feed === 'peck' ? 'Pecking' : a.feed === 'sniff' ? 'Sniffing about' : a.feed === 'drink' ? 'Drinking' : a.feed === 'scratch' ? 'Scratching' : 'Grazing', rest: 'Resting', alert: 'Watching warily', avoid: 'Keeping away from people', flee: 'Running away', held: 'Captured', penned: 'In the pen' };
    return map[a.state];
  }

  // ---------------- Update ----------------

  update(dt: number, camTarget: THREE.Vector3, cursor: THREE.Vector3 | null, people: SpatialHash<Islander>): void {
    this.time += dt;
    if (dt > 0) {
      for (const g of this.groups) {
        // Group centre follows its members.
        let sx = 0, sz = 0, n = 0;
        for (const a of this.list) if (a.group === this.groups.indexOf(g) && a.alive && a.pen < 0 && !a.heldBy) {
          sx += a.x;
          sz += a.z;
          n++;
        }
        if (n) {
          g.x = sx / n;
          g.z = sz / n;
        }
      }
      for (const a of this.list) {
        // Distance-based simulation rate: far animals think less often.
        const far = Math.hypot(a.x - camTarget.x, a.z - camTarget.z) > FAUNA.lodDistance;
        a.tick += dt;
        const step = far ? 0.3 : 0;
        if (a.tick < step) continue;
        const d = a.tick;
        a.tick = 0;
        this.step(a, d, cursor, people);
      }
    }
    this.draw(dt);
  }

  private walkable(a: Animal, x: number, z: number): boolean {
    const w = this.world;
    const i = w.cellIndexAt(x, z);
    if (i < 0 || w.layer[i] < 1 || !Number.isNaN(w.riverY[i])) return false;
    // Wild animals keep out of building footprints (the fire, huts, fields); penned ones stay in their pen.
    if (w.occ[i] && (a.pen < 0 || !w.passable(w.occ[i] - 1))) return false;
    return Math.abs(w.heightAt(x, z) - a.y) < SPECIES[a.sp].maxSlope;
  }

  private moveToward(a: Animal, speed: number, dt: number, turn = 3): boolean {
    const dx = a.tx - a.x, dz = a.tz - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) return true;
    let dh = Math.atan2(dx, dz) - a.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    a.heading += Math.max(-turn * dt, Math.min(turn * dt, dh));
    // Accelerate smoothly; slow when turning hard.
    const target = speed * (1 - Math.min(0.7, Math.abs(dh) * 0.4));
    a.speed += (target - a.speed) * Math.min(1, dt * 4);
    const nx = a.x + Math.sin(a.heading) * a.speed * dt, nz = a.z + Math.cos(a.heading) * a.speed * dt;
    // Standing somewhere it shouldn't be (e.g. a building went up around it): always let it walk out.
    if (this.walkable(a, nx, nz) || !this.walkable(a, a.x, a.z)) {
      a.x = nx;
      a.z = nz;
    } else {
      // Blocked (a building, water, a steep step): sidestep around it, keeping the goal.
      const step = Math.max(0.02, a.speed * dt);
      for (const off of [0.7, -0.7, 1.4, -1.4, 2.1, -2.1]) {
        const h = a.heading + off;
        const sx = a.x + Math.sin(h) * step, sz = a.z + Math.cos(h) * step;
        if (this.walkable(a, sx, sz)) {
          a.x = sx;
          a.z = sz;
          a.heading += off * Math.min(1, dt * 6);
          return false;
        }
      }
      // Boxed in: back off and pick somewhere else next time.
      a.tx = a.x - Math.sin(a.heading) * 2;
      a.tz = a.z - Math.cos(a.heading) * 2;
      a.speed = 0;
      a.timer = 0;
      a.state = 'idle';
      return true;
    }
    return d < 0.25;
  }

  private step(a: Animal, dt: number, cursor: THREE.Vector3 | null, people: SpatialHash<Islander>): void {
    const def = SPECIES[a.sp];
    a.phase += dt * a.tempo;
    a.flap = Math.max(0, a.flap - dt);
    if (!a.alive) {
      if (a.respawn > 0 && (a.respawn -= dt) <= 0) {
        // A new animal appears in its group's home range (off the settlement).
        const g = this.groups[a.group];
        const p = this.pickSpot(a.sp, g.homeX, g.homeZ, g.r + 4);
        if (p) {
          Object.assign(a, { x: p[0], z: p[1], alive: true, state: 'idle', timer: 2, stamina: def.stamina, pen: -1 });
          a.y = this.world.groundY(a.x, a.z);
        } else a.respawn = 30;
      }
      return;
    }
    if (a.heldBy) {
      const l = a.heldBy;
      if (a.heldMode === 'lead') {
        a.tx = l.x - Math.sin(l.heading) * 0.55;
        a.tz = l.z - Math.cos(l.heading) * 0.55;
        this.moveToward(a, Math.max(1.4, Math.hypot(a.tx - a.x, a.tz - a.z) * 3), dt, 6);
      }
      a.y = this.world.groundY(a.x, a.z);
      return;
    }
    if (a.pen >= 0) {
      const pc = this.pens.get(a.pen);
      if (!pc) {
        a.pen = -1;
        return;
      }
      a.timer -= dt;
      if (a.timer <= 0) {
        a.tx = pc.x + (this.rng.next() - 0.5) * pc.r * 1.6;
        a.tz = pc.z + (this.rng.next() - 0.5) * pc.r * 1.6;
        a.timer = 3 + this.rng.next() * 6;
        a.state = this.rng.chance(0.4) ? 'feed' : 'walk';
        a.feed = a.sp === 'pig' ? 'sniff' : 'graze';
      }
      if (a.state === 'walk') {
        const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
        if (d > 0.05) {
          a.heading = Math.atan2(dx, dz);
          a.x += (dx / d) * Math.min(d, def.wanderSpeed * dt);
          a.z += (dz / d) * Math.min(d, def.wanderSpeed * dt);
        } else a.state = 'idle';
      }
      a.y = this.world.groundY(a.x, a.z);
      return;
    }

    // --- Threat assessment: escalating comfort → alert → move away → flee. ---
    let nearD = Infinity, nx = 0, nz = 0, running = false, warrior = false;
    people.query(a.x, a.z, def.alertRadius * 1.2 + 2, (i, d2) => {
      const d = Math.sqrt(d2);
      if (i.warrior && d < WARRIOR.scareRadius) warrior = true;
      if (d < nearD) {
        nearD = d;
        nx = i.x;
        nz = i.z;
        running = i.anim === 'run';
      }
    });
    const chaser = a.chasedBy;
    if (chaser) {
      nearD = Math.hypot(chaser.x - a.x, chaser.z - a.z);
      nx = chaser.x;
      nz = chaser.z;
      if (nearD < 1.6) a.caught += dt;
    }
    let flee = warrior || (!!chaser && nearD < 9) || nearD < def.fleeRadius || (running && nearD < def.avoidRadius);
    if (a.sp === 'chicken' && cursor && Math.hypot(cursor.x - a.x, cursor.z - a.z) < WILDLIFE.chickenFleeRadius) {
      flee = true;
      nx = cursor.x;
      nz = cursor.z;
      a.flap = 0.6;
    }
    if (flee) {
      if (a.state !== 'flee' || a.timer <= 0) {
        // Run away (tapirs retreat deeper into the jungle).
        const away = Math.atan2(a.x - nx, a.z - nz);
        let best: [number, number] | null = null, bs = -Infinity;
        for (let k = 0; k < 6; k++) {
          const ang = away + (this.rng.next() - 0.5) * 1.6, r = a.sp === 'chicken' ? 1.6 : 3.5;
          const px = a.x + Math.sin(ang) * r, pz = a.z + Math.cos(ang) * r;
          if (!this.walkable(a, px, pz)) continue;
          const s = (a.sp === 'tapir' ? this.habitat('tapir', px, pz) : 0) + this.rng.next();
          if (s > bs) {
            bs = s;
            best = [px, pz];
          }
        }
        if (best) {
          a.tx = best[0];
          a.tz = best[1];
        }
        a.state = 'flee';
        a.timer = a.sp === 'chicken' ? 0.5 + this.rng.next() * 0.5 : 1.2;
      }
      const tired = a.stamina <= 0;
      a.stamina = Math.max(0, a.stamina - dt);
      this.moveToward(a, def.fleeSpeed * (tired ? 0.45 : 1) * a.tempo, dt, 5);
      a.timer -= dt;
      a.y = this.world.groundY(a.x, a.z);
      return;
    }
    a.stamina = Math.min(def.stamina, a.stamina + dt * 0.5);
    if (nearD < def.avoidRadius) {
      if (a.state !== 'avoid') {
        const away = Math.atan2(a.x - nx, a.z - nz);
        a.tx = a.x + Math.sin(away) * def.avoidRadius;
        a.tz = a.z + Math.cos(away) * def.avoidRadius;
        a.state = 'avoid';
      }
      if (this.moveToward(a, def.wanderSpeed * 1.4 * a.tempo, dt)) a.state = 'alert';
      a.lookYaw = 0;
      a.y = this.world.groundY(a.x, a.z);
      return;
    }
    if (nearD < def.alertRadius && a.state !== 'rest') {
      // Stop and watch the islander.
      if (a.state !== 'alert') {
        a.state = 'alert';
        a.timer = 1 + this.rng.next() * 2;
      }
      let dh = Math.atan2(nx - a.x, nz - a.z) - a.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      a.lookYaw += (Math.max(-1, Math.min(1, dh)) - a.lookYaw) * Math.min(1, dt * 4);
      a.speed = 0;
      return;
    }
    a.lookYaw *= 1 - Math.min(1, dt * 2);

    // --- Everyday life. ---
    a.timer -= dt;
    if (a.timer <= 0) this.chooseActivity(a);
    if (a.state === 'walk') {
      if (this.moveToward(a, def.wanderSpeed * a.tempo * (a.sp === 'chicken' && a.flap > 0 ? 3 : 1), dt)) {
        a.state = 'idle';
        a.timer = 0.4 + this.rng.next() * 1.5;
      }
    } else a.speed *= 1 - Math.min(1, dt * 5);
    a.y = this.world.groundY(a.x, a.z);
  }

  /** Weighted, randomised choice of what to do next (never the same rhythm twice). */
  private chooseActivity(a: Animal): void {
    const g = this.groups[a.group];
    const dGroup = Math.hypot(a.x - g.x, a.z - g.z);
    const r = this.rng.next();
    const walkTo = (x: number, z: number, rad: number) => {
      const p = this.pickSpot(a.sp, x, z, rad, 5);
      if (p) {
        a.tx = p[0];
        a.tz = p[1];
        a.state = 'walk';
        a.timer = 12;
      } else {
        a.state = 'idle';
        a.timer = 1;
      }
    };
    // Regroup if strayed.
    if (dGroup > g.r * 1.3) return walkTo(g.x, g.z, 1.5);
    // The group's home drifts slowly, so herds roam the island over time.
    if (this.rng.chance(0.04)) {
      const p = this.pickSpot(a.sp, g.homeX, g.homeZ, 6, 6);
      if (p) {
        g.homeX = p[0];
        g.homeZ = p[1];
      }
    }
    switch (a.sp) {
      case 'chicken':
        if (r < 0.35) {
          a.state = 'feed';
          a.feed = 'peck';
          a.timer = 1.2 + this.rng.next() * 2.2;
        } else if (r < 0.45) {
          a.state = 'feed';
          a.feed = 'scratch';
          a.timer = 0.8 + this.rng.next();
        } else if (r < 0.52) {
          a.flap = 0.5; // short run
          walkTo(a.x, a.z, 2.5);
        } else if (r < 0.58) {
          a.state = 'rest';
          a.timer = 4 + this.rng.next() * 8;
        } else if (r < 0.68) {
          a.state = 'idle';
          a.timer = 0.6 + this.rng.next() * 1.4;
        } else walkTo((g.x + g.homeX) / 2, (g.z + g.homeZ) / 2, g.r);
        break;
      case 'pig':
        if (r < 0.2) {
          a.state = 'feed';
          a.feed = 'graze';
          a.timer = 3 + this.rng.next() * 4;
        } else if (r < 0.4) {
          a.state = 'feed';
          a.feed = 'sniff';
          a.timer = 2 + this.rng.next() * 3;
        } else if (r < 0.5) {
          a.state = 'rest';
          a.timer = 10 + this.rng.next() * 18;
        } else if (r < 0.62) {
          // Wander toward a herd-mate.
          const mates = this.list.filter((o) => o !== a && o.group === a.group && o.alive && o.pen < 0);
          const m = mates[Math.floor(this.rng.next() * mates.length)];
          if (m) walkTo(m.x, m.z, 1);
          else walkTo(g.homeX, g.homeZ, g.r);
        } else walkTo((g.x + g.homeX) / 2, (g.z + g.homeZ) / 2, g.r);
        break;
      case 'goat':
        if (r < 0.35) {
          a.state = 'feed';
          a.feed = 'graze';
          a.timer = 3 + this.rng.next() * 5;
        } else if (r < 0.45) {
          a.state = 'rest';
          a.timer = 8 + this.rng.next() * 12;
        } else if (r < 0.55) {
          // Wander over to investigate the settlement.
          const pts = this.settlement();
          const p = pts[Math.floor(this.rng.next() * pts.length)];
          if (p) walkTo(p.x, p.z, 4);
          else walkTo(g.homeX, g.homeZ, g.r);
        } else walkTo(g.homeX, g.homeZ, g.r);
        break;
      case 'tapir':
        if (r < 0.3) {
          a.state = 'feed';
          a.feed = 'graze';
          a.timer = 4 + this.rng.next() * 5;
        } else if (r < 0.4 && this.nearRiver(a.x, a.z)) {
          a.state = 'feed';
          a.feed = 'drink';
          a.timer = 4 + this.rng.next() * 4;
        } else if (r < 0.55) {
          a.state = 'rest';
          a.timer = 12 + this.rng.next() * 20;
        } else walkTo(g.homeX, g.homeZ, g.r);
        break;
    }
  }

  // ---------------- Drawing ----------------

  /** Rope from the islander leading this animal to its neck. */
  private leashLine(a: Animal, rig: (typeof RIG)[SpeciesKey], lineArr: Float32Array, lines: number): boolean {
    if (a.heldMode !== 'lead' || !a.heldBy || lines >= 64) return false;
    const l = a.heldBy;
    const hx2 = l.x, hy2 = l.y + 0.25, hz2 = l.z;
    const ax = a.x + Math.sin(a.heading) * 0.15 * a.scale, ay = a.y + rig.head[1] * a.scale, az = a.z + Math.cos(a.heading) * 0.15 * a.scale;
    const mx = (hx2 + ax) / 2, my = (hy2 + ay) / 2 - 0.08, mz = (hz2 + az) / 2;
    lineArr.set([hx2, hy2, hz2, mx, my, mz, mx, my, mz, ax, ay, az], lines * 12);
    return true;
  }

  private put(key: string, m: THREE.Matrix4, col: THREE.Color): void {
    const e = this.meshes.get(key);
    if (!e || e.n >= e.mesh.instanceMatrix.count) return;
    e.mesh.setMatrixAt(e.n, m);
    e.acc.setXYZ(e.n, col.r, col.g, col.b);
    e.n++;
  }

  /** Pig, goat or tapir: spine bend, gait-driven jointed legs, head on the front half. */
  private drawQuad(a: Animal, dt: number): void {
    const q = QUAD[a.sp as Quad];
    const moving = a.speed > 0.05;
    const fast = a.state === 'flee' || a.speed > 1;
    // Gait advances with distance travelled, so feet don't skate.
    a.gait = (a.gait + (a.speed * dt) / q.stride / (fast ? 1.5 : 1)) % 1;
    let dh = a.heading - a.prevHeading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    a.prevHeading = a.heading;
    if (dt > 0) a.turn += (THREE.MathUtils.clamp(dh / dt, -4, 4) - a.turn) * Math.min(1, dt * 6);
    a.lie += ((a.state === 'rest' ? 1 : 0) - a.lie) * Math.min(1, dt * 2.5);
    const lie = a.lie;
    const G = a.gait * Math.PI * 2;
    // Spine: bends into turns, sways a little with each step, flexes and extends when running.
    const bendYaw = THREE.MathUtils.clamp(a.turn * 0.11, -0.32, 0.32) + (moving && !fast ? Math.sin(G) * 0.05 : 0);
    const flex = fast ? Math.sin(G * 2) * 0.09 : 0;
    let headTilt = 0, frontPitch = 0;
    if (a.state === 'feed') {
      headTilt = a.feed === 'sniff' ? 0.6 + Math.sin(a.phase * 6) * 0.2 : 0.8 + Math.sin(a.phase * 1.7) * 0.1;
      frontPitch = 0.1;
    }
    if (a.state === 'alert') headTilt = -0.25;
    const bob = moving ? (fast ? Math.abs(Math.sin(G * 2)) * 0.022 : Math.abs(Math.sin(G * 2)) * 0.008) * a.scale : Math.sin(a.phase * 2) * 0.002;
    const drop = lie * (q.spineY - q.hipY * 0.35);
    compose(_m, a.x, a.y + (q.spineY - drop) * a.scale + bob, a.z, 0, a.heading, lie * 0.08, a.scale);
    const front = new THREE.Matrix4().multiplyMatrices(_m, compose(new THREE.Matrix4(), 0, 0, 0, frontPitch + flex, bendYaw * 0.5, 0));
    const rear = new THREE.Matrix4().multiplyMatrices(_m, compose(new THREE.Matrix4(), 0, 0, 0, -flex, -bendYaw * 0.5, 0));
    this.put(`${a.bodyKey}_F`, front, a.color);
    this.put(`${a.bodyKey}_R`, rear, a.color);
    const [hx, hy, hz] = q.head;
    _m2.multiplyMatrices(front, compose(new THREE.Matrix4(), hx, hy, hz, headTilt - frontPitch, a.lookYaw + bendYaw * 0.5, 0));
    this.put(a.headKey, _m2, a.color);
    // Legs.
    const L = q.hipY, l1 = L * q.seg[0], l2 = L * q.seg[1];
    const amp = moving ? (fast ? 0.62 : 0.34) * Math.min(1, a.speed * 2 + 0.3) : 0;
    const offs = fast ? TROT : WALK;
    const hindY = hindHipY(q);
    const J = new THREE.Matrix4(), T = new THREE.Matrix4();
    for (let k = 0; k < 4; k++) {
      const isFront = k < 2, side = k % 2 === 0 ? 1 : -1;
      const ph = G + offs[k] * Math.PI * 2;
      const sw = Math.sin(ph);
      const lift = Math.max(0, -Math.cos(ph)) * (amp > 0 ? 1 : 0);
      let a1: number, a2: number, a3: number;
      if (isFront) {
        // Shoulder swings; elbow and wrist fold the foot back and up as it swings forward.
        a1 = amp * sw - (a.state === 'feed' ? 0.12 : 0);
        a2 = lift * 0.75 * (amp / 0.34);
        a3 = lift * 1.25 * (amp / 0.34) - a1 * 0.3;
        // Lying down: forelegs folded under the chest.
        a1 = a1 * (1 - lie) - 1.1 * lie;
        a2 = a2 * (1 - lie) + 2.5 * lie;
        a3 = a3 * (1 - lie) - 1.2 * lie;
      } else {
        // Hip swings; knee and hock flex through the swing.
        a1 = HIND0[0] + amp * sw;
        a2 = HIND0[1] + lift * 0.7 * (amp / 0.34);
        a3 = HIND0[2] - lift * 0.8 * (amp / 0.34);
        a1 = a1 * (1 - lie) - 1.5 * lie;
        a2 = a2 * (1 - lie) + 2.7 * lie;
        a3 = a3 * (1 - lie) - 0.9 * lie;
      }
      const half = isFront ? front : rear;
      const hipYo = (isFront ? L : hindY) - q.spineY;
      J.multiplyMatrices(half, compose(T, side * q.x, hipYo, isFront ? q.zF : q.zR, a1, 0, side * 0.03));
      this.put(`legU_${a.sp}`, J, a.color);
      J.multiply(compose(T, 0, -l1, 0, a2, 0, 0));
      this.put(`legL_${a.sp}`, J, a.color);
      J.multiply(compose(T, 0, -l2, 0, a3, 0, 0));
      this.put(`legP_${a.sp}`, J, a.color);
    }
  }

  private draw(dt = 0.016): void {
    for (const e of this.meshes.values()) e.n = 0;
    const lineArr = (this.leash.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    let lines = 0;
    for (const a of this.list) {
      if (!a.alive) continue;
      if (a.heldMode === 'carry') continue; // drawn in the islander's arms
      const rig = RIG[a.sp];
      if (a.sp !== 'chicken') {
        this.drawQuad(a, dt);
        this.leashLine(a, rig, lineArr, lines) && lines++;
        continue;
      }
      const moving = a.speed > 0.05;
      const fast = a.state === 'flee' || a.speed > 1;
      const ph = a.phase * (fast ? 16 : 8);
      let tilt = 0, drop = 0, headTilt = 0;
      const resting = a.state === 'rest';
      if (a.state === 'feed') {
        if (a.feed === 'peck') headTilt = Math.sin(a.phase * 14) > 0.2 ? 1.1 : 0.2;
        else if (a.feed === 'scratch') tilt = Math.sin(a.phase * 10) * 0.08;
        else if (a.feed === 'sniff') headTilt = 0.6 + Math.sin(a.phase * 6) * 0.2;
        else headTilt = 0.75 + Math.sin(a.phase * 1.7) * 0.1;
      }
      if (resting) drop = rig.legLen * 0.85;
      const bob = moving ? Math.abs(Math.sin(ph)) * 0.02 * a.scale : Math.sin(a.phase * 2) * 0.002;
      compose(_m, a.x, a.y + bob - drop * a.scale, a.z, tilt, a.heading, 0, a.scale);
      this.put(a.bodyKey, _m, a.color);
      // Head: pecks, grazes, turns to look.
      const [hx, hy, hz] = rig.head;
      _m2.multiplyMatrices(_m, compose(new THREE.Matrix4(), hx, hy, hz, headTilt, a.lookYaw, 0));
      this.put(a.headKey, _m2, a.color);
      // Legs.
      rig.legs.forEach(([lx, ly, lz], k) => {
        const sw = moving ? Math.sin(ph + (k % 2 ? Math.PI : 0) + (k > 1 ? Math.PI : 0)) * (fast ? 0.8 : 0.5) : 0;
        const fold = resting ? (a.sp === 'chicken' ? 1.4 : k < 2 ? -1.4 : 1.4) : 0;
        _m2.multiplyMatrices(_m, compose(new THREE.Matrix4(), lx, ly, lz, sw + fold, 0, 0));
        this.put(`leg_${a.sp}`, _m2, a.color);
      });
      if (rig.wings) {
        // Folded against the sides; spread and beating when running off or flapping up.
        const open = a.flap > 0 || a.state === 'flee' ? 1 : 0;
        a.wingOpen += (open - a.wingOpen) * 0.18;
        flapPose(a.phase * 38, 0.85, _fp, 0, 0.15);
        _fp.f1 += 0.25;
        mixPose(FOLDED, _fp, a.wingOpen, _wp);
        for (const side of [1, -1] as const) {
          wingMatrices(_m, side, [0.066, 0.118, 0.035], CHICKEN_WING, _wp, _wm);
          for (let k = 0; k < 3; k++) this.put(`wing_chicken${side === 1 ? k : k + 3}`, _wm[k], a.color);
        }
      }
      if (this.leashLine(a, rig, lineArr, lines)) lines++;
    }
    this.leash.geometry.setDrawRange(0, lines * 4);
    (this.leash.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    for (const e of this.meshes.values()) {
      e.mesh.count = e.n;
      if (e.n) {
        e.mesh.instanceMatrix.needsUpdate = true;
        e.acc.needsUpdate = true;
      }
    }
  }

  // ---------------- Save / load ----------------

  serialize(): number[][] {
    return this.list.map((a) => [a.alive ? 1 : 0, Math.round(a.x * 10) / 10, Math.round(a.z * 10) / 10, a.pen, Math.round(a.respawn)]);
  }

  restore(data: number[][], idMap: Map<number, number>): void {
    data.forEach((d, i) => {
      const a = this.list[i];
      if (!a) return;
      a.alive = d[0] === 1;
      a.x = d[1];
      a.z = d[2];
      a.pen = d[3] >= 0 ? idMap.get(d[3]) ?? -1 : -1;
      a.respawn = d[4];
      a.state = a.pen >= 0 ? 'penned' : 'idle';
      a.y = this.world.groundY(a.x, a.z);
      if (a.pen >= 0 && !this.pens.has(a.pen)) a.pen = -1;
    });
  }
}
