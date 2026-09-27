import * as THREE from 'three';
import { FAUNA } from '../config';
import { peopleMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';
import * as models from './animalModels';
import { GeoBuilder, M, P } from '../render/GeoBuilder';

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
  notify: (msg: string) => void;
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
}

interface Troop {
  tree: number;
  timer: number;
  home: number;
}

const _m = new THREE.Matrix4();
const _b = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const TAU = Math.PI * 2;
/** Segment lengths: upper arm, forearm; thigh, shin. */
const ARM = [0.068, 0.062];
const LEG = [0.058, 0.052];

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
  private time = 0;
  private frame = 0;
  private raidTimer = 0;
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
      this.group.add(m);
    };
    const n = this.list.length;
    // Jointed: pelvis + chest (waist joint), upper arm / forearm / hand, thigh / shin / foot.
    mk('pelvis', models.monkeyPelvis(), n);
    mk('chest', models.monkeyChest(), n);
    mk('head', models.monkeyHead(), n);
    mk('uarm', models.monkeySeg(ARM[0], 0.013, 0.011), n * 2);
    mk('farm', models.monkeySeg(ARM[1], 0.011, 0.009), n * 2);
    mk('hand', models.monkeyHand(0.028), n * 2);
    mk('thigh', models.monkeySeg(LEG[0], 0.016, 0.012), n * 2);
    mk('shin', models.monkeySeg(LEG[1], 0.012, 0.009), n * 2);
    mk('foot', models.monkeyHand(0.03), n * 2);
    mk('tail', models.monkeyTail(), n);
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
    this.render();
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
      this.hooks.notify('Monkeys are creeping into the village after your food! Wave them off with the pointer, or send a hunter.');
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
          if (this.time - this.lastTheft > 10) this.hooks.notify(`Monkeys made off with ${got.n}+ ${got.res}!`);
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

  private render(): void {
    const ms = this.meshes;
    const cnt: Record<string, number> = {};
    for (const k of Object.keys(ms)) cnt[k] = 0;
    const put = (key: string, parent: THREE.Matrix4, l: THREE.Matrix4) => {
      _m.multiplyMatrices(parent, l);
      ms[key].setMatrixAt(cnt[key]++, _m);
      return _m;
    };
    const L = new THREE.Matrix4();
    const chest = new THREE.Matrix4(), J = new THREE.Matrix4(), T = new THREE.Matrix4();
    for (const m of this.list) {
      if (m.dead) continue;
      const t = this.time + m.phase;
      let pitch = 0, roll = 0, bodyY = 0;
      let armL = -0.25, armR = -0.25, armLz = 0.25, armRz = -0.25;
      let legL = -1.4, legR = -1.4, legSpread = 0.35;
      // Elbows (forearm forward −), wrists, knees (shin back +), ankles, and the waist.
      let elbL = -0.35, elbR = -0.35, wriL = 0.1, wriR = 0.1;
      let kneeL = 1.7, kneeR = 1.7, ankL = -0.6, ankR = -0.6;
      let waistX = 0.12, waistY = 0;
      let tailX = -1.25, tailY = Math.sin(t * 0.8) * 0.25;
      let headX = 0, headY = m.look;
      let yaw = m.heading;
      let hangSwing = 0;
      switch (m.state) {
        case 'sit':
        case 'watch':
          headY = m.look + Math.sin(t * 0.6) * 0.5;
          headX = Math.sin(t * 0.37) * 0.15;
          armL = -0.4 + Math.sin(t * 0.3) * 0.05;
          // Forearms resting over the knees, now and then scratching.
          elbL = -0.9;
          elbR = -0.7 + Math.max(0, Math.sin(t * 0.21)) * Math.sin(t * 9) * 0.25;
          kneeL = 1.9;
          kneeR = 1.8;
          waistX = 0.2 + Math.sin(t * 0.4) * 0.04;
          waistY = Math.sin(t * 0.25) * 0.15;
          break;
        case 'eat':
          armR = -2.2 + Math.sin(t * 5) * 0.12;
          armRz = 0.3;
          elbR = -1.7 + Math.sin(t * 5) * 0.2;
          wriR = -0.6;
          elbL = -1.0;
          headX = 0.2 + Math.sin(t * 5) * 0.05;
          waistX = 0.22;
          break;
        case 'steal':
          // Hunched on the ground, rummaging with both hands and glancing about.
          armR = -1.4 + Math.sin(t * 9) * 0.4;
          armL = -1.4 - Math.sin(t * 9 + 1) * 0.4;
          elbR = elbL = -0.9;
          waistX = 0.5;
          pitch = 0.3;
          headX = 0.3;
          headY = Math.sin(t * 2.3) * 0.9;
          kneeL = kneeR = 2.0;
          break;
        case 'run':
        case 'walk': {
          const g = t * (m.state === 'run' ? 15 : 9);
          pitch = 1.2;
          bodyY = m.state === 'run' ? 0.12 + Math.abs(Math.sin(g)) * 0.03 : 0.1;
          armL = -pitch + Math.sin(g) * 0.55;
          armR = -pitch - Math.sin(g) * 0.55;
          legL = -pitch - Math.sin(g) * 0.55;
          legR = -pitch + Math.sin(g) * 0.55;
          // Limbs flex as they swing forward, straighten as they push.
          elbL = -0.15 - Math.max(0, Math.cos(g)) * 0.7;
          elbR = -0.15 - Math.max(0, -Math.cos(g)) * 0.7;
          kneeL = 0.35 + Math.max(0, -Math.cos(g)) * 0.9;
          kneeR = 0.35 + Math.max(0, Math.cos(g)) * 0.9;
          wriL = wriR = pitch * 0.6;
          ankL = ankR = -0.9;
          legSpread = 0.1;
          armLz = 0.1;
          armRz = -0.1;
          headX = -1.0;
          // Spine swings side to side with the stride.
          waistX = 0;
          waistY = Math.sin(g) * 0.14;
          // Tail up in an S curve for balance.
          tailX = -pitch + 0.9 + Math.sin(g * 0.5) * 0.1;
          break;
        }
        case 'climb': {
          const g = t * 7;
          armL = -2.6 + Math.sin(g) * 0.4;
          armR = -2.6 - Math.sin(g) * 0.4;
          // Reaching arm straight, pulling arm bent.
          elbL = -0.15 - Math.max(0, -Math.sin(g)) * 1.3;
          elbR = -0.15 - Math.max(0, Math.sin(g)) * 1.3;
          wriL = wriR = -0.4;
          legL = -1.0 - Math.sin(g) * 0.35;
          legR = -1.0 + Math.sin(g) * 0.35;
          kneeL = 1.3 + Math.sin(g) * 0.5;
          kneeR = 1.3 - Math.sin(g) * 0.5;
          ankL = ankR = -0.9;
          waistX = -0.1;
          waistY = Math.sin(g) * 0.12;
          pitch = 0.15;
          headX = -0.3;
          tailX = -1.4;
          break;
        }
        case 'hang': {
          // Hanging from the branch by the arms (tail wrapped above), swinging.
          hangSwing = Math.sin(t * 1.6) * 0.35;
          armL = armR = Math.PI;
          armLz = -0.15;
          armRz = 0.15;
          elbL = elbR = -0.1;
          wriL = wriR = -0.9;
          legL = Math.sin(t * 1.6 + 0.6) * 0.25;
          legR = Math.sin(t * 1.6 + 0.9) * 0.25;
          kneeL = 0.3 + Math.sin(t * 1.6 + 1.2) * 0.25;
          kneeR = 0.35 + Math.sin(t * 1.6 + 1.5) * 0.25;
          ankL = ankR = -0.4;
          waistX = Math.sin(t * 1.6 + 0.4) * 0.12;
          waistY = 0;
          legSpread = 0.2;
          tailX = 1.1;
          headX = -0.25;
          break;
        }
        case 'crouch': {
          const k = Math.min(1, m.t * 1.5);
          bodyY = -0.05 * k;
          pitch = 0.6 * k;
          legL = legR = -1.9 * k;
          kneeL = kneeR = 1.7 + 0.6 * k;
          armL = armR = -1.2 * k;
          elbL = elbR = -0.35 - 0.6 * k;
          waistX = 0.12 + 0.2 * k;
          headX = -0.5 * k;
          const dx = m.to.x - m.x, dz = m.to.z - m.z;
          yaw = Math.atan2(dx, dz);
          break;
        }
        case 'jump': {
          // Stretched out mid-air: arms reaching forward, legs trailing, tail streaming.
          const k = Math.min(1, m.t);
          pitch = 1.0 + (k - 0.5) * 0.6;
          armL = armR = -pitch - 1.4 + k * 0.4;
          elbL = elbR = -0.05;
          wriL = wriR = -0.3 + k * 0.5;
          armLz = 0.25;
          armRz = -0.25;
          legL = legR = -pitch + 0.9 - k * 0.8;
          kneeL = kneeR = 0.3 + k * 0.9;
          ankL = ankR = -0.3;
          waistX = -0.2 + k * 0.3;
          legSpread = 0.25;
          tailX = -pitch + 0.2;
          tailY = Math.sin(t * 6) * 0.15;
          headX = -0.8;
          break;
        }
        case 'land': {
          const k = m.timer / 0.35;
          bodyY = -0.06 * k;
          pitch = 0.6 * k;
          legL = legR = -1.4 - 0.5 * k;
          kneeL = kneeR = 1.7 + 0.5 * k;
          armL = armR = -0.8 * k - 0.3;
          elbL = elbR = -0.3 - 0.6 * k;
          waistX = 0.12 + 0.25 * k;
          break;
        }
      }
      const s = m.scale;
      if (m.state === 'hang') {
        // Pivot at the hands on the branch.
        local(_b, m.x, m.y + 0.02, m.z, 0, yaw, 0, s);
        L.copy(_b);
        _b.multiply(local(new THREE.Matrix4(), 0, 0, 0, hangSwing, 0, 0));
        _b.multiply(local(new THREE.Matrix4(), 0, -0.3, 0, 0, 0, 0));
      } else {
        local(_b, m.x, m.y + bodyY * s, m.z, pitch, yaw, roll, s);
      }
      put('pelvis', _b, local(L, 0, 0, 0, 0, 0, 0));
      chest.multiplyMatrices(_b, local(L, 0, 0.08, 0, waistX, waistY, 0));
      put('chest', chest, local(L, 0, 0, 0, 0, 0, 0));
      put('head', chest, local(L, 0, 0.09, 0.01, headX - waistX, headY - waistY, 0));
      // Arms: shoulder → elbow → wrist.
      for (const [side, ax, az, el, wr] of [[1, armL, armLz, elbL, wriL], [-1, armR, armRz, elbR, wriR]] as const) {
        J.multiplyMatrices(chest, local(T, side * 0.055, 0.065, 0, ax - waistX, 0, az));
        ms.uarm.setMatrixAt(cnt.uarm++, J);
        J.multiply(local(T, 0, -ARM[0], 0, el, 0, 0));
        ms.farm.setMatrixAt(cnt.farm++, J);
        J.multiply(local(T, 0, -ARM[1], 0, wr, 0, 0));
        ms.hand.setMatrixAt(cnt.hand++, J);
      }
      // Legs: hip → knee → ankle.
      for (const [side, lg, kn, an] of [[1, legL, kneeL, ankL], [-1, legR, kneeR, ankR]] as const) {
        J.multiplyMatrices(_b, local(T, side * 0.035, 0.03, 0.01, lg, 0, side * legSpread * 0.4));
        ms.thigh.setMatrixAt(cnt.thigh++, J);
        J.multiply(local(T, 0, -LEG[0], 0, kn, 0, 0));
        ms.shin.setMatrixAt(cnt.shin++, J);
        J.multiply(local(T, 0, -LEG[1], 0, an, 0, 0));
        ms.foot.setMatrixAt(cnt.foot++, J);
      }
      put('tail', _b, local(L, 0, 0.035, -0.04, tailX, tailY, 0));
      // Stolen food clutched to the chest.
      if (m.raid?.carry) put('loot', chest, local(L, 0, 0.03, 0.06, 0, 0, 0));
      void roll;
    }
    for (const [k, mesh] of Object.entries(ms)) {
      mesh.count = cnt[k];
      mesh.instanceMatrix.needsUpdate = true;
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
