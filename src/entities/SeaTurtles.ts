import * as THREE from 'three';
import { TURTLES } from '../config';
import { GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';
import { QuadMeshes } from './quadRig';

type TState = 'rest' | 'crawl' | 'enter' | 'swim' | 'breathe' | 'approach' | 'exit';

interface Turtle {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  state: TState;
  timer: number;
  tx: number;
  tz: number;
  ty: number;
  /** Beach spot it's heading for (or resting on). */
  beachX: number;
  beachZ: number;
  breath: number;
  stroke: number;
  speed: number;
  scale: number;
  color: THREE.Color;
  /** Head drawn in (0 out … 1 tucked) when people come close on land. */
  shy: number;
}

const COAT = { color: 0xffffff, mat: 2 };
const C = (c: number) => ({ color: c });

/** Shell (tinted per turtle) with darker scute seams, and a pale plastron. Faces +z. */
function shellGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const g = new THREE.IcosahedronGeometry(0.13, 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(pos.getY(i), -0.01));
  g.computeVertexNormals();
  b.add(g, {
    color: (p) => {
      // Scutes: a central row of plates and two side rows, seams slightly darker.
      const u = p.z / 0.16, v = p.x / 0.13;
      const seam = Math.abs(Math.sin(u * 5.2)) < 0.18 || Math.abs(Math.abs(v) - 0.38) < 0.06;
      return new THREE.Color().setScalar(seam ? 0.62 : 0.9 + 0.1 * Math.sin(u * 3 + v * 4));
    },
    mat: 2,
  }, M.t(0, 0.02, 0, 0, 0, 0, 1, 0.42, 1.28));
  b.add(P.sphere(0.12, 1), C(0xd8c890), M.t(0, 0.012, 0, 0, 0, 0, 0.95, 0.16, 1.2));
  return facet(b.build());
}

function headGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.024, 0.03, 0.05, 6), C(0x7a8656), M.t(0, 0, 0.02, Math.PI / 2, 0, 0));
  b.add(P.sphere(0.034, 1), C(0x84905c), M.t(0, 0.004, 0.06, 0, 0, 0, 0.9, 0.78, 1.2));
  // Scales on the head: a few darker plates, beak and eyes.
  b.add(P.sphere(0.02, 0), C(0x5c6640), M.t(0, 0.02, 0.06, 0, 0, 0, 1, 0.4, 1.2));
  b.add(P.cone(0.012, 0.02, 4), C(0x3a3a30), M.t(0, -0.004, 0.1, Math.PI / 2, 0, 0));
  for (const x of [-1, 1]) b.add(P.sphere(0.006, 0), C(0x141410), M.t(x * 0.024, 0.012, 0.078));
  return facet(b.build());
}

/** A flipper from its shoulder (origin) out along +x; symmetric front-to-back so it can be mirrored. */
function flipperGeo(len: number, w: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const g = new THREE.BoxGeometry(len, 0.012, w, 3, 1, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / len + 0.5;
    // Tapers to a point and curves back toward the tip.
    p.setZ(i, p.getZ(i) * (1 - u * 0.7));
    p.setX(i, u * len);
  }
  g.computeVertexNormals();
  b.add(g, { color: (q) => new THREE.Color(Math.sin(q.x * 70) > 0.6 ? 0x5a6440 : 0x6e7a4e) });
  return facet(b.build());
}

const _b = new THREE.Matrix4(), _m = new THREE.Matrix4(), _t = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function compose(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
}

const SHELL = [0x6e6a3e, 0x7a6038, 0x5e6a44, 0x846a40];

/**
 * Sea turtles moving between beaches and the sea: resting on quiet sand, crawling slowly down
 * to the water with both front flippers, slipping in and "flying" through the shallows and
 * deeper coastal water, surfacing to breathe, and now and then hauling out onto a beach again.
 */
