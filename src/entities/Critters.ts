import * as THREE from 'three';
import { CRITTERS } from '../config';
import { ColorFn, GeoBuilder, M, P, facet, tube } from '../render/GeoBuilder';
import { FX } from '../render/materials';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';
import { QuadMeshes } from './quadRig';

interface Crab {
  x: number;
  z: number;
  y: number;
  hx: number;
  hz: number;
  heading: number;
  dir: number;
  state: 'rest' | 'scuttle' | 'flee' | 'buried';
  timer: number;
  phase: number;
  sink: number;
  // ---- Animation only ----
  /** Gait phase (cycles), smoothed speed, claw display (0..1) and which claw, raised eye stalks. */
  gph: number;
  spd: number;
  wave: number;
  waveT: number;
  waveSide: number;
  guard: number;
  eyes: number;
}

interface Ray {
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  turn: number;
  phase: number;
  size: number;
  cx: number;
  cz: number;
  /** Undulation phase (integrated, so its rate can change smoothly with speed). */
  wave: number;
}

// ---------------- Crab geometry ----------------

const SHELL = 0xd8552e, SHELL_DARK = 0xa83a1e, PALE = 0xf2a07a, TIP = 0x3a1a10;

/** Crab dimensions in its body frame (faces +z, walks sideways along x; origin on the ground). */
const CRAB = {
  bodyY: 0.045,
  /** Leg roots along the carapace edge (x, z) for the four walking legs, front to back. */
  legRoot: [[0.062, 0.03], [0.07, 0.008], [0.068, -0.016], [0.058, -0.036]] as [number, number][],
  /** Leg splay from straight out (+ toward the front), front to back. */
  legYaw: [0.75, 0.25, -0.2, -0.65],
  L1: 0.052,
  L2: 0.066,
  /** Neutral foot reach (horizontal, from the leg root) and stride per stance. */
  reach: 0.08,
  claw: [0.05, 0.05, 0.058] as [number, number, number],
  armLen: 0.045,
  eye: [0.018, 0.068, 0.058] as [number, number, number],
};

/** Crab tuning: step length per stance (scuttle / flee), step lift, claw display odds. */
const CRAB_STRIDE = { walk: 0.035, flee: 0.05, lift: 0.022 };

function crabBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // Wide, flattened carapace: mottled red-orange above with a darker rim, pale below.
  const shellCol: ColorFn = (p, n) => {
    if (n.y < 0.2) return new THREE.Color(PALE);
    const rim = Math.abs(p.x) > 0.07 || p.z > 0.05;
    return new THREE.Color(rim ? SHELL_DARK : SHELL).multiplyScalar(0.92 + 0.12 * Math.sin(p.x * 120) * Math.sin(p.z * 110));
  };
  b.add(P.sphere(0.07, 1), { color: shellCol }, M.t(0, CRAB.bodyY, 0, 0, 0, 0, 1.25, 0.5, 1));
  // A raised ridge across the front and the mouthparts beneath.
  b.add(P.box(0.1, 0.012, 0.018), C(SHELL_DARK), M.t(0, CRAB.bodyY + 0.018, 0.052, 0.3, 0, 0));
  b.add(P.box(0.04, 0.02, 0.02), C(PALE), M.t(0, CRAB.bodyY - 0.012, 0.06));
  return facet(b.build());
}

const C = (c: number) => ({ color: c });

/** A limb segment from its joint at the origin running out along +x. */
function segX(len: number, r0: number, r1: number, color: number, tip?: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r0 * 1.15, 0), C(color));
  b.add(P.cyl(r1, r0, len, 5), C(color), M.t(len / 2, 0, 0, 0, 0, -Math.PI / 2, 1, 1, 0.8));
  if (tip !== undefined) b.add(P.cone(r1, len * 0.22, 4), C(tip), M.t(len + len * 0.1, 0, 0, 0, 0, -Math.PI / 2));
  return facet(b.build());
}

/** Claw hand (propodus with the fixed finger), from the wrist along +x. */
function crabClaw(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.022, 1), C(SHELL), M.t(0.02, 0, 0, 0, 0, 0, 1.2, 0.75, 0.85));
  b.add(P.box(0.03, 0.008, 0.012), C(SHELL_DARK), M.t(0.052, -0.006, 0));
  b.add(P.cone(0.006, 0.014, 4), C(TIP), M.t(0.072, -0.006, 0, 0, 0, -Math.PI / 2));
  return facet(b.build());
}

