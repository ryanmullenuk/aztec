import * as THREE from 'three';
import { ALLIGATORS, DEFENCE } from '../config';
import { ColorFn, GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';
import { QuadMeshes } from './quadRig';

type AState = 'float' | 'swim' | 'dive' | 'crawl' | 'bask' | 'lunge' | 'retreat' | 'dead';

interface Gator {
  swamp: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  state: AState;
  timer: number;
  tx: number;
  tz: number;
  /** Seconds before it can strike again. */
  cool: number;
  /** Jaws open 0..1, tail sweep phase, how submerged (0 floating … 1 under). */
  jaw: number;
  sweep: number;
  sink: number;
  speed: number;
  scale: number;
  react: number;
  preyKind: 'villager' | 'dog' | null;
  preyId: number;
  /** Arrow hits it can still take. */
  hp: number;
  // ---- Animation only (smoothed) ----
  /** Gait phase (cycles) and blend weights: walking, swimming (legs tucked), basking. */
  gph: number;
  walkW: number;
  swimW: number;
  baskW: number;
  /** Tail wave amplitude and spine bend. */
  tailA: number;
  spine: number;
  lift: number;
}

const C = (c: number) => ({ color: c });
const BACK = 0x3a4428, BELLY = 0x8a8a5a, SCUTE = 0x2a3220, SKIN_D = 0x323a22;

/** Rig dimensions (body frame at the spine joint; faces +z). */
const ALG = {
  head: [0, 0.01, 0.17] as [number, number, number],
  tail: [0, 0.004, -0.17] as [number, number, number],
  tailLen: [0.11, 0.1, 0.1, 0.09],
  tailR: [0.05, 0.04, 0.028, 0.017, 0.006],
  /** Shoulder and hip roots (right side). */
  legF: [0.068, -0.014, 0.1] as [number, number, number],
  legR: [0.072, -0.01, -0.105] as [number, number, number],
  L1: 0.055,
  L2: 0.05,
  /** Neutral foot reach out to the side, and the step length per gait cycle. */
  reach: 0.075,
  stride: 0.16,
};

/** Gait: fraction of the cycle a foot is planted, step lift, how much the spine and tail swing. */
const GATOR_GAIT = { duty: 0.6, lift: 0.028, spine: 0.16, walkTail: 0.3 };
/** Tail sculling amplitude (radians at the tip) swimming, and the travelling wave's lag per segment. */
const GATOR_SWIM = { tail: 0.55, lag: 0.85 };

const backCol = (p: THREE.Vector3, n: THREE.Vector3) => new THREE.Color(n.y < -0.25 || p.y < -0.022 ? BELLY : BACK).multiplyScalar(0.94 + 0.08 * Math.sin(p.z * 160) * Math.sin(p.x * 120));

/**
 * Front or rear half of the body (they overlap at the spine joint so it can bend without a gap):
 * low and broad, pale belly with transverse scale rows, armoured back with keeled osteoderms in
 * rows, and the big nuchal scutes behind the head on the front half.
 */
function bodyHalf(front: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const z0 = front ? 0.065 : -0.065;
  b.add(P.sphere(0.1, 1), { color: backCol }, M.t(0, 0, z0, 0, 0, 0, front ? 1 : 0.97, 0.46, front ? 1.3 : 1.35));
  // Belly scale rows.
  for (let k = 0; k < 4; k++) b.add(P.box(0.13, 0.004, 0.006), C(0x7a7a4e), M.t(0, -0.043, z0 + (k - 1.5) * 0.035));
  // Osteoderm rows along the back.
  const rows = front ? [0.0, 0.03, 0.06, 0.09, 0.12] : [-0.02, -0.05, -0.08, -0.11, -0.14];
  for (const z of rows)
    for (const x of [-0.05, -0.022, 0.022, 0.05]) {
      const y = 0.046 * Math.sqrt(Math.max(0, 1 - (x / 0.1) ** 2)) * 0.95;
      b.add(P.cone(0.012, 0.014, 4), C(SCUTE), M.t(x, y, z, 0, Math.PI / 4, 0, 1, 1, 1.4));
    }
  if (front) for (const x of [-0.03, -0.012, 0.012, 0.03]) b.add(P.cone(0.014, 0.02, 4), C(SCUTE), M.t(x, 0.044, 0.15, 0, Math.PI / 4, 0, 1, 1, 1.2));
  // Neck skin joining the head.
  if (front) b.add(P.sphere(0.06, 1), { color: backCol }, M.t(0, 0.005, 0.16, 0, 0, 0, 1, 0.55, 0.9));
  return facet(b.build());
}

/** A tapered box running from z0 along +z (snout, jaw), width and height interpolated. */
function taperBox(len: number, w0: number, w1: number, h0: number, h1: number, z0: number, y0: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 1, 4);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getZ(i) + 0.5;
    // A broad, rounded U-shaped snout: the tip narrows only at the very end.
    const w = w0 + (w1 - w0) * u * u;
    const h = h0 + (h1 - h0) * u;
    p.setXYZ(i, p.getX(i) * w, y0 + p.getY(i) * h, z0 + u * len);
  }
  return g;
}