export class SeaTurtles {
  readonly meshes = new QuadMeshes();
  list: Turtle[] = [];
  private rng: RNG;
  private beaches: { x: number; z: number }[] = [];
  people: SpatialHash<Islander> | null = null;

  constructor(private world: World, private sea: number) {
    this.rng = new RNG(world.seed * 67 + 41);
    this.findBeaches();
    this.spawn();
    const n = TURTLES.count[1] + 2;
    this.meshes.add('shell', shellGeo(), n);
    this.meshes.add('head', headGeo(), n);
    this.meshes.add('flipF', flipperGeo(0.2, 0.075), n * 2);
    this.meshes.add('flipR', flipperGeo(0.09, 0.055), n * 2);
  }

  private findBeaches(): void {
    const w = this.world;
    for (let k = 0; k < 8000 && this.beaches.length < 60; k++) {
      const cx = this.rng.int(2, w.N - 3), cz = this.rng.int(2, w.N - 3);
      const i = w.idx(cx, cz);
      const x = w.centerX(cx), z = w.centerZ(cz);
      const h = w.heightAt(x, z);
      if (w.isLandCell(i) && w.sandy[i] > 0.55 && w.distWater[i] <= 2 && h > this.sea + 0.02 && h < 0.45) this.beaches.push({ x, z });
    }
  }

  private spawn(): void {
    const r = this.rng;
    const n = Math.round(THREE.MathUtils.clamp(this.beaches.length / 6, TURTLES.count[0], TURTLES.count[1]));
    for (let k = 0; k < n; k++) {
      const onBeach = this.beaches.length > 0 && r.chance(0.35);
      let x = 0, z = 0;
      if (onBeach) {
        const b = this.beaches[r.int(0, this.beaches.length - 1)];
        x = b.x;
        z = b.z;
      } else {
        const p = this.seaPoint(r.range(-this.world.half * 0.7, this.world.half * 0.7), r.range(-this.world.half * 0.7, this.world.half * 0.7), 40);
        if (!p) continue;
        x = p.x;
        z = p.z;
      }
      this.list.push({
        x, y: onBeach ? this.world.heightAt(x, z) : -0.6, z, heading: r.range(0, 6.28), pitch: 0, state: onBeach ? 'rest' : 'swim', timer: r.range(20, 90),
        tx: x, tz: z, ty: -0.6, beachX: x, beachZ: z, breath: r.range(20, 60), stroke: r.next(), speed: 0, scale: r.range(0.85, 1.15),
        color: new THREE.Color(SHELL[r.int(0, SHELL.length - 1)]).offsetHSL(0, r.range(-0.05, 0.05), r.range(-0.04, 0.04)), shy: 0,
      });
    }
  }

  /** A point in coastal water (shallow to moderately deep) near (x, z). */
  private seaPoint(x: number, z: number, r: number): { x: number; z: number } | null {
    for (let k = 0; k < 20; k++) {
      const a = this.rng.range(0, 6.28), d = Math.sqrt(this.rng.next()) * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const h = this.world.heightAt(px, pz);
      if (h < -0.35 && h > -3.5) return { x: px, z: pz };
    }
    return null;
  }

  update(dt: number): void {
    if (dt > 0) for (const t of this.list) this.think(t, dt);
    this.draw(dt);
  }