/** Movable finger (dactyl), hinged above the fixed finger. */
function crabPinch(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.box(0.032, 0.007, 0.01), C(SHELL_DARK), M.t(0.016, 0, 0));
  b.add(P.cone(0.005, 0.012, 4), C(TIP), M.t(0.037, 0, 0, 0, 0, -Math.PI / 2));
  return facet(b.build());
}

/** Eye stalk from its base, the black eye at the top. */
function crabEye(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.0035, 0.0045, 0.028, 4), C(SHELL_DARK), M.t(0, 0.014, 0));
  b.add(P.sphere(0.0075, 0), C(0x101010), M.t(0, 0.03, 0.001, 0, 0, 0, 1, 1.3, 1));
  return facet(b.build());
}

// ---------------- Ray geometry ----------------

/** Disc half-length front and back of its widest point, and the half span. */
const RAY = { front: 0.32, back: -0.26, span: 0.44, tail: 0.62 };

/**
 * Stingray: a thin lens-shaped disc built as a grid (so the margins can ripple smoothly), with
 * raised eyes and spiracles and a long, thin whip tail with the sting.
 * aVeg.x carries the wave weight: ≥ 0 across the disc (0 on the midline → 1 at the margin) and
 * negative down the tail (0 at its base → −1 at the tip).
 */
function rayGeometry(): THREE.BufferGeometry {
  const nu = 12, nv = 14;
  const pos: number[] = [];
  const idx: number[] = [];
  const W = (v: number) => RAY.span * Math.pow(Math.sin(Math.PI * Math.pow(v, 1.7)), 0.75);
  for (const top of [1, -1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      const z = RAY.front + (RAY.back - RAY.front) * v;
      const w = W(v);
      for (let i = 0; i <= nu; i++) {
        const u = (i / nu) * 2 - 1;
        const x = u * w;
        // Thickest over the body in the middle, thin at the wing margins.
        const body = Math.exp(-(x * x) / 0.012);
        const th = top > 0 ? 0.018 * (1 - u * u) + 0.03 * body * Math.sin(Math.PI * v) : -0.008 * (1 - u * u) - 0.01 * body * Math.sin(Math.PI * v);
        pos.push(x, th, z);
      }
    }
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i, b = a + nu + 1;
        if (top > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
        else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
  }
  const disc = new THREE.BufferGeometry();
  disc.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  disc.setIndex(idx);
  disc.computeVertexNormals();
  const b = new GeoBuilder();
  const topCol = (p: THREE.Vector3) => (Math.sin(p.x * 30) * Math.sin(p.z * 30) > 0.6 ? 0x3a3530 : 0x5a5048);
  b.add(disc, { color: (p, n) => new THREE.Color(n.y > 0 ? topCol(p) : 0xd8d2c8), sway: (p) => Math.min(1, Math.abs(p.x) / RAY.span) });
  // Eyes and spiracles on top of the head.
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.016, 0), C(0x4a4238), M.t(x * 0.04, 0.035, 0.14, 0, 0, 0, 1, 0.7, 1.2));
    b.add(P.sphere(0.007, 0), C(0x141210), M.t(x * 0.044, 0.044, 0.15));
    b.add(P.sphere(0.01, 0), C(0x2e2a26), M.t(x * 0.045, 0.03, 0.1, 0, 0, 0, 1, 0.5, 1.4));
  }
  // Small pelvic fins at the back of the disc.
  for (const x of [-1, 1]) b.add(P.box(0.05, 0.008, 0.06), C(0x4e463e), M.t(x * 0.045, 0.004, -0.25, 0, x * 0.4, 0));
  // Whip tail with the barb, bending along its length.
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 8; k++) pts.push(new THREE.Vector3(0, 0.012, RAY.back + 0.02 - (k / 8) * RAY.tail));
  const tailLen = RAY.tail;
  const tailW = (p: THREE.Vector3) => -Math.min(1, Math.max(0, (RAY.back + 0.02 - p.z) / tailLen));
  b.add(tube(pts, (t) => 0.014 * (1 - t) + 0.002, 4, 12), { color: 0x3a3530, sway: tailW });
  b.add(P.cone(0.006, 0.05, 3), { color: 0x201c18, sway: tailW }, M.t(0, 0.02, RAY.back - 0.2, -Math.PI / 2 - 0.3, 0, 0));
  return facet(b.build());
}

