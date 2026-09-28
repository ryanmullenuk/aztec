import * as THREE from 'three';
import { FAUNA, WILDLIFE } from '../config';
import { ColorFn, GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';
import { FLARE, FOLDED, GULL_WING, TOUCAN_WING, WingPose, WingSpec, flapPose, mixPose, pose, trimPose, wingMatrices, wingParts } from './birdWings';
import { QuadMeshes } from './quadRig';

type V3 = [number, number, number];

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
  /** Wing fold 0 (spread) … 1 (folded on the ground) and smoothed flap strength. */
  fold: number;
  amp: number;
  // ---- Animation only (never read by the flocking / landing decisions) ----
  /** Ground activity: 0 stand, 1 walk, 2 peck, 3 preen, 4 wing stretch; and its timer. */
  act: number;
  actT: number;
  walkH: number;
  legPh: number;
  look: number;
  lookS: number;
  /** Smoothed: landing flare 0..1, legs tucked 0..1, body pitch, wing stretch, tail spread. */
  flare: number;
  tuck: number;
  pitch: number;
  stretch: number;
  spread: number;
  peck: number;
  preen: number;
  gait: number;
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
  fold: number;
  // ---- Animation only ----
  vy: number;
  bank: number;
  pitch: number;
  wph: number;
  amp: number;
  flare: number;
  tuck: number;
  /** Springy tail cock angle and its velocity. */
  tail: number;
  tailV: number;
  headYaw: number;
  bodyYaw: number;
  toss: number;
  flickT: number;
  prev: 'perch' | 'hop' | 'fly';
  seed: number;
}

const WHITE = new THREE.Color(1, 1, 1);
const _b = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _fp = pose();
const _wp = pose();
const _sp = pose();
const _wm = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];
const _here = new THREE.Vector3();
const _side = new THREE.Vector3();
/** Reused result of rayDist (read immediately by the caller, never stored). */
const _threat = { d: Infinity, ax: 0, ay: 0, az: 0 };

function compose(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(s, s, s);
  return out.compose(_p, _q, _s);
}

const _keys: Record<string, string[]> = {};
/** Part keys for a prefix (wing panels 0–5, then LegU, LegL, Foot), built once rather than per frame. */
function keys(prefix: string): string[] {
  return (_keys[prefix] ??= ['0', '1', '2', '3', '4', '5', 'LegU', 'LegL', 'Foot'].map((n) => prefix + n));
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/**
 * Vertical offset of a foot below the body origin (body units) for a two-segment bird leg hanging
 * from a hip at (hy, hz), with the body pitched by p, the tibia at u from straight down (+ back)
 * and the tarsus bent by l relative to it.
 */
function legDrop(hy: number, hz: number, p: number, u: number, l: number, L1: number, L2: number): number {
  return hy * Math.cos(p) - hz * Math.sin(p) - L1 * Math.cos(p + u) - L2 * Math.cos(p + u + l);
}

// ---------------- Geometry ----------------

const C = (c: number) => ({ color: c });

/** Mirror a (non-indexed or indexed) geometry in x, keeping faces pointing outward. */
function mirrorGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  const p = m.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
  const idx = m.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  m.computeVertexNormals();
  return m;
}

interface BillSpec {
  z0: number;
  y0: number;
  len: number;
  /** Depth and width at the base and tip. */
  h0: number;
  h1: number;
  w0: number;
  w1: number;
  /** Downward curve of the whole bill at the tip, and the extra hook of the upper tip. */
  curve: number;
  hook: number;
  segs: number;
}

/** A tapered, laterally flattened bill with a ridged culmen, a decurved line and a hooked tip. */
function billGeo(o: BillSpec): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 2, o.segs);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getZ(i) + 0.5;
    const v = p.getY(i) + 0.5;
    const h = lerp(o.h0, o.h1, u), w = lerp(o.w0, o.w1, u);
    let y = o.y0 + (v - 0.5) * h - o.curve * u * u;
    if (u > 0.72) y -= o.hook * ((u - 0.72) / 0.28) ** 2 * (0.4 + 0.6 * v);
    // The culmen is a narrow ridge: the top of the bill is slimmer than its cutting edges.
    const x = p.getX(i) * w * (v > 0.75 ? 0.55 : 1);
    p.setXYZ(i, x, y, o.z0 + u * o.len * (1 - 0.06 * (1 - v)));
  }
  return g;
}

