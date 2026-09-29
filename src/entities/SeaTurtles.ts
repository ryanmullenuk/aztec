import * as THREE from 'three';
import { TURTLES } from '../config';
import { ColorFn, GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';
import { QuadMeshes } from './quadRig';
import { seaLifeMaterial } from '../render/materials';

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
  // ---- Animation only (smoothed) ----
  /** 0 on land … 1 afloat: blends crawling strokes into swimming strokes. */
  wet: number;
  prevH: number;
  turnRate: number;
  roll: number;
  pitchS: number;
  /** Breathing: head raised to the surface 0..1. */
  gasp: number;
  seed: number;
}

// ---------------- Geometry ----------------

const C = (c: number) => ({ color: c });
const SKIN = 0x7a8656, SKIN_DARK = 0x5a6440, SKIN_PALE = 0xc8c896;

/** Mirror a faceted (non-indexed) geometry in x, keeping its faces pointing outward. */
function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.index ? g.toNonIndexed() : g.clone();
  const p = m.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
  // Swap the 2nd and 3rd vertex of every triangle (all attributes) to restore the winding.
  for (const k of Object.keys(m.attributes)) {
    const a = m.getAttribute(k) as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i += 3)
      for (let c = 0; c < a.itemSize; c++) {
        const t = a.getComponent(i + 1, c);
        a.setComponent(i + 1, c, a.getComponent(i + 2, c));
        a.setComponent(i + 2, c, t);
      }
  }
  m.computeVertexNormals();
  return m;
}

/**
 * Carapace (tinted per turtle, mat 2) with its scutes: five vertebral plates down the ridge, four
 * costal plates each side and a ring of marginals, each plate lighter in its middle with darker
 * seams and fine radiating streaks; a pale plastron, and a short tail. Faces +z.
 */
function shellGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const R = 0.13, SY = 0.42, SZ = 1.28;
  const g = new THREE.IcosahedronGeometry(R, 3);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = Math.max(pos.getY(i), -0.01);
    // A low keel along the vertebral ridge and a slight flare at the rear margin.
    y += Math.exp(-(x * x) / 0.0012) * 0.008 * Math.max(0, y / R);
    pos.setXYZ(i, x * (1 + (z < -0.06 && y < 0.02 ? 0.04 : 0)), y, z);
  }
  g.computeVertexNormals();
  const seamAt = (v: number, list: number[]) => {
    let d = 1;
    for (const s of list) d = Math.min(d, Math.abs(v - s));
    return d;
  };
  const shell: ColorFn = (p) => {
    const X = p.x / R, Z = p.z / (R * SZ), Y = (p.y - 0.02) / (R * SY);
    let shade: number;
    if (Y < 0.28) {
      // Marginal scutes around the rim.
      const a = Math.atan2(X, Z) * (22 / (Math.PI * 2));
      const dm = Math.abs(a - Math.round(a));
      shade = dm < 0.08 ? 0.55 : 0.72 + 0.12 * Math.min(1, dm * 4);
    } else if (Math.abs(X) < 0.3) {
      const d = Math.min(seamAt(Z, [-0.62, -0.22, 0.2, 0.58]) * 2.2, (0.3 - Math.abs(X)) * 3.2);
      shade = d < 0.07 ? 0.56 : 0.8 + 0.2 * Math.min(1, d * 2.5);
    } else {
      const d = Math.min(seamAt(Z, [-0.5, -0.05, 0.4]) * 2.2, (Math.abs(X) - 0.3) * 3.2);
      shade = d < 0.07 ? 0.56 : 0.78 + 0.2 * Math.min(1, d * 2.5);
    }
    // Fine radiating streaks within the plates.
    shade *= 0.95 + 0.07 * Math.sin(Math.atan2(X, Z) * 17 + Y * 6);
    return new THREE.Color().setScalar(shade);
  };
  b.add(g, { color: shell, mat: 2 }, M.t(0, 0.02, 0, 0, 0, 0, 1, SY, SZ));
  b.add(P.sphere(0.12, 1), C(0xd8c890), M.t(0, 0.012, 0, 0, 0, 0, 0.95, 0.16, 1.2));
  // Skin at the openings and the short tail.
  b.add(P.sphere(0.05, 1), C(SKIN), M.t(0, 0.012, 0.13, 0, 0, 0, 1.2, 0.35, 0.6));
  b.add(P.cone(0.018, 0.05, 4), C(SKIN_DARK), M.t(0, 0.01, -0.175, -Math.PI / 2, 0, 0, 1, 0.6, 1));
  return facet(b.build());
}