function softShadow(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(10,30,40,0.55)');
  grd.addColorStop(1, 'rgba(10,30,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

const _m = new THREE.Matrix4();
const _b = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);

function compose(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
}

const _ik = { a: 0, b: 0 };
/** Two-bone IK in a leg's vertical plane: foot at (h out, v up) from the root; knee up. */
function legIK(h: number, v: number, L1: number, L2: number): void {
  const d = THREE.MathUtils.clamp(Math.hypot(h, v), Math.abs(L1 - L2) + 1e-4, (L1 + L2) * 0.999);
  const phi = Math.atan2(v, h);
  const al = Math.acos(THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const a = phi + al;
  _ik.a = a;
  _ik.b = Math.atan2(v - L1 * Math.sin(a), h - L1 * Math.cos(a)) - a;
}

/** Little beach crabs that scuttle sideways and burrow, and stingrays gliding over the shallows. */
export class Critters {
  readonly group = new THREE.Group();
  private crabs: Crab[] = [];
  private rays: Ray[] = [];
  private crabParts = new QuadMeshes();
  private rayMesh: THREE.InstancedMesh;
  private rayShadow: THREE.InstancedMesh;
  private rayAnim: THREE.InstancedBufferAttribute;
  private rng: RNG;
  /** Cosmetic choices (claw waving) use their own generator so the behaviour stream is unchanged. */
  private arng: RNG;

  constructor(private world: World) {
    this.rng = new RNG(world.seed * 71 + 3);
    this.arng = new RNG(world.seed * 313 + 17);
    this.spawn();
    const n = Math.max(1, this.crabs.length);
    const cp = this.crabParts;
    cp.add('body', crabBody(), n);
    cp.add('legU', segX(CRAB.L1, 0.0065, 0.0055, SHELL), n * 8);
    cp.add('legL', segX(CRAB.L2, 0.0055, 0.003, SHELL_DARK, TIP), n * 8);
    cp.add('arm', segX(CRAB.armLen, 0.009, 0.008, SHELL), n * 2);
    cp.add('claw', crabClaw(), n * 2);
    cp.add('pinch', crabPinch(), n * 2);
    cp.add('eye', crabEye(), n * 2);
    this.group.add(cp.group);

    // Rays ripple their wing margins in the vertex shader: a wave travelling back along the disc,
    // growing toward the edges, with the whip tail swaying behind.
    const rayMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    rayMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = FX.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aVeg;\nattribute vec3 iRay;\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            float w = max(aVeg.x, 0.0);
            float tw = max(-aVeg.x, 0.0);
            float side = sign(position.x);
            // Travelling wave (crests move from the head toward the tail), bigger on the outer wing.
            float amp = iRay.y * (1.0 + side * iRay.z);
            float wv = sin(iRay.x + position.z * ${RAY_WAVE_K.toFixed(2)});
            transformed.y += wv * w * w * amp + sin(iRay.x * 0.5) * w * amp * 0.25;
            // Tail: a lagging lateral sway, bending into turns.
            transformed.x += (sin(iRay.x * 0.5 - tw * 3.5) * 0.035 - iRay.z * 0.12) * tw * tw;
            transformed.y += sin(iRay.x * 0.5 - tw * 2.5) * 0.012 * tw;
          }`);
    };
    rayMat.customProgramCacheKey = () => 'stingray';
    const rg = rayGeometry();
    this.rayAnim = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, this.rays.length) * 3), 3);
    this.rayAnim.setUsage(THREE.DynamicDrawUsage);
    rg.setAttribute('iRay', this.rayAnim);
    this.rayMesh = new THREE.InstancedMesh(rg, rayMat, Math.max(1, this.rays.length));
    this.rayMesh.frustumCulled = false;
    this.rayMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.rayMesh);
    this.rayShadow = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false, fog: true }),
      Math.max(1, this.rays.length)
    );
    this.rayShadow.frustumCulled = false;
    this.rayShadow.renderOrder = 2;
    this.group.add(this.rayShadow);
  }

  private spawn(): void {
    const w = this.world;
    for (let k = 0; k < 6000 && this.crabs.length < CRITTERS.crabs; k++) {
      const cx = this.rng.int(2, w.N - 3), cz = this.rng.int(2, w.N - 3);
      const i = w.idx(cx, cz);
      if (w.layer[i] < 1 || w.layer[i] > 2 || w.sandy[i] < 0.5 || w.distWater[i] > 3 || w.occ[i]) continue;
      const x = w.centerX(cx) + this.rng.range(-0.4, 0.4), z = w.centerZ(cz) + this.rng.range(-0.4, 0.4);
      this.crabs.push({
        x, z, y: w.heightAt(x, z), hx: x, hz: z, heading: this.rng.range(0, 6.28), dir: 1, state: 'rest', timer: this.rng.range(0, 3), phase: this.rng.range(0, 10), sink: 0,
        gph: 0, spd: 0, wave: 0, waveT: 2 + (this.crabs.length % 7), waveSide: 1, guard: 0, eyes: 1,
      });
    }
    for (let k = 0; k < 6000 && this.rays.length < CRITTERS.rays; k++) {
      const cx = this.rng.int(2, w.N - 3), cz = this.rng.int(2, w.N - 3);
      const x = w.centerX(cx), z = w.centerZ(cz);
      const bed = w.heightAt(x, z);
      if (bed > -0.45 || bed < -2.2) continue;
      if (this.rays.some((r) => Math.hypot(r.x - x, r.z - z) < 6)) continue;
      this.rays.push({ x, z, y: bed + 0.25, heading: this.rng.range(0, 6.28), speed: this.rng.range(0.35, 0.6), turn: 0, phase: this.rng.range(0, 10), size: this.rng.range(0.8, 1.4), cx: x, cz: z, wave: this.rays.length * 1.3 });
    }
  }

  private sandAt(x: number, z: number): boolean {
    const w = this.world;
    const i = w.cellIndexAt(x, z);
    return i >= 0 && w.layer[i] >= 1 && w.sandy[i] > 0.3 && !w.occ[i];
  }

  update(dt: number, time: number, cursor: THREE.Vector3 | null, islanders: SpatialHash<Islander>): void {
    if (dt > 0) {
      for (const c of this.crabs) this.stepCrab(c, dt, cursor, islanders);
      for (const r of this.rays) this.stepRay(r, dt, cursor);
    }
    this.draw(time, dt);
  }

  private stepCrab(c: Crab, dt: number, cursor: THREE.Vector3 | null, islanders: SpatialHash<Islander>): void {
    c.phase += dt;
    c.timer -= dt;
    // Startled by the cursor or people walking by: scuttle off fast or dig in.
    let threat: { x: number; z: number } | null = null;
    if (cursor && Math.hypot(cursor.x - c.x, cursor.z - c.z) < CRITTERS.crabFleeRadius) threat = cursor;
    islanders.query(c.x, c.z, 0.9, (i) => (threat = i));
    if (threat && c.state !== 'flee' && c.state !== 'buried') {
      const t = threat as { x: number; z: number };
      if (this.rng.chance(0.35)) {
        c.state = 'buried';
        c.timer = 3 + this.rng.next() * 4;
      } else {
        c.state = 'flee';
        c.timer = 0.9;
        // Face so that sideways (the crab's local x) points away from the threat.
        const away = Math.atan2(c.x - t.x, c.z - t.z);
        c.heading = away - Math.PI / 2;
        c.dir = 1;
      }
    }
    if (c.state === 'buried') {
      c.sink = Math.min(1, c.sink + dt * 3);
      if (c.timer <= 0) c.state = 'rest';
      return;
    }
    c.sink = Math.max(0, c.sink - dt * 2);
    if (c.state === 'rest') {
      if (c.timer <= 0) {
        c.state = 'scuttle';
        c.timer = 0.5 + this.rng.next() * 1.2;
        // Scuttle back toward home if we've strayed.
        if (Math.hypot(c.x - c.hx, c.z - c.hz) > 2.5) c.heading = Math.atan2(c.hx - c.x, c.hz - c.z) - Math.PI / 2;
        else c.heading += this.rng.range(-0.6, 0.6);
        c.dir = this.rng.chance(0.5) ? 1 : -1;
      }
      return;
    }
    const sp = c.state === 'flee' ? 1.4 : 0.45;
    const sx = Math.cos(c.heading) * c.dir, sz = -Math.sin(c.heading) * c.dir;
    const nx = c.x + sx * sp * dt, nz = c.z + sz * sp * dt;
    if (this.sandAt(nx, nz)) {
      c.x = nx;
      c.z = nz;
      c.y = this.world.heightAt(nx, nz);
    } else c.dir *= -1;
    if (c.timer <= 0) {
      c.state = 'rest';
      c.timer = 1 + this.rng.next() * 3.5;
    }
  }

  private stepRay(r: Ray, dt: number, cursor: THREE.Vector3 | null): void {
    r.phase += dt;
    // Wander in slow loops around a home area, keeping to the shallows.
    const w = this.world;
    const ax = r.x + Math.sin(r.heading) * 1.5, az = r.z + Math.cos(r.heading) * 1.5;
    const bed = w.heightAt(ax, az);
    let want = Math.sin(r.phase * 0.2) * 0.4;
    if (bed > -0.4 || bed < -2.6 || Math.hypot(ax - r.cx, az - r.cz) > 10) want = 1.4;
    if (cursor && Math.hypot(cursor.x - r.x, cursor.z - r.z) < CRITTERS.rayFleeRadius) {
      const away = Math.atan2(r.x - cursor.x, r.z - cursor.z);
      let d = away - r.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      want = Math.sign(d) * 1.8;
      r.speed = Math.min(1.4, r.speed + dt);
    } else r.speed += (0.45 - r.speed) * dt * 0.5;
    r.turn += (want - r.turn) * Math.min(1, dt * 1.5);
    r.heading += r.turn * dt;
    r.x += Math.sin(r.heading) * r.speed * dt;
    r.z += Math.cos(r.heading) * r.speed * dt;
    const b = w.heightAt(r.x, r.z);
    r.y += (Math.min(b + 0.28, -0.22) - r.y) * Math.min(1, dt * 2);
  }

  private draw(time: number, dt: number): void {
    const cp = this.crabParts;
    cp.begin();
    for (const c of this.crabs) {
      if (c.sink > 0.97 || !View.sees(c.x, c.y, c.z, 0.3)) continue;
      this.drawCrab(c, time, dt);
    }
    cp.end();
    for (let i = 0; i < this.rays.length; i++) {
      const r = this.rays[i];
      // Undulation speeds up (and grows) when it swims faster; the inner wing of a turn ripples less.
      r.wave += dt * (RAY_WAVE.rate + r.speed * RAY_WAVE.rateSpeed);
      this.rayAnim.setXYZ(i, r.wave, RAY_WAVE.amp + r.speed * RAY_WAVE.ampSpeed, THREE.MathUtils.clamp(-r.turn * 0.25, -0.5, 0.5));
      _e.set(Math.sin(time * 0.8 + r.phase) * 0.05, r.heading, -r.turn * 0.25, 'XYZ');
      _q.setFromEuler(_e);
      _p.set(r.x, r.y + Math.sin(r.wave * 0.5) * 0.01, r.z);
      _s.setScalar(r.size);
      this.rayMesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      // Soft shadow on the seabed below.
      const bed = this.world.heightAt(r.x, r.z);
      _q.identity();
      _p.set(r.x + 0.1, bed + 0.03, r.z + 0.1);
      _s.set(r.size * 1.1, 1, r.size * 0.95);
      this.rayShadow.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.rayAnim.needsUpdate = true;
    this.rayMesh.instanceMatrix.needsUpdate = true;
    this.rayShadow.instanceMatrix.needsUpdate = true;
  }

  private drawCrab(c: Crab, time: number, dt: number): void {
    const cp = this.crabParts;
    const moving = c.state === 'scuttle' || c.state === 'flee';
    const flee = c.state === 'flee';
    const digging = c.state === 'buried' && c.sink < 0.97;
    const k = Math.min(1, dt * 10);
    c.spd += ((moving ? (flee ? 1.4 : 0.45) : 0) - c.spd) * Math.min(1, dt * 14);
    const stride = flee ? CRAB_STRIDE.flee : CRAB_STRIDE.walk;
    // Gait: cycles per second so that feet in stance keep pace with the body.
    c.gph += dt * (c.spd / (2 * stride) + (digging ? 9 : 0));
    // Claws: raised wide in threat when fleeing; now and then one waved in display while resting.
    c.waveT -= dt;
    if (c.waveT <= 0) {
      c.waveT = 2 + this.arng.next() * 6;
      if (c.state === 'rest' && this.arng.chance(0.5)) {
        c.wave = 1.6;
        c.waveSide = this.arng.chance(0.5) ? 1 : -1;
      }
    }
    c.wave = Math.max(0, c.wave - dt);
    c.guard += ((flee ? 1 : 0) - c.guard) * k;
    c.eyes += ((digging && c.sink > 0.6 ? 0 : 1) - c.eyes) * k;
    // Body: rides low and rocks a little with each step; sinks into the sand when burrowing.
    const g = c.gph * Math.PI * 2;
    const gait = Math.min(1, c.spd * 3);
    const bob = Math.abs(Math.sin(g)) * 0.006 * gait;
    const s = CRITTERS.crabSize;
    compose(_b, c.x, c.y - c.sink * 0.1 * s + bob * s, c.z, Math.sin(g * 2) * 0.03 * gait, c.heading, Math.sin(g) * 0.05 * gait * c.dir, s);
    cp.put('body', _b, WHITE);
    // Walking legs: an alternating tetrapod gait (L1 R2 L3 R4 against R1 L2 R3 L4); feet in stance
    // slide back against the direction of travel, feet in swing lift and reach ahead.
    for (let side = -1; side <= 1; side += 2) {
      for (let j = 0; j < 4; j++) {
        const group = (j + (side > 0 ? 1 : 0)) % 2;
        const ph = (c.gph + group * 0.5) % 1;
        // Relative foot offset along the direction of travel: +1 ahead … −1 behind.
        let off: number, lift = 0;
        if (ph < 0.5) off = 1 - (ph / 0.5) * 2;
        else {
          const sw = (ph - 0.5) / 0.5;
          off = -1 + sw * 2;
          lift = Math.sin(sw * Math.PI);
        }
        off *= gait;
        lift *= gait;
        if (digging) {
          // Burrowing: the legs scrape and shovel the sand away.
          off = Math.sin(g + j) * 0.8;
          lift = Math.max(0, Math.cos(g + j)) * 0.6;
        }
        const yaw = CRAB.legYaw[j];
        // Travel is along local x (sign c.dir): shift this foot along x and re-aim the leg at it.
        const h0 = CRAB.reach + (c.state === 'rest' ? Math.sin(time * 0.7 + j + side) * 0.002 : 0);
        const fx = h0 * Math.cos(yaw) + off * stride * 0.5 * c.dir * side, fz = h0 * Math.sin(yaw);
        const reach = Math.hypot(fx, fz);
        const yawLive = Math.atan2(fz, fx);
        legIK(reach, -CRAB.bodyY + c.sink * 0.06 + lift * CRAB_STRIDE.lift, CRAB.L1, CRAB.L2);
        const [rx, rz] = CRAB.legRoot[j];
        _m.multiplyMatrices(_b, compose(_t, side * rx, CRAB.bodyY - 0.004, rz, 0, side > 0 ? -yawLive : Math.PI + yawLive, _ik.a));
        cp.put('legU', _m, WHITE);
        _m.multiply(compose(_t, CRAB.L1, 0, 0, 0, 0, _ik.b));
        cp.put('legL', _m, WHITE);
      }
      // Claws: held folded in front of the mouth; raised and opened in threat; one waved in display.
      const disp = c.waveSide === side && c.wave > 0 ? Math.sin(Math.min(1, c.wave / 1.6) * Math.PI) : 0;
      const waveA = disp * (0.6 + Math.sin(time * 9) * 0.35);
      const raise = 0.15 + c.guard * 0.75 + waveA;
      const armYaw = 1.05 - c.guard * 0.35;
      _m.multiplyMatrices(_b, compose(_t, side * CRAB.claw[0], CRAB.claw[1], CRAB.claw[2], 0, side > 0 ? -armYaw : Math.PI + armYaw, raise));
      cp.put('arm', _m, WHITE);
      _m.multiply(compose(_t, CRAB.armLen, 0, 0, 0, -side * (0.95 - c.guard * 0.5), -raise * 0.6 - 0.1));
      cp.put('claw', _m, WHITE);
      const snap = c.guard * Math.max(0, Math.sin(time * 14 + side)) + disp * 0.3;
      _m.multiply(compose(_t, 0.03, 0.006, 0, 0, 0, 0.08 + snap * 0.5));
      cp.put('pinch', _m, WHITE);
      // Eye stalks: raised and swivelling; flattened into their grooves when burrowing.
      const ex = CRAB.eye;
      _m.multiplyMatrices(_b, compose(_t, side * ex[0], ex[1] - 0.012, ex[2], -(1 - c.eyes) * 1.3 + Math.sin(time * 1.3 + c.phase) * 0.1, 0, -side * 0.15 + Math.sin(time * 0.9 + side + c.hx) * 0.12, 1));
      cp.put('eye', _m, WHITE);
    }
  }
}

/** Stingray undulation: wavenumber along the disc, base rate and amplitude (plus per unit of speed). */
const RAY_WAVE_K = 13;
const RAY_WAVE = { rate: 2.2, rateSpeed: 3.2, amp: 0.035, ampSpeed: 0.035 };