/** One half of a tail fan (x ≥ 0), from its base at the origin trailing back along −z. */
function tailHalf(len: number, w0: number, w1: number, thick: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 1, 3);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5;
    const v = p.getZ(i) * -1 + 0.5; // 0 base, 1 tip
    const x = u * lerp(w0, w1, v);
    // Outer feathers a little shorter: a gently rounded (gull) or square (toucan) end.
    const z = -v * len * (1 - 0.1 * u * u);
    p.setXYZ(i, x, p.getY(i) * thick * (1 - 0.45 * v) + v * thick * 0.3, z);
  }
  return g;
}

/** A leg segment hanging from its joint (a small rounded joint at the top). */
function legSeg(len: number, r0: number, r1: number, color: number | ColorFn): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const c = { color };
  b.add(P.sphere(r0 * 1.15, 0), c);
  b.add(P.cyl(r1, r0, len, 5), c, M.t(0, -len / 2, 0));
  return facet(b.build());
}

/** Webbed foot (three forward toes joined by a web, and a small hind toe), pivot at the toe joint. */
function webbedFoot(len: number, r: number, toe: number, web: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r * 1.2, 0), C(toe));
  for (const a of [-0.5, 0, 0.5]) b.add(P.box(r * 1.3, r * 1.1, len), C(toe), M.t(Math.sin(a) * len * 0.5, -r * 0.5, Math.cos(a) * len * 0.5, 0, a, 0));
  b.add(P.cone(len * 0.5, len * 0.95, 3), C(web), M.t(0, -r * 0.6, len * 0.5, Math.PI / 2, 0, 0, 1, 1, 0.12));
  b.add(P.box(r, r, len * 0.3), C(toe), M.t(0, -r * 0.3, -len * 0.14));
  return facet(b.build());
}

/** Zygodactyl perching foot: two toes forward, two back, curled to grip. */
function perchFoot(len: number, r: number, toe: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r * 1.3, 0), C(toe));
  for (const [a, fwd] of [[-0.3, 1], [0.3, 1], [-0.25, -1], [0.25, -1]] as [number, number][]) {
    b.add(P.box(r * 1.3, r * 1.2, len), C(toe), M.t(Math.sin(a) * len * 0.45, -r * 0.8, fwd * Math.cos(a) * len * 0.45, fwd * 0.35, a, 0));
  }
  return facet(b.build());
}

// ---- Gull ----

const GS = 1.25;
const GULL = {
  neck: [0, 0.03, 0.064] as V3,
  tail: [0, 0.012, -0.078] as V3,
  hip: [0.014, -0.02, -0.004] as V3,
  legU: 0.022,
  legL: 0.03,
  wing: [0.026, 0.028, 0.03] as V3,
};
const G_BACK = new THREE.Color(0xb0b8c0), G_WHITE = new THREE.Color(0xfafaf6), G_BELLY = new THREE.Color(0xf2f2ee);

function gullBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // Pale grey mantle and back (where the folded wings lie), brilliant white head, breast and belly.
  const bodyCol: ColorFn = (p, n) => (n.y > 0.45 && p.z < 0.045 && p.z > -0.1 ? G_BACK : p.y < -0.01 ? G_BELLY : G_WHITE).clone();
  // Deep chest tapering to a slim rump, then the short neck rising to the head.
  b.add(P.sphere(0.06, 1), { color: bodyCol }, M.t(0, 0, 0.008, 0, 0, 0, 0.72, 0.68, 1.3));
  b.add(P.cone(0.04, 0.085, 6), { color: bodyCol }, M.t(0, 0.006, -0.06, -Math.PI / 2, 0, 0, 1, 1, 0.78));
  b.add(P.cyl(0.02, 0.03, 0.045, 6), C(0xfafaf6), M.t(0, 0.02, 0.055, 0.85, 0, 0));
  return facet(b.build());
}

function gullHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // Rounded head with a flattish crown, pivot at the base of the neck.
  b.add(P.sphere(0.032, 1), C(0xfafaf6), M.t(0, 0.014, 0.018, 0, 0, 0, 0.9, 0.88, 1.15));
  b.add(P.sphere(0.024, 0), C(0xfafaf6), M.t(0, 0.004, 0.0, 0, 0, 0, 1, 1.1, 1));
  // Stout yellow bill with a hooked tip and the red gonys spot on the lower mandible.
  const bill: BillSpec = { z0: 0.042, y0: 0.008, len: 0.05, h0: 0.014, h1: 0.008, w0: 0.012, w1: 0.005, curve: 0.002, hook: 0.006, segs: 5 };
  b.add(billGeo(bill), { color: (p) => new THREE.Color(p.z > 0.075 && p.z < 0.088 && p.y < 0.004 ? 0xd8342a : 0xf2c030) });
  for (const x of [-1, 1]) {
    // Pale yellow iris, black pupil, thin red eye ring.
    b.add(P.sphere(0.0062, 0), C(0xc8342a), M.t(x * 0.0235, 0.023, 0.03));
    b.add(P.sphere(0.0052, 0), C(0xf0e070), M.t(x * 0.0255, 0.023, 0.031));
    b.add(P.sphere(0.0026, 0), C(0x101010), M.t(x * 0.029, 0.0235, 0.033));
  }
  return facet(b.build());
}

