import * as THREE from 'three';
import type { Where } from '../ui/where';
import { View } from '../render/View';
import { FAUNA } from '../config';
import { peopleMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';
import * as models from './animalModels';
import { GeoBuilder, M, P, facet } from '../render/GeoBuilder';

/** Monkey ids are offset so the colony's hunting hooks can tell them from land animals. */
export const MONKEY_BASE = 1_000_000;

/** A village raid: down the trunk, across the ground to the food store, and back up a tree. */
interface Raid {
  stage: 'down' | 'run' | 'steal' | 'flee' | 'up';
  tx: number;
  tz: number;
  store: number;
  carry: number;
  scared: boolean;
}

export interface MonkeyHooks {
  /** Food stores monkeys raid (complete buildings holding food). */
  targets: () => { id: number; x: number; z: number }[];
  /** Take food from the stores; returns what was stolen. */
  steal: (n: number) => { res: string; n: number } | null;
  day: () => boolean;
  notify: (msg: string, at?: Where) => void;
  /** People monkeys keep clear of on the ground (warriors). */
  guards: () => { x: number; z: number }[];
}

/** A canopy tree monkeys can use: base position plus canopy height and radius. */
export interface CanopyTree {
  id: number;
  x: number;
  y: number;
  z: number;
  mid: number;
  top: number;
  r: number;
}

type MState = 'sit' | 'walk' | 'climb' | 'hang' | 'crouch' | 'jump' | 'land' | 'eat' | 'watch' | 'run' | 'steal';

interface Monkey {
  id: number;
  dead: boolean;
  deadFor: number;
  raid: Raid | null;
  chasedBy: Islander | null;
  group: number;
  tree: number;
  /** Current spot on the tree: angle around the trunk, radial fraction, height fraction (0 trunk base → 1 canopy top). */
  a: number;
  rf: number;
  hf: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  state: MState;
  timer: number;
  /** Move / jump from → to. */
  from: THREE.Vector3;
  to: THREE.Vector3;
  toTree: number;
  toA: number;
  toRf: number;
  toHf: number;
  t: number;
  dur: number;
  phase: number;
  look: number;
  scale: number;
  lod: number;
  // ---- Drawing only ----
  /** Current joint pose, the pose captured at the last state change, and the blend between them. */
  pose: Float32Array;
  snap: Float32Array;
  blend: number;
  last: MState | '';
  /** Smoothed facing, ground gait cycle and last drawn position (for stride-locked steps). */
  dyaw: number;
  gait: number;
  px: number;
  pz: number;
  /** Which way it hangs this time: by hands and tail, or upside down by the tail alone. */
  hangVar: number;
}

interface Troop {
  tree: number;
  timer: number;
  home: number;
}

const _b = new THREE.Matrix4();
const _C = new THREE.Matrix4();
const _J = new THREE.Matrix4();
const _T = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const TAU = Math.PI * 2;
/** Segment lengths: upper arm, forearm; thigh, shin; hand and foot. Spider monkeys are all arms. */
const ARM = [0.088, 0.082];
const LEG = [0.074, 0.07];
const HAND = 0.034, FOOT = 0.034;
/** Skeleton (pelvis frame): waist joint height, shoulder height above the waist, hip joints, tail base. */
const WAIST = 0.08, SHOULDER = 0.07, SH_X = 0.052, HIP_X = 0.035, HIP_Y = 0.03, HIP_Z = 0.01;
/** Prehensile tail: pieces, first piece length and the taper from piece to piece. */
const TAIL_N = 7, TAIL_SEG = 0.058, TAIL_TAPER = 0.9;
/** Brachiation: distance per hand-over-hand swing, and shoulder-to-wrist reach while hanging. */
const BR_STEP = 0.28, BR_REACH = 0.16;
/** Trunk climbing: height gained per full cycle of all four limbs. */
const CLIMB_STEP = 0.2;
/** Ground bounding gait: distance per stride, and the duty factor. */
const RUN_STRIDE = 0.42, RUN_DUTY = 0.42;
/** Seconds to blend from one state's pose into the next, and between idle fidget choices. */
const BLEND_T = 0.3, IDLE_WINDOW = 4.5;

// Pose channels (see Monkeys.target): root offset, orientation, waist, head, arms, legs, tail.
const OX = 0, OY = 1, OZ = 2, PITCH = 3, ROLL = 4, YAW = 5, WX = 6, WY = 7, WZ = 8, HX = 9, HY = 10, HZ = 11;
const AL = 12, ALZ = 13, EL = 14, WRL = 15, AR = 16, ARZ = 17, ER = 18, WRR = 19;
const LL = 20, LLZ = 21, KL = 22, ANL = 23, LR = 24, LRZ = 25, KR = 26, ANR = 27;
const TP = 28, TY = 29, TC = 30, TCY = 31, TT = 32, TW = 33;
const NP = 34;
const _tgt = new Float32Array(NP);
const _ik = [0, 0];

/** Two-bone IK in the sagittal plane (0 = hanging down, + swings back); sign +1 elbow back, -1 knee forward. */
function ik2(hy: number, hz: number, ty: number, tz: number, l1: number, l2: number, sign: number): void {
  const dy = ty - hy, dz = tz - hz;
  const line = Math.atan2(-dz, -dy);
  const d = Math.min((l1 + l2) * 0.999, Math.max(Math.abs(l1 - l2) + 1e-4, Math.hypot(dy, dz)));
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const t1 = line + sign * a;
  const ey = hy - l1 * Math.cos(t1), ez = hz - l1 * Math.sin(t1);
  _ik[0] = t1;
  _ik[1] = Math.atan2(-(hz - d * Math.sin(line) - ez), -(hy - d * Math.cos(line) - ey));
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const env = (u: number, a: number, b: number, r = 0.4) => smooth(a, a + r, u) * (1 - smooth(b - r, b, u));
const hash = (a: number, b: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** One instanced part and how many instances are filled this frame. */
interface Part {
  mesh: THREE.InstancedMesh;
  n: number;
}

/** Climbing limb target for cycle position c: gripping (sliding down relative to the body as it rises) then reaching. */
/** Blend pose channel i toward v by e. */
const mixIn = (o: Float32Array, i: number, v: number, e: number) => (o[i] += (v - o[i]) * e);

let _ly = 0, _lz = 0;
function climbLimb(c: number, top: number): void {
  const u = ((c % 1) + 1) % 1, span = 0.55 * CLIMB_STEP;
  if (u < 0.55) {
    _ly = top - (u / 0.55) * span;
    _lz = 0;
  } else {
    const v = (u - 0.55) / 0.45;
    _ly = top - span + span * smooth(0, 1, v);
    _lz = -0.035 * Math.sin(Math.PI * v);
  }
}

function local(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
}

/**
 * Spider monkeys living in the canopy: sitting, walking along branches, climbing trunks,
 * hanging and swinging, and leaping between trees that are close enough to reach.
 * Troops of 2–5 move together loosely, never in lockstep.
 */
export class Monkeys {
  readonly group = new THREE.Group();
  list: Monkey[] = [];
  private trees: CanopyTree[] = [];
  private links: number[][] = [];
  private troops: Troop[] = [];
  private rng: RNG;
  private meshes: Record<string, THREE.InstancedMesh> = {};
  private parts: Record<string, Part> = {};
  private partList: Part[] = [];
  private time = 0;
  private frame = 0;
  private raidTimer = 0;

  /** Where a raiding monkey is now (for notifications that take the camera there). */
  private raider(): { x: number; z: number } | null {
    const m = this.list.find((q) => q.raid && !q.dead);
    return m ? { x: m.x, z: m.z } : null;
  }
  private warned = -999;
  private lastTheft = -999;
  hooks: MonkeyHooks = { targets: () => [], steal: () => null, day: () => true, notify: () => {}, guards: () => [] };

  constructor(private world: World, trees: CanopyTree[], private treeAlive: (id: number) => boolean) {
    this.rng = new RNG(world.seed * 173 + 3);
    this.trees = trees;
    this.link();
    this.spawn();
    const mat = peopleMaterial();
    const mk = (key: string, g: THREE.BufferGeometry, n: number) => {
      const m = new THREE.InstancedMesh(g, mat, Math.max(1, n));
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes[key] = m;
      this.parts[key] = { mesh: m, n: 0 };
      this.partList.push(this.parts[key]);
      this.group.add(m);
    };
    const n = this.list.length;
    // Jointed: pot-bellied pelvis + chest (waist joint), long upper arm / forearm / hooked hand,
    // thigh / shin / foot, and a prehensile tail of TAIL_N tapering pieces ending in a bare grip pad.
    mk('pelvis', pelvisGeometry(), n);
    mk('chest', chestGeometry(), n);
    mk('head', headGeometry(), n);
    mk('uarm', models.monkeySeg(ARM[0], 0.013, 0.01), n * 2);
    mk('farm', models.monkeySeg(ARM[1], 0.0105, 0.008), n * 2);
    mk('hand', models.monkeyHand(HAND), n * 2);
    mk('thigh', models.monkeySeg(LEG[0], 0.016, 0.011), n * 2);
    mk('shin', models.monkeySeg(LEG[1], 0.0115, 0.008), n * 2);
    mk('foot', models.monkeyHand(FOOT), n * 2);
    mk('tail', tailGeometry(false), n * (TAIL_N - 1));
    mk('tailtip', tailGeometry(true), n);
    mk('loot', lootGeometry(), n);
    this.raidTimer = this.rng.range(FAUNA.monkeyRaidEvery[0], FAUNA.monkeyRaidEvery[1]);
  }

  /** Trees are linked when the gap between canopies is a believable leap. */
  private link(): void {
    const T = this.trees;
    this.links = T.map(() => []);
    for (let i = 0; i < T.length; i++) {
      for (let j = i + 1; j < T.length; j++) {
        const d = Math.hypot(T[i].x - T[j].x, T[i].z - T[j].z);
        const gap = d - (T[i].r + T[j].r) * 0.7;
        if (gap < FAUNA.monkeyJump && d > 1 && Math.abs(T[i].y + T[i].mid - T[j].y - T[j].mid) < 2.2) {
          this.links[i].push(j);
          this.links[j].push(i);
        }
      }
    }
  }

  private spawn(): void {
    // Troops start in well-connected jungle trees.
    const good = this.trees.map((_, i) => i).filter((i) => this.links[i].length >= 2);
    if (!good.length) return;
    const want = this.rng.int(FAUNA.monkeys[0], FAUNA.monkeys[1]);
    const used = new Set<number>();
    while (this.list.length < want) {
      let home = -1;
      for (let k = 0; k < 30; k++) {
        const c = good[Math.floor(this.rng.next() * good.length)];
        if ([...used].every((u) => Math.hypot(this.trees[u].x - this.trees[c].x, this.trees[u].z - this.trees[c].z) > 18)) {
          home = c;
          break;
        }
      }
      if (home < 0) home = good[Math.floor(this.rng.next() * good.length)];
      used.add(home);
      const g = this.troops.length;
      this.troops.push({ tree: home, timer: 20 + this.rng.next() * 30, home });
      const size = Math.min(want - this.list.length, this.rng.int(FAUNA.monkeyGroup[0], FAUNA.monkeyGroup[1]));
      for (let k = 0; k < size; k++) {
        const tree = k === 0 ? home : this.rng.chance(0.5) ? home : this.links[home][Math.floor(this.rng.next() * this.links[home].length)];
        const m: Monkey = {
          id: this.list.length, dead: false, deadFor: 0, raid: null, chasedBy: null,
          group: g, tree, a: this.rng.range(0, TAU), rf: this.rng.range(0.3, 0.75), hf: this.rng.range(0.55, 0.9), x: 0, y: 0, z: 0,
          heading: this.rng.range(0, TAU), state: 'sit', timer: this.rng.range(1, 6), from: new THREE.Vector3(), to: new THREE.Vector3(),
          toTree: tree, toA: 0, toRf: 0, toHf: 0, t: 0, dur: 1, phase: this.rng.range(0, 10), look: 0,
          scale: k === size - 1 && size > 2 && this.rng.chance(0.6) ? 0.65 : this.rng.range(0.92, 1.08), lod: 0,
          pose: new Float32Array(NP), snap: new Float32Array(NP), blend: 1, last: '', dyaw: 0, gait: 0, px: 0, pz: 0, hangVar: 0,
        };
        this.spot(tree, m.a, m.rf, m.hf, _p);
        m.x = _p.x;
        m.y = _p.y;
        m.z = _p.z;
        this.list.push(m);
      }
    }
  }

  /** World position of a spot on a tree. */
  private spot(tree: number, a: number, rf: number, hf: number, out: THREE.Vector3): THREE.Vector3 {
    const t = this.trees[tree];
    // Branches under the canopy (visible from the tilted camera), reaching further out higher up.
    const bottom = Math.max(1.1, t.mid - t.r * 0.62);
    const reach = t.r * rf * 0.85 * Math.min(1, 0.2 + hf);
    return out.set(t.x + Math.cos(a) * reach, t.y + bottom * (0.45 + 0.55 * Math.min(1, hf)), t.z + Math.sin(a) * reach);
  }

  get count(): number {
    return this.list.length;
  }

  update(dt: number, camTarget: THREE.Vector3, people: SpatialHash<Islander>, cursor: THREE.Vector3 | null = null): void {
    this.time += dt;
    this.frame++;
    if (dt > 0) {
      this.updateRaids(dt, cursor);
      for (const tr of this.troops) {
        tr.timer -= dt;
        if (tr.timer <= 0) {
          // The troop drifts to a neighbouring tree; members follow one by one.
          tr.timer = 25 + this.rng.next() * 40;
          const n = this.links[tr.tree].filter((j) => this.treeAlive(this.trees[j].id));
          if (n.length) tr.tree = n[Math.floor(this.rng.next() * n.length)];
        }
      }
      for (const m of this.list) {
        if (m.dead) continue;
        if (m.raid && m.raid.stage !== 'down' && m.raid.stage !== 'up') {
          this.ground(m, dt);
          continue;
        }
        const far = Math.hypot(m.x - camTarget.x, m.z - camTarget.z) > FAUNA.lodDistance;
        m.lod += dt;
        // Far monkeys think every few frames (animation continues smoothly).
        if (far && (this.frame + m.group) % 4 !== 0 && m.state !== 'jump' && m.state !== 'climb' && m.state !== 'walk') continue;
        this.think(m, m.lod, people);
        m.lod = 0;
      }
    }
    this.render(dt);
  }

  private startMove(m: Monkey, tree: number, a: number, rf: number, hf: number, state: MState): void {
    m.from.set(m.x, m.y, m.z);
    this.spot(tree, a, rf, hf, m.to);
    m.toTree = tree;
    m.toA = a;
    m.toRf = rf;
    m.toHf = hf;
    m.t = 0;
    const d = m.from.distanceTo(m.to);
    m.state = state;
    if (state === 'crouch') {
      m.dur = 0.5 + this.rng.next() * 0.3;
    } else if (state === 'climb') m.dur = Math.max(0.6, Math.abs(m.to.y - m.from.y) / 0.9);
    else m.dur = Math.max(0.5, d / (0.75 * m.scale + 0.25));
    const dx = m.to.x - m.from.x, dz = m.to.z - m.from.z;
    if (Math.hypot(dx, dz) > 0.05) m.heading = Math.atan2(dx, dz);
  }

  private think(m: Monkey, dt: number, people: SpatialHash<Islander>): void {
    const tr = this.troops[m.group];
    // Tree felled underneath: leap to a neighbour (or drop and vanish into the jungle).
    if (!this.treeAlive(this.trees[m.tree].id) && m.state !== 'jump' && m.state !== 'crouch') {
      const n = this.links[m.tree].filter((j) => this.treeAlive(this.trees[j].id));
      if (n.length) this.startMove(m, n[0], this.rng.range(0, TAU), 0.5, 0.75, 'crouch');
      else {
        const alt = this.trees.findIndex((t) => this.treeAlive(t.id));
        if (alt >= 0) {
          m.tree = alt;
          this.spot(alt, m.a, m.rf, m.hf, _p);
          m.x = _p.x;
          m.y = _p.y;
          m.z = _p.z;
        }
      }
      return;
    }
    // Somebody close below: look at them, or climb higher out of reach.
    let near: Islander | null = null;
    let nd = 6;
    people.query(m.x, m.z, 6, (p) => {
      const d = Math.hypot(p.x - m.x, p.z - m.z);
      if (d < nd) {
        nd = d;
        near = p;
      }
    });
    switch (m.state) {
      case 'walk':
      case 'climb': {
        m.t += dt / m.dur;
        const k = Math.min(1, m.t);
        const e = k * k * (3 - 2 * k);
        m.x = m.from.x + (m.to.x - m.from.x) * e;
        m.y = m.from.y + (m.to.y - m.from.y) * (m.state === 'climb' ? k : e);
        m.z = m.from.z + (m.to.z - m.from.z) * e;
        if (m.state === 'climb') {
          // Face the trunk while climbing.
          const t = this.trees[m.tree];
          m.heading = Math.atan2(t.x - m.x, t.z - m.z);
        }
        if (k >= 1) {
          if (m.raid?.stage === 'down') {
            m.raid.stage = 'run';
            m.state = 'run';
            return;
          }
          if (m.raid?.stage === 'up') m.raid = null;
          this.arrive(m);
        }
        return;
      }
      case 'crouch':
        m.t += dt / m.dur;
        if (m.t >= 1) {
          m.state = 'jump';
          m.t = 0;
          m.from.set(m.x, m.y, m.z);
          const d = m.from.distanceTo(m.to);
          m.dur = 0.45 + d * 0.09;
        }
        return;
      case 'jump': {
        m.t += dt / m.dur;
        const k = Math.min(1, m.t);
        const d = Math.hypot(m.to.x - m.from.x, m.to.z - m.from.z);
        m.x = m.from.x + (m.to.x - m.from.x) * k;
        m.z = m.from.z + (m.to.z - m.from.z) * k;
        m.y = m.from.y + (m.to.y - m.from.y) * k + Math.sin(k * Math.PI) * (0.35 + d * 0.16);
        if (k >= 1) {
          m.state = 'land';
          m.timer = 0.35;
          this.arrive(m, true);
        }
        return;
      }
      case 'land':
        m.timer -= dt;
        if (m.timer <= 0) {
          m.state = 'sit';
          m.timer = 1 + this.rng.next() * 3;
        }
        return;
    }
    // Hunted: leap away to another tree when the hunter gets close.
    if (m.chasedBy && (m.state === 'sit' || m.state === 'watch' || m.state === 'eat' || m.state === 'hang') && Math.hypot(m.chasedBy.x - m.x, m.chasedBy.z - m.z) < 4 && this.rng.chance(dt * 0.6)) {
      const n = this.links[m.tree].filter((j) => this.treeAlive(this.trees[j].id));
      if (n.length) {
        const j = n[Math.floor(this.rng.next() * n.length)];
        const t = this.trees[j];
        this.startMove(m, j, Math.atan2(m.z - t.z, m.x - t.x), this.rng.range(0.5, 0.8), this.rng.range(0.7, 0.9), 'crouch');
        return;
      }
    }
    if (near && m.state !== 'hang') {
      const p = near as Islander;
      m.look = Math.atan2(p.x - m.x, p.z - m.z) - m.heading;
      if (m.state !== 'watch' && m.state !== 'eat') {
        m.state = 'watch';
        m.timer = 2 + this.rng.next() * 3;
      }
      // Too low with a person right below: climb higher.
      if (m.hf < 0.6 && nd < 3) {
        this.startMove(m, m.tree, m.a, m.rf * 0.4, 0.8 + this.rng.next() * 0.15, 'climb');
        return;
      }
    } else if (m.state === 'watch') m.look *= 0.95;
    m.timer -= dt;
    if (m.timer > 0) return;
    // Follow the troop when it has moved on (each at their own moment).
    if (m.tree !== tr.tree && this.rng.chance(0.55)) {
      const path = this.links[m.tree].includes(tr.tree) ? tr.tree : this.links[m.tree].find((j) => this.links[j].includes(tr.tree));
      if (path !== undefined && this.treeAlive(this.trees[path].id)) {
        const t = this.trees[path];
        // Aim for the side of the next tree facing us.
        const a = Math.atan2(m.z - t.z, m.x - t.x) + this.rng.range(-0.6, 0.6);
        this.startMove(m, path, a, this.rng.range(0.5, 0.8), this.rng.range(0.6, 0.85), 'crouch');
        return;
      }
    }
    const r = this.rng.next();
    if (r < 0.28) {
      // Walk along the branch to another spot in the same tree.
      this.startMove(m, m.tree, m.a + this.rng.range(-1.4, 1.4), this.rng.range(0.35, 0.85), Math.max(0.55, Math.min(0.92, m.hf + this.rng.range(-0.12, 0.12))), 'walk');
    } else if (r < 0.38) {
      // Down the trunk a little, or back up.
      const hf = m.hf > 0.7 ? this.rng.range(0.42, 0.55) : this.rng.range(0.72, 0.9);
      this.startMove(m, m.tree, m.a, 0.12, hf, 'climb');
    } else if (r < 0.5) {
      m.state = 'hang';
      m.timer = 3 + this.rng.next() * 4;
    } else if (r < 0.62) {
      m.state = 'eat';
      m.timer = 3 + this.rng.next() * 3;
    } else if (r < 0.72 && this.links[m.tree].length) {
      // Explore a neighbouring tree.
      const n = this.links[m.tree].filter((j) => this.treeAlive(this.trees[j].id) && (j === tr.tree || this.links[j].includes(tr.tree) || this.links[tr.tree].includes(j)));
      if (n.length) {
        const j = n[Math.floor(this.rng.next() * n.length)];
        const t = this.trees[j];
        this.startMove(m, j, Math.atan2(m.z - t.z, m.x - t.x) + this.rng.range(-0.8, 0.8), this.rng.range(0.5, 0.8), this.rng.range(0.6, 0.85), 'crouch');
        return;
      }
      m.state = 'sit';
      m.timer = 2 + this.rng.next() * 4;
    } else {
      m.state = 'sit';
      m.look = this.rng.range(-1, 1);
      m.timer = 2 + this.rng.next() * 5;
    }
  }

  private arrive(m: Monkey, jumped = false): void {
    m.tree = m.toTree;
    m.a = m.toA;
    m.rf = m.toRf;
    m.hf = m.toHf;
    m.x = m.to.x;
    m.y = m.to.y;
    m.z = m.to.z;
    if (!jumped) {
      m.state = 'sit';
      m.timer = 0.8 + this.rng.next() * 3;
    }
    // Sit facing outward from the trunk.
    if (m.state === 'sit' || jumped) m.heading = m.a > -99 ? Math.atan2(Math.cos(m.a), Math.sin(m.a)) : m.heading;
  }

  // ---------------- Village raids ----------------

  private updateRaids(dt: number, cursor: THREE.Vector3 | null): void {
    // Lost monkeys are slowly replaced by newcomers from the jungle.
    for (const m of this.list) {
      if (!m.dead) continue;
      m.deadFor += dt;
      if (m.deadFor > FAUNA.monkeyRespawn) {
        const tr = this.troops[m.group];
        const tree = this.treeAlive(this.trees[tr.tree].id) ? tr.tree : this.trees.findIndex((t) => this.treeAlive(t.id));
        if (tree < 0) continue;
        Object.assign(m, { dead: false, deadFor: 0, raid: null, chasedBy: null, tree, state: 'sit', timer: 2, a: this.rng.range(0, TAU), rf: 0.5, hf: 0.8 });
        this.spot(tree, m.a, m.rf, m.hf, _p);
        m.x = _p.x;
        m.y = _p.y;
        m.z = _p.z;
      }
    }
    // Raiders on the ground bolt from the pointer and from warriors.
    const guards = this.hooks.guards();
    for (const m of this.list) {
      const r = m.raid;
      if (m.dead || !r || (r.stage !== 'run' && r.stage !== 'steal')) continue;
      const scared = (cursor && Math.hypot(cursor.x - m.x, cursor.z - m.z) < FAUNA.monkeyFear) || guards.some((g) => Math.hypot(g.x - m.x, g.z - m.z) < FAUNA.monkeyFear * 0.8) || !!m.chasedBy;
      if (scared) this.flee(m, cursor, true);
    }
    this.raidTimer -= dt;
    if (this.raidTimer > 0) return;
    this.raidTimer = this.rng.range(FAUNA.monkeyRaidEvery[0], FAUNA.monkeyRaidEvery[1]);
    if (!this.hooks.day()) return;
    const stores = this.hooks.targets();
    if (!stores.length) return;
    // The troop nearest a food store sends a few bold members in.
    let best: { g: number; s: { id: number; x: number; z: number }; d: number } | null = null;
    this.troops.forEach((tr, g) => {
      const t = this.trees[tr.tree];
      for (const st of stores) {
        const d = Math.hypot(st.x - t.x, st.z - t.z);
        if (d < FAUNA.monkeyRaidRange && (!best || d < best.d)) best = { g, s: st, d };
      }
    });
    if (!best) return;
    const { g, s: st } = best as { g: number; s: { id: number; x: number; z: number }; d: number };
    const members = this.list.filter((m) => !m.dead && m.group === g && !m.raid && (m.state === 'sit' || m.state === 'watch' || m.state === 'eat' || m.state === 'walk'));
    const n = Math.min(members.length, this.rng.int(FAUNA.monkeyRaiders[0], FAUNA.monkeyRaiders[1]));
    for (let k = 0; k < n; k++) {
      const m = members[k];
      m.raid = { stage: 'down', tx: st.x + this.rng.range(-0.6, 0.6), tz: st.z + this.rng.range(-0.6, 0.6), store: st.id, carry: 0, scared: false };
      // Down the trunk to the ground.
      const t = this.trees[m.tree];
      const a = Math.atan2(st.z - t.z, st.x - t.x);
      const gx = t.x + Math.cos(a) * 0.4, gz = t.z + Math.sin(a) * 0.4;
      m.from.set(m.x, m.y, m.z);
      m.to.set(gx, this.world.groundY(gx, gz), gz);
      m.t = 0;
      m.dur = Math.max(0.8, Math.abs(m.to.y - m.from.y) / 1.1);
      m.state = 'climb';
    }
    if (n && this.time - this.warned > 90) {
      this.warned = this.time;
      this.hooks.notify('Monkeys are creeping into the village after your food! Wave them off with the pointer, or send a hunter.', () => this.raider());
    }
  }

  /** Run for the nearest tree (away from whatever scared it), dropping any plan to steal. */
  private flee(m: Monkey, from: THREE.Vector3 | null, scared: boolean): void {
    const r = m.raid!;
    r.stage = 'flee';
    r.scared = r.scared || scared;
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      if (!this.treeAlive(t.id)) continue;
      let d = Math.hypot(t.x - m.x, t.z - m.z);
      // Prefer trees away from the threat.
      if (from) {
        const ax = m.x - from.x, az = m.z - from.z, bx = t.x - m.x, bz = t.z - m.z;
        if (ax * bx + az * bz < 0) d *= 2.5;
      }
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return;
    m.tree = best;
    const t = this.trees[best];
    const a = Math.atan2(m.z - t.z, m.x - t.x);
    r.tx = t.x + Math.cos(a) * 0.35;
    r.tz = t.z + Math.sin(a) * 0.35;
    m.state = 'run';
  }

  /** On the ground: scamper to the store, rummage, and run back to the trees. */
  private ground(m: Monkey, dt: number): void {
    const r = m.raid!;
    if (r.stage === 'steal') {
      m.state = 'steal';
      m.timer -= dt;
      if (m.timer <= 0) {
        const got = this.hooks.steal(this.rng.int(FAUNA.monkeySteal[0], FAUNA.monkeySteal[1]));
        if (got) {
          r.carry = got.n;
          // One message per raid, not one per monkey.
          if (this.time - this.lastTheft > 10) this.hooks.notify(`Monkeys made off with ${got.n}+ ${got.res}!`, () => this.raider());
          this.lastTheft = this.time;
        }
        this.flee(m, null, false);
      }
      return;
    }
    const dx = r.tx - m.x, dz = r.tz - m.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) {
      if (r.stage === 'run') {
        r.stage = 'steal';
        m.state = 'steal';
        m.timer = FAUNA.monkeyStealTime;
        return;
      }
      // Back at a tree: up into the branches.
      r.stage = 'up';
      this.startMove(m, m.tree, Math.atan2(m.z - this.trees[m.tree].z, m.x - this.trees[m.tree].x), 0.5, 0.78, 'climb');
      return;
    }
    const sp = (r.stage === 'flee' ? FAUNA.monkeyFleeSpeed * (r.scared ? 1.15 : 1) : FAUNA.monkeyRunSpeed) * (0.8 + 0.2 * m.scale);
    const step = Math.min(d, sp * dt);
    const nx = m.x + (dx / d) * step, nz = m.z + (dz / d) * step;
    // Monkeys won't swim: turn back if the way ahead is water.
    if (this.world.heightAt(nx, nz) < -0.25 && r.stage === 'run') {
      this.flee(m, null, false);
      return;
    }
    m.x = nx;
    m.z = nz;
    m.y = this.world.groundY(nx, nz);
    let dh = Math.atan2(dx, dz) - m.heading;
    while (dh > Math.PI) dh -= TAU;
    while (dh < -Math.PI) dh += TAU;
    m.heading += dh * Math.min(1, dt * 10);
    m.state = 'run';
  }

  // ---------------- Hunting (through the colony's capture hooks) ----------------

  get(id: number): Monkey | undefined {
    const m = this.list[id - MONKEY_BASE];
    return m && !m.dead ? m : undefined;
  }

  canHunt(id: number): boolean {
    const m = this.get(id);
    return !!m && !m.chasedBy && m.state !== 'jump';
  }

  beginChase(id: number, isl: Islander): void {
    const m = this.get(id);
    if (m) m.chasedBy = isl;
  }

  /** Close enough on the ground to grab, or right under it in a tree for a spear throw. */
  catchable(id: number, isl: Islander): boolean {
    const m = this.get(id);
    if (!m) return false;
    const d = Math.hypot(m.x - isl.x, m.z - isl.z);
    if (m.raid && m.raid.stage !== 'down' && m.raid.stage !== 'up') return d < 0.7;
    return d < 1.3 && m.state !== 'jump' && m.state !== 'crouch' && m.y - isl.y < 4;
  }

  kill(id: number): void {
    const m = this.get(id);
    if (!m) return;
    m.dead = true;
    m.deadFor = 0;
    m.raid = null;
    m.chasedBy = null;
  }

  release(id: number): void {
    const m = this.get(id);
    if (m) m.chasedBy = null;
  }

  /** How many are on the ground in the village right now. */
  get raiders(): number {
    return this.list.filter((m) => !m.dead && m.raid && m.raid.stage !== 'up').length;
  }

  // ---------------- Rendering ----------------

  private put(pt: Part, m: THREE.Matrix4): void {
    if (pt.n < pt.mesh.instanceMatrix.count) pt.mesh.setMatrixAt(pt.n++, m);
  }

  private render(dt: number): void {
    const P = this.parts;
    for (const pt of this.partList) pt.n = 0;
    for (const m of this.list) {
      if (m.dead) continue;
      if (!View.sees(m.x, m.y, m.z, 0.5)) continue;
      const s = m.scale;
      const t = this.time + m.phase;
      // Ground strides are locked to the distance actually covered.
      const moved = Math.hypot(m.x - m.px, m.z - m.pz);
      m.px = m.x;
      m.pz = m.z;
      if (moved < 1) m.gait = (m.gait + moved / (RUN_STRIDE * s)) % 1;
      if (m.state === 'hang' && m.last !== 'hang') m.hangVar = hash(m.id, Math.floor(this.time * 7)) < 0.4 ? 1 : 0;
      this.target(m, t, _tgt);
      const o = m.pose;
      if (m.last === '') {
        o.set(_tgt);
        m.snap.set(_tgt);
        m.blend = 1;
        m.last = m.state;
        m.dyaw = m.heading;
      } else if (m.state !== m.last) {
        // New state: blend over from wherever the limbs are now.
        m.snap.set(o);
        m.blend = 0;
        m.last = m.state;
      }
      m.blend = Math.min(1, m.blend + dt / BLEND_T);
      const k = smooth(0, 1, m.blend);
      for (let i = 0; i < NP; i++) o[i] = m.snap[i] + (_tgt[i] - m.snap[i]) * k;
      let dh = m.heading - m.dyaw;
      while (dh > Math.PI) dh -= TAU;
      while (dh < -Math.PI) dh += TAU;
      m.dyaw += dh * Math.min(1, dt * 10);
      const yaw = m.dyaw + o[YAW];
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      local(_b, m.x + (o[OX] * cy + o[OZ] * sy) * s, m.y + o[OY] * s, m.z + (-o[OX] * sy + o[OZ] * cy) * s, o[PITCH], yaw, o[ROLL], s);
      this.put(P.pelvis, _b);
      _C.multiplyMatrices(_b, local(_T, 0, WAIST, 0, o[WX], o[WY], o[WZ]));
      this.put(P.chest, _C);
      this.put(P.head, _J.multiplyMatrices(_C, local(_T, 0, 0.1, 0.008, o[HX] - o[WX], o[HY] - o[WY], o[HZ])));
      // Arms: shoulder → elbow → wrist (angles relative to the pelvis, so the waist is taken back out).
      for (let side = 1; side >= -1; side -= 2) {
        const l = side > 0;
        _J.multiplyMatrices(_C, local(_T, side * SH_X, SHOULDER, 0, o[l ? AL : AR] - o[WX], 0, side * o[l ? ALZ : ARZ]));
        this.put(P.uarm, _J);
        _J.multiply(local(_T, 0, -ARM[0], 0, o[l ? EL : ER], 0, 0));
        this.put(P.farm, _J);
        _J.multiply(local(_T, 0, -ARM[1], 0, o[l ? WRL : WRR], 0, 0));
        this.put(P.hand, _J);
        // Legs: hip → knee → ankle.
        _J.multiplyMatrices(_b, local(_T, side * HIP_X, HIP_Y, HIP_Z, o[l ? LL : LR], 0, side * o[l ? LLZ : LRZ]));
        this.put(P.thigh, _J);
        _J.multiply(local(_T, 0, -LEG[0], 0, o[l ? KL : KR], 0, 0));
        this.put(P.shin, _J);
        _J.multiply(local(_T, 0, -LEG[1], 0, o[l ? ANL : ANR], 0, 0));
        this.put(P.foot, _J);
      }
      // Tail: tapering pieces, each curling a little more, with a slow wave running down it.
      _J.multiplyMatrices(_b, local(_T, 0, 0.035, -0.04, o[TP], o[TY], 0));
      this.put(P.tail, _J);
      for (let i = 1; i < TAIL_N; i++) {
        const wave = o[TW] * Math.sin(t * 2.2 - i * 0.7);
        _J.multiply(local(_T, 0, 0, -TAIL_SEG, o[TC] + (i >= TAIL_N - 3 ? o[TT] : 0) + wave * 0.3, o[TCY] + wave, 0, TAIL_TAPER));
        this.put(i === TAIL_N - 1 ? P.tailtip : P.tail, _J);
      }
      // Stolen food clutched to the chest.
      if (m.raid?.carry) this.put(P.loot, _J.multiplyMatrices(_C, local(_T, 0, 0.03, 0.062, 0, 0, 0)));
    }
    for (const pt of this.partList) {
      pt.mesh.count = pt.n;
      pt.mesh.visible = pt.n > 0;
      if (pt.n) pt.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Arm IK: wrist to (ty, tz) in the heading frame (relative to the root, unscaled), hand at heading angle hand. */
  private armTo(o: Float32Array, side: number, ty: number, tz: number, hand: number): void {
    const p = o[PITCH], c = Math.cos(p), sn = Math.sin(p);
    const y = ty - o[OY], z = tz - o[OZ];
    const wx = o[WX];
    ik2(WAIST + SHOULDER * Math.cos(wx), SHOULDER * Math.sin(wx), y * c + z * sn, -y * sn + z * c, ARM[0], ARM[1], 1);
    const l = side > 0;
    o[l ? AL : AR] = _ik[0];
    o[l ? EL : ER] = _ik[1] - _ik[0];
    o[l ? WRL : WRR] = hand - p - _ik[1];
  }

  /** Leg IK: ankle to (ty, tz) in the heading frame, foot at heading angle foot. */
  private legTo(o: Float32Array, side: number, ty: number, tz: number, foot: number): void {
    const p = o[PITCH], c = Math.cos(p), sn = Math.sin(p);
    const y = ty - o[OY], z = tz - o[OZ];
    ik2(HIP_Y, HIP_Z, y * c + z * sn, -y * sn + z * c, LEG[0], LEG[1], -1);
    const l = side > 0;
    o[l ? LL : LR] = _ik[0];
    o[l ? KL : KR] = _ik[1] - _ik[0];
    o[l ? ANL : ANR] = foot - p - _ik[1];
  }

  /** The joint pose each state is heading for (blended in render). Angles: + pitches forward / swings limbs back. */
  private target(m: Monkey, t: number, o: Float32Array): void {
    o.fill(0);
    // Sitting on a branch: knees up, forearms over the knees, tail hanging down and coiled round the branch.
    o[PITCH] = 0.08;
    o[WX] = 0.16 + Math.sin(t * 0.4) * 0.04;
    o[WY] = Math.sin(t * 0.25) * 0.15;
    o[HX] = Math.sin(t * 0.37) * 0.15;
    o[HY] = m.look + Math.sin(t * 0.6) * 0.45;
    o[AL] = o[AR] = -0.5;
    o[ALZ] = o[ARZ] = 0.22;
    o[EL] = o[ER] = -0.9;
    o[WRL] = o[WRR] = 0.1;
    o[LL] = o[LR] = -1.75;
    o[LLZ] = o[LRZ] = 0.35;
    o[KL] = o[KR] = 1.85;
    o[ANL] = o[ANR] = -1.5;
    o[TP] = -1.35;
    o[TY] = 0.25;
    o[TC] = -0.42 + Math.sin(t * 0.7) * 0.05;
    o[TCY] = 0.03;
    o[TT] = -0.45;
    o[TW] = 0.06;
    const s = m.scale;
    switch (m.state) {
      case 'sit':
      case 'watch':
      case 'eat':
        this.sitIdle(m, t, o);
        break;
      case 'walk': {
        // Brachiating: hanging under the branch, swinging hand over hand, tail hooked up behind.
        const dist = Math.hypot(m.x - m.from.x, m.y - m.from.y, m.z - m.from.z) / s;
        const kk = Math.round(dist / BR_STEP), off = dist - kk * BR_STEP;
        const side = kk % 2 === 0 ? 1 : -1;
        const u = off / BR_STEP + 0.5, e = (1 - Math.cos(Math.PI * u)) / 2;
        const shY = -0.03 - Math.sqrt(Math.max(0, BR_REACH * BR_REACH - off * off));
        const p = (-0.8 * off) / BR_REACH;
        o[PITCH] = p;
        o[WX] = 0;
        o[OY] = shY - (WAIST + SHOULDER) * Math.cos(p);
        o[OZ] = -(WAIST + SHOULDER) * Math.sin(p);
        o[ROLL] = side * 0.1;
        o[WY] = side * 0.12;
        o[ALZ] = o[ARZ] = 0.1;
        this.armTo(o, side, -0.03, -off, Math.PI);
        this.armTo(o, -side, -0.03 - 0.07 * Math.sin(Math.PI * u), -off + BR_STEP * (2 * e - 1), Math.PI + 0.4 * Math.sin(Math.PI * u));
        const sw = Math.sin(Math.PI * u);
        o[LL] = -0.25 - 0.6 * p + side * 0.12 * sw;
        o[LR] = -0.25 - 0.6 * p - side * 0.12 * sw;
        o[KL] = o[KR] = 0.45 + 0.35 * sw;
        o[ANL] = o[ANR] = -0.5;
        o[LLZ] = o[LRZ] = 0.2;
        o[HX] = -0.3 + p * 0.5;
        o[HY] = 0;
        o[TP] = 1.2 - p;
        o[TY] = 0;
        o[TC] = 0.12;
        o[TT] = 0.45;
        o[TW] = 0.08;
        break;
      }
      case 'climb': {
        // Hand over hand up (or down) the trunk, diagonal limbs together; grips stay put while the body moves.
        const up = m.to.y >= m.from.y;
        const c = m.y / s / CLIMB_STEP;
        o[PITCH] = 0.2;
        o[WX] = 0.05;
        o[WY] = 0.12 * Math.sin(TAU * c);
        o[ROLL] = 0.05 * Math.sin(TAU * c);
        o[ALZ] = o[ARZ] = 0.3;
        o[LLZ] = o[LRZ] = 0.45;
        climbLimb(c, 0.3);
        this.armTo(o, 1, _ly, 0.075 + _lz, Math.PI - 0.25);
        climbLimb(c + 0.5, 0.3);
        this.armTo(o, -1, _ly, 0.075 + _lz, Math.PI - 0.25);
        climbLimb(c, 0.02);
        this.legTo(o, -1, _ly, 0.06 + _lz, Math.PI * 0.62);
        climbLimb(c + 0.5, 0.02);
        this.legTo(o, 1, _ly, 0.06 + _lz, Math.PI * 0.62);
        o[HX] = up ? -0.35 : 0.5;
        o[HY] = 0;
        o[TP] = -1.1;
        o[TY] = 0;
        o[TC] = 0.1;
        o[TT] = 0.45;
        o[TW] = 0.12;
        break;
      }
      case 'hang':
        if (m.hangVar) {
          // Upside down by the tail alone, arms dangling and reaching, turning slowly.
          const sw = Math.sin(t * 1.2) * 0.22;
          o[PITCH] = Math.PI + sw * 0.6;
          o[OY] = 0.02 - 0.2 * Math.cos(sw);
          o[OZ] = -0.2 * Math.sin(sw);
          o[YAW] = Math.sin(t * 0.5) * 0.4;
          o[WX] = Math.sin(t * 0.9) * 0.1;
          o[WY] = 0;
          o[AL] = Math.PI - 0.25 + Math.sin(t * 0.9) * 0.3;
          o[AR] = Math.PI + 0.2 + Math.sin(t * 0.8 + 1) * 0.25;
          o[EL] = -0.3;
          o[ER] = -0.5;
          o[ALZ] = o[ARZ] = 0.3;
          o[WRL] = o[WRR] = 0;
          o[LL] = -0.4 + Math.sin(t * 1.1) * 0.2;
          o[LR] = -0.4 + Math.sin(t * 1.1 + 1.3) * 0.2;
          o[KL] = o[KR] = 0.9;
          o[ANL] = o[ANR] = -0.6;
          o[LLZ] = o[LRZ] = 0.3;
          o[HX] = -0.4;
          o[HY] = Math.sin(t * 0.6) * 0.6;
          o[TP] = -1.3;
          o[TY] = 0.25;
          o[TC] = 0.04;
          o[TCY] = 0;
          o[TT] = -1.1;
          o[TW] = 0.03;
        } else {
          // Hanging by both hands with the tail wrapped round the branch above, swinging.
          const sw = Math.sin(t * 1.6) * 0.3, R = BR_REACH + WAIST + SHOULDER;
          o[PITCH] = sw;
          o[WX] = 0;
          o[WY] = 0;
          o[OY] = -0.01 - R * Math.cos(sw);
          o[OZ] = -R * Math.sin(sw);
          o[ALZ] = o[ARZ] = 0.12;
          this.armTo(o, 1, -0.01, 0, Math.PI);
          this.armTo(o, -1, -0.01, 0, Math.PI);
          o[LL] = -0.3 - sw * 0.6 + Math.sin(t * 1.6 + 0.6) * 0.15;
          o[LR] = -0.3 - sw * 0.6 + Math.sin(t * 1.6 + 0.9) * 0.15;
          o[KL] = 0.5 + Math.sin(t * 1.6 + 1.2) * 0.2;
          o[KR] = 0.55 + Math.sin(t * 1.6 + 1.5) * 0.2;
          o[ANL] = o[ANR] = -0.4;
          o[LLZ] = o[LRZ] = 0.25;
          o[HX] = -0.2;
          o[TP] = 1.35 - sw;
          o[TY] = 0;
          o[TC] = 0.1;
          o[TT] = 1.0;
          o[TW] = 0.05;
        }
        break;
      case 'crouch': {
        // Gathering for the leap: bunched low, tail lifting for balance.
        const k = Math.min(1, m.t * 1.5);
        o[OY] = -0.03 * k;
        o[PITCH] = 0.6 * k;
        o[LL] = o[LR] = -1.75 - 0.3 * k;
        o[KL] = o[KR] = 1.85 + 0.45 * k;
        o[AL] = o[AR] = -0.5 - 0.8 * k;
        o[WX] = 0.14 + 0.2 * k;
        o[HX] = -0.55 * k;
        o[TP] = -1.35 + 0.9 * k;
        o[TC] = -0.42 * (1 - k) + 0.08 * k;
        o[TT] = -0.45 * (1 - k);
        break;
      }
      case 'jump': {
        // Stretched out mid-air: arms reaching for the far branch, legs trailing, tail streaming.
        const k = Math.min(1, m.t);
        const p = 1.0 + (k - 0.5) * 0.6;
        o[PITCH] = p;
        o[AL] = o[AR] = -p - 1.4 + k * 0.4;
        o[EL] = o[ER] = -0.05 - k * 0.3;
        o[WRL] = o[WRR] = -0.3 + k * 0.5;
        o[ALZ] = o[ARZ] = 0.25;
        o[LL] = o[LR] = -p + 0.9 - 0.8 * k;
        o[KL] = o[KR] = 0.3 + 0.9 * k;
        o[ANL] = o[ANR] = -0.3;
        o[LLZ] = o[LRZ] = 0.25;
        o[WX] = -0.2 + 0.3 * k;
        o[WY] = 0;
        o[HX] = -0.8;
        o[HY] = 0;
        o[TP] = -p + 0.25;
        o[TY] = 0;
        o[TC] = 0.06;
        o[TT] = 0.3;
        o[TW] = 0.1;
        break;
      }
      case 'land': {
        const k = m.timer / 0.35;
        o[OY] = -0.05 * k;
        o[PITCH] = 0.6 * k;
        o[LL] = o[LR] = -1.75 - 0.3 * k;
        o[KL] = o[KR] = 1.85 + 0.5 * k;
        o[AL] = o[AR] = -0.5 - 0.6 * k;
        o[WX] = 0.14 + 0.25 * k;
        o[TP] = -1.35 + 0.6 * k;
        o[TC] = -0.42 * (1 - k);
        o[TT] = -0.45 * (1 - k);
        break;
      }
      case 'run': {
        // On the ground: a bounding four-footed run, long arms reaching, tail up in an arc.
        const g = m.gait, G = g * TAU;
        const p = 1.05 + 0.06 * Math.cos(G - TAU * 0.35);
        o[PITCH] = p;
        o[WX] = 0.14 * Math.cos(G - TAU * 0.1) - 0.05;
        o[WY] = 0.1 * Math.sin(G);
        o[OY] = 0.095 + 0.012 * Math.cos(G - TAU * 0.6);
        o[HX] = -1.0;
        o[HY] = 0;
        o[ALZ] = o[ARZ] = 0.12;
        o[LLZ] = o[LRZ] = 0.15;
        const S = RUN_DUTY * RUN_STRIDE, c = Math.cos(p), sn = Math.sin(p);
        const shZ = o[OZ] + (WAIST + SHOULDER) * sn, hipZ = HIP_Y * sn + HIP_Z * c;
        for (let limb = 0; limb < 4; limb++) {
          const arm = limb < 2, side = limb % 2 === 0 ? 1 : -1;
          const ph = (((g + (arm ? 0.5 : 0) + (side < 0 ? 0.08 : 0)) % 1) + 1) % 1;
          let z = arm ? shZ + 0.01 : hipZ - 0.01, y = 0, ang = arm ? -1.35 : -1.45;
          if (ph < RUN_DUTY) z += S * (0.5 - ph / RUN_DUTY);
          else {
            const u = (ph - RUN_DUTY) / (1 - RUN_DUTY);
            z += S * (u - Math.sin(TAU * u) / TAU - 0.5);
            y = 0.03 * Math.sin(Math.PI * u);
            ang += (arm ? 1.9 : 1.6) * Math.sin(Math.PI * u);
          }
          const len = arm ? HAND : FOOT;
          const wy = y + len * 0.8 * Math.cos(ang), wz = z + len * 0.8 * Math.sin(ang);
          if (arm) this.armTo(o, side, wy, wz, ang);
          else this.legTo(o, side, wy, wz, ang);
        }
        if (m.raid?.carry) {
          // Loot clutched in one arm: runs on three.
          o[AR] = -0.5;
          o[ER] = -1.9;
          o[WRR] = -0.3;
          o[ARZ] = -0.2;
        }
        o[TP] = -0.45;
        o[TY] = 0;
        o[TC] = 0.05;
        o[TT] = 0.5;
        o[TW] = 0.12;
        break;
      }
      case 'steal':
        // Squatting at the store, rummaging with both hands and glancing about.
        o[OY] = 0.035;
        o[PITCH] = 0.4;
        o[WX] = 0.45;
        o[LL] = o[LR] = -1.95;
        o[KL] = o[KR] = 2.45;
        o[ANL] = o[ANR] = -2.3;
        o[AR] = -1.4 + Math.sin(t * 9) * 0.4;
        o[AL] = -1.4 - Math.sin(t * 9 + 1) * 0.4;
        o[EL] = o[ER] = -0.9;
        o[WRL] = o[WRR] = 0.2;
        o[HX] = 0.3;
        o[HY] = Math.sin(t * 2.3) * 0.9;
        o[TP] = -0.5;
        o[TC] = 0.15;
        o[TT] = 0.4;
        break;
    }
  }

  /** Sitting, watching and eating, with idle fidgets: scratching, grooming, looking round, holding on above, tail play. */
  private sitIdle(m: Monkey, t: number, o: Float32Array): void {
    if (m.state === 'watch') {
      o[WX] = 0.02;
      o[HX] = -0.1;
      o[HY] = m.look;
      return;
    }
    if (m.state === 'eat') {
      // Fruit to the mouth with one hand, chewing.
      o[AR] = -2.2 + Math.sin(t * 5) * 0.12;
      o[ARZ] = -0.3;
      o[ER] = -1.7 + Math.sin(t * 5) * 0.2;
      o[WRR] = -0.6;
      o[AL] = -0.75;
      o[EL] = -1.2;
      o[HX] = 0.2 + Math.sin(t * 5) * 0.05;
      o[WX] = 0.22;
      return;
    }
    const wt = t + m.id * 1.7, wk = Math.floor(wt / IDLE_WINDOW), u = wt - wk * IDLE_WINDOW;
    const h = hash(wk, m.id);
    if (h < 0.22) {
      const e = env(u, 0.4, 3.6);
      mixIn(o, AR, -2.7, e);
      mixIn(o, ARZ, 0.55, e);
      mixIn(o, ER, -2.0 + Math.sin(t * 14) * 0.35, e);
      mixIn(o, WRR, -0.4, e);
      o[HZ] -= 0.25 * e;
      o[HX] += 0.15 * e;
    } else if (h < 0.44) {
      const e = env(u, 0.4, 4);
      mixIn(o, AL, -1.0, e);
      mixIn(o, EL, -1.5 + Math.sin(t * 7) * 0.25, e);
      mixIn(o, WRL, Math.sin(t * 7) * 0.3, e);
      mixIn(o, AR, -0.9, e);
      mixIn(o, ER, -1.3 + Math.sin(t * 7 + 1.5) * 0.25, e);
      o[HX] += 0.55 * e;
      mixIn(o, HY, Math.sin(t * 0.9) * 0.3, e);
    } else if (h < 0.62) {
      const e = env(u, 0.3, 4.2);
      mixIn(o, HY, Math.sin(t * 0.9) * 1.1, e);
      o[WY] += Math.sin(t * 0.9) * 0.3 * e;
    } else if (h < 0.75) {
      const e = env(u, 0.5, 4);
      mixIn(o, AL, -3.0, e);
      mixIn(o, ALZ, 0.1, e);
      mixIn(o, EL, -0.25, e);
      mixIn(o, WRL, -0.4, e);
      o[WX] -= 0.1 * e;
      o[HX] -= 0.2 * e;
    } else if (h < 0.85) {
      const e = env(u, 0.3, 4);
      o[TC] += Math.sin(t * 1.8) * 0.35 * e;
      o[TP] += 0.3 * e;
    }
  }

  /** Nearest monkey to a ground point (for info taps). */
  near(x: number, z: number, r: number): Monkey | null {
    let best: Monkey | null = null, bd = r;
    for (const m of this.list) {
      if (m.dead) continue;
      const d = Math.hypot(m.x - x, m.z - z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  /** Screen-space pick for tapping a monkey. */
  pick(camera: THREE.Camera, sx: number, sy: number, rect: DOMRect, radius = 22): Monkey | null {
    const v = new THREE.Vector3();
    let best: Monkey | null = null, bd = radius * radius;
    for (const m of this.list) {
      if (m.dead) continue;
      v.set(m.x, m.y + 0.1, m.z).project(camera);
      if (v.z > 1) continue;
      const px = (v.x * 0.5 + 0.5) * rect.width + rect.left, py = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      const d = (px - sx) ** 2 + (py - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  describe(m: Monkey): string {
    if (m.raid) {
      if (m.raid.stage === 'steal') return 'Stealing food!';
      if (m.raid.stage === 'flee' || m.raid.stage === 'up') return m.raid.carry ? `Running off with ${m.raid.carry} food` : 'Fleeing back to the trees';
      return 'Sneaking into the village';
    }
    const map: Record<MState, string> = { sit: 'Sitting on a branch', walk: 'Walking along a branch', climb: 'Climbing', hang: 'Hanging and swinging', crouch: 'Getting ready to leap', jump: 'Leaping between trees', land: 'Landing', eat: 'Eating fruit', watch: 'Watching the islanders', run: 'Scampering', steal: 'Stealing food!' };
    return map[m.state];
  }
}

/** A stolen bundle: a papaya and a maize cob. */
function lootGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.035, 1), { color: 0xf0a030 }, M.t(0, 0, 0, 0, 0, 0, 0.9, 1.2, 0.9));
  b.add(P.cyl(0.014, 0.012, 0.07, 6), { color: 0xf2d040 }, M.t(0.03, 0.01, 0.01, 0, 0, 0.7));
  return b.build();
}

// ---------------- Spider monkey geometry (pivots match the skeleton constants above) ----------------

const FUR = 0x2a2220, FUR_PALE = 0x43362c, FACE = 0xc9a585, FACE_PALE = 0xdcc2a2, SKIN = 0x5a4238;
const C = (c: number) => ({ color: c });

/** Hips and the spider monkey's round pot belly; the waist joint is at y = WAIST. */
function pelvisGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.043, 0.035, 3, 7), C(FUR), M.t(0, 0.045, 0));
  b.add(P.sphere(0.047, 1), C(FUR), M.t(0, 0.028, -0.006, 0, 0, 0, 1.1, 0.72, 1));
  b.add(P.sphere(0.045, 1), C(FUR_PALE), M.t(0, 0.058, 0.016, 0, 0, 0, 0.95, 1.05, 0.95));
  return facet(b.build());
}

/** Narrow chest under broad, long-armed shoulders, with a short neck to the head joint. */
function chestGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.CapsuleGeometry(0.041, 0.04, 3, 7), C(FUR), M.t(0, 0.035, 0));
  b.add(P.sphere(0.03, 0), C(FUR_PALE), M.t(0, 0.03, 0.028, 0, 0, 0, 0.9, 1.2, 0.5));
  b.add(P.sphere(0.048, 1), C(FUR), M.t(0, SHOULDER - 0.004, 0, 0, 0, 0, 1.3, 0.55, 0.85));
  b.add(P.cyl(0.018, 0.024, 0.035, 6), C(FUR), M.t(0, 0.09, 0.004));
  return facet(b.build());
}

/** Small round head with a pale face mask: muzzle, eye rings, dark eyes under a furry brow. */
function headGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.04, 1), C(FUR), M.t(0, 0.04, -0.004, 0, 0, 0, 0.95, 1, 1));
  b.add(P.sphere(0.022, 0), C(FUR), M.t(0, 0.07, -0.012));
  b.add(P.sphere(0.03, 1), C(FACE), M.t(0, 0.035, 0.024, 0, 0, 0, 1, 1.05, 0.7));
  b.add(P.sphere(0.019, 1), C(FACE), M.t(0, 0.021, 0.045, 0, 0, 0, 1.05, 0.85, 0.85));
  b.add(P.box(0.044, 0.009, 0.014), C(FUR), M.t(0, 0.059, 0.03, 0.3, 0, 0));
  b.add(P.box(0.016, 0.0025, 0.004), C(0x2a1a14), M.t(0, 0.012, 0.059));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.011, 0), C(FACE_PALE), M.t(x * 0.013, 0.045, 0.04));
    b.add(P.sphere(0.0065, 0), C(0x100a08), M.t(x * 0.013, 0.046, 0.048));
    b.add(P.sphere(0.002, 0), C(0xffffff), M.t(x * 0.015, 0.048, 0.054));
    b.add(P.sphere(0.003, 0), C(0x2a1a14), M.t(x * 0.005, 0.025, 0.062));
    b.add(P.sphere(0.009, 0), C(SKIN), M.t(x * 0.037, 0.042, 0.0, 0, 0, 0, 0.5, 1, 0.9));
  }
  return facet(b.build());
}

/** One tail piece from its joint back along -z; the tip piece curls and has the bare grip pad underneath. */
function tailGeometry(tip: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const len = TAIL_SEG;
  b.add(P.sphere(0.0108, 0), C(FUR), M.t(0, 0, 0));
  b.add(P.cyl(0.0102, 0.0094, len, 5), C(FUR), M.t(0, 0, -len / 2, Math.PI / 2, 0, 0));
  if (tip) {
    b.add(P.cyl(0.0094, 0.006, len * 0.7, 5), C(FUR), M.t(0, 0.012, -len * 1.2, Math.PI / 2 + 0.7, 0, 0));
    b.add(P.box(0.009, 0.004, len * 0.9), C(SKIN), M.t(0, -0.008, -len * 0.6));
  }
  return facet(b.build());
}