/** Head with the upper jaw: broad skull, long rounded snout, raised eyes and brows, nostril knob, teeth. */
function headGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(taperBox(0.09, 0.1, 0.085, 0.046, 0.034, -0.02, 0.012), C(BACK));
  b.add(taperBox(0.13, 0.08, 0.052, 0.03, 0.022, 0.06, 0.004), { color: (p) => new THREE.Color(Math.sin(p.z * 150) > 0.7 ? SKIN_D : 0x3e4a2c) });
  b.add(P.sphere(0.013, 0), C(0x2a2a1a), M.t(0, 0.02, 0.18, 0, 0, 0, 1.3, 0.8, 1));
  for (const x of [-1, 1]) b.add(P.sphere(0.004, 0), C(0x0c0c08), M.t(x * 0.006, 0.027, 0.183));
  // Teeth along the upper jaw.
  for (let k = 0; k < 7; k++) {
    const z = 0.07 + k * 0.018, w = 0.04 - k * 0.0018;
    for (const x of [-1, 1]) b.add(P.cone(0.0035, 0.013, 3), C(0xe8e0c8), M.t(x * w, -0.012, z, Math.PI, 0, 0));
  }
  for (const x of [-1, 1]) {
    // Bony brows and the raised eyes with yellow irises and dark slit pupils.
    b.add(P.sphere(0.016, 0), C(SCUTE), M.t(x * 0.028, 0.04, 0.02, 0, 0, 0, 1, 0.9, 1.2));
    b.add(P.sphere(0.009, 0), C(0xc8a030), M.t(x * 0.032, 0.047, 0.03));
    b.add(P.box(0.002, 0.009, 0.003), C(0x0c0c08), M.t(x * 0.039, 0.048, 0.034));
  }
  return facet(b.build());
}

/** Lower jaw, from its hinge at the back of the skull: pale underneath, teeth pointing up. */
function jawGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(taperBox(0.2, 0.085, 0.05, 0.02, 0.014, 0, -0.01), { color: (_p, n) => new THREE.Color(n.y > 0.5 ? 0xb89a8a : BELLY) });
  for (let k = 0; k < 6; k++) for (const x of [-1, 1]) b.add(P.cone(0.0035, 0.012, 3), C(0xe8e0c8), M.t(x * (0.036 - k * 0.002), 0.004, 0.05 + k * 0.024));
  return facet(b.build());
}

/** One tail segment from its joint trailing along −z: laterally flattened, with its crest scutes. */
function tailGeo(k: number): THREE.BufferGeometry {
  const len = ALG.tailLen[k], r0 = ALG.tailR[k], r1 = ALG.tailR[k + 1];
  const b = new GeoBuilder();
  const flat = 0.8 - k * 0.1;
  b.add(P.sphere(r0 * 0.98, 0), { color: backCol }, M.t(0, 0, 0, 0, 0, 0, flat, 0.9, 1));
  b.add(P.cyl(r1, r0, len, 7), { color: (p, n) => new THREE.Color(n.y < -0.3 ? BELLY : BACK) }, M.t(0, 0, -len / 2, -Math.PI / 2, 0, 0, flat, 1, 1.05));
  // A double crest near the body that merges into a single one toward the tip.
  for (let j = 0; j < 4; j++) {
    const z = -len * (0.12 + j * 0.24), r = r0 + (r1 - r0) * (0.12 + j * 0.24);
    const h = 0.012 + r * 0.25;
    if (k < 2) for (const x of [-1, 1]) b.add(P.box(0.008, h, 0.02), C(SCUTE), M.t(x * r * 0.35, r * 0.85, z));
    else b.add(P.box(0.008, h * 1.3, 0.022), C(SCUTE), M.t(0, r * 0.95, z));
  }
  return facet(b.build());
}