function gullTail(left: boolean): THREE.BufferGeometry {
  const g = tailHalf(0.07, 0.014, 0.026, 0.008);
  const b = new GeoBuilder();
  // White tail with a narrow black subterminal band.
  b.add(left ? mirrorGeo(g) : g, { color: (p) => new THREE.Color(p.z < -0.05 && p.z > -0.062 ? 0x1c1c1e : 0xf4f5f2) });
  return facet(b.build());
}

// ---- Toucan ----

const TS = 1.3;
const TOU = {
  neck: [0, 0.03, 0.036] as V3,
  tail: [0, 0.014, -0.05] as V3,
  hip: [0.013, -0.024, 0.004] as V3,
  legU: 0.02,
  legL: 0.022,
  wing: [0.04, 0.018, 0.012] as V3,
};
const T_BLACK = 0x121214;

function toucanBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.05, 1), { color: (_p, n) => new THREE.Color(n.y > 0.5 ? 0x18181e : T_BLACK) }, M.t(0, 0, 0, 0, 0, 0, 0.85, 0.9, 1.25));
  // Bright yellow bib bordered with red below, and red undertail coverts.
  b.add(P.sphere(0.034, 1), C(0xf6d42a), M.t(0, 0.014, 0.04, 0, 0, 0, 1.05, 1.05, 0.62));
  b.add(P.sphere(0.03, 0), C(0xc8201e), M.t(0, -0.014, 0.036, 0, 0, 0, 1.05, 0.32, 0.62));
  b.add(P.sphere(0.02, 0), C(0xd02820), M.t(0, -0.026, -0.045, 0, 0, 0, 1, 0.7, 1.2));
  b.add(P.cyl(0.024, 0.032, 0.03, 6), C(T_BLACK), M.t(0, 0.026, 0.03, 0.5, 0, 0));
  return facet(b.build());
}

function toucanHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.033, 1), C(T_BLACK), M.t(0, 0.012, 0.008, 0, 0, 0, 0.92, 0.95, 1.05));
  // Yellow face and throat running down into the bib.
  b.add(P.sphere(0.027, 1), C(0xf6d42a), M.t(0, -0.002, 0.022, 0, 0, 0, 1.08, 0.85, 0.72));
  for (const x of [-1, 1]) {
    // Lime-green bare skin around the eye.
    b.add(P.sphere(0.011, 0), C(0x9ad84a), M.t(x * 0.026, 0.018, 0.02, 0, 0, 0, 0.55, 1, 1.1));
    b.add(P.sphere(0.0045, 0), C(0x0c0c0c), M.t(x * 0.031, 0.019, 0.022));
  }
  // The huge banded bill: green upper mandible with an orange band, blue lower mandible, red tip,
  // and a dark line at its base.
  const bill: BillSpec = { z0: 0.028, y0: 0.012, len: 0.118, h0: 0.046, h1: 0.012, w0: 0.024, w1: 0.008, curve: 0.014, hook: 0.005, segs: 7 };
  b.add(billGeo(bill), {
    color: (p) => {
      const u = (p.z - bill.z0) / bill.len;
      const mid = bill.y0 - bill.curve * u * u;
      if (u < 0.05) return new THREE.Color(0x1a1a14);
      if (u > 0.84) return new THREE.Color(0xd42a1e);
      if (p.y < mid - 0.002) return new THREE.Color(u > 0.7 ? 0xd8581e : 0x3a86d8);
      if (u > 0.3 && u < 0.62 && p.y < mid + lerp(bill.h0, bill.h1, u) * 0.3) return new THREE.Color(0xf28c1e);
      return new THREE.Color(0x8cc63e);
    },
  });
  return facet(b.build());
}

function toucanTail(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const g = tailHalf(0.1, 0.017, 0.019, 0.009);
  b.add(g, C(T_BLACK));
  b.add(mirrorGeo(g), C(T_BLACK));
  return facet(b.build());
}

// ---------------- Tuning ----------------

