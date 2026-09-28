import * as THREE from 'three';
import { View } from '../render/View';
import { FAUNA, SPECIES, SpeciesDef, SpeciesKey, WARRIOR, WILDLIFE } from '../config';
import { Building } from '../buildings/Buildings';
import { peopleMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';
import * as models from './animalModels';
import { CHICKEN_WING, FOLDED, flapPose, mixPose, pose, wingMatrices, wingParts } from './birdWings';

/** Roaming radius of penned animals per pen building (anything else: 0.9, the butcher's pen). */
const PEN_RADIUS: Partial<Record<string, number>> = { farm: 0.36, butcher: 0.9, pigpen: 1.8, chickenpen: 1.7 };
/** A butcher also takes livestock from pig pens within this distance. */
const BUTCHER_REACH = 24;

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
  /** Smoothed drawing state (never saved; rebuilt when the animal comes back on screen). */
  anim: AnimState;
}

/** Per-animal pose state smoothed across frames so gaits, heads and lying down blend rather than snap. */
interface AnimState {
  /** Draw frame this was last posed on, and the position then (speed is measured from real movement). */
  frame: number;
  px: number;
  pz: number;
  /** Ground speed actually moved (smoothed), walking weight 0…1 and walk → trot weight 0…1. */
  v: number;
  move: number;
  run: number;
  /** Body pitch following the ground slope. */
  slope: number;
  /** Head-down weight (grazing, pecking), alertness, smoothed head yaw and roll. */
  graze: number;
  alert: number;
  hy: number;
  hr: number;
  /** Lying on the side weight (pigs, tapirs). */
  side: number;
  /** How far the fore / rear end sinks so stretched planted legs still reach the ground. */
  vF: number;
  vR: number;
  /** Instanced keys of this animal's front / rear body halves (quadrupeds). */
  kF: string;
  kR: string;
  /** Head joint in world space (the leash ties on here). */
  nx: number;
  ny: number;
  nz: number;
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

/**
 * Jointed quadruped skeletons: a spine joint mid-body (front and rear halves bend into turns, roll
 * with each footfall and flex at speed), a head (goats: on a two-joint neck), ears and tail, and
 * legs of three segments: hip/shoulder → knee/elbow → hock/wrist → foot, placed by two-bone IK so
 * planted hooves stay put on the ground while the body moves over them.
 */
type Quad = 'pig' | 'goat' | 'tapir';
interface QuadRig {
  spineY: number;
  /** Shoulder height above the ground (front leg length). */
  hipY: number;
  x: number;
  zF: number;
  zR: number;
  /** Head joint in the front half's frame (goats: the neck base). */
  head: [number, number, number];
  /** Goats: neck length and its pitch standing / grazing (the head hangs from its end). */
  neck: [number, number, number] | null;
  /** Head pitch relative to its parent, standing / grazing. */
  headPitch: [number, number];
  /** Forequarters dip this much while grazing. */
  frontGraze: number;
  /** Segment length ratios (upper, lower, foot) and radius. */
  seg: [number, number, number];
  r: number;
  hoof: number;
  foot: 'split' | 'toes';
  /** Distance covered per gait cycle walking / trotting (world units at scale 1). */
  stride: [number, number];
  /** Fraction of the cycle each foot is on the ground, walking / trotting. */
  duty: [number, number];
  /** Foot clearance in swing (fraction of leg length), walking / trotting. */
  lift: [number, number];
  /** Speeds over which the walk turns into a trot. */
  trot: [number, number];
  /** Body bob walking / trotting, roll with each step, head nod. */
  bob: [number, number];
  roll: number;
  nod: number;
  /** Spine height lying on the chest / sprawled on the side (0: never lies on its side). */
  restY: number;
  sideY: number;
  /** Ear root on the head (x mirrored), tail root on the rear half. */
  ear: [number, number, number];
  tail: [number, number, number] | null;
}
const QUAD: Record<Quad, QuadRig> = {
  pig: {
    spineY: 0.17, hipY: 0.12, x: 0.066, zF: 0.12, zR: -0.12, head: [0, 0.012, 0.2], neck: null, headPitch: [0.12, 1.15], frontGraze: 0.12,
    seg: [0.44, 0.34, 0.22], r: 0.03, hoof: 0x3a2a22, foot: 'split', stride: [0.17, 0.28], duty: [0.62, 0.45], lift: [0.2, 0.3], trot: [0.7, 1.25],
    bob: [0.004, 0.012], roll: 0.05, nod: 0.05, restY: 0.1, sideY: 0.125, ear: [0.046, 0.058, 0.02], tail: [0, 0.045, -0.21],
  },
  goat: {
    spineY: 0.26, hipY: 0.21, x: 0.048, zF: 0.12, zR: -0.13, head: [0, 0.035, 0.15], neck: [0.15, -0.6, 1.05], headPitch: [1.05, 0.6], frontGraze: 0.12,
    seg: [0.36, 0.3, 0.34], r: 0.02, hoof: 0x2a2018, foot: 'split', stride: [0.26, 0.45], duty: [0.64, 0.42], lift: [0.16, 0.3], trot: [0.7, 1.2],
    bob: [0.004, 0.014], roll: 0.04, nod: 0.07, restY: 0.115, sideY: 0, ear: [0.026, 0.024, 0.02], tail: [0, 0.05, -0.19],
  },
  tapir: {
    spineY: 0.35, hipY: 0.25, x: 0.11, zF: 0.24, zR: -0.24, head: [0, -0.01, 0.44], neck: null, headPitch: [0.3, 1.25], frontGraze: 0.1,
    seg: [0.4, 0.37, 0.23], r: 0.05, hoof: 0x1e1814, foot: 'toes', stride: [0.36, 0.6], duty: [0.65, 0.45], lift: [0.13, 0.25], trot: [0.8, 1.4],
    bob: [0.006, 0.016], roll: 0.035, nod: 0.05, restY: 0.2, sideY: 0.19, ear: [0.048, 0.078, 0.005], tail: null,
  },
};
/** Tapir proboscis root on the head. */
const TRUNK: [number, number, number] = [0, -0.02, 0.238];
/** Hind legs stand with the thigh forward, shin back and cannon upright; their hip sits a little lower. */
const HIND0 = [-0.32, 0.64, -0.32];
const hindHipY = (q: QuadRig) => q.hipY * (q.seg[0] * Math.cos(HIND0[0]) + q.seg[1] * Math.cos(HIND0[0] + HIND0[1]) + q.seg[2]);
/** Front legs stand very slightly flexed (a dead-straight leg has no give for the IK to work with). */
const FRONT_H = 0.993;
/** How much a planted cannon leans with the leg (fore, hind): forelegs swing almost as straight struts. */
const STRUT_F = 0.85, STRUT_H = 0.5;
/**
 * Gait phase offsets per leg (LF, RF, LH, RH): lateral-sequence walk and diagonal trot. The trot is
 * written so each leg's offset moves at most a quarter cycle from the walk, and the two blend smoothly.
 */
const WALK = [0.25, 0.75, 0, 0.5];
const TROT = [0.25, 0.75, -0.25, 0.25];
/** Leg joint angles when lying on the chest (legs tucked under) and sprawled on the side. */
const LIE_F = [0.9, -2.47, 2.95], LIE_H = [-1.5, 2.7, 0.4];
const SIDE_F = [-0.3, -0.25, 0.2], SIDE_H = [0.1, 0.35, -0.1];

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
// Scratch matrices for posing (reused every frame rather than allocated per animal).
const _front = new THREE.Matrix4(), _rear = new THREE.Matrix4(), _tmp = new THREE.Matrix4();
const _J = new THREE.Matrix4(), _T = new THREE.Matrix4(), _N = new THREE.Matrix4(), _H = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _offs = [0, 0, 0, 0];
const _B = new THREE.Matrix4();
/** Instanced part keys per quadruped (built once so posing never concatenates strings). */
const QKEYS: Record<Quad, { legU: string; legL: string; legP: string; ear: string; tail: string; neck: string }> = {
  pig: { legU: 'legU_pig', legL: 'legL_pig', legP: 'legP_pig', ear: 'ear_pig', tail: 'tail_pig', neck: 'neck_pig' },
  goat: { legU: 'legU_goat', legL: 'legL_goat', legP: 'legP_goat', ear: 'ear_goat', tail: 'tail_goat', neck: 'neck_goat' },
  tapir: { legU: 'legU_tapir', legL: 'legL_tapir', legP: 'legP_tapir', ear: 'ear_tapir', tail: 'tail_tapir', neck: 'neck_tapir' },
};
/** Chicken gait cycle distance walking / running (world units at scale 1). */
const CHICK_STRIDE: [number, number] = [0.13, 0.24];
const WING_ROOT: [number, number, number] = [0.066, 0.118, 0.035];
const WING_KEYS = [0, 1, 2, 3, 4, 5].map((k) => `wing_chicken${k}`);

function compose(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(s, s, s);
  return out.compose(_p, _q, _s);
}

/** Rotation (pitch, roll) about a pivot at height py, e.g. a chicken tipping forward over its hips. */
function pivot(out: THREE.Matrix4, py: number, rx: number, rz: number): THREE.Matrix4 {
  _e.set(rx, 0, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(0, py, 0).applyQuaternion(_q);
  _p.set(-_p.x, py - _p.y, -_p.z);
  _s.set(1, 1, 1);
  return out.compose(_p, _q, _s);
}

// ---------------- Small animation helpers (allocation free) ----------------

const TAU = Math.PI * 2;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0: number, e1: number, x: number) => {
  const t = sat((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const frac = (x: number) => x - Math.floor(x);
const hash = (n: number) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);
const approach = (cur: number, target: number, step: number) => (cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step));
/** Smooth value noise in [-1, 1]. */
function noise(t: number, seed: number): number {
  const n = Math.floor(t), f = t - n;
  return mix(hash(n + seed * 17.3), hash(n + 1 + seed * 17.3), f * f * (3 - 2 * f)) * 2 - 1;
}
/** A random value in [-1, 1] held for `period` seconds, then jumping to another (jerky bird glances). */
const held = (t: number, period: number, seed: number) => hash(Math.floor(t / period + hash(seed)) + seed * 13.7) * 2 - 1;
/** 0 → 1 → 0 pulse lasting `len` of each `period`, firing on a random `chance` of periods (ear flicks, tail swishes). */
function blip(t: number, period: number, len: number, chance: number, seed: number): number {
  const u = t / period + hash(seed), n = Math.floor(u), f = u - n;
  if (f > len || hash(n * 1.37 + seed * 7.1) > chance) return 0;
  return Math.sin((f / len) * Math.PI);
}

/** Per-frame smoothing: frame-rate independent, and snaps straight to the target on an animal's first posed frame. */
let _dt = 0, _snap = false;
const sm = (cur: number, target: number, rate: number) => (_snap ? target : cur + (target - cur) * (1 - Math.exp(-rate * _dt)));

/**
 * Foot travel through a gait cycle at phase p: in stance (p < duty) the foot slides back from +S/2 to
 * −S/2 at exactly the body's speed (S = duty × cycle distance), so it stays planted; in swing it lifts
 * and swings forward. Writes _fz (along the body), _fy (lift) and _sw (swing progress 0…1, −1 in stance).
 */
let _fz = 0, _fy = 0, _sw = -1;
function footPath(p: number, duty: number, stride: number, lift: number): void {
  if (p < duty) {
    _fz = stride * (0.5 - p / duty);
    _fy = 0;
    _sw = -1;
  } else {
    const u = (p - duty) / (1 - duty);
    _fz = stride * (u * u * (3 - 2 * u) - 0.5);
    _fy = lift * Math.sin(Math.PI * Math.min(1, u * 1.1));
    _sw = u;
  }
}

/**
 * Two-bone IK in a leg's sagittal plane: target (tz, ty) relative to the upper joint; angles are
 * about x (0 = hanging straight down, + = swung back). bend +1 puts the middle joint forward (hind
 * stifle), −1 backward (fore elbow, a bird's hock). Writes the upper angle to _a1 and the relative
 * middle-joint angle to _a2.
 */
let _a1 = 0, _a2 = 0;
function ik2(tz: number, ty: number, l1: number, l2: number, bend: number): void {
  const d = Math.min((l1 + l2) * 0.999, Math.max(Math.abs(l1 - l2) + 1e-4, Math.hypot(tz, ty)));
  const phi = Math.atan2(-tz, -ty);
  const alpha = Math.acos(THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const beta = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
  _a1 = phi - bend * alpha;
  _a2 = bend * (Math.PI - beta);
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
  private pens = new Map<number, { x: number; z: number; r: number; key: string }>();
  private leash: THREE.LineSegments;
  private time = 0;
  /** Counts draw calls so each animal can tell whether it was posed last frame. */
  private drawFrame = 0;
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
    add('neck_chicken', models.chickenNeck(), cap);
    // Three-piece legs: feathered drumstick, scaly shank, toes.
    const [cu, cl, cf] = models.chickenLegParts();
    add('legU_chicken', cu, cap * 2);
    add('legL_chicken', cl, cap * 2);
    add('foot_chicken', cf, cap * 2);
    // Quadrupeds: front / rear body halves (split at the spine joint) and three-segment legs.
    const halves = (key: string, h: [THREE.BufferGeometry, THREE.BufferGeometry], n: number) => {
      add(`${key}_F`, h[0], n);
      add(`${key}_R`, h[1], n);
    };
    halves('pig_plain', models.pigBodyHalves(false, QUAD.pig.spineY), cap);
    halves('pig_spotted', models.pigBodyHalves(true, QUAD.pig.spineY), cap);
    add('head_pig', models.pigHead(), cap);
    add('ear_pig', models.pigEar(), cap * 2);
    add('tail_pig', models.pigTail(), cap);
    halves('goat_plain', models.goatBodyHalves(false, QUAD.goat.spineY), cap);
    halves('goat_patched', models.goatBodyHalves(true, QUAD.goat.spineY), cap);
    add('head_straight', models.goatHead(false), cap);
    add('head_curly', models.goatHead(true), cap);
    add('neck_goat', models.goatNeck(), cap);
    add('ear_goat', models.goatEar(), cap * 2);
    add('tail_goat', models.goatTail(), cap);
    halves('tapir_plain', models.tapirBodyHalves(QUAD.tapir.spineY), 12);
    add('head_tapir', models.tapirHead(), 12);
    add('ear_tapir', models.tapirEar(), 24);
    add('trunk_tapir', models.tapirTrunk(), 12);
    for (const sp of ['pig', 'goat', 'tapir'] as Quad[]) {
      const q = QUAD[sp], L = q.hipY, n = sp === 'tapir' ? 48 : cap * 4;
      add(`legU_${sp}`, models.limbUpper(L * q.seg[0], q.r, q.r * 0.78), n);
      add(`legL_${sp}`, models.legSegment(L * q.seg[1], q.r * 0.72, q.r * 0.58), n);
      add(`legP_${sp}`, models.footSegment(L * q.seg[2], q.r * 0.6, q.hoof, q.foot), n);
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
      anim: { frame: -10, px: x, pz: z, v: 0, move: 0, run: 0, slope: 0, graze: 0, alert: 0, hy: 0, hr: 0, side: 0, vF: 0, vR: 0, kF: `${sp}_${v.body}_F`, kR: `${sp}_${v.body}_R`, nx: x, ny: 0, nz: z },
    };
  }

  // ---------------- Pens & capture API ----------------

  registerPen(b: Building): void {
    // A farm's chicken run is small, the butcher's pen roomier; the pig and chicken pens have a whole yard.
    const p = { x: b.penX, z: b.penZ, r: PEN_RADIUS[b.key] ?? 0.9, key: b.key as string };
    this.pens.set(b.id, p);
    // Animals already penned here (e.g. from a save made before the pen had a place) move into it.
    for (const a of this.list) {
      if (a.pen !== b.id || Math.hypot(a.x - p.x, a.z - p.z) <= p.r) continue;
      a.x = p.x + (this.rng.next() - 0.5) * p.r;
      a.z = p.z + (this.rng.next() - 0.5) * p.r;
      a.tx = a.x;
      a.tz = a.z;
    }
  }
  /** A pen whose building was moved: its animals follow it to the new spot. */
  movePen(b: Building): void {
    const p = this.pens.get(b.id);
    if (!p) return;
    const dx = b.penX - p.x, dz = b.penZ - p.z;
    p.x = b.penX;
    p.z = b.penZ;
    for (const a of this.list) if (a.pen === b.id) {
      a.x += dx;
      a.z += dz;
    }
  }
  releasePen(id: number): void {
    for (const a of this.list) if (a.pen === id) {
      a.pen = -1;
      a.state = 'flee';
      a.timer = 2;
    }
    this.pens.delete(id);
  }
  /** Pens a building's worker can take animals from: its own, and for a butcher any pig pen within reach (nearest first). */
  private sourcePens(b: Building): number[] {
    const ids = [b.id];
    if (b.key !== 'butcher') return ids;
    const near: [number, number][] = [];
    for (const [id, p] of this.pens) {
      if (p.key !== 'pigpen') continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d <= BUTCHER_REACH) near.push([id, d]);
    }
    near.sort((a, c) => a[1] - c[1]);
    return ids.concat(near.map((n) => n[0]));
  }
  penCount(b: Building): number {
    const ids = this.sourcePens(b);
    return this.list.filter((a) => a.alive && ids.includes(a.pen)).length;
  }
  takeFromPen(b: Building): boolean {
    for (const id of this.sourcePens(b)) {
      const a = this.list.find((x) => x.alive && x.pen === id);
      if (!a) continue;
      this.consume(a.id);
      return true;
    }
    return false;
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
      for (let gi = 0; gi < this.groups.length; gi++) {
        const g = this.groups[gi];
        // Group centre follows its members.
        let sx = 0, sz = 0, n = 0;
        for (const a of this.list) if (a.group === gi && a.alive && a.pen < 0 && !a.heldBy) {
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
    if (i < 0 || w.layer[i] < 1 || !Number.isNaN(w.riverY[i]) || w.blocked(i)) return false;
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

  /** Rope from the islander leading this animal to its head. */
  private leashLine(a: Animal, arr: Float32Array, lines: number): boolean {
    if (a.heldMode !== 'lead' || !a.heldBy || lines >= 64) return false;
    const l = a.heldBy, an = a.anim;
    const hx = l.x, hy = l.y + 0.25, hz = l.z;
    const mx = (hx + an.nx) / 2, my = (hy + an.ny) / 2 - 0.08, mz = (hz + an.nz) / 2;
    const o = lines * 12;
    arr[o] = hx; arr[o + 1] = hy; arr[o + 2] = hz;
    arr[o + 3] = mx; arr[o + 4] = my; arr[o + 5] = mz;
    arr[o + 6] = mx; arr[o + 7] = my; arr[o + 8] = mz;
    arr[o + 9] = an.nx; arr[o + 10] = an.ny; arr[o + 11] = an.nz;
    return true;
  }

  private put(key: string, m: THREE.Matrix4, col: THREE.Color): void {
    const e = this.meshes.get(key);
    if (!e || e.n >= e.mesh.instanceMatrix.count) return;
    e.mesh.setMatrixAt(e.n, m);
    e.acc.setXYZ(e.n, col.r, col.g, col.b);
    e.n++;
  }

  /** Put with an extra non-uniform scale in the part's own frame (breathing, fluffing up). */
  private putScaled(key: string, m: THREE.Matrix4, col: THREE.Color, sx: number, sy: number, sz: number): void {
    _B.copy(m).scale(_s.set(sx, sy, sz));
    this.put(key, _B, col);
  }

  /**
   * Measure how fast the animal really moves (so the legs match whatever moved it: wandering, fleeing,
   * being led, shuffling round a pen) and advance its gait by the distance covered, so planted feet
   * never skate. Also smooths the walk / trot weights and the turn rate. Returns the gait cycle
   * length in the animal's local units.
   */
  private track(a: Animal, dt: number, walkD: number, runD: number, trot0: number, trot1: number): number {
    const an = a.anim;
    _snap = an.frame !== this.drawFrame - 1;
    an.frame = this.drawFrame;
    _dt = Math.min(dt, 0.1);
    if (_snap) {
      an.v = a.state === 'walk' || a.state === 'flee' || a.state === 'avoid' || a.heldMode === 'lead' ? a.speed : 0;
      a.prevHeading = a.heading;
      a.turn = 0;
    } else if (dt > 0) {
      const d = Math.hypot(a.x - an.px, a.z - an.pz);
      if (d < 1) an.v = sm(an.v, Math.min(4, d / dt), 10);
    }
    an.px = a.x;
    an.pz = a.z;
    an.move = sm(an.move, smooth(0.03, 0.14, an.v), 8);
    an.run = sm(an.run, smooth(trot0, trot1, an.v), 5);
    let dh = a.heading - a.prevHeading;
    while (dh > Math.PI) dh -= TAU;
    while (dh < -Math.PI) dh += TAU;
    a.prevHeading = a.heading;
    if (_dt > 0) a.turn = sm(a.turn, THREE.MathUtils.clamp(dh / _dt, -4, 4), 6);
    // Longer strides at speed (and short shuffling ones when barely moving).
    const D = mix(walkD, runD, an.run) * (0.65 + 0.35 * sat(an.v / (trot0 * 0.65)));
    a.gait = frac(a.gait + (an.v * _dt) / (D * a.scale));
    return D;
  }

  /**
   * Pig, goat or tapir. The body rides on its legs: it bobs, rolls and sways with each footfall,
   * bends into turns, flexes at the trot and pitches with the slope; hooves are placed by IK
   * (planted in stance, lifted and folded in swing). Head, ears and tail add grazing, looking round,
   * ear flicks and tail swishes; lying down kneels in front first, and pigs and tapirs sprawl on their side.
   */
  private drawQuad(a: Animal, dt: number): void {
    const sp = a.sp as Quad, q = QUAD[sp], an = a.anim, s = a.scale, def = SPECIES[a.sp], K = QKEYS[sp];
    const t = this.time * a.tempo + a.id * 3.7;
    const D = this.track(a, dt, q.stride[0], q.stride[1], q.trot[0], q.trot[1]);
    const move = an.move, run = an.run, g = a.gait;
    const L = q.hipY, l1 = L * q.seg[0], l2 = L * q.seg[1], l3 = L * q.seg[2];

    // --- Lying down: the forequarters kneel first and the rear follows; getting up, the rear rises first.
    const resting = a.state === 'rest', still = an.v < 0.05;
    const sprawler = q.sideY > 0 && a.id % 3 !== 0;
    an.side = sm(an.side, resting && still && sprawler && a.lie > 0.97 ? 1 : 0, still ? 1.2 : 6);
    const lieGoal = (resting || an.side > 0.08) && still ? 1 : 0;
    a.lie = _snap ? lieGoal : approach(a.lie, lieGoal, _dt / (still ? 1.3 : 0.4));
    const lieF = smooth(0, 0.62, a.lie), lieR = smooth(0.38, 1, a.lie), side = an.side;
    const dF = lieF * (q.spineY - q.restY), dR = lieR * (q.spineY - q.restY);
    const liePitch = Math.atan2(dF - dR, q.zF - q.zR);
    const up = 1 - lieF;

    // --- Ground slope under the fore and hind feet.
    const sh = Math.sin(a.heading), ch = Math.cos(a.heading);
    const gF = this.world.groundY(a.x + sh * q.zF * s, a.z + ch * q.zF * s);
    const gR = this.world.groundY(a.x + sh * q.zR * s, a.z + ch * q.zR * s);
    an.slope = sm(an.slope, THREE.MathUtils.clamp(Math.atan2(gR - gF, (q.zF - q.zR) * s), -0.45, 0.45), 8);

    // --- Body motion tied to the footfalls (walk and trot phase offsets blend with the trot weight).
    const duty = mix(q.duty[0], q.duty[1], run);
    for (let k = 0; k < 4; k++) _offs[k] = mix(WALK[k], TROT[k], run);
    const mLF = TAU * (g + _offs[0] - duty / 2), mLH = TAU * (g + _offs[2] - duty / 2);
    // Walking vaults over each stance leg (highest mid-stance); trotting compresses into it.
    const bob = move * mix(q.bob[0] * Math.cos(2 * mLH), -q.bob[1] * Math.cos(2 * mLF), run);
    const stepRoll = move * q.roll * (1 - 0.6 * run);
    let rollR = stepRoll * Math.cos(mLH);
    const rollF = 0.6 * stepRoll * Math.cos(mLF);
    const sway = move * q.roll * 0.7 * (1 - 0.5 * run) * Math.sin(mLH);
    const flex = move * run * 0.06 * Math.sin(2 * mLF);
    const nod = move * q.nod * (1 - 0.4 * run) * Math.cos(2 * mLF + 1.2);
    const bend = THREE.MathUtils.clamp(a.turn * 0.11, -0.32, 0.32) * up;

    // --- Attention: grazing with the head down (looking up now and then), looking round, watching a threat.
    const feeding = a.state === 'feed';
    an.alert = sm(an.alert, a.state === 'alert' || a.state === 'avoid' ? 1 : 0, 5);
    const alert = an.alert;
    const lookUp = feeding ? blip(t, 6.5, 0.3, 0.55, a.id) : 0;
    an.graze = sm(an.graze, (feeding ? (a.feed === 'sniff' ? 0.72 : 1) * (1 - 0.85 * lookUp) : 0) * up, 3);
    const gz = an.graze;
    const idle = (1 - move) * (1 - gz) * (1 - alert);
    an.hy = sm(an.hy, (a.lookYaw + idle * noise(t * 0.3, a.id) * 0.75) * (1 - side), 3.5);
    const bite = feeding && a.feed !== 'sniff' ? blip(t, 1.7, 0.28, 0.7, a.id + 2) * gz : 0;
    const chew = Math.sin(t * 8.5) * (feeding ? gz : 0);
    // Goats chew the cud: side-to-side grinding with the head up, standing or lying.
    const ruminate = sp === 'goat' ? Math.max(feeding ? 1 - gz : 0, resting ? lieF * blip(t, 9, 0.6, 0.8, a.id + 4) : 0) : 0;

    // --- Idle goats and tapirs now and then rest a hind leg: hoof tipped, that hip dropped.
    let cock = -1, cw = 0;
    if (sp !== 'pig') {
      const u = t / 9 + hash(a.id + 1), n = Math.floor(u), f = u - n;
      if (hash(n + a.id * 3.3) < 0.6) {
        cw = smooth(0.1, 0.25, f) * (1 - smooth(0.75, 0.9, f)) * idle * up;
        cock = hash(n * 2.1 + a.id) > 0.5 ? 2 : 3;
        rollR += cw * (cock === 2 ? -0.05 : 0.05);
      }
    }

    // --- Vaulting: wherever a planted leg is stretched fore or aft the body sinks a little over it (twice
    // per stride, like a real walk), so hooves never hover at the ends of their stance.
    const frontPitch = q.frontGraze * gz + bite * 0.03;
    const fP = frontPitch + flex, rP = -flex;
    const strideL = duty * D, liftL = L * mix(q.lift[0], q.lift[1], run);
    const hindY = hindHipY(q), neutralH = (l1 - l2) * Math.sin(-HIND0[0]);
    let y0 = a.y + (q.spineY - (dF + dR) / 2 + side * (q.sideY - q.restY) + bob) * s;
    let vF = 0, vR = 0;
    if (move > 0.01 && up > 0.01) {
      const reach2 = (l1 + l2) * 0.985;
      for (let k = 0; k < 4; k++) {
        const ph = frac(g + _offs[k]);
        if (ph >= duty) continue;
        const isF = k < 2;
        footPath(ph, duty, strideL, liftL);
        const P = an.slope + liePitch + (isF ? fP : rP);
        const hipYo = (isF ? L * FRONT_H : hindY) - q.spineY, hipZ = isF ? q.zF : q.zR;
        const cP = Math.cos(P), sP = Math.sin(P);
        const above = hipYo * cP - hipZ * sP - ((isF ? gF : gR) - y0) / s;
        const dz = hipZ - (hipYo * sP + hipZ * cP) + (isF ? 0 : neutralH) + _fz * move;
        const th3 = Math.atan2(-dz, above) * (isF ? STRUT_F : STRUT_H);
        const wz = dz + l3 * Math.sin(th3);
        const reach = l3 * Math.cos(th3) + (Math.abs(wz) < reach2 ? Math.sqrt(reach2 * reach2 - wz * wz) : 0);
        const u = ph / duty, w = smooth(0, 0.12, u) * smooth(0, 0.12, 1 - u);
        const d = Math.max(0, above - reach) * w * up;
        if (isF) vF = Math.max(vF, d);
        else vR = Math.max(vR, d);
      }
    }
    an.vF = sm(an.vF, vF, 30);
    an.vR = sm(an.vR, vR, 30);
    y0 -= ((an.vF + an.vR) / 2) * s;

    // --- Body halves.
    const bodyPitch = an.slope + liePitch + Math.atan2(an.vF - an.vR, q.zF - q.zR);
    const pant = 1 - a.stamina / def.stamina;
    const breath = Math.sin(t * mix(2.2, 7, pant) * (resting ? 0.7 : 1)) * mix(0.012, 0.025, pant) * (1 - move * 0.6);
    const sideDir = a.id % 2 ? 1 : -1;
    compose(_m, a.x, y0, a.z, bodyPitch, a.heading, side * sideDir * 1.35, s);
    _front.multiplyMatrices(_m, compose(_tmp, 0, 0, 0, fP, bend * 0.5 + sway * 0.3, rollF));
    _rear.multiplyMatrices(_m, compose(_tmp, 0, 0, 0, rP, -bend * 0.5 - sway, rollR));
    this.putScaled(an.kF, _front, a.color, 1 + breath, 1 + breath, 1 + breath * 0.3);
    this.put(an.kR, _rear, a.color);

    // --- Neck and head (partly cancelling the body's pitch, so the head stays level on slopes).
    const parentPitch = bodyPitch + fP;
    const [hx, hy, hz] = q.head;
    let yaw = an.hy + bend * 0.5;
    if (feeding && a.feed === 'sniff') yaw += Math.sin(t * 4.3) * 0.2 * gz;
    const headRoll = ruminate * Math.sin(t * 5.5) * 0.06;
    if (q.neck) {
      const [nl, n0, n1] = q.neck;
      let np = mix(n0, n1, gz) + nod * 0.8 - alert * 0.25 + run * move * 0.28 - parentPitch * 0.7;
      np = mix(np, -0.45 - parentPitch, lieF);
      _N.multiplyMatrices(_front, compose(_tmp, hx, hy, hz, np, yaw * 0.5, 0));
      this.put(K.neck, _N, a.color);
      let hp = mix(q.headPitch[0], q.headPitch[1], gz) + nod * 0.4 - alert * 0.15 - bite * 0.3 + chew * 0.025 - run * move * 0.2;
      hp = mix(hp, 0.95, lieF);
      _H.multiplyMatrices(_N, compose(_tmp, 0, 0, nl, hp, yaw * 0.5, headRoll));
    } else {
      let hp = mix(q.headPitch[0], q.headPitch[1], gz) + nod - alert * 0.35 - run * move * 0.15 - bite * 0.2 + chew * 0.02 - parentPitch * 0.8;
      if (feeding && a.feed === 'sniff') hp += Math.sin(t * 11) * 0.06 * gz;
      if (feeding && a.feed === 'drink') hp += (0.1 + Math.sin(t * 6) * 0.04) * gz;
      // Resting: chin down near the ground (sprawled on the side the head just lies flat with the body).
      hp = mix(hp, 0.35 - parentPitch, lieF * (1 - side));
      _H.multiplyMatrices(_front, compose(_tmp, hx, hy, hz, hp, yaw, headRoll));
    }
    this.put(a.headKey, _H, a.color);
    an.nx = _H.elements[12];
    an.ny = _H.elements[13];
    an.nz = _H.elements[14];

    // --- Ears: flop with each step (lagging the head), flick at flies, prick up when alert, lie back at a run.
    const [ex, ey, ez] = q.ear;
    const fast = run * move;
    for (let e = 0; e < 2; e++) {
      const sd = e === 0 ? 1 : -1;
      const shake = blip(t, 3.2, 0.09, 0.35, a.id * 1.3 + e * 0.47) * Math.sin(t * 38);
      let rx: number, ry: number, rz: number;
      if (sp === 'pig') {
        rx = 0.9 - alert * 0.45 + fast * 0.25 + move * 0.2 * Math.cos(2 * mLF + 0.1) + gz * 0.2;
        ry = sd * 0.35;
        rz = -sd * (0.55 + shake * 0.35 + fast * 0.2);
      } else if (sp === 'goat') {
        rx = 0.25;
        ry = sd * (0.15 - alert * 0.3 + fast * 0.6);
        rz = -sd * (1.4 - alert * 0.35 + shake * 0.4 + move * 0.08 * Math.cos(2 * mLF));
      } else {
        rx = -0.1 + fast * 0.4;
        ry = sd * (0.35 + noise(t * 0.45, a.id + e * 5) * 0.6 * (1 - alert));
        rz = -sd * (0.35 + shake * 0.25);
      }
      _J.multiplyMatrices(_H, compose(_tmp, sd * ex, ey, ez, rx, ry, rz));
      this.put(K.ear, _J, a.color);
    }
    if (sp === 'tapir') {
      // The proboscis never stops: sniffing, curling down to the forage, lifting to test the air.
      const tp = 0.2 + gz * 0.55 + Math.sin(t * 3.1) * 0.1 + noise(t * 0.8, a.id + 2) * 0.15 + lieF * 0.3 - alert * 0.3 + (feeding && a.feed === 'drink' ? 0.2 : 0);
      _J.multiplyMatrices(_H, compose(_tmp, TRUNK[0], TRUNK[1], TRUNK[2], tp, noise(t * 0.6, a.id + 6) * 0.25, 0));
      this.put('trunk_tapir', _J, a.color);
    }

    // --- Tail: swishes with the gait and at flies; raised when alarmed or running.
    if (q.tail) {
      const tf = blip(t, 4.5, 0.12, 0.45, a.id + 3);
      let tp: number, ty: number;
      if (sp === 'pig') {
        ty = move * 0.4 * Math.sin(2 * mLH) + idle * noise(t * 1.3, a.id + 8) * 0.5 + tf * Math.sin(t * 30) * 0.45;
        tp = -fast * 0.5 + lieF * 0.3;
      } else {
        tp = -0.25 * alert - fast * 0.35 + tf * Math.sin(t * 32) * 0.45 + lieF * 0.4;
        ty = tf * Math.sin(t * 27) * 0.35 + move * 0.12 * Math.sin(2 * mLH);
      }
      _J.multiplyMatrices(_rear, compose(_tmp, q.tail[0], q.tail[1], q.tail[2], tp, ty, 0));
      this.put(K.tail, _J, a.color);
    }

    // --- Legs (two-bone IK to the hoof; the cannon is angled separately and folds in swing).
    const foldK = move * (0.75 + 0.25 * run);
    for (let k = 0; k < 4; k++) {
      const isF = k < 2, sd = k % 2 === 0 ? 1 : -1;
      const P = bodyPitch + (isF ? fP : rP), cP = Math.cos(P), sP = Math.sin(P);
      const hipYo = (isF ? L * FRONT_H : hindY) - q.spineY, hipZ = isF ? q.zF : q.zR;
      // Foot target relative to the hip in the unpitched body frame: on the ground however the body bobs,
      // and anchored to the body (not the pitching hip) so spine flex and vaulting don't drag planted feet.
      footPath(frac(g + _offs[k]), duty, strideL, liftL);
      const ground = ((isF ? gF : gR) - y0) / s;
      let dz = hipZ - (hipYo * sP + hipZ * cP) + (isF ? 0 : neutralH) + _fz * move;
      let dy = ground + _fy * move - (hipYo * cP - hipZ * sP);
      let th3 = Math.atan2(-dz, -dy) * (isF ? STRUT_F : STRUT_H);
      if (_sw >= 0) th3 += (isF ? 1.35 * Math.sin(Math.PI * sat(_sw * 1.15)) : 0.7 * Math.sin(Math.PI * _sw)) * foldK;
      if (k === cock) {
        dy += 0.07 * L * cw;
        dz += 0.04 * L * cw;
        th3 += 0.6 * cw;
      }
      // Into the half's own pitched frame, then solve for the wrist / hock above the hoof.
      const tz = -dy * sP + dz * cP, ty = dy * cP + dz * sP, t3 = th3 - P;
      ik2(tz + l3 * Math.sin(t3), ty + l3 * Math.cos(t3), l1, l2, isF ? -1 : 1);
      let a1 = _a1, a2 = _a2, a3 = t3 - _a1 - _a2;
      const lw = isF ? lieF : lieR, lp = isF ? LIE_F : LIE_H, spp = isF ? SIDE_F : SIDE_H;
      if (lw > 0) {
        a1 = mix(a1, lp[0], lw);
        a2 = mix(a2, lp[1], lw);
        a3 = mix(a3, lp[2], lw);
      }
      if (side > 0) {
        a1 = mix(a1, spp[0], side);
        a2 = mix(a2, spp[1], side);
        a3 = mix(a3, spp[2], side);
      }
      _J.multiplyMatrices(isF ? _front : _rear, compose(_T, sd * q.x, hipYo, hipZ, a1, 0, sd * 0.03));
      this.put(K.legU, _J, a.color);
      _J.multiply(compose(_T, 0, -l1, 0, a2, 0, 0));
      this.put(K.legL, _J, a.color);
      _J.multiply(compose(_T, 0, -l2, 0, a3, 0, 0));
      this.put(K.legP, _J, a.color);
    }
  }

  /**
   * Chicken: waddles over its stance foot with the head held still in space and then thrust forward
   * each step; pecks in quick bursts, rakes the ground with alternate feet, glances about in jerky
   * saccades cocking its head, sits fluffed up to rest, flaps when hurrying (and the rooster crows).
   */
  private drawChicken(a: Animal, dt: number): void {
    const an = a.anim, s = a.scale, CH = models.CHICKEN;
    const t = this.time * a.tempo + a.id * 3.7;
    const D = this.track(a, dt, CHICK_STRIDE[0], CHICK_STRIDE[1], 0.75, 1.35);
    const move = an.move, run = an.run, g = a.gait;
    const duty = mix(0.6, 0.42, run);
    const resting = a.state === 'rest', still = an.v < 0.05;
    a.lie = _snap ? (resting && still ? 1 : 0) : approach(a.lie, resting && still ? 1 : 0, _dt / (still ? 0.6 : 0.2));
    const lie = smooth(0, 1, a.lie);
    const feeding = a.state === 'feed', scratching = feeding && a.feed === 'scratch';
    an.alert = sm(an.alert, a.state === 'alert' || a.state === 'avoid' ? 1 : 0, 6);
    const alert = an.alert;

    // Pecking: bursts of quick jabs at the ground, then the head comes up for a look round.
    let down = 0, strike = 0, rake = -1, rw = 0;
    if (scratching) {
      // Rake back with one foot, then the other, then look down and peck at what turned up.
      const u = frac(t / 1.4 + hash(a.id));
      if (u < 0.5) {
        rake = u < 0.25 ? 0 : 1;
        rw = frac(u * 4);
        down = 0.55;
      } else {
        down = 0.95;
        const pu = (u - 0.5) / 0.5;
        strike = pu > 0.35 && pu < 0.6 ? Math.sin(((pu - 0.35) / 0.25) * Math.PI) : 0;
      }
    } else if (feeding) {
      const u = frac(t / 1.8 + hash(a.id));
      if (u < 0.6) {
        down = 1;
        const pu = frac((u / 0.6) * 3);
        strike = pu < 0.38 ? Math.sin((pu / 0.38) * Math.PI) : 0;
      } else down = 0.2;
    }
    an.graze = sm(an.graze, down * (1 - lie), 9);
    const dw = an.graze;
    strike *= dw;
    const idle = (1 - move) * (1 - dw);
    const crow = a.headKey === 'head_rooster' ? blip(t, 23, 0.08, 0.5, a.id + 21) * idle * (1 - lie) : 0;

    // Body: waddles over the stance foot, bobs each step, tips forward over the hips to peck or run.
    const mid = TAU * (g - duty / 2);
    const bob = move * mix(0.004 * Math.cos(2 * mid), -0.006 * Math.cos(2 * mid), run) + (1 - move) * Math.sin(t * 2.3) * 0.0012 * (1 - lie);
    const pitch = mix(-0.04, 0.45, dw) + move * 0.08 + run * move * 0.2 - alert * 0.08 + lie * 0.05 + (scratching ? 0.1 : 0) - crow * 0.2;
    const roll = -move * 0.075 * (1 - 0.5 * run) * Math.cos(mid) + (rake < 0 ? 0 : rake === 0 ? 0.06 : -0.06);
    const drop = lie * 0.034 + dw * 0.006 - alert * 0.004;
    compose(_m, a.x, a.y + (bob - drop) * s, a.z, 0, a.heading, 0, s);
    _front.multiplyMatrices(_m, pivot(_tmp, CH.hipY, pitch, roll));
    const fluff = 1 + Math.sin(t * 2.3) * 0.012 * (1 - move) + lie * 0.05;
    this.putScaled(a.bodyKey, _front, a.color, fluff, fluff, 1 + lie * 0.03);

    // Neck and head: the head stays put in the world while the body walks under it, then darts forward.
    const stepU = frac(2 * g + 0.15), hold = 0.72;
    const hs = stepU < hold ? 0.5 - stepU / hold : smooth(hold, 1, stepU) - 0.5;
    const stab = (hs * Math.min(0.028, hold * D * 0.5) * move * (1 - run) * (1 - dw)) / CH.neck;
    const neckP = mix(0.12, 1.25, dw) + strike * 0.6 + run * move * 0.55 + stab - alert * 0.2 - lie * 0.3 - crow * 0.35 - pitch * (1 - dw) * 0.8;
    const headW = mix(0, 1.75, dw) + strike * 0.15 - crow * 0.7 + lie * 0.15;
    const glance = held(t, 0.55 + hash(a.id) * 0.5, a.id) * 0.9 * idle * (1 - lie * 0.5);
    an.hy = sm(an.hy, a.lookYaw + glance, 16);
    an.hr = sm(an.hr, held(t, 0.9, a.id + 5) * 0.35 * idle, 12);
    _N.multiplyMatrices(_front, compose(_tmp, 0, CH.neckY, CH.neckZ, neckP, an.hy * 0.8, 0));
    this.put('neck_chicken', _N, a.color);
    _H.multiplyMatrices(_N, compose(_tmp, 0, CH.neck, 0, headW - pitch - neckP, an.hy * 0.2, an.hr));
    this.put(a.headKey, _H, a.color);
    an.nx = _H.elements[12];
    an.ny = _H.elements[13];
    an.nz = _H.elements[14];

    // Legs: hip → hock (bending backward) → ankle by IK; toes flat on the ground, curled in swing.
    const strideL = duty * D, liftL = mix(0.012, 0.02, run);
    const cP = Math.cos(pitch), sP = Math.sin(pitch);
    const hipH = CH.hipY + bob - drop;
    for (let k = 0; k < 2; k++) {
      footPath(frac(g + k * 0.5), duty, strideL, liftL);
      let dz = _fz * move, lift = _fy * move, curl = _sw >= 0 ? Math.sin(Math.PI * _sw) * move : 0;
      if (k === rake) {
        if (rw < 0.3) {
          const f = rw / 0.3;
          dz = 0.016 * f;
          lift = 0.012 * Math.sin(f * Math.PI * 0.5);
          curl = f;
        } else if (rw < 0.75) {
          const f = (rw - 0.3) / 0.45;
          dz = mix(0.016, -0.035, f);
          lift = 0.012 * (1 - sat(f * 3));
          curl = 1 - sat(f * 3);
        } else {
          const f = (rw - 0.75) / 0.25;
          dz = mix(-0.035, 0, f);
          lift = 0.008 * Math.sin(f * Math.PI);
          curl = Math.sin(f * Math.PI);
        }
      }
      const dy = CH.ankle + lift - hipH;
      ik2(-dy * sP + dz * cP, dy * cP + dz * sP, CH.thigh, CH.shank, -1);
      _J.multiplyMatrices(_front, compose(_T, (k === 0 ? 1 : -1) * CH.hipX, CH.hipY, 0, _a1, 0, 0));
      this.put('legU_chicken', _J, a.color);
      _J.multiply(compose(_T, 0, -CH.thigh, 0, _a2, 0, 0));
      this.put('legL_chicken', _J, a.color);
      _J.multiply(compose(_T, 0, -CH.shank, 0, 0.9 * curl - pitch - _a1 - _a2, 0, 0));
      this.put('foot_chicken', _J, a.color);
    }

    // Wings: folded against the sides; beating when it runs off or flaps up, half out when hurrying,
    // and a quick stretch-and-flap now and then while standing about.
    const idleFlap = blip(t, 17, 0.05, 0.35, a.id + 11) * idle * (1 - lie);
    const open = a.flap > 0 || a.state === 'flee' ? 1 : Math.max(run * move * 0.35, idleFlap > 0.05 ? 0.9 : 0, crow * 0.5);
    a.wingOpen = sm(a.wingOpen, open, 10);
    flapPose(t * 38, 0.85, _fp, 0, 0.15);
    _fp.f1 += 0.25;
    mixPose(FOLDED, _fp, a.wingOpen, _wp);
    for (let e = 0; e < 2; e++) {
      wingMatrices(_front, e === 0 ? 1 : -1, WING_ROOT, CHICKEN_WING, _wp, _wm);
      for (let k = 0; k < 3; k++) this.put(WING_KEYS[e * 3 + k], _wm[k], a.color);
    }
  }

  private draw(dt = 0.016): void {
    this.drawFrame++;
    for (const e of this.meshes.values()) e.n = 0;
    const lineArr = (this.leash.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    let lines = 0;
    for (const a of this.list) {
      if (!a.alive) continue;
      if (a.heldMode === 'carry') continue; // drawn in the islander's arms
      // Off screen: no limbs to pose (it keeps living; the pose picks up again when seen).
      if (!View.sees(a.x, a.y + 0.2 * a.scale, a.z, 0.5 * a.scale + 0.2)) continue;
      if (a.sp === 'chicken') this.drawChicken(a, dt);
      else this.drawQuad(a, dt);
      if (this.leashLine(a, lineArr, lines)) lines++;
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