/** A limb segment from its joint out along +x (symmetric front-to-back, so it serves both sides). */
function limbSeg(len: number, r0: number, r1: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r0 * 1.1, 0), C(BACK));
  b.add(P.cyl(r1, r0, len, 6), { color: (p, n) => new THREE.Color(n.y < -0.3 ? BELLY : BACK) }, M.t(len / 2, 0, 0, 0, 0, -Math.PI / 2));
  return facet(b.build());
}

/** Foot from the wrist / ankle, lying flat and pointing forward: splayed clawed toes (webbed at the back). */
function footGeo(toes: number, len: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.box(0.03, 0.01, 0.026), C(SKIN_D), M.t(0, -0.004, 0.008));
  for (let k = 0; k < toes; k++) {
    const a = -0.9 + (k / (toes - 1)) * 1.8;
    b.add(P.box(0.006, 0.006, len), C(SKIN_D), M.t(Math.sin(a) * len * 0.55, -0.006, 0.01 + Math.cos(a) * len * 0.55, 0, a, 0));
    b.add(P.cone(0.003, 0.008, 3), C(0x1a1a10), M.t(Math.sin(a) * len * 1.05, -0.006, 0.01 + Math.cos(a) * len * 1.05, Math.PI / 2, 0, 0));
  }
  if (toes === 4) b.add(P.cone(len * 0.8, len, 3), C(SKIN_D), M.t(0, -0.007, 0.022, Math.PI / 2, 0, 0, 1, 1, 0.1));
  return facet(b.build());
}