/** Gull ground life: walking speed, how far it wanders from where it landed, step rate (cycles/s). */
const GULL_WALK = { speed: 0.22, roam: 0.28, steps: 1.5 };
/** Head-bob amplitude (body units) while walking: the head holds still, then thrusts forward. */
const HEAD_BOB = 0.008;
/** Distance from the landing spot at which the gull starts to flare, and lowers its legs. */
const GULL_FLARE_DIST = 1.5;
const GULL_LEGS_DIST = 2.6;
/** Toucan bounding flight: flaps per burst cycle gate and the tail spring (stiffness, damping). */
const TOUCAN_TAIL_SPRING = { k: 120, c: 13 };

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
  /** Separate generator for purely cosmetic choices, so the behaviour stream is unchanged. */
  private arng: RNG;
  private time = 0;
  private meshes = new QuadMeshes();
  /** Called when birds burst into flight (for the flap sound). */
  onScatter: (x: number, z: number) => void = () => {};

  constructor(private world: World, perches: THREE.Vector3[], landing: THREE.Vector3[]) {
    this.rng = new RNG(world.seed * 211 + 1);
    this.arng = new RNG(world.seed * 997 + 5);
    this.perches = perches;
    this.landing = landing;
    this.spawn();
    const G = Math.max(1, this.gulls.length), T = Math.max(1, this.toucans.length);
    const ms = this.meshes;
    ms.add('gBody', gullBody(), G);
    ms.add('gHead', gullHead(), G);
    ms.add('gTailR', gullTail(false), G);
    ms.add('gTailL', gullTail(true), G);
    // Jointed wings: panels 0–2 right (arm, forearm, hand), 3–5 left.
    wingParts(GULL_WING).forEach((g, k) => ms.add(`gW${k}`, g, G));
    ms.add('gLegU', legSeg(GULL.legU, 0.0058, 0.0042, (p) => new THREE.Color(p.y > -GULL.legU * 0.45 ? 0xf2f2ee : 0xf0a038)), G * 2);
    ms.add('gLegL', legSeg(GULL.legL, 0.0036, 0.0032, 0xf0a038), G * 2);
    ms.add('gFoot', webbedFoot(0.026, 0.0028, 0xe89430, 0xe08a2a), G * 2);
    ms.add('tBody', toucanBody(), T);
    ms.add('tHead', toucanHead(), T);
    ms.add('tTail', toucanTail(), T);
    wingParts(TOUCAN_WING).forEach((g, k) => ms.add(`tW${k}`, g, T));
    ms.add('tLegU', legSeg(TOU.legU, 0.0055, 0.0042, 0x4a5a7a), T * 2);
    ms.add('tLegL', legSeg(TOU.legL, 0.0042, 0.0038, 0x5a6a92), T * 2);
    ms.add('tFoot', perchFoot(0.018, 0.003, 0x4e5e84), T * 2);
    this.group.add(ms.group);
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
          lx: 0, ly: 0, lz: 0, heading: 0, bank: 0, stray: 0, fold: 0, amp: 0.3,
          act: 0, actT: 0, walkH: 0, legPh: 0, look: 0, lookS: 0, flare: 0, tuck: 1, pitch: 0, stretch: 0, spread: 0.1, peck: 0, preen: 0, gait: 0,
        });
      }
    }
    const nT = this.rng.int(FAUNA.toucans[0], FAUNA.toucans[1]);
    for (let k = 0; k < nT && this.perches.length; k++) {
      const p = this.perches[Math.floor(this.rng.next() * this.perches.length)];
      this.toucans.push({
        x: p.x, y: p.y, z: p.z, heading: this.rng.range(0, 6.28), state: 'perch', timer: 3 + this.rng.next() * 10, look: 0, lookT: 0, from: p.clone(), to: p.clone(), ctrl: p.clone(), t: 0, dur: 1, flap: 0, fold: 1,
        vy: 0, bank: 0, pitch: -0.35, wph: 0, amp: 0, flare: 0, tuck: 0, tail: -0.15, tailV: 0, headYaw: 0, bodyYaw: 0, toss: 0, flickT: 2 + k, prev: 'perch', seed: k * 1.7,
      });
    }
  }

  /** Distance from a point to the pointer ray and the push-away direction (a reused scratch result). */
  private rayDist(x: number, y: number, z: number, ray: THREE.Ray | null): { d: number; ax: number; ay: number; az: number } {
    const r = _threat;
    if (!ray) {
      r.d = Infinity;
      r.ax = r.ay = r.az = 0;
      return r;
    }
    _p.set(x, y, z);
    const t = Math.max(0, _v.copy(_p).sub(ray.origin).dot(ray.direction));
    _v.copy(ray.origin).addScaledVector(ray.direction, t);
    const ax = x - _v.x, ay = y - _v.y, az = z - _v.z;
    const d = Math.hypot(ax, ay, az) || 0.001;
    r.d = d;
    r.ax = ax / d;
    r.ay = ay / d;
    r.az = az / d;
    return r;
  }

  update(dt: number, ray: THREE.Ray | null, people: SpatialHash<Islander>): void {
    if (dt > 0) {
      this.time += dt;
      this.updateGulls(dt, ray, people);
      this.updateToucans(dt, ray, people);
    }
    this.draw(dt);
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
      const tax = threat.ax, tay = threat.ay, taz = threat.az;
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
        } else this.groundLife(g, dt);
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
            g.act = 0;
            g.actT = 0.6 + this.arng.next() * 0.8;
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
        fx += tax * push;
        fz += taz * push;
        fy += Math.max(0.3, tay) * push * 0.5;
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
      const dh = wrap(g.heading - prevH);
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

  /**
   * A gull's life between landing and taking off again (cosmetic only): standing and looking about,
   * a few steps around the spot where it landed, pecking at the sand, preening, a wing stretch.
   */
  private groundLife(g: Gull, dt: number): void {
    const r = this.arng;
    g.actT -= dt;
    if (g.actT <= 0) {
      const x = r.next();
      g.act = x < 0.34 ? 0 : x < 0.62 ? 1 : x < 0.8 ? 2 : x < 0.93 ? 3 : 4;
      g.actT = g.act === 0 ? r.range(1.2, 3.5) : g.act === 1 ? r.range(0.7, 1.8) : g.act === 2 ? r.range(0.8, 2) : g.act === 3 ? r.range(1.5, 3) : 1.7;
      g.look = r.range(-1.1, 1.1);
      if (g.act === 1) {
        // Wander a little, turning back toward the landing spot if it has strayed.
        const hx = g.lx - g.x, hz = g.lz - g.z;
        g.walkH = Math.hypot(hx, hz) > GULL_WALK.roam * 0.5 ? Math.atan2(hx, hz) + r.range(-0.4, 0.4) : g.heading + r.range(-1.4, 1.4);
      }
    }
    if (g.act === 1) {
      g.heading += wrap(g.walkH - g.heading) * Math.min(1, dt * 5);
      g.legPh += dt * GULL_WALK.steps;
      const step = 0.55 + 0.45 * Math.abs(Math.sin(g.legPh * Math.PI * 2));
      const nx = g.x + Math.sin(g.heading) * GULL_WALK.speed * step * dt, nz = g.z + Math.cos(g.heading) * GULL_WALK.speed * step * dt;
      if (Math.hypot(nx - g.lx, nz - g.lz) < GULL_WALK.roam) {
        g.x = nx;
        g.z = nz;
      } else g.act = 0;
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
        const prevH = b.heading;
        if (Math.hypot(nx - b.x, nz - b.z) > 0.0001) b.heading = Math.atan2(nx - b.x, nz - b.z);
        b.vy += ((ny - b.y) / dt - b.vy) * Math.min(1, dt * 8);
        b.bank += (THREE.MathUtils.clamp(-wrap(b.heading - prevH) / dt * 0.3, -0.6, 0.6) - b.bank) * Math.min(1, dt * 5);
        b.x = nx;
        b.y = ny;
        b.z = nz;
        if (t >= 1) {
          b.state = 'perch';
          b.timer = 5 + this.rng.next() * 14;
          b.vy = 0;
        }
        continue;
      }
      b.bank *= 1 - Math.min(1, dt * 6);
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
        const here = _here.set(b.x, b.y, b.z);
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
        const dist = here.distanceTo(to);
        const side = _side.set(to.z - here.z, 0, here.x - to.x).normalize().multiplyScalar(dist * this.rng.range(-0.35, 0.35));
        b.ctrl.copy(here).add(to).multiplyScalar(0.5).add(side);
        b.ctrl.y += 1.5 + dist * 0.15;
        b.t = 0;
        b.dur = dist / (startle ? 7 : 4.5);
        if (startle) this.onScatter(b.x, b.z);
      }
    }
  }

  // ---------------- Drawing ----------------

  /** Both wings for the bird whose body matrix is in _b, with per-side gliding trim. */
  private wings(prefix: string, root: V3, spec: WingSpec, p: WingPose, roll: number, t: number, trim: number): void {
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      trimPose(p, side, roll, t, trim, _sp);
      wingMatrices(_b, side, root, spec, _sp, _wm);
      const ks = keys(prefix);
      for (let k = 0; k < 3; k++) this.meshes.put(ks[s === 0 ? k : k + 3], _wm[k], WHITE);
    }
  }

  /** Two-segment leg with a foot, from the body matrix in _b (u, l relative angles; f foot relative). */
  private leg(prefix: string, side: number, hip: V3, L1: number, L2: number, u: number, l: number, f: number, splay: number): void {
    _m.multiplyMatrices(_b, compose(_t, side * hip[0], hip[1], hip[2], u, 0, -side * splay));
    const ks = keys(prefix);
    this.meshes.put(ks[6], _m, WHITE);
    _m.multiply(compose(_t, 0, -L1, 0, l, 0, side * splay));
    this.meshes.put(ks[7], _m, WHITE);
    _m.multiply(compose(_t, 0, -L2, 0, f, 0, 0));
    this.meshes.put(ks[8], _m, WHITE);
  }

  private draw(dt: number): void {
    this.meshes.begin();
    const k = Math.min(1, dt * 6);
    for (const g of this.gulls) {
      // Wingbeat timing runs for every gull (the scatter call is keyed to it), posing only on screen.
      const panic = g.state === 'takeoff' || g.fear > 0.4;
      const burst = Math.sin(this.time * 0.45 + g.speedMul * 23) > 0.35 || g.vy > 0.6;
      const ampT = panic ? 0.95 : g.state === 'land' ? 0.22 + g.flare * 0.4 : burst ? 0.5 : 0.06;
      g.amp += (ampT - g.amp) * k;
      g.flap += dt * (panic ? 17 : g.state === 'land' ? 6 + g.flare * 8 : 7);
      g.fold += ((g.state === 'ground' ? 1 : 0) - g.fold) * Math.min(1, dt * (g.state === 'ground' ? 4 : 12));
      if (View.sees(g.x, g.y, g.z, 0.5)) this.drawGull(g, dt, panic);
    }
    for (const b of this.toucans) if (View.sees(b.x, b.y, b.z, 0.5)) this.drawToucan(b, dt);
    this.meshes.end();
  }

  private drawGull(g: Gull, dt: number, panic: boolean): void {
    const onGround = g.state === 'ground';
    const landing = g.state === 'land';
    const dl = landing ? Math.hypot(g.lx - g.x, g.ly - g.y, g.lz - g.z) : Infinity;
    const kt = Math.min(1, dt * 6);
    // ---- Landing flare, legs and posture ----
    g.flare += ((landing ? smooth(1 - (dl - 0.15) / GULL_FLARE_DIST) : 0) - g.flare) * kt;
    const tuckT = onGround || (landing && dl < GULL_LEGS_DIST) ? 0 : 1;
    g.tuck += (tuckT - g.tuck) * Math.min(1, dt * (tuckT > g.tuck ? 2.2 : 5));
    const walking = onGround && g.act === 1;
    g.gait += ((walking ? 1 : 0) - g.gait) * Math.min(1, dt * 8);
    g.peck += ((onGround && g.act === 2 ? 1 : 0) - g.peck) * kt;
    g.preen += ((onGround && g.act === 3 ? 1 : 0) - g.preen) * Math.min(1, dt * 4);
    g.stretch += ((onGround && g.act === 4 ? Math.sin(Math.PI * clamp01(1 - g.actT / 1.7)) : 0) - g.stretch) * kt;
    g.lookS += ((onGround ? g.look : 0) - g.lookS) * Math.min(1, dt * 9);
    const pitchT = onGround ? 0.05 + g.peck * 0.35 + (walking ? 0.06 : 0) : THREE.MathUtils.clamp(-g.vy * 0.05, -0.35, 0.35) - g.flare * 0.6;
    g.pitch += (pitchT - g.pitch) * Math.min(1, dt * 5);
    const bank = onGround ? 0 : g.bank * (1 - g.flare * 0.7);
    // ---- Legs: tucked back under the tail in flight, swung down and forward to land, walking ----
    const ph = g.legPh * Math.PI * 2;
    const air = 1 - (onGround ? 1 : 0);
    let uR = 0, lR = 0, uL = 0, lL = 0;
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      // Walking: the foot lifts (ankle flexing) as it swings forward, then pushes back in stance.
      const q = ph + (s === 0 ? 0 : Math.PI);
      const u0 = 0.35 + Math.cos(q) * 0.38 * g.gait;
      const l0 = -0.72 - Math.max(0, Math.sin(q)) * 0.75 * g.gait;
      let u = u0, l = l0;
      if (landing || !onGround) {
        // Legs reaching down and forward for the touchdown.
        u = lerp(u, -0.35 - g.pitch, g.flare * air);
        l = lerp(l, -0.25, g.flare * air);
      }
      u = lerp(u, 1.3, g.tuck);
      l = lerp(l, 0.2, g.tuck);
      if (side > 0) (uR = u), (lR = l);
      else (uL = u), (lL = l);
    }
    // Standing: the lower of the two feet rests on the ground.
    const drop = Math.min(legDrop(GULL.hip[1], GULL.hip[2], g.pitch, uR, lR, GULL.legU, GULL.legL), legDrop(GULL.hip[1], GULL.hip[2], g.pitch, uL, lL, GULL.legU, GULL.legL));
    const standY = g.ly - drop * GS;
    const y = onGround ? standY : landing || g.state === 'takeoff' ? Math.max(g.y, standY) : g.y;
    compose(_b, g.x, y, g.z, g.pitch, g.heading, bank, GS);
    this.meshes.put('gBody', _b, WHITE);
    // ---- Head: held level against the body's pitch and roll; bobs while walking; pecks, preens ----
    const stepF = (g.legPh * 2) % 1;
    const bob = (stepF < 0.65 ? 0.5 - stepF / 0.65 : -0.5 + (stepF - 0.65) / 0.35) * HEAD_BOB * 2 * g.gait;
    const pk = g.peck * Math.max(0, Math.sin(this.time * 9 + g.speedMul * 7));
    const hp = -g.pitch * 0.85 + g.peck * 0.55 + pk * 0.55 + g.preen * 0.45;
    const hy = g.lookS * (1 - g.preen) + g.preen * (g.speedMul > 1 ? 2.1 : -2.1) + g.preen * Math.sin(this.time * 6) * 0.15;
    _m.multiplyMatrices(_b, compose(_t, GULL.neck[0], GULL.neck[1] - g.peck * 0.01 - g.preen * 0.006, GULL.neck[2] + bob + pk * 0.012, hp, hy, -bank * 0.75));
    this.meshes.put('gHead', _m, WHITE);
    // ---- Tail: steers in turns, fans and depresses as an air brake when landing ----
    const spreadT = onGround ? 0 : 0.06 + Math.abs(g.bank) * 0.25 + g.flare * 0.55 + (g.state === 'takeoff' ? 0.25 : 0);
    g.spread += (spreadT - g.spread) * kt;
    const tp = onGround ? 0.05 - g.peck * 0.2 : THREE.MathUtils.clamp(g.vy * 0.06, -0.2, 0.2) - g.flare * 0.45;
    const tw = bank * 0.35;
    _m.multiplyMatrices(_b, compose(_t, GULL.tail[0], GULL.tail[1], GULL.tail[2], tp, -g.spread, tw));
    this.meshes.put('gTailR', _m, WHITE);
    _m.multiplyMatrices(_b, compose(_t, GULL.tail[0], GULL.tail[1], GULL.tail[2], tp, g.spread, tw));
    this.meshes.put('gTailL', _m, WHITE);
    // ---- Wings: long glides broken by bursts of flapping; hard fast strokes when frightened or
    // taking off; braking beats around a raised, cupped wing when landing; folded on the ground. ----
    flapPose(g.flap, g.amp, _fp, panic ? 0.05 : 0.2, 0.28);
    if (g.flare > 0.001) mixPose(_fp, FLARE, g.flare * 0.6, _fp);
    mixPose(_fp, FOLDED, g.fold, _wp);
    if (g.stretch > 0.001) mixPose(_wp, FLARE, g.stretch * 0.85, _wp);
    const glide = (1 - g.fold) * clamp01(1 - g.amp * 2.5);
    this.wings('gW', GULL.wing, GULL_WING, _wp, bank, this.time + g.speedMul * 9, glide);
    // ---- Legs and feet (toes flat on the ground, curled in flight) ----
    const splay = 0.06 + g.flare * 0.08;
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      const u = s === 0 ? uR : uL, l = s === 0 ? lR : lL;
      const flat = -(g.pitch + u + l);
      this.leg('g', side, GULL.hip, GULL.legU, GULL.legL, u, l, lerp(flat, 1.1, g.tuck), splay);
    }
  }

  private drawToucan(b: Toucan, dt: number): void {
    const kt = Math.min(1, dt * 8);
    const flying = b.state === 'fly';
    const hop = b.state === 'hop';
    const t = Math.min(1, b.t);
    // Landing kicks the tail up (a springy cock-and-settle), as do hops and the odd flick.
    if (b.state !== b.prev) {
      if (b.prev === 'fly' || b.state === 'hop') b.tailV += 9;
      b.prev = b.state;
    }
    b.flickT -= dt;
    if (b.flickT <= 0 && !flying) {
      b.flickT = 2.5 + this.arng.next() * 6;
      if (this.arng.chance(0.6)) b.tailV += 7;
      else b.toss = 1;
    }
    b.toss = Math.max(0, b.toss - dt * 2.2);
    // ---- Flight phases: launch, bounding flight (bursts of beats between short glides), flare ----
    const launch = flying ? clamp01(1 - b.t / 0.14) : 0;
    b.flare += ((flying ? smooth((b.t - 0.8) / 0.2) : 0) - b.flare) * kt;
    const tuckT = flying && b.flare < 0.25 && launch < 0.5 ? 1 : 0;
    b.tuck += (tuckT - b.tuck) * Math.min(1, dt * (tuckT > b.tuck ? 3 : 7));
    const bursting = Math.sin(b.flap * 2.4) > -0.35;
    const ampT = !flying ? 0 : launch > 0 ? 1 : b.flare > 0.2 ? 0.55 : bursting ? 0.85 : 0.04;
    b.amp += (ampT - b.amp) * Math.min(1, dt * 7);
    b.wph += dt * (launch > 0 ? 19 : b.flare > 0.2 ? 15 : 17);
    const foldT = flying ? 0 : hop ? 1 - 0.65 * Math.sin(t * Math.PI) : 1;
    b.fold += (foldT - b.fold) * Math.min(1, dt * 10);
    // ---- Posture ----
    const pitchT = flying ? THREE.MathUtils.clamp(-b.vy * 0.07, -0.35, 0.35) - b.flare * 0.55 : hop ? -0.2 : -0.35;
    b.pitch += (pitchT - b.pitch) * Math.min(1, dt * 6);
    b.bodyYaw += ((flying ? 0 : b.look * 0.3) - b.bodyYaw) * Math.min(1, dt * 3);
    b.headYaw += ((flying ? 0 : b.look * 0.9) - b.headYaw) * Math.min(1, dt * 14);
    // Legs: gripping the perch in a crouch, springing for a hop, tucked in flight, reaching to land.
    const crouch = hop ? 1 - Math.sin(t * Math.PI) * 0.9 : 1;
    let a1 = lerp(-0.1, 0.95, crouch), a2 = lerp(-0.25, -0.75, crouch);
    a1 = lerp(a1, -0.3, b.flare);
    a2 = lerp(a2, -0.55, b.flare);
    a1 = lerp(a1, 1.2, b.tuck);
    a2 = lerp(a2, 1.45, b.tuck);
    const u = a1 - b.pitch, l = a2 - a1;
    const drop = legDrop(TOU.hip[1], TOU.hip[2], b.pitch, u, l, TOU.legU, TOU.legL);
    // Feet on the perch (or the hop's arc); in flight the body rides just above the path, blending
    // into the standing height through the launch and the landing flare.
    const perchY = b.y - drop * TS;
    const y = flying ? lerp(b.y + 0.05, perchY, Math.max(b.flare, launch)) : perchY;
    compose(_b, b.x, y, b.z, b.pitch, b.heading + b.bodyYaw, b.bank, TS);
    this.meshes.put('tBody', _b, WHITE);
    // Head: turns in quick glances, held level in flight, tosses the bill now and then.
    const toss = Math.sin(b.toss * Math.PI) * 0.7;
    _m.multiplyMatrices(_b, compose(_t, TOU.neck[0], TOU.neck[1], TOU.neck[2], -b.pitch * 0.8 - toss + (hop ? 0.1 : 0), b.headYaw - b.bodyYaw, -b.bank * 0.7));
    this.meshes.put('tHead', _m, WHITE);
    // Tail: a damped spring around its resting angle; straight out in flight, fanned down to land.
    const tailRest = flying ? 0.05 - b.flare * 0.5 : hop ? 0.3 : -0.15 + (0.35 + b.pitch);
    const dts = Math.min(dt, 0.05);
    b.tailV += ((tailRest - b.tail) * TOUCAN_TAIL_SPRING.k - b.tailV * TOUCAN_TAIL_SPRING.c) * dts;
    b.tail += b.tailV * dts;
    b.tail = THREE.MathUtils.clamp(b.tail, -0.9, 1.3);
    _m.multiplyMatrices(_b, compose(_t, TOU.tail[0], TOU.tail[1], TOU.tail[2], b.tail, 0, b.bank * 0.3));
    this.meshes.put('tTail', _m, WHITE);
    // Wings.
    flapPose(b.wph, b.amp, _fp, 0, 0.12);
    if (b.flare > 0.001) mixPose(_fp, FLARE, b.flare * 0.65, _fp);
    mixPose(_fp, FOLDED, b.fold, _wp);
    this.wings('tW', TOU.wing, TOUCAN_WING, _wp, b.bank, this.time + b.seed,(1 - b.fold) * clamp01(1 - b.amp * 2.5));
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      this.leg('t', side, TOU.hip, TOU.legU, TOU.legL, u, l, lerp(-(b.pitch + u + l), 1.0, b.tuck), 0.1);
    }
  }
}
