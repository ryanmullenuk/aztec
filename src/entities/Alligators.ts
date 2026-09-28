import * as THREE from 'three';
import { ALLIGATORS } from '../config';
import { GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';
import { QuadMeshes } from './quadRig';

type AState = 'float' | 'swim' | 'dive' | 'crawl' | 'bask' | 'lunge' | 'retreat';

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
}

const C = (c: number) => ({ color: c });
const BACK = 0x3a4428, BELLY = 0x8a8a5a, SCUTE = 0x2a3220;

/** Body: low, broad, armoured back with rows of scutes, pale belly. Faces +z, centre at origin. */
function bodyGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.1, 1), { color: (p) => new THREE.Color(p.y < -0.02 ? BELLY : BACK) }, M.t(0, 0, 0, 0, 0, 0, 1, 0.45, 1.9));
  for (let k = 0; k < 7; k++) for (const x of [-0.035, 0, 0.035]) b.add(P.box(0.022, 0.018, 0.03), C(SCUTE), M.t(x, 0.045 - Math.abs(x) * 0.25, -0.15 + k * 0.05));
  return facet(b.build());
}

/** Head with the upper jaw: flat broad snout, raised eyes and nostrils (all that shows above water). */
function headGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.box(0.1, 0.045, 0.1), C(BACK), M.t(0, 0.012, 0.03));
  b.add(P.box(0.075, 0.03, 0.16), C(0x3e4a2c), M.t(0, 0.004, 0.14));
  b.add(P.sphere(0.012, 0), C(0x2a2a1a), M.t(0, 0.022, 0.215));
  // Teeth along the upper jaw.
  for (let k = 0; k < 6; k++) for (const x of [-1, 1]) b.add(P.cone(0.004, 0.014, 3), C(0xe8e0c8), M.t(x * 0.035, -0.014, 0.08 + k * 0.025, Math.PI, 0, 0));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.015, 0), C(0x3a4428), M.t(x * 0.028, 0.04, 0.03));
    b.add(P.sphere(0.008, 0), C(0xc8a030), M.t(x * 0.03, 0.046, 0.036));
  }
  return facet(b.build());
}

function jawGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.box(0.07, 0.018, 0.2), C(BELLY), M.t(0, -0.008, 0.1));
  for (let k = 0; k < 5; k++) for (const x of [-1, 1]) b.add(P.cone(0.004, 0.012, 3), C(0xe8e0c8), M.t(x * 0.03, 0.006, 0.05 + k * 0.03));
  return facet(b.build());
}

function tailGeo(len: number, r0: number, r1: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(r1, r0, len, 6), { color: (p) => new THREE.Color(p.y < -0.01 ? BELLY : BACK) }, M.t(0, 0, -len / 2, Math.PI / 2, 0, 0, 1, 1, 0.7));
  // A double crest of scutes down the tail.
  for (let k = 0; k < 5; k++) b.add(P.box(0.012, 0.022, 0.025), C(SCUTE), M.t(0, r0 * 0.6, -len * (0.1 + k * 0.18)));
  return facet(b.build());
}

function legGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.014, 0.02, 0.08, 5), C(BACK), M.t(0.04, -0.01, 0, 0, 0, Math.PI / 2 + 0.4));
  b.add(P.box(0.04, 0.008, 0.035), C(0x2e3620), M.t(0.075, -0.035, 0.01));
  return facet(b.build());
}

const _b = new THREE.Matrix4(), _m = new THREE.Matrix4(), _t = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);
function compose(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
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

  constructor(private world: World) {
    this.rng = new RNG(world.seed * 173 + 61);
    this.findPlaces();
    this.spawn();
    const n = ALLIGATORS.max + 1;
    this.meshes.add('body', bodyGeo(), n);
    this.meshes.add('head', headGeo(), n);
    this.meshes.add('jaw', jawGeo(), n);
    this.meshes.add('tail0', tailGeo(0.2, 0.05, 0.035), n);
    this.meshes.add('tail1', tailGeo(0.2, 0.035, 0.012), n);
    this.meshes.add('leg', legGeo(), n * 4);
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
        const p = this.pools[si][this.rng.int(0, this.pools[si].length - 1)];
        this.list.push({
          swamp: si, x: p.x, y: 0, z: p.z, heading: this.rng.range(0, 6.28), state: 'float', timer: this.rng.range(5, 25), tx: p.x, tz: p.z,
          cool: 0, jaw: 0, sweep: this.rng.next() * 6, sink: 0, speed: 0, scale: this.rng.range(0.9, 1.2), react: this.rng.next(), preyKind: null, preyId: -1,
        });
      }
    });
  }

  private waterY(x: number, z: number): number {
    return this.world.swampWaterY(x, z);
  }

  update(dt: number): void {
    if (dt > 0 && this.hooks) for (const g of this.list) this.think(g, dt);
    this.draw();
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

  private draw(): void {
    const m = this.meshes;
    m.begin();
    for (const g of this.list) {
      if (!View.sees(g.x, g.y, g.z, 0.6)) continue;
      const s = g.scale;
      const walking = g.state === 'crawl' || g.state === 'retreat' || g.state === 'lunge';
      const sw = Math.sin(g.sweep);
      // The body snakes side to side as it swims or crawls.
      const bodyYaw = walking || g.state === 'swim' ? sw * 0.12 : 0;
      compose(_b, g.x, g.y + (walking ? 0.03 : 0) * s, g.z, g.state === 'lunge' ? -0.12 : 0, g.heading + bodyYaw, 0, s);
      m.put('body', _b, WHITE);
      // Head and jaw at the front, the jaw hinging down.
      _m.multiplyMatrices(_b, compose(_t, 0, 0.012, 0.17, -g.jaw * 0.25, -bodyYaw * 0.8, 0));
      m.put('head', _m, WHITE);
      _m.multiply(compose(_t, 0, -0.012, 0.0, g.jaw * 0.75, 0, 0));
      m.put('jaw', _m, WHITE);
      // Tail sweeps in an S behind.
      const tailA = (g.state === 'swim' ? 0.45 : walking ? 0.3 : 0.08) * Math.sin(g.sweep - 0.6);
      _m.multiplyMatrices(_b, compose(_t, 0, 0.005, -0.17, 0, -tailA, 0));
      m.put('tail0', _m, WHITE);
      _m.multiply(compose(_t, 0, 0, -0.2, 0, -tailA * 1.4 + Math.sin(g.sweep - 1.4) * 0.2, 0));
      m.put('tail1', _m, WHITE);
      // Splayed legs: tucked back while swimming, walking in a diagonal gait on land.
      for (let k = 0; k < 4; k++) {
        const front = k < 2, side = k % 2 ? -1 : 1;
        const swimTuck = !walking && g.state !== 'bask' ? 0.9 : 0;
        const stepA = walking ? Math.sin(g.sweep * 1.6 + (k === 0 || k === 3 ? 0 : Math.PI)) * 0.5 : 0;
        _m.multiplyMatrices(_b, compose(_t, side * 0.075, -0.015, front ? 0.1 : -0.1, 0, side > 0 ? stepA - swimTuck : Math.PI - stepA + swimTuck, 0));
        m.put('leg', _m, WHITE);
      }
    }
    m.end();
  }
}

function turn(h: number, a: number, k: number): number {
  let d = a - h;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return h + d * Math.min(1, k);
}