  private think(t: Turtle, dt: number): void {
    const w = this.world;
    const r = this.rng;
    const ground = w.heightAt(t.x, t.z);
    t.stroke += dt * (t.state === 'swim' || t.state === 'approach' || t.state === 'breathe' ? 0.55 : t.state === 'rest' ? 0 : 0.45);
    // People close by on land: the head draws in and the turtle waits.
    let near = false;
    this.people?.query(t.x, t.z, 2.2, (p) => !p.hidden && (near = true));
    t.shy += ((near && (t.state === 'rest' || t.state === 'crawl' || t.state === 'exit') ? 1 : 0) - t.shy) * Math.min(1, dt * 3);
    const crawlStep = () => Math.max(0, Math.sin(t.stroke * Math.PI * 2)) * TURTLES.crawlSpeed * 2 * (1 - t.shy);
    switch (t.state) {
      case 'rest':
        t.timer -= dt;
        t.y = ground;
        if (t.timer <= 0) {
          // Back to the sea: head for the nearest water.
          const p = this.seaPoint(t.x, t.z, 8);
          if (p) {
            t.state = 'crawl';
            t.tx = p.x;
            t.tz = p.z;
            t.timer = 90;
          } else t.timer = 30;
        }
        break;
      case 'crawl':
      case 'exit': {
        const dx = t.tx - t.x, dz = t.tz - t.z;
        const d = Math.hypot(dx, dz);
        t.heading = turn(t.heading, Math.atan2(dx, dz), dt * 0.8);
        const s = crawlStep();
        t.x += Math.sin(t.heading) * s * dt;
        t.z += Math.cos(t.heading) * s * dt;
        t.y = Math.max(w.heightAt(t.x, t.z), t.state === 'crawl' ? -1 : -1);
        t.speed = s;
        t.timer -= dt;
        if (t.state === 'crawl' && w.heightAt(t.x, t.z) < this.sea - 0.04) {
          // Into the water: the swim takes over as the body lifts off the sand.
          t.state = 'enter';
          t.timer = 2.5;
        } else if (t.state === 'exit' && (d < 0.2 || t.timer <= 0)) {
          t.state = 'rest';
          t.timer = r.range(TURTLES.restSeconds[0], TURTLES.restSeconds[1]);
        }
        break;
      }
      case 'enter':
        t.timer -= dt;
        t.x += Math.sin(t.heading) * 0.18 * dt;
        t.z += Math.cos(t.heading) * 0.18 * dt;
        t.y += (Math.max(w.heightAt(t.x, t.z) + 0.06, this.sea - 0.12) - t.y) * Math.min(1, dt * 1.5);
        if (t.timer <= 0) this.newSwim(t);
        break;
      case 'swim':
      case 'approach':
      case 'breathe': {
        const dx = t.tx - t.x, dz = t.tz - t.z;
        const d = Math.hypot(dx, dz);
        t.heading = turn(t.heading, Math.atan2(dx, dz), dt * 0.6);
        const sp = TURTLES.swimSpeed * (t.state === 'breathe' ? 0.5 : 1);
        const nx = t.x + Math.sin(t.heading) * sp * dt, nz = t.z + Math.cos(t.heading) * sp * dt;
        const nh = w.heightAt(nx, nz);
        if (nh < this.sea - 0.1 || t.state === 'approach') {
          t.x = nx;
          t.z = nz;
        } else t.heading += dt * 1.5;
        const bed = w.heightAt(t.x, t.z);
        t.breath -= dt;
        if (t.state === 'swim' && t.breath <= 0) {
          t.state = 'breathe';
          t.timer = r.range(3, 6);
        }
        const wantY = t.state === 'breathe' ? this.sea - 0.05 : Math.max(bed + 0.12, Math.min(this.sea - 0.2, t.ty));
        t.pitch = THREE.MathUtils.clamp((wantY - t.y) * 2, -0.5, 0.5);
        t.y += (wantY - t.y) * Math.min(1, dt * 0.7);
        t.speed = sp;
        if (t.state === 'breathe') {
          t.timer -= dt;
          if (t.timer <= 0) {
            t.breath = r.range(TURTLES.breathEvery[0], TURTLES.breathEvery[1]);
            t.state = 'swim';
          }
        } else if (t.state === 'approach') {
          // At the shallows' edge: haul out onto the sand.
          if (w.heightAt(t.x, t.z) > this.sea - 0.06) {
            t.state = 'exit';
            t.tx = t.beachX;
            t.tz = t.beachZ;
            t.timer = 90;
          }
        } else if (d < 0.5) {
          // Reached the wander point: carry on exploring, or come ashore now and then.
          if (this.beaches.length && r.chance(TURTLES.comeAshore) && this.quietBeach(t)) {
            t.state = 'approach';
            t.tx = t.beachX;
            t.tz = t.beachZ;
          } else this.newSwim(t);
        }
        break;
      }
    }
  }

