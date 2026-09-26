import * as THREE from 'three';
import { FAUNA, WILDLIFE } from '../config';
import { peopleMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';
import * as models from './animalModels';

interface Gull {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  flock: number;
  /** Smoothed fear 0..1 with an individual reaction time, so birds react one after another. */
  fear: number;
  react: number;
  speedMul: number;
  flap: number;
  state: 'fly' | 'land' | 'ground' | 'takeoff';
  timer: number;
  lx: number;
  ly: number;
  lz: number;
  heading: number;
  bank: number;
  /** Occasionally wander off from the flock for a while. */
  stray: number;
}

interface Flock {
  cx: number;
  cz: number;
  a: number;
  r: number;
  y: number;
  drift: number;
}

interface Toucan {
  x: number;
  y: number;
  z: number;
  heading: number;
  state: 'perch' | 'hop' | 'fly';
  timer: number;
  look: number;
  lookT: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  ctrl: THREE.Vector3;
  t: number;
  dur: number;
  flap: number;
}

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
 * Gulls in loose boids flocks around the coast (they land on rocks and beaches, and react to the
 * pointer with a graduated, staggered response before regrouping) and toucans hopping between
 * jungle treetops on curved flight paths.
 */
export class Birds {
  readonly group = new THREE.Group();
  gulls: Gull[] = [];
  toucans: Toucan[] = [];
  private flocks: Flock[] = [];
  private landing: THREE.Vector3[] = [];
  private perches: THREE.Vector3[] = [];
  private hash = new SpatialHash<Gull>(4);
  private rng: RNG;
  private time = 0;
  private meshes: Record<string, THREE.InstancedMesh> = {};
  /** Called when birds burst into flight (for the flap sound). */
  onScatter: (x: number, z: number) => void = () => {};

  constructor(private world: World, perches: THREE.Vector3[], landing: THREE.Vector3[]) {
    this.rng = new RNG(world.seed * 211 + 1);
    this.perches = perches;
    this.landing = landing;
    const mat = peopleMaterial();
    const mk = (key: string, g: THREE.BufferGeometry, n: number) => {
      const m = new THREE.InstancedMesh(g, mat, Math.max(1, n));
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes[key] = m;
      this.group.add(m);
    };
    this.spawn();
    const G = this.gulls.length, T = this.toucans.length;
    mk('gull', models.gullBody(), G);
    mk('gullWing', models.wingGeometry(0.2, 0.07, 0xe8eaec, 0x1c1c1e), G * 2);
    mk('gullLegs', models.birdLegs(0xf2a030), G);
    mk('toucan', models.toucanBody(), T);
    mk('toucanWing', models.wingGeometry(0.12, 0.06, 0x121214, 0x0a0a0c), T * 2);
  }

  private spawn(): void {
    const w = this.world;
    // Flocks around coastal points: the village's shore first, then elsewhere.
    const coast: { x: number; z: number }[] = [];
    for (let k = 0; k < 4000 && coast.length < 60; k++) {
      const cx = this.rng.int(3, w.N - 4), cz = this.rng.int(3, w.N - 4);
      const i = w.idx(cx, cz);
      if (w.layer[i] === 0 && w.distWater[i] === 0) {
        const n = w.layer[i - 1] + w.layer[i + 1] + w.layer[i - w.N] + w.layer[i + w.N];
        if (n > 0) coast.push({ x: w.centerX(cx), z: w.centerZ(cz) });
      }
    }
    const m = w.meadow;
    coast.sort((a, b) => Math.hypot(a.x - m.x, a.z - m.z) - Math.hypot(b.x - m.x, b.z - m.z));
    for (let f = 0; f < FAUNA.gullFlocks && coast.length; f++) {
      const c = coast[Math.min(coast.length - 1, f * 17)];
      this.flocks.push({ cx: c.x, cz: c.z, a: this.rng.range(0, 6.28), r: 7 + this.rng.next() * 6, y: 6 + this.rng.next() * 3, drift: this.rng.range(-1, 1) });
      const n = this.rng.int(FAUNA.gullsPerFlock[0], FAUNA.gullsPerFlock[1]);
      for (let k = 0; k < n; k++) {
        this.gulls.push({
          x: c.x + this.rng.range(-4, 4), y: 6 + this.rng.range(-1, 1), z: c.z + this.rng.range(-4, 4), vx: this.rng.range(-1, 1), vy: 0, vz: this.rng.range(-1, 1),
          flock: f, fear: 0, react: 0.08 + this.rng.next() * 0.35, speedMul: 0.85 + this.rng.next() * 0.3, flap: this.rng.next() * 6, state: 'fly', timer: 10 + this.rng.next() * 30,
          lx: 0, ly: 0, lz: 0, heading: 0, bank: 0, stray: 0,
        });
      }
    }
    const nT = this.rng.int(FAUNA.toucans[0], FAUNA.toucans[1]);
    for (let k = 0; k < nT && this.perches.length; k++) {
      const p = this.perches[Math.floor(this.rng.next() * this.perches.length)];
      this.toucans.push({ x: p.x, y: p.y, z: p.z, heading: this.rng.range(0, 6.28), state: 'perch', timer: 3 + this.rng.next() * 10, look: 0, lookT: 0, from: p.clone(), to: p.clone(), ctrl: p.clone(), t: 0, dur: 1, flap: 0 });
    }
  }

  /** Distance from a point to the pointer ray and the push-away direction. */
  private rayDist(x: number, y: number, z: number, ray: THREE.Ray | null): { d: number; ax: number; ay: number; az: number } {
    if (!ray) return { d: Infinity, ax: 0, ay: 0, az: 0 };
    _p.set(x, y, z);
    const t = Math.max(0, _p.clone().sub(ray.origin).dot(ray.direction));
    const c = ray.origin.clone().addScaledVector(ray.direction, t);
    const ax = x - c.x, ay = y - c.y, az = z - c.z;
    const d = Math.hypot(ax, ay, az) || 0.001;
    return { d, ax: ax / d, ay: ay / d, az: az / d };
  }

  update(dt: number, ray: THREE.Ray | null, people: SpatialHash<Islander>): void {
    if (dt > 0) {
      this.time += dt;
      this.updateGulls(dt, ray, people);
      this.updateToucans(dt, ray, people);
    }
    this.draw();
  }

  private updateGulls(dt: number, ray: THREE.Ray | null, people: SpatialHash<Islander>): void {
    const bo = WILDLIFE.boids;
    this.hash.clear();
    for (const g of this.gulls) if (g.state === 'fly') this.hash.insert(g);
    for (const f of this.flocks) {
      f.a += dt * 0.1;
      // The flock's circuit drifts along the shore.
      f.cx += Math.cos(f.a * 0.3 + f.drift) * dt * 0.3;
      f.cz += Math.sin(f.a * 0.3 + f.drift) * dt * 0.3;
    }
    for (const g of this.gulls) {
      const f = this.flocks[g.flock];
      const threat = this.rayDist(g.x, g.y, g.z, ray);
      // Graduated disturbance level from the pointer: notice → bank → scatter.
      const level = threat.d > FAUNA.gullNotice ? 0 : threat.d > FAUNA.gullBank ? 0.25 : threat.d > FAUNA.gullScatter ? 0.6 : 1;
      g.fear += (level - g.fear) * Math.min(1, dt / g.react);
      if (g.state === 'ground') {
        let near = g.fear > 0.5;
        people.query(g.x, g.z, 1.5, () => (near = true));
        g.timer -= dt;
        if (g.timer <= 0 || near) {
          g.state = 'takeoff';
          g.vy = 3;
          g.vx = Math.sin(g.heading) * 2;
          g.vz = Math.cos(g.heading) * 2;
          if (near) this.onScatter(g.x, g.z);
        }
        continue;
      }
      if (g.state === 'land') {
        // Glide down to the landing spot.
        const dx = g.lx - g.x, dy = g.ly - g.y, dz = g.lz - g.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.1 || g.fear > 0.5) {
          if (g.fear > 0.5) {
            g.state = 'takeoff';
            g.vy = 3;
          } else {
            g.state = 'ground';
            g.x = g.lx;
            g.y = g.ly;
            g.z = g.lz;
            g.timer = 6 + this.rng.next() * 14;
          }
          continue;
        }
        const sp = Math.min(3, d * 1.2 + 0.5);
        g.vx = (dx / d) * sp;
        g.vy = (dy / d) * sp;
        g.vz = (dz / d) * sp;
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        g.z += g.vz * dt;
        g.heading = Math.atan2(g.vx, g.vz);
        continue;
      }
      // Flying: boids + circling the flock centre + pointer avoidance.
      let sx = 0, sz = 0, ax = 0, az = 0, mx = 0, mz = 0, n = 0;
      this.hash.query(g.x, g.z, bo.neighbourRadius, (o, d2) => {
        if (o === g || o.flock !== g.flock) return;
        n++;
        ax += o.vx;
        az += o.vz;
        mx += o.x;
        mz += o.z;
        if (d2 < bo.sepRadius * bo.sepRadius) {
          sx += (g.x - o.x) / Math.max(0.2, d2);
          sz += (g.z - o.z) / Math.max(0.2, d2);
        }
      });
      let fx = 0, fz = 0, fy = 0;
      const coh = g.stray > 0 ? 0.1 : 1;
      if (n) {
        fx += sx * bo.separation + ((ax / n) - g.vx) * bo.alignment * 0.5 + ((mx / n) - g.x) * bo.cohesion * 0.25 * coh;
        fz += sz * bo.separation + ((az / n) - g.vz) * bo.alignment * 0.5 + ((mz / n) - g.z) * bo.cohesion * 0.25 * coh;
      }
      const tx = f.cx + Math.cos(f.a) * f.r, tz = f.cz + Math.sin(f.a) * f.r;
      fx += (tx - g.x) * 0.18 * coh;
      fz += (tz - g.z) * 0.18 * coh;
      fy += (f.y + Math.sin(this.time * 0.5 + g.flap) * 0.6 - g.y) * 0.9;
      if (g.fear > 0.02) {
        // Steer away from the pointer; strength grows with the disturbance level.
        const push = g.fear * g.fear * 26;
        fx += threat.ax * push;
        fz += threat.az * push;
        fy += Math.max(0.3, threat.ay) * push * 0.5;
      }
      g.stray = Math.max(0, g.stray - dt);
      if (g.stray <= 0 && this.rng.next() < dt * 0.01) g.stray = 4 + this.rng.next() * 5;
      g.vx += fx * dt;
      g.vy += fy * dt;
      g.vz += fz * dt;
      g.vy *= 1 - Math.min(1, dt * 1.5);
      const sp = Math.hypot(g.vx, g.vz);
      const maxS = (3.2 + g.fear * 6) * g.speedMul, minS = 1.6 * g.speedMul;
      const k = sp > maxS ? maxS / sp : sp < minS ? minS / Math.max(0.01, sp) : 1;
      g.vx *= k;
      g.vz *= k;
      const prevH = g.heading;
      g.heading = Math.atan2(g.vx, g.vz);
      let dh = g.heading - prevH;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      g.bank += (Math.max(-0.9, Math.min(0.9, -dh / Math.max(dt, 0.001) * 0.35)) - g.bank) * Math.min(1, dt * 4);
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      if (g.state === 'takeoff' && g.y > f.y - 1) g.state = 'fly';
      if (g.fear > 0.55 && g.flap % 1 < 0.02) this.onScatter(g.x, g.z);
      // Now and then, drop down onto a rock or beach near the flock.
      g.timer -= dt;
      if (g.timer <= 0 && g.state === 'fly' && g.fear < 0.1) {
        g.timer = 20 + this.rng.next() * 40;
        const spot = this.landing.filter((l) => Math.hypot(l.x - g.x, l.z - g.z) < 18);
        if (spot.length && this.rng.chance(0.6)) {
          const s = spot[Math.floor(this.rng.next() * spot.length)];
          g.lx = s.x + this.rng.range(-0.3, 0.3);
          g.ly = s.y;
          g.lz = s.z + this.rng.range(-0.3, 0.3);
          g.state = 'land';
        }
      }
    }
  }

  private updateToucans(dt: number, ray: THREE.Ray | null, people: SpatialHash<Islander>): void {
    for (const b of this.toucans) {
      b.flap += dt;
      if (b.state === 'fly') {
        b.t += dt / b.dur;
        const t = Math.min(1, b.t);
        // Quadratic Bezier with a lifted, sideways control point: a curved, natural flight.
        const u = 1 - t;
        const nx = u * u * b.from.x + 2 * u * t * b.ctrl.x + t * t * b.to.x;
        const ny = u * u * b.from.y + 2 * u * t * b.ctrl.y + t * t * b.to.y;
        const nz = u * u * b.from.z + 2 * u * t * b.ctrl.z + t * t * b.to.z;
        if (Math.hypot(nx - b.x, nz - b.z) > 0.0001) b.heading = Math.atan2(nx - b.x, nz - b.z);
        b.x = nx;
        b.y = ny;
        b.z = nz;
        if (t >= 1) {
          b.state = 'perch';
          b.timer = 5 + this.rng.next() * 14;
        }
        continue;
      }
      // Startled by the pointer or someone right below.
      let startle = this.rayDist(b.x, b.y, b.z, ray).d < 2.5;
      people.query(b.x, b.z, 1.2, () => (startle = startle || this.rng.next() < 0.02));
      b.timer -= dt;
      b.lookT -= dt;
      if (b.lookT <= 0) {
        b.look = this.rng.range(-1, 1);
        b.lookT = 0.5 + this.rng.next() * 2;
      }
      if (b.state === 'hop') {
        b.t += dt / b.dur;
        const t = Math.min(1, b.t);
        b.x = b.from.x + (b.to.x - b.from.x) * t;
        b.z = b.from.z + (b.to.z - b.from.z) * t;
        b.y = b.from.y + (b.to.y - b.from.y) * t + Math.sin(t * Math.PI) * 0.08;
        if (t >= 1) b.state = 'perch';
        continue;
      }
      if (b.timer <= 0 || startle) {
        const here = new THREE.Vector3(b.x, b.y, b.z);
        if (!startle && this.rng.chance(0.35)) {
          // Hop along the branch.
          b.state = 'hop';
          b.from.copy(here);
          b.to.set(b.x + this.rng.range(-0.3, 0.3), b.y, b.z + this.rng.range(-0.3, 0.3));
          b.t = 0;
          b.dur = 0.35;
          b.heading = Math.atan2(b.to.x - b.x, b.to.z - b.z);
          b.timer = 2 + this.rng.next() * 5;
          continue;
        }
        // Fly to another tree, preferring jungle canopy within a few trees' reach.
        const cands = this.perches.filter((p) => {
          const d = p.distanceTo(here);
          return d > 3 && d < (startle ? 30 : 22);
        });
        const to = cands[Math.floor(this.rng.next() * cands.length)] ?? this.perches[Math.floor(this.rng.next() * this.perches.length)];
        if (!to) continue;
        b.state = 'fly';
        b.from.copy(here);
        b.to.copy(to);
        const mid = here.clone().add(to).multiplyScalar(0.5);
        const side = new THREE.Vector3(to.z - here.z, 0, here.x - to.x).normalize().multiplyScalar(here.distanceTo(to) * this.rng.range(-0.35, 0.35));
        b.ctrl.copy(mid).add(side).add(new THREE.Vector3(0, 1.5 + here.distanceTo(to) * 0.15, 0));
        b.t = 0;
        b.dur = here.distanceTo(to) / (startle ? 7 : 4.5);
        if (startle) this.onScatter(b.x, b.z);
      }
    }
  }

  private draw(): void {
    const ms = this.meshes;
    let gi = 0;
    for (const g of this.gulls) {
      const onGround = g.state === 'ground';
      compose(_m, g.x, g.y + (onGround ? 0.06 : 0), g.z, onGround ? 0 : -g.vy * 0.05, g.heading, onGround ? 0 : g.bank, 1.25);
      ms.gull.setMatrixAt(gi, _m);
      // Wings: slow glide flaps, fast when frightened, folded on the ground.
      const flapRate = g.state === 'takeoff' || g.fear > 0.4 ? 20 : g.state === 'land' ? 3 : 5;
      g.flap += 0.016 * flapRate;
      const f = onGround ? 1.3 : Math.sin(g.flap) * (g.fear > 0.4 || g.state === 'takeoff' ? 0.9 : 0.35) + 0.12;
      _m2.multiplyMatrices(_m, compose(new THREE.Matrix4(), 0.035, 0.02, 0, 0, 0, onGround ? -1.3 : f));
      ms.gullWing.setMatrixAt(gi * 2, _m2);
      _m2.multiplyMatrices(_m, compose(new THREE.Matrix4(), -0.035, 0.02, 0, 0, Math.PI, onGround ? -1.3 : f));
      ms.gullWing.setMatrixAt(gi * 2 + 1, _m2);
      ms.gullLegs.setMatrixAt(gi, onGround || g.state === 'land' ? _m : new THREE.Matrix4().makeScale(0, 0, 0));
      gi++;
    }
    let ti = 0;
    for (const b of this.toucans) {
      const flying = b.state === 'fly';
      compose(_m, b.x, b.y + 0.05, b.z, flying ? -0.1 : 0, b.heading + (flying ? 0 : b.look * 0.6), 0, 1.3);
      ms.toucan.setMatrixAt(ti, _m);
      const f = flying ? Math.sin(b.flap * 18) * 0.9 : b.state === 'hop' ? 0.5 : -1.2;
      _m2.multiplyMatrices(_m, compose(new THREE.Matrix4(), 0.035, 0.01, 0, 0, 0, f));
      ms.toucanWing.setMatrixAt(ti * 2, _m2);
      _m2.multiplyMatrices(_m, compose(new THREE.Matrix4(), -0.035, 0.01, 0, 0, Math.PI, f));
      ms.toucanWing.setMatrixAt(ti * 2 + 1, _m2);
      ti++;
    }
    for (const m of Object.values(ms)) m.instanceMatrix.needsUpdate = true;
  }
}