/** Neck from its base (inside the shell) forward along +z; wrinkled skin. */
function neckGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.024, 0.032, NECK_LEN, 6), { color: (p) => new THREE.Color(p.y > 0.008 ? SKIN : SKIN_PALE) }, M.t(0, 0, NECK_LEN / 2, Math.PI / 2, 0, 0));
  for (let k = 0; k < 3; k++) b.add(P.torus(0.027 - k * 0.002, 0.004, 3, 7), C(SKIN_DARK), M.t(0, 0, 0.012 + k * 0.014));
  return facet(b.build());
}

/** Head from the end of the neck: blunt skull with plated scales, hooked beak, dark eyes. */
function headGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const scaled: ColorFn = (p, n) => {
    if (n.y < -0.2) return new THREE.Color(SKIN_PALE);
    const plate = Math.sin(p.x * 150) * Math.sin(p.z * 130) > 0.35;
    return new THREE.Color(plate ? SKIN_DARK : 0x84905c);
  };
  b.add(P.sphere(0.034, 1), { color: scaled }, M.t(0, 0.004, 0.03, 0, 0, 0, 0.9, 0.78, 1.25));
  // Large plates on top of the head.
  b.add(P.sphere(0.022, 0), C(SKIN_DARK), M.t(0, 0.02, 0.036, 0, 0, 0, 1.05, 0.38, 1.3));
  // Beak: upper jaw hooked over the lower.
  b.add(P.cone(0.014, 0.024, 4), C(0x3a3a30), M.t(0, -0.002, 0.072, Math.PI / 2 + 0.25, 0, 0, 1, 1, 0.8));
  b.add(P.box(0.02, 0.006, 0.02), C(0x4a4838), M.t(0, -0.014, 0.062));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.0075, 0), C(0x141410), M.t(x * 0.024, 0.01, 0.048));
    b.add(P.sphere(0.009, 0), C(SKIN_DARK), M.t(x * 0.026, 0.001, 0.028, 0, 0, 0, 0.5, 0.9, 1.3));
  }
  return facet(b.build());
}

/** Short, thick upper arm of a flipper from the shoulder out along +x. */
function armGeo(len: number, r: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r * 1.1, 0), C(SKIN));
  b.add(P.cyl(r * 0.9, r, len, 6), { color: (p) => new THREE.Color(p.y > 0 ? SKIN : SKIN_PALE) }, M.t(len / 2, 0, 0, 0, 0, -Math.PI / 2, 1, 1, 0.6));
  return facet(b.build());
}

/**
 * A flipper blade out along +x: thick, straight leading edge (+z), thin swept trailing edge curving
 * back to a pointed tip, covered in polygonal scales (dark with pale edges) with a claw near the
 * leading edge; pale underneath.
 */
function bladeGeo(len: number, w: number, sweep: number, claw: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const g = new THREE.BoxGeometry(1, 1, 1, 5, 1, 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5;
    const v = p.getZ(i) + 0.5; // 1 = leading edge
    const chord = w * (1 - u * 0.78) * (0.7 + 0.3 * Math.sin(Math.PI * Math.min(1, u * 1.6 + 0.2)));
    const lead = w * 0.3 - sweep * u * u;
    const y = p.getY(i) * 0.014 * (0.4 + 0.6 * v) * (1 - 0.6 * u);
    p.setXYZ(i, u * len, y, lead - (1 - v) * chord);
  }
  const scales: ColorFn = (q, n) => {
    if (n.y < -0.2) return new THREE.Color(0xb8b488);
    const s = Math.sin(q.x * 110 + q.z * 40) * Math.sin(q.z * 120 - q.x * 30);
    return new THREE.Color(s > 0.45 ? 0x9aa070 : s < -0.3 ? 0x4e5838 : 0x646e46);
  };
  b.add(g, { color: scales });
  if (claw) b.add(P.cone(0.004, 0.012, 3), C(0x2a2820), M.t(len * 0.3, 0.004, w * 0.3 + 0.002, 0, 0, -Math.PI / 2));
  return facet(b.build());
}