const _b = new THREE.Matrix4(), _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _r = new THREE.Matrix4();
const _f = new THREE.Matrix4(), _c = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);
function compose(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAIL_KEYS = ['tail0', 'tail1', 'tail2', 'tail3'];

const _ik = { a: 0, b: 0 };
/** Two-bone IK in the leg's vertical plane: foot at (h out, v up) from the shoulder/hip; elbow up. */
function legIK(h: number, v: number, L1: number, L2: number): void {
  const d = THREE.MathUtils.clamp(Math.hypot(h, v), Math.abs(L1 - L2) + 1e-4, (L1 + L2) * 0.999);
  const phi = Math.atan2(v, h);
  const al = Math.acos(THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  _ik.a = phi + al;
  _ik.b = Math.atan2(v - L1 * Math.sin(_ik.a), h - L1 * Math.cos(_ik.a)) - _ik.a;
}

export interface GatorHooks {
  people: SpatialHash<Islander>;
  dogs: () => { id: number; x: number; z: number; puppy: boolean; dead: boolean }[];
  /** A villager seized: injured or killed. */
  bite: (isl: Islander, killed: boolean) => void;
  biteDog: (id: number, fromX: number, fromZ: number) => void;
  splash: (x: number, z: number, n: number, speed: number, r: number, y: number) => void;
  sfx: (name: string, x: number, z: number) => void;
  godMode: () => boolean;
}

/**
 * Alligators: a few per swamp, and only there. They float with just eyes and snout above the
 * murky water, drift, slip under and resurface somewhere else, and haul out to bask on the mud.
 * Ambush predators: anyone (or any dog) coming within a couple of strides of the water's edge
 * where one lies may get a sudden lunge. They never chase far, and go straight back to the water.
 */
export class Alligators {
  readonly meshes = new QuadMeshes();
  list: Gator[] = [];
  private rng: RNG;
  private pools: { x: number; z: number }[][] = [];
  private banks: { x: number; z: number }[][] = [];
  hooks: GatorHooks | null = null;
  private time = 0;
  /** Swamps waiting for a new alligator (one was shot there), and when it turns up. */
  private pending: { swamp: number; at: number }[] = [];

  constructor(private world: World) {
    this.rng = new RNG(world.seed * 173 + 61);
    this.findPlaces();
    this.spawn();
    const n = ALLIGATORS.max + 1;
    this.meshes.add('bodyF', bodyHalf(true), n);
    this.meshes.add('bodyR', bodyHalf(false), n);
    this.meshes.add('head', headGeo(), n);
    this.meshes.add('jaw', jawGeo(), n);
    for (let k = 0; k < 4; k++) this.meshes.add(`tail${k}`, tailGeo(k), n);
    this.meshes.add('upperF', limbSeg(ALG.L1, 0.017, 0.014), n * 2);
    this.meshes.add('lowerF', limbSeg(ALG.L2, 0.014, 0.011), n * 2);
    this.meshes.add('footF', footGeo(5, 0.024), n * 2);
    this.meshes.add('upperR', limbSeg(ALG.L1, 0.021, 0.016), n * 2);
    this.meshes.add('lowerR', limbSeg(ALG.L2, 0.016, 0.012), n * 2);
    this.meshes.add('footR', footGeo(4, 0.03), n * 2);
  }

  private findPlaces(): void {
    const w = this.world;
    for (const sw of w.swamps) {
      const pools: { x: number; z: number }[] = [], banks: { x: number; z: number }[] = [];
      for (let k = 0; k < 900; k++) {
        const a = this.rng.range(0, 6.28), d = Math.sqrt(this.rng.next()) * (sw.r + 2);
        const x = sw.x + Math.cos(a) * d, z = sw.z + Math.sin(a) * d;
        const wy = w.swampWaterY(x, z);
        const g = w.heightAt(x, z);
        if (!Number.isNaN(wy) && wy - g > 0.15) pools.push({ x, z });
        else if (Number.isNaN(wy) || wy - g < 0.02) {
          const i = w.cellIndexAt(x, z);
          if (i >= 0 && w.swamp[i] > 0.45 && !w.occ[i]) banks.push({ x, z });
        }
      }
      this.pools.push(pools);
      this.banks.push(banks);
    }
  }

  private spawn(): void {
    this.world.swamps.forEach((_, si) => {
      if (!this.pools[si].length) return;
      const n = this.rng.int(ALLIGATORS.perSwamp[0], ALLIGATORS.perSwamp[1]);
      for (let k = 0; k < n && this.list.length < ALLIGATORS.max; k++) {
        this.list.push(this.make(si));
      }
    });
  }

  private make(si: number): Gator {
    const p = this.pools[si][this.rng.int(0, this.pools[si].length - 1)];
    return {
      swamp: si, x: p.x, y: 0, z: p.z, heading: this.rng.range(0, 6.28), state: 'float', timer: this.rng.range(5, 25), tx: p.x, tz: p.z,
      cool: 0, jaw: 0, sweep: this.rng.next() * 6, sink: 0, speed: 0, scale: this.rng.range(0.9, 1.2), react: this.rng.next(), preyKind: null, preyId: -1, hp: DEFENCE.gatorHits,
      gph: this.rng.next(), walkW: 0, swimW: 0, baskW: 0, tailA: 0.1, spine: 0, lift: 0,
    };
  }

  /** Alligators an archer may shoot at (any still alive). */
  get targets(): Gator[] {
    return this.list.filter((g) => g.state !== 'dead');
  }

  /**
   * Struck by an arrow: it thrashes and slips away under the water (or back into it off the bank),
   * or dies after enough hits and sinks, and a while later another turns up in the swamps from
   * upriver: they never die out.
   */
  hitByArrow(g: Gator): 'hurt' | 'killed' {
    if (g.state === 'dead') return 'killed';
    const h = this.hooks;
    g.hp--;
    const wy = this.waterY(g.x, g.z);
    if (h && !Number.isNaN(wy)) h.splash(g.x, g.z, g.hp > 0 ? 18 : 34, 1.2, 0.3, wy);
    h?.sfx('splash', g.x, g.z);
    g.preyKind = null;
    g.cool = ALLIGATORS.cooldown;
    if (g.hp > 0) {
      const inWater = !Number.isNaN(wy) && wy - this.world.heightAt(g.x, g.z) > 0.12;
      if (inWater) {
        g.state = 'dive';
        g.timer = this.rng.range(14, 26);
      } else {
        const p = this.pickPool(g);
        g.state = 'retreat';
        g.tx = p.x;
        g.tz = p.z;
        g.timer = 20;
      }
      return 'hurt';
    }
    g.state = 'dead';
    g.timer = 9;
    g.jaw = 0.4;
    this.pending.push({ swamp: g.swamp, at: this.time + this.rng.range(DEFENCE.respawn[0], DEFENCE.respawn[1]) });
    return 'killed';
  }

  private waterY(x: number, z: number): number {
    return this.world.swampWaterY(x, z);
  }

  update(dt: number): void {
    this.time += dt;
    if (dt > 0 && this.hooks) for (const g of this.list) this.think(g, dt);
    this.list = this.list.filter((g) => g.state !== 'dead' || g.timer > 0);
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const p = this.pending[k];
      if (this.time < p.at || this.list.length >= ALLIGATORS.max) continue;
      this.pending.splice(k, 1);
      // Turns up under the water, somewhere in the swamps (not necessarily the same one).
      const swamps = this.pools.map((P, i) => (P.length ? i : -1)).filter((i) => i >= 0);
      const g = this.make(swamps.includes(p.swamp) && this.rng.chance(0.6) ? p.swamp : swamps[this.rng.int(0, swamps.length - 1)]);
      g.state = 'dive';
      g.sink = 1;
      g.timer = this.rng.range(4, 10);
      this.list.push(g);
    }
    this.draw(dt);
  }

  private pickPool(g: Gator): { x: number; z: number } {
    const P = this.pools[g.swamp];
    return P[this.rng.int(0, P.length - 1)];
  }

  private moveTo(g: Gator, speed: number, dt: number): boolean {
    const dx = g.tx - g.x, dz = g.tz - g.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.1) return true;
    g.heading = turn(g.heading, Math.atan2(dx, dz), dt * 1.8);
    const step = Math.min(d, speed * dt);
    g.x += Math.sin(g.heading) * step;
    g.z += Math.cos(g.heading) * step;
    return false;
  }

  /** Someone within striking distance of the waiting alligator? */
  private ambush(g: Gator): boolean {
    const h = this.hooks!;
    if (g.cool > 0) return false;
    let best: Islander | null = null, bd = ALLIGATORS.lungeRange;
    h.people.query(g.x, g.z, ALLIGATORS.lungeRange, (p) => {
      if (p.hidden) return;
      const d = Math.hypot(p.x - g.x, p.z - g.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    });
    let dog: { id: number; x: number; z: number } | null = null;
    for (const d of h.dogs()) {
      if (d.dead) continue;
      const dd = Math.hypot(d.x - g.x, d.z - g.z);
      if (dd < bd) {
        bd = dd;
        dog = d;
        best = null;
      }
    }
    const target = (best as Islander | null) ?? dog;
    if (!target || !this.rng.chance(0.55)) return false;
    g.state = 'lunge';
    g.tx = target.x;
    g.tz = target.z;
    g.timer = 0.5;
    g.preyKind = best ? 'villager' : 'dog';
    g.preyId = best ? (best as Islander).id : dog!.id;
    g.heading = Math.atan2(target.x - g.x, target.z - g.z);
    h.sfx('growl', g.x, g.z);
    const wy = this.waterY(g.x, g.z);
    if (!Number.isNaN(wy)) h.splash(g.x, g.z, 30, 1.4, 0.3, wy);
    return true;
  }

  private think(g: Gator, dt: number): void {
    const h = this.hooks!;
    const r = this.rng;
    const w = this.world;
    g.cool = Math.max(0, g.cool - dt);
    g.sweep += dt * (g.state === 'swim' ? 3 : g.state === 'crawl' || g.state === 'retreat' ? 4 : g.state === 'lunge' ? 10 : 0.6);
    g.react -= dt;
    const waiting = g.state === 'float' || g.state === 'bask' || g.state === 'swim';
    if (g.react <= 0) {
      g.react = 0.25;
      if (waiting && this.ambush(g)) return;
    }
    let sinkT = 0, jawT = 0, speed = 0;
    switch (g.state) {
      case 'dead':
        // Rolls and sinks out of sight in the water; on the mud it lies still and is gone later.
        g.timer -= dt;
        sinkT = 1.4;
        break;
      case 'float':
        g.timer -= dt;
        g.heading += Math.sin(g.sweep * 0.2) * dt * 0.05;
        if (g.timer <= 0) {
          const x = r.next();
          if (x < 0.4) {
            const p = this.pickPool(g);
            g.state = 'swim';
            g.tx = p.x;
            g.tz = p.z;
            g.timer = 40;
          } else if (x < 0.65) {
            g.state = 'dive';
            g.timer = r.range(8, 22);
          } else if (this.banks[g.swamp].length) {
            const b = this.banks[g.swamp][r.int(0, this.banks[g.swamp].length - 1)];
            g.state = 'crawl';
            g.tx = b.x;
            g.tz = b.z;
            g.timer = 40;
          } else g.timer = r.range(10, 30);
        }
        break;
      case 'swim':
        speed = 0.35;
        g.timer -= dt;
        if (this.moveTo(g, speed, dt) || g.timer <= 0) {
          g.state = 'float';
          g.timer = r.range(12, 40);
        }
        break;
      case 'dive':
        // Slips under and resurfaces a little way off.
        sinkT = 1;
        g.timer -= dt;
        if (g.timer <= 0) {
          const p = this.pickPool(g);
          if (Math.hypot(p.x - g.x, p.z - g.z) < 8) {
            g.x = p.x;
            g.z = p.z;
          }
          g.state = 'float';
          g.timer = r.range(10, 30);
        }
        break;
      case 'crawl':
        speed = 0.3;
        g.timer -= dt;
        if (this.moveTo(g, speed, dt) || g.timer <= 0) {
          g.state = 'bask';
          g.timer = r.range(30, 90);
        }
        break;
      case 'bask':
        // Lying on the mud, now and then gaping to cool off.
        jawT = Math.sin(g.sweep * 0.3) > 0.7 ? 0.7 : 0;
        g.timer -= dt;
        if (g.timer <= 0) {
          const p = this.pickPool(g);
          g.state = 'retreat';
          g.tx = p.x;
          g.tz = p.z;
          g.timer = 30;
        }
        break;
      case 'lunge': {
        // A short explosive burst, jaws wide, then a snap.
        jawT = g.timer > 0.12 ? 1 : 0;
        speed = ALLIGATORS.lungeSpeed;
        this.moveTo(g, speed, dt);
        g.timer -= dt;
        if (g.timer <= 0) this.snap(g);
        break;
      }
      case 'retreat':
        speed = 0.9;
        g.timer -= dt;
        if (this.moveTo(g, speed, dt) || g.timer <= 0 || (!Number.isNaN(this.waterY(g.x, g.z)) && this.waterY(g.x, g.z) - w.heightAt(g.x, g.z) > 0.2)) {
          g.state = 'dive';
          g.timer = r.range(10, 20);
          const wy2 = this.waterY(g.x, g.z);
          if (!Number.isNaN(wy2)) h.splash(g.x, g.z, 15, 0.8, 0.2, wy2);
        }
        break;
    }
    g.speed = speed;
    g.jaw += (jawT - g.jaw) * Math.min(1, dt * (jawT > g.jaw ? 18 : 10));
    g.sink += (sinkT - g.sink) * Math.min(1, dt * 1.2);
    const wy = this.waterY(g.x, g.z);
    const ground = w.heightAt(g.x, g.z);
    // Floating: only the eyes, snout and ridge of the back break the surface.
    g.y = !Number.isNaN(wy) && wy - ground > 0.08 ? Math.max(ground + 0.05, wy - 0.045 - g.sink * 0.22) : ground + 0.045;
    if (g.state === 'dead') g.y -= Math.max(0, 3 - g.timer) * 0.06;
  }

  private snap(g: Gator): void {
    const h = this.hooks!;
    const r = this.rng;
    const sx = g.x + Math.sin(g.heading) * 0.25 * g.scale, sz = g.z + Math.cos(g.heading) * 0.25 * g.scale;
    let hit = false;
    if (g.preyKind === 'villager') {
      let prey: Islander | null = null;
      h.people.query(sx, sz, 0.8, (p) => p.id === g.preyId && !p.hidden && (prey = p));
      if (prey && r.chance(ALLIGATORS.hitChance)) {
        hit = true;
        h.bite(prey, !h.godMode() && r.chance(ALLIGATORS.killChance));
      }
    } else if (g.preyKind === 'dog') {
      const d = h.dogs().find((x) => x.id === g.preyId && !x.dead);
      if (d && Math.hypot(d.x - sx, d.z - sz) < 0.8 && r.chance(ALLIGATORS.hitChance)) {
        hit = true;
        h.biteDog(d.id, g.x, g.z);
      }
    }
    h.sfx(hit ? 'yelp' : 'splash', sx, sz);
    g.cool = ALLIGATORS.cooldown;
    g.preyKind = null;
    // Straight back into the water.
    const p = this.pickPool(g);
    let best = p, bd = Infinity;
    for (let k = 0; k < 10; k++) {
      const q = this.pickPool(g);
      const d = Math.hypot(q.x - g.x, q.z - g.z);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    g.state = 'retreat';
    g.tx = best.x;
    g.tz = best.z;
    g.timer = 20;
  }

  // ---------------- Drawing ----------------

  private draw(dt: number): void {
    const m = this.meshes;
    m.begin();
    for (const g of this.list) {
      if (!View.sees(g.x, g.y, g.z, 0.6)) continue;
      this.drawGator(g, dt);
    }
    m.end();
  }

  private drawGator(g: Gator, dt: number): void {
    const m = this.meshes;
    const s = g.scale;
    const walking = g.state === 'crawl' || g.state === 'retreat' || g.state === 'lunge';
    const swimming = g.state === 'swim' || g.state === 'dive';
    const lunge = g.state === 'lunge';
    g.walkW += ((walking ? 1 : 0) - g.walkW) * Math.min(1, dt * (walking ? 6 : 3));
    g.swimW += ((swimming ? 1 : 0) - g.swimW) * Math.min(1, dt * 3);
    g.baskW += ((g.state === 'bask' ? 1 : 0) - g.baskW) * Math.min(1, dt * 2);
    g.lift += ((walking ? (lunge ? 0.045 : 0.03) : 0) - g.lift) * Math.min(1, dt * 5);
    g.tailA += ((swimming ? GATOR_SWIM.tail : lunge ? 0.6 : walking ? GATOR_GAIT.walkTail : g.state === 'float' ? 0.1 : 0.05) - g.tailA) * Math.min(1, dt * 3);
    // Gait phase: cycles per second so the planted feet keep pace with the body.
    g.gph += dt * (g.speed / (ALG.stride * s));
    const gp = g.gph * Math.PI * 2;
    // Spine: bends side to side in time with the diagonal steps on land; a small recoil to each
    // tail stroke when swimming.
    g.spine = Math.sin(gp) * GATOR_GAIT.spine * g.walkW + Math.sin(g.sweep + 1.2) * 0.06 * g.swimW * (1 - g.walkW);
    const pitch = lunge ? -0.12 : 0;
    const roll = Math.sin(gp) * 0.035 * g.walkW;
    const by = g.y + g.lift * s;
    compose(_r, g.x, by, g.z, pitch, g.heading, roll, s);
    _b.multiplyMatrices(_r, compose(_t, 0, 0, 0, 0, g.spine * 0.5, 0));
    m.put('bodyF', _b, WHITE);
    _f.multiplyMatrices(_r, compose(_t, 0, 0, 0, 0, -g.spine * 0.5, 0));
    m.put('bodyR', _f, WHITE);
    // Head: held steady against the spine's swing; raised a touch afloat so eyes and nostrils clear
    // the surface; the lower jaw drops wide in a lunge (the head tips back as it opens).
    const headP = (g.state === 'float' ? -0.05 : 0) - g.jaw * 0.25 - (lunge ? 0.1 : 0) - g.baskW * 0.06;
    _m.multiplyMatrices(_b, compose(_t, ALG.head[0], ALG.head[1], ALG.head[2], headP, -g.spine * 0.9, 0));
    m.put('head', _m, WHITE);
    _m.multiply(compose(_t, 0, -0.012, -0.015, g.jaw * 0.8, 0, 0));
    m.put('jaw', _m, WHITE);
    // Tail: a travelling wave from base to tip (bigger toward the tip); it continues the spine's
    // curve on land and lies along the ground behind the raised body.
    _m.multiplyMatrices(_f, compose(_t, ALG.tail[0], ALG.tail[1], ALG.tail[2], -g.lift * 1.4, -g.spine * 0.6 + g.tailA * 0.35 * Math.sin(g.sweep), 0));
    m.put('tail0', _m, WHITE);
    for (let k = 1; k < 4; k++) {
      const a = g.tailA * (0.35 + k * 0.22) * Math.sin(g.sweep - k * GATOR_SWIM.lag) - g.spine * 0.25;
      _m.multiply(compose(_t, 0, 0, -ALG.tailLen[k - 1], k === 1 ? g.lift * 1.2 : 0, a, 0));
      m.put(TAIL_KEYS[k], _m, WHITE);
    }
    // Legs: a sprawling walk in diagonal pairs (RF with LH, LF with RH), feet planted and solved with
    // IK; pressed back along the flanks when swimming; splayed and hanging afloat; sprawled flat
    // on the mud when basking.
    const groundL = (this.world.heightAt(g.x, g.z) - by) / s;
    for (let k = 0; k < 4; k++) {
      const front = k < 2, side = k % 2 ? -1 : 1;
      const root = front ? ALG.legF : ALG.legR;
      const off = (front ? side > 0 : side < 0) ? 0 : 0.5;
      const local = (((g.gph + off) % 1) + 1) % 1;
      const A = ALG.stride * GATOR_GAIT.duty * 0.5;
      let dz: number, lift = 0;
      if (local < GATOR_GAIT.duty) dz = A * (1 - (2 * local) / GATOR_GAIT.duty);
      else {
        const e = (local - GATOR_GAIT.duty) / (1 - GATOR_GAIT.duty);
        dz = -A + 2 * A * e * e * (3 - 2 * e);
        lift = Math.sin(Math.PI * e) * GATOR_GAIT.lift;
      }
      const maxDown = -(ALG.L1 + ALG.L2) * 0.97;
      const v = Math.max(maxDown, groundL - root[1] + lift);
      // Walk pose (IK to the stepping foot).
      const fwd = dz + (front ? 0.02 : -0.015);
      legIK(Math.hypot(ALG.reach, fwd), v, ALG.L1, ALG.L2);
      let yaw = Math.atan2(fwd, ALG.reach), ua = _ik.a, lb = _ik.b;
      // Bask pose: sprawled on the mud.
      const bfwd = front ? 0.035 : -0.05;
      legIK(Math.hypot(ALG.reach * 1.1, bfwd), Math.max(maxDown, groundL - root[1]), ALG.L1, ALG.L2);
      const byaw = Math.atan2(bfwd, ALG.reach * 1.1);
      // Float pose: hanging splayed, sculling slowly.
      const fyaw = (front ? 0.35 : -0.35) + Math.sin(g.sweep * 0.7 + k) * 0.1, fa = -0.55, fb = -0.55;
      // Swim pose: pressed back along the body.
      const tyaw = front ? -1.3 : -1.45, ta = -0.05, tb = -0.12;
      const wW = g.walkW, bW = g.baskW * (1 - wW);
      yaw = lerp(lerp(lerp(fyaw, byaw, bW), yaw, wW), tyaw, g.swimW);
      ua = lerp(lerp(lerp(fa, _ik.a, bW), ua, wW), ta, g.swimW);
      lb = lerp(lerp(lerp(fb, _ik.b, bW), lb, wW), tb, g.swimW);
      const part = front ? _b : _f;
      compose(_c, side * root[0], root[1], root[2], 0, side > 0 ? -yaw : Math.PI + yaw, ua);
      _m.multiplyMatrices(part, _c);
      m.put(front ? 'upperF' : 'upperR', _m, WHITE);
      _c.multiply(compose(_t, ALG.L1, 0, 0, 0, 0, lb));
      _m.multiplyMatrices(part, _c);
      m.put(front ? 'lowerF' : 'lowerR', _m, WHITE);
      // Foot: at the end of the lower leg, lying flat, toes turned out (back along the body when tucked).
      _c.multiply(compose(_t, ALG.L2, 0, 0, 0, 0, 0));
      const e = _c.elements;
      const footYaw = side * lerp(front ? 0.35 : 0.5, 2.7, g.swimW);
      _m.multiplyMatrices(part, compose(_t, e[12], e[13], e[14], 0, footYaw, 0));
      m.put(front ? 'footF' : 'footR', _m, WHITE);
    }
  }
}

function turn(h: number, a: number, k: number): number {
  let d = a - h;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return h + d * Math.min(1, k);
}