  /** Pick a quiet beach not far away (no villagers near) to come ashore on. */
  private quietBeach(t: Turtle): boolean {
    for (let k = 0; k < 8; k++) {
      const b = this.beaches[this.rng.int(0, this.beaches.length - 1)];
      if (Math.hypot(b.x - t.x, b.z - t.z) > 45) continue;
      let busy = false;
      this.people?.query(b.x, b.z, 6, () => (busy = true));
      if (busy) continue;
      t.beachX = b.x;
      t.beachZ = b.z;
      return true;
    }
    return false;
  }

  private newSwim(t: Turtle): void {
    const p = this.seaPoint(t.x, t.z, 18) ?? { x: t.x, z: t.z };
    t.state = 'swim';
    t.tx = p.x;
    t.tz = p.z;
    // Explore at mid-depth: sometimes near the bottom, sometimes just below the surface.
    t.ty = this.rng.range(-0.95, -0.25);
    if (t.breath <= 0) t.breath = this.rng.range(TURTLES.breathEvery[0], TURTLES.breathEvery[1]);
  }

  // ---------------- Drawing ----------------

  private draw(dt: number): void {
    const m = this.meshes;
    m.begin();
    void dt;
    for (const t of this.list) {
      if (!View.sees(t.x, t.y, t.z, 0.4)) continue;
      const s = t.scale;
      const wet = t.state === 'swim' || t.state === 'approach' || t.state === 'breathe' || t.state === 'enter';
      const ph = t.stroke * Math.PI * 2;
      // On land the body heaves forward with each push; in water it glides with a gentle pitch.
      const lift = wet ? 0 : Math.max(0, Math.sin(ph)) * 0.015;
      compose(_b, t.x, t.y + 0.02 * s + lift, t.z, wet ? t.pitch : -lift * 3, t.heading, wet ? Math.sin(ph) * 0.04 : 0, s);
      m.put('shell', _b, t.color);
      // Head: out and looking about, drawn in when people are near.
      const hx = 0.125 - t.shy * 0.05;
      _m.multiplyMatrices(_b, compose(_t, 0, 0.025, hx, wet ? -0.1 : 0.1 + Math.sin(t.stroke * 1.3) * 0.05, Math.sin(t.stroke * 0.7) * 0.3, 0));
      m.put('head', _m, t.color);
      for (const side of [1, -1]) {
        // Front flippers: long wing-like strokes in water; both pushing back together on sand.
        let flap: number, sweep: number;
        if (wet) {
          flap = Math.sin(ph) * 0.75;
          sweep = 0.35 + Math.cos(ph) * 0.35;
        } else if (t.state === 'rest') {
          flap = -0.15;
          sweep = 0.5;
        } else {
          flap = -0.1 + Math.max(0, Math.cos(ph)) * 0.25;
          sweep = -0.3 + (Math.sin(ph) * 0.5 + 0.5) * 1.1;
        }
        _m.multiplyMatrices(_b, compose(_t, side * 0.085, 0.02, 0.065, 0, side > 0 ? -sweep : Math.PI + sweep, flap));
        m.put('flipF', _m, t.color);
        // Rear flippers: small steering paddles.
        const rf = wet ? Math.sin(ph + 1.2) * 0.3 : -0.1;
        _m.multiplyMatrices(_b, compose(_t, side * 0.07, 0.015, -0.12, 0, side > 0 ? -0.9 : Math.PI + 0.9, rf));
        m.put('flipR', _m, t.color);
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