const _b = new THREE.Matrix4(), _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _w = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function compose(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
}
const WHITE = new THREE.Color(1, 1, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

// ---------------- Tuning ----------------

const NECK_LEN = 0.05;
/** Joints in the body frame (right side; x mirrored for the left). */
const TUR = {
  neck: [0, 0.022, 0.105] as [number, number, number],
  front: [0.07, 0.018, 0.075] as [number, number, number],
  rear: [0.065, 0.014, -0.12] as [number, number, number],
  arm: 0.055,
  blade: 0.16,
};
/** Crawling: fraction of each half-cycle spent heaving (the rest is a pause), heave lift and roll. */
const CRAWL = { power: 0.6, lift: 0.014, roll: 0.05 };
/** Swimming: flipper flap amplitude and how the stroke lifts the body. */
const SWIM = { flap: 0.7, bob: 0.012 };

const SHELL = [0x6e6a3e, 0x7a6038, 0x5e6a44, 0x846a40];

/**
 * Sea turtles moving between beaches and the sea: resting on quiet sand, crawling slowly down
 * to the water with alternating heaves of their flippers, slipping in and "flying" through the
 * shallows and deeper coastal water with synchronised front-flipper strokes, surfacing to breathe,
 * and now and then hauling out onto a beach again.
 */
export class SeaTurtles {
  readonly meshes = new QuadMeshes();
  list: Turtle[] = [];
  private rng: RNG;
  private beaches: { x: number; z: number }[] = [];
  people: SpatialHash<Islander> | null = null;
  private time = 0;

  constructor(private world: World, private sea: number) {
    this.rng = new RNG(world.seed * 67 + 41);
    this.findBeaches();
    this.spawn();
    const n = TURTLES.count[1] + 2;
    this.meshes.add('shell', shellGeo(), n);
    this.meshes.add('neck', neckGeo(), n);
    this.meshes.add('head', headGeo(), n);
    const armF = armGeo(TUR.arm, 0.018), bladeF = bladeGeo(TUR.blade, 0.07, 0.05, true);
    const bladeR = bladeGeo(0.085, 0.055, 0.02, false);
    this.meshes.add('armR', armF, n);
    this.meshes.add('armL', mirrorX(armF), n);
    this.meshes.add('flipR', bladeF, n);
    this.meshes.add('flipL', mirrorX(bladeF), n);
    this.meshes.add('rearR', bladeR, n);
    this.meshes.add('rearL', mirrorX(bladeR), n);
    // Turtles glow softly at night (their own material: land animals share the plain one).
    for (const c of this.meshes.group.children) (c as THREE.Mesh).material = seaLifeMaterial();
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
      const heading = r.range(0, 6.28);
      this.list.push({
        x, y: onBeach ? this.world.heightAt(x, z) : -0.6, z, heading, pitch: 0, state: onBeach ? 'rest' : 'swim', timer: r.range(20, 90),
        tx: x, tz: z, ty: -0.6, beachX: x, beachZ: z, breath: r.range(20, 60), stroke: r.next(), speed: 0, scale: r.range(0.85, 1.15),
        color: new THREE.Color(SHELL[r.int(0, SHELL.length - 1)]).offsetHSL(0, r.range(-0.05, 0.05), r.range(-0.04, 0.04)), shy: 0,
        wet: onBeach ? 0 : 1, prevH: heading, turnRate: 0, roll: 0, pitchS: 0, gasp: 0, seed: k * 2.3,
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
    this.time += dt;
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
    // Two heaves per stroke cycle (one per diagonal flipper pair), each followed by a pause; the
    // average speed is the same as a single sinusoidal heave per cycle.
    const crawlStep = () => {
      const h = (((t.stroke * 2) % 1) + 1) % 1;
      return (h < CRAWL.power ? Math.sin((Math.PI * h) / CRAWL.power) / CRAWL.power : 0) * TURTLES.crawlSpeed * (1 - t.shy);
    };
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
    for (const t of this.list) {
      // Turning rate (for the rudders and banking), tracked on or off screen.
      const dh = wrapA(t.heading - t.prevH);
      t.prevH = t.heading;
      if (dt > 0) t.turnRate += (dh / dt - t.turnRate) * Math.min(1, dt * 3);
      if (!View.sees(t.x, t.y, t.z, 0.4)) continue;
      this.drawTurtle(t, dt);
    }
    m.end();
  }

  private drawTurtle(t: Turtle, dt: number): void {
    const m = this.meshes;
    const s = t.scale;
    const inWater = t.state === 'swim' || t.state === 'approach' || t.state === 'breathe' || t.state === 'enter';
    t.wet += ((inWater ? 1 : 0) - t.wet) * Math.min(1, dt * 1.2);
    const W = smooth(t.wet), L = 1 - W;
    // ---- Land: alternating diagonal pairs heave the body forward, then a pause ----
    const crawling = t.state === 'crawl' || t.state === 'exit';
    const cyc = ((t.stroke % 1) + 1) % 1;
    const half = (cyc * 2) % 1;
    const pull = cyc < 0.5 ? 1 : -1;
    const effort = crawling ? 1 - t.shy : 0;
    const heave = (half < CRAWL.power ? Math.sin((Math.PI * half) / CRAWL.power) : 0) * effort;
    // ---- Water: synchronised "flying" strokes; slow sculling while breathing at the surface ----
    const ph = t.stroke * Math.PI * 2;
    const breathing = t.state === 'breathe' && t.y > this.sea - 0.25;
    t.gasp += ((breathing ? 1 : 0) - t.gasp) * Math.min(1, dt * 1.5);
    const amp = SWIM.flap * (1 - 0.55 * t.gasp);
    // ---- Body ----
    t.pitchS += (t.pitch - t.pitchS) * Math.min(1, dt * 2);
    const rollW = THREE.MathUtils.clamp(-t.turnRate * 0.6, -0.35, 0.35);
    t.roll += (rollW - t.roll) * Math.min(1, dt * 2);
    const bob = -Math.cos(ph) * SWIM.bob * (1 - t.gasp);
    const pitch = lerp(-heave * 0.07, t.pitchS - t.gasp * 0.22, W);
    const roll = lerp(pull * heave * CRAWL.roll, t.roll, W);
    compose(_b, t.x, t.y + 0.02 * s + (heave * CRAWL.lift * L + bob * W) * s, t.z, pitch, t.heading, roll, s);
    m.put('shell', _b, t.color);
    // ---- Neck and head: lifted with each heave and to look about; raised to breathe; tucked when shy ----
    const look = Math.max(0, Math.sin(this.time * 0.22 + t.seed));
    const resting = t.state === 'rest';
    const npLand = resting ? 0.18 - look * look * 0.45 : -0.08 - heave * 0.22;
    const npWater = -0.04 + Math.sin(this.time * 0.5 + t.seed) * 0.06 - t.gasp * 0.75;
    const np = lerp(npLand, npWater, W) + t.shy * 0.35;
    const ny = lerp(Math.sin(this.time * 0.35 + t.seed) * 0.35 * (resting ? look : 1), Math.sin(this.time * 0.2 + t.seed) * 0.12 + THREE.MathUtils.clamp(t.turnRate * 0.4, -0.3, 0.3), W) * (1 - t.shy);
    _m.multiplyMatrices(_b, compose(_t, TUR.neck[0], TUR.neck[1], TUR.neck[2] - t.shy * 0.045, np, ny, 0));
    m.put('neck', _m, WHITE);
    const gulp = t.gasp * Math.max(0, Math.sin(this.time * 3 + t.seed)) * 0.25;
    _m.multiply(compose(_t, 0, 0, NECK_LEN, -np * 0.45 - gulp, 0, 0));
    m.put('head', _m, WHITE);
    // ---- Flippers ----
    for (let q = 0; q < 2; q++) {
      const side = q === 0 ? 1 : -1;
      // Front flipper on land: plant forward, drag back (blade dug in), pause, lift and swing forward.
      const psi = (cyc + (side > 0 ? 0 : 0.5)) % 1;
      let lSw: number, lFl = -0.22;
      if (psi < 0.3) lSw = lerp(-0.45, 0.65, smooth(psi / 0.3));
      else if (psi < 0.5) lSw = 0.65;
      else if (psi < 0.8) {
        const e = smooth((psi - 0.5) / 0.3);
        lSw = lerp(0.65, -0.45, e);
        lFl += Math.sin(Math.PI * e) * 0.4;
      } else lSw = -0.45;
      // Resting: spread flat on the sand.
      const g = crawling ? 1 : 0;
      lSw = lerp(0.45, lSw, g);
      lFl = lerp(-0.2, lFl, g);
      // In water: downstroke sweeps back with the leading edge pronated, upstroke feathers forward.
      const wFl = 0.1 + Math.sin(ph) * amp;
      const wSw = 0.5 - Math.sin(ph) * 0.35 * (amp / SWIM.flap);
      const wTw = -Math.cos(ph) * 0.45 * (amp / SWIM.flap);
      const sweep = lerp(lSw, wSw, W), flap = lerp(lFl, wFl, W);
      const bFl = lerp(-0.3, Math.sin(ph - 0.8) * 0.35 * (amp / SWIM.flap), W);
      const bSw = lerp(0.35, 0.15, W);
      const tw = lerp(0.15, wTw, W);
      _m.multiplyMatrices(_b, compose(_t, side * TUR.front[0], TUR.front[1], TUR.front[2], 0, sweep * side, flap * side));
      m.put(side > 0 ? 'armR' : 'armL', _m, WHITE);
      _m.multiply(compose(_t, side * TUR.arm, 0, 0, 0, bSw * side, bFl * side));
      _m.multiply(compose(_w, 0, 0, 0, tw, 0, 0));
      m.put(side > 0 ? 'flipR' : 'flipL', _m, WHITE);
      // Rear flippers: pushing back in the diagonal pair on land; rudders (and a little paddling) in water.
      const psr = (cyc + (side > 0 ? 0.5 : 0)) % 1;
      let rSw = 0.55, rFl = -0.2;
      if (crawling) {
        if (psr < 0.3) rSw = lerp(0.35, 1.2, smooth(psr / 0.3));
        else if (psr < 0.5) rSw = 1.2;
        else if (psr < 0.8) {
          const e = smooth((psr - 0.5) / 0.3);
          rSw = lerp(1.2, 0.35, e);
          rFl += Math.sin(Math.PI * e) * 0.25;
        } else rSw = 0.35;
      }
      const rud = THREE.MathUtils.clamp(t.turnRate * 0.8, -0.5, 0.5) * side;
      const wrSw = 1.25 + Math.sin(ph + 1.2) * 0.1;
      const wrFl = -0.05 + rud * 0.5 + Math.sin(ph + 1.2) * 0.12 * (1 - t.gasp);
      _m.multiplyMatrices(_b, compose(_t, side * TUR.rear[0], TUR.rear[1], TUR.rear[2], 0, lerp(rSw, wrSw, W) * side, lerp(rFl, wrFl, W) * side));
      _m.multiply(compose(_w, 0, 0, 0, lerp(0, rud * 0.8, W), 0, 0));
      m.put(side > 0 ? 'rearR' : 'rearL', _m, WHITE);
    }
  }
}

function wrapA(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function turn(h: number, a: number, k: number): number {
  let d = a - h;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return h + d * Math.min(1, k);
}
