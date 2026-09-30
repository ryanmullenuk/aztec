import * as THREE from 'three';
import { BOATS, JETTY } from '../config';
import { Building, BuildingSystem } from '../buildings/Buildings';
import { Colony } from '../ai/Colony';
import { Economy } from '../economy/Economy';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { patchStylised } from '../render/materials';
import { Vegetation } from '../vegetation/Vegetation';
import { SEA_SURFACE, Water } from '../water/Water';
import { Particles } from '../render/Particles';
export { Particles };
import { World } from '../world/World';
import { Islander } from './Islander';
import { CanoePassenger } from './CanoePassenger';
import { School, Wildlife } from './Wildlife';
import { giveWay, Hull, hullGap, pickSchool, stationOffset } from './fleet';

/** Eased swell pose of a hull (so it settles gently rather than twitching). */
export interface Ride {
  y: number;
  pitch: number;
  roll: number;
  init: boolean;
}

/** What the shared sailing, mooring, swell and wake helpers need of any boat. */
export interface Vessel {
  x: number;
  z: number;
  heading: number;
  speed: number;
  ride: Ride;
  /** Distance sailed since the last wake puff. */
  wakeAcc: number;
  /** Seconds spent barely moving while under way (a new pier or bridge in the way: find another route). */
  stuck?: number;
}

export const newRide = (): Ride => ({ y: SEA_SURFACE, pitch: 0, roll: 0, init: false });

interface Boat extends Vessel {
  id: number;
  jetty: number;
  state: 'docked' | 'out' | 'netting' | 'return';
  /** Home and backing onto the berth. */
  mooring: boolean;
  crew: Islander | null;
  path: { x: number; z: number }[] | null;
  idx: number;
  timer: number;
  catch: number;
  school: School | null;
  mesh: THREE.Group;
  net: THREE.Group;
  /** Rower pivot (rocks with the paddle stroke), holding a seated male and female: the crew's shows. */
  rower: THREE.Group;
  seats: Record<'m' | 'f', CanoePassenger>;
  paddlePhase: number;
  sail: boolean;
  /** Seconds to the next ripple ring while lying still with the net out. */
  rippleT: number;
  /** Seconds of fishing left on this trip (counts down once the boat reaches the fishing grounds). */
  fishTime: number;
  onTrip: boolean;
}

/** Boats were oversized next to islanders. */
export const BOAT_SCALE = 0.65;
/** Half length and half beam of a fishing boat's hull (world units at BOAT_SCALE). */
export const HULL_HALF = 1.05 * BOAT_SCALE;
export const HULL_BEAM = 0.32 * BOAT_SCALE;

/** Hull and sail colours. */
export interface BoatLook {
  hull: number;
  keel: number;
  inner: number;
  deck: number;
  rim: number;
  sail: number;
  stripe: number;
  /** Optional band along the foot of the sail. */
  band?: number;
}

/** The village's own boats: red-ochre hulls, cream sails with gold stripes. */
export const HOME_LOOK: BoatLook = { hull: 0xb8452f, keel: 0x8b5a34, inner: 0x5e3a22, deck: 0x7a4e2e, rim: 0xd8b04a, sail: 0xf4ecd8, stripe: 0xd4a017 };

export function boatGeometry(sail: boolean, look: BoatLook = HOME_LOOK): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const hull = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  b.add(hull, { color: (p) => (p.y > -0.05 ? new THREE.Color(look.hull) : new THREE.Color(look.keel)) }, M.t(0, 0.18, 0, 0, 0, 0, 0.32, 0.22, 1.05));
  // Inner hull and deck: the half-sphere shell alone is see-through from above.
  b.add(hull.clone().scale(-1, 1, 1), { color: look.inner }, M.t(0, 0.18, 0, 0, 0, 0, 0.29, 0.19, 1.0));
  b.add(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), { color: look.deck }, M.t(0, 0.1, 0, 0, 0, 0, 0.27, 1, 0.95));
  // Gunwale rim.
  b.add(new THREE.TorusGeometry(1, 0.04, 4, 20).rotateX(Math.PI / 2), { color: look.rim }, M.t(0, 0.185, 0, 0, 0, 0, 0.32, 1, 1.05));
  b.add(P.box(0.5, 0.03, 0.08), { color: 0x6e4428 }, M.t(0, 0.16, 0.3));
  b.add(P.box(0.5, 0.03, 0.08), { color: 0x6e4428 }, M.t(0, 0.16, -0.35));
  // Net pile at the stern.
  b.add(P.sphere(0.12, 1), { color: 0xd9c9a0 }, M.t(0, 0.15, -0.65, 0, 0, 0, 1.2, 0.5, 1));
  if (sail) {
    b.add(P.cyl(0.015, 0.02, 1.1, 5), { color: 0x6e4428 }, M.t(0, 0.7, 0.35));
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0, 0.95);
    s.lineTo(0.6, 0.05);
    s.lineTo(0, 0);
    const sg = new THREE.ShapeGeometry(s);
    sg.rotateY(-Math.PI / 2);
    const sailCol = (p: THREE.Vector3) => new THREE.Color(look.band !== undefined && p.y < 0.42 ? look.band : (p.y * 6) % 1 < 0.2 ? look.stripe : look.sail);
    b.add(sg, { color: sailCol, sway: 0.15 }, M.t(0, 0.22, 0.38));
  }
  return b.build();
}

/** The rower's paddle (the rower is a seated character model). */
function paddleGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.008, 0.008, 0.6, 4), { color: 0x8b5a34 }, M.t(0.12, 0.3, 0.05, 0.3, 0, -0.9));
  b.add(P.box(0.03, 0.14, 0.07), { color: 0x8b5a34 }, M.t(0.33, 0.08, 0.1, 0.3, 0, -0.9));
  return b.build();
}

function netTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(240,230,200,0.9)';
  g.lineWidth = 2;
  for (let i = 0; i <= s; i += 12) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, s);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(s, i);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Float line round a cast net: a rope ring with gourd floats. */
function netFloatsGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.TorusGeometry(1, 0.018, 4, 32).rotateX(Math.PI / 2), { color: 0xd9c9a0 }, M.t(0, 0.01, 0));
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    b.add(P.sphere(0.05, 1), { color: k % 2 ? 0xd8b04a : 0xc8742c }, M.t(Math.cos(a), 0.02, Math.sin(a), 0, 0, 0, 1, 0.6, 1));
  }
  return b.build();
}

const _m = new THREE.Matrix4();

/** Pool of flat rings that spread and fade on the sea surface (ripples round boats lying still). */
class Ripples {
  readonly mesh: THREE.InstancedMesh;
  private age: Float32Array;
  private life: Float32Array;
  private r0: Float32Array;
  private r1: Float32Array;
  private str: Float32Array;
  private px: Float32Array;
  private pz: Float32Array;
  private fade: THREE.InstancedBufferAttribute;
  private next = 0;

  constructor(private n: number) {
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    geo.setAttribute('aFade', this.fade);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xf5fbff) } },
      vertexShader: `attribute float aFade; varying float vF; varying vec2 vP;
        void main(){ vF = aFade; vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      // A faint, thin band near the rim of the quad (a ripple, not a hoop).
      fragmentShader: `uniform vec3 uColor; varying float vF; varying vec2 vP;
        void main(){ float r = length(vP); float a = exp(-pow((r - 0.8) / 0.045, 2.0)) * vF * 0.45; if (a < 0.01) discard; gl_FragColor = vec4(uColor, a); }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.r0 = new Float32Array(n);
    this.r1 = new Float32Array(n);
    this.str = new Float32Array(n);
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    _m.makeScale(0, 1, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, _m);
  }

  spawn(x: number, z: number, r0: number, r1: number, life: number, strength: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.px[i] = x;
    this.pz[i] = z;
    this.r0[i] = r0;
    this.r1[i] = r1;
    this.age[i] = 0;
    this.life[i] = life;
    this.str[i] = strength;
  }

  update(dt: number): void {
    const f = this.fade.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (f[i] !== 0) {
          f[i] = 0;
          _m.makeScale(0, 1, 0);
          this.mesh.setMatrixAt(i, _m);
        }
        continue;
      }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        continue;
      }
      // Spreads quickly then slows; fades in briefly and out slowly.
      const r = this.r0[i] + (this.r1[i] - this.r0[i]) * (1 - (1 - t) * (1 - t));
      f[i] = this.str[i] * (1 - t) * Math.min(1, t * 8);
      _m.makeScale(r, 1, r).setPosition(this.px[i], SEA_SURFACE + 0.02, this.pz[i]);
      this.mesh.setMatrixAt(i, _m);
    }
    this.fade.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Soft foam wakes, splashes and ripple rings on the sea surface, shared by every boat. */
export class SeaFx {
  readonly group = new THREE.Group();
  readonly splash = new Particles(240, 0xe8fbff);
  private foam = new Particles(1600, 0xf5fbff, BOATS.wakeOpacity);
  private rings = new Ripples(64);

  constructor() {
    this.group.add(this.foam.points, this.splash.points, this.rings.mesh);
  }

  /**
   * A gentle continuous wake: foam puffs laid every BOATS.wakeSpacing sailed, so a faster boat
   * leaves a longer, wider, livelier trail and a boat drifting slowly barely any.
   * @param top the boat's cruising speed (sets how strong the wake is at a given speed)
   */
  wake(v: Vessel, dt: number, half: number, beam: number, top: number): void {
    const s = Math.min(1.2, Math.max(0, v.speed) / top);
    if (s < 0.06) {
      v.wakeAcc = 0;
      return;
    }
    v.wakeAcc += v.speed * dt;
    const size = half / HULL_HALF;
    const y = SEA_SURFACE + 0.05;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading), px = Math.cos(v.heading), pz = -Math.sin(v.heading);
    while (v.wakeAcc > BOATS.wakeSpacing) {
      v.wakeAcc -= BOATS.wakeSpacing;
      const sx = v.x - fx * half * 0.9, sz = v.z - fz * half * 0.9;
      // Two arms spreading outward from the stern quarters (the V), and a faint trail between them.
      const spread = (0.1 + 0.28 * s) * size;
      for (const side of [-1, 1]) {
        this.foam.spawn(sx + px * beam * 0.8 * side, y, sz + pz * beam * 0.8 * side, px * spread * side - fx * 0.04, 0, pz * spread * side - fz * 0.04, 1.3 + 1.5 * s, (0.13 + 0.13 * s) * size, (0.16 + 0.22 * s) * size);
      }
      this.foam.spawn(sx, y, sz, 0, 0, 0, 1 + 1.6 * s, (0.18 + 0.1 * s) * size, 0.28 * s * size);
      // A little bow wave when under way.
      if (s > 0.5 && Math.random() < 0.5) {
        const bx = v.x + fx * half * 0.8, bz = v.z + fz * half * 0.8, side = Math.random() < 0.5 ? -1 : 1;
        this.foam.spawn(bx + px * beam * side, y, bz + pz * beam * side, px * spread * 1.3 * side, 0, pz * spread * 1.3 * side, 0.7, 0.1 * size, 0.18 * size);
      }
    }
  }

  /** A ripple ring spreading from (x, z). */
  ring(x: number, z: number, r0: number, r1: number, life: number, strength: number): void {
    this.rings.spawn(x, z, r0, r1, life, strength);
  }

  update(dt: number): void {
    this.foam.update(dt);
    this.splash.update(dt, 3);
    this.rings.update(dt);
  }
}

/** Minimal binary min-heap of cell indices for the sea A*. */
class Heap {
  private k = new Int32Array(1024);
  private p = new Float32Array(1024);
  size = 0;

  push(key: number, pri: number): void {
    if (this.size >= this.k.length) {
      const k = new Int32Array(this.k.length * 2), p = new Float32Array(this.p.length * 2);
      k.set(this.k);
      p.set(this.p);
      this.k = k;
      this.p = p;
    }
    let i = this.size++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.p[up] <= pri) break;
      this.k[i] = this.k[up];
      this.p[i] = this.p[up];
      i = up;
    }
    this.k[i] = key;
    this.p[i] = pri;
  }

  pop(): number {
    const top = this.k[0];
    const key = this.k[--this.size], pri = this.p[this.size];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.p[c + 1] < this.p[c]) c++;
      if (this.p[c] >= pri) break;
      this.k[i] = this.k[c];
      this.p[i] = this.p[c];
      i = c;
    }
    this.k[i] = key;
    this.p[i] = pri;
    return top;
  }
}

const wrap = (a: number): number => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** A canoe bringing new settlers across the sea to the island. */
interface Arrival extends Vessel {
  mesh: THREE.Group;
  rowers: CanoePassenger[];
  path: { x: number; z: number }[];
  idx: number;
  genders: ('m' | 'f')[];
  land: { x: number; z: number };
  state: 'sail' | 'beached';
  timer: number;
  phase: number;
  onLand?: (people: Islander[]) => void;
}

/** Canoes and fishing boats: built at jetties, crewed by fishers, sail to fish schools, net and return. */
export class Boats {
  readonly group = new THREE.Group();
  list: Boat[] = [];
  private nextId = 1;
  /** Wakes, splashes and ripples (trade boats use them too). */
  readonly fx = new SeaFx();
  private geos = [boatGeometry(false), boatGeometry(true)];
  private paddleGeo = paddleGeometry();
  private netGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  private floatsGeo = netFloatsGeometry();
  /** Boats' own double-sided material (never modify the shared stylised one). */
  private hullMat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
  private netMat = new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
  /** Rocks and reefs (fixed). */
  private blocked: Uint8Array;
  /** Sea route grid, redone about once a second: 0 no way through, 1 open water, 2 open but beside an obstacle. */
  private nav: Uint8Array;
  private navAt = -Infinity;
  private clock = 0;
  // A* scratch, reused between searches (stamped instead of cleared).
  private g: Float32Array;
  private from: Int32Array;
  private seen: Uint32Array;
  private shut: Uint32Array;
  private stamp = 0;
  private heap = new Heap();
  /** Other boats on the water (trade boats, visitors) for keeping clear. */
  readonly fleets: (() => Iterable<Hull>)[] = [];
  /** Number of boats ever launched (milestone). */
  launched = 0;
  onLaunch: () => void = () => {};
  sfx: (n: string, x: number, z: number) => void = () => {};

  constructor(private world: World, private water: Water, private bld: BuildingSystem, private colony: Colony, private eco: Economy, private wildlife: Wildlife, veg: Vegetation) {
    this.group.add(this.fx.group);
    const NN = world.N * world.N;
    // Rocks and reefs are obstacles for boats.
    this.blocked = new Uint8Array(NN);
    for (const p of veg.plants) {
      if (p.kind === 'searock' || p.kind === 'reef') {
        const i = world.cellIndexAt(p.x, p.z);
        if (i >= 0) this.blocked[i] = 1;
      }
    }
    this.nav = new Uint8Array(NN);
    this.g = new Float32Array(NN);
    this.from = new Int32Array(NN);
    this.seen = new Uint32Array(NN);
    this.shut = new Uint32Array(NN);
  }

  /** Extra obstacle cells (coral reefs) that boats steer around. */
  blockCells(cells: number[]): void {
    for (const i of cells) this.blocked[i] = 1;
    this.navAt = -Infinity;
  }

  /** Start building a boat at a jetty (pays the cost). */
  order(j: Building): boolean {
    if (!j.complete || j.boatBuild > 0 || j.boats.length >= JETTY.maxBoats) return false;
    if (!this.eco.spend(JETTY.boatCost)) return false;
    j.boatBuild = 0.001;
    return true;
  }

  private spawn(j: Building, sail: boolean): Boat {
    const mesh = new THREE.Group();
    const hullMat = this.hullMat;
    const hull = new THREE.Mesh(this.geos[sail ? 1 : 0], hullMat);
    hull.castShadow = true;
    const rower = new THREE.Group();
    const seats = { m: new CanoePassenger('m', 0.62 / 1.8 / BOAT_SCALE, this.paddleGeo), f: new CanoePassenger('f', 0.62 / 1.8 / BOAT_SCALE, this.paddleGeo) };
    rower.add(seats.m, seats.f);
    rower.visible = false;
    // The cast net: a mesh disc on the surface ringed by its float line (sits just above the sea plane).
    const net = new THREE.Group();
    const disc = new THREE.Mesh(this.netGeo, this.netMat);
    disc.renderOrder = 15;
    const floats = new THREE.Mesh(this.floatsGeo, this.hullMat);
    net.add(disc, floats);
    net.visible = false;
    mesh.add(hull, rower);
    mesh.scale.setScalar(BOAT_SCALE);
    this.group.add(mesh, net);
    const slot = j.boats.length;
    j.boats.push(0);
    const at = this.berth(j, slot);
    const b: Boat = {
      id: this.nextId++, jetty: j.id, x: at.x, z: at.z, heading: at.out, speed: 0, ride: newRide(), wakeAcc: 0,
      state: 'docked', mooring: false, crew: null, path: null, idx: 0, timer: 0, catch: 0, school: null, mesh, net, rower, seats, paddlePhase: Math.random() * 6, sail, rippleT: 0, fishTime: 0, onTrip: false,
    };
    j.boats[slot] = b.id;
    this.list.push(b);
    this.launched++;
    this.onLaunch();
    return b;
  }

  /**
   * Where boat `slot` moors at a jetty or Trade Dock: side by side off the end of the pier, bows
   * out to sea. `approach` is where it turns round before backing in (staggered per slot).
   */
  berth(j: Building, slot: number, spacing = 0.9, centre = 1, out = JETTY.berthOut): { x: number; z: number; out: number; approach: { x: number; z: number } } {
    const [dx, dz] = j.dir;
    const lat = (slot - centre) * spacing;
    const x = j.dockX + dx * out + dz * lat, z = j.dockZ + dz * out - dx * lat;
    let a = BOATS.approach + slot * BOATS.approachStagger;
    // Turn round in open water (closer in if the pier reaches into a narrow bay).
    while (a > 1.2 && !this.open(x + dx * a, z + dz * a)) a -= 0.4;
    return { x, z, out: Math.atan2(dx, dz), approach: { x: x + dx * a, z: z + dz * a } };
  }

  private slot(b: Boat, j: Building): number {
    return Math.max(0, j.boats.indexOf(b.id));
  }

  /** A fisher arrives at the jetty: crew a free docked boat. */
  board(isl: Islander, j: Building): boolean {
    const b = this.list.find((x) => x.jetty === j.id && x.state === 'docked' && !x.crew);
    if (!b) return false;
    const school = this.chooseSchool(b);
    if (!school) return false;
    b.school = school;
    const st = this.station(b);
    const { approach } = this.berth(j, this.slot(b, j));
    const path = this.waterPath(approach.x, approach.z, st.x, st.z);
    if (!path) {
      b.school = null;
      return false;
    }
    b.crew = isl;
    // Straight out from the berth first, then away to the grounds.
    b.path = [approach, ...path];
    b.idx = 0;
    b.state = 'out';
    b.rower.visible = true;
    b.seats.m.visible = isl.gender === 'm';
    b.seats.f.visible = isl.gender === 'f';
    this.sfx('splash', b.x, b.z);
    return true;
  }

  /** The school this boat should work: near, but preferring one no other boat is on. */
  private chooseSchool(b: Boat): School | null {
    const S = this.wildlife.schools;
    const working = S.map((s) => this.list.filter((o) => o !== b && o.school === s).length);
    const k = pickSchool(b.x, b.z, S, working);
    return k >= 0 ? S[k] : null;
  }

  /** This boat's station on its school: boats sharing a school spread evenly round it. */
  private station(b: Boat): { x: number; z: number } {
    const s = b.school;
    if (!s) return { x: b.x, z: b.z };
    const crew = this.list.filter((o) => o.school === s).sort((p, q) => p.id - q.id);
    // The first station faces the island (the side the boats come from).
    const off = stationOffset(crew.indexOf(b), crew.length, Math.atan2(-s.x, -s.z));
    // Keep to open water: come in closer to the school if the station falls on a reef or shallows.
    for (const f of [1, 0.7, 0.45]) {
      const x = s.x + off.x * f, z = s.z + off.z * f;
      if (this.open(x, z)) return { x, z };
    }
    return { x: s.x, z: s.z };
  }

  // ---------------- Sea routes ----------------

  /** Rebuild the sea route grid (piers, bridges and buildings come and go). */
  private refreshNav(force = false): void {
    if (!force && this.clock - this.navAt < 1) return;
    this.navAt = this.clock;
    const w = this.world, N = w.N, nav = this.nav;
    for (let i = 0; i < N * N; i++) {
      nav[i] = w.layer[i] <= 0 && !this.blocked[i] && !w.bridge[i] && !w.occ[i] && !w.blocked(i) ? 1 : 0;
    }
    // Pier decks and their T-ends reach out over the water.
    for (const b of this.bld.list) if (b.key === 'jetty' || b.key === 'tradedock') this.markPier(b, nav);
    // Open water right beside an obstacle costs a little more, so routes keep a boat's width off.
    for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
      const i = cz * N + cx;
      if (!nav[i]) continue;
      near: for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if ((dx || dz) && w.inBounds(nx, nz) && !nav[nz * N + nx]) {
          nav[i] = 2;
          break near;
        }
      }
    }
  }

  /** Clear the cells under a pier's deck and T-end (model-local rectangles, as in models.ts). */
  private markPier(b: Building, nav: Uint8Array): void {
    const L = JETTY.length, z1 = 1.2 + L;
    const rects = b.key === 'jetty'
      ? [[0.02, 0.98, 1.2, z1], [-0.6, 1.6, z1 - 0.15, z1 + 0.75]]
      : [[-0.05, 1.05, 1.2, z1], [-1.2, 2.2, z1 - 0.15, z1 + 0.95]];
    for (const [x0, x1, z0, z2] of rects) {
      for (let lz = z0 + 0.05; lz <= z2 - 0.05 + 1e-6; lz += 0.2) for (let lx = x0 + 0.05; lx <= x1 - 0.05 + 1e-6; lx += 0.2) {
        const [wx, wz] = b.local(lx, lz);
        const i = this.world.cellIndexAt(wx, wz);
        if (i >= 0) nav[i] = 0;
      }
    }
  }

  /** Is (x, z) open water a boat may sail in? */
  open(x: number, z: number): boolean {
    this.refreshNav();
    const i = this.world.cellIndexAt(x, z);
    return i >= 0 && this.nav[i] > 0;
  }

  /** Room for a hull here: centre (and bow) in open water. */
  private roomFor(x: number, z: number, heading: number, half: number, bow: boolean): boolean {
    if (!this.open(x, z)) return false;
    return !bow || this.open(x + Math.sin(heading) * half * 0.9, z + Math.cos(heading) * half * 0.9);
  }

  /** A straight run from a to b with a hull's width of open water either side (cells okA / okB always pass). */
  private lineClear(ax: number, az: number, bx: number, bz: number, okA: number, okB: number): boolean {
    const w = this.world;
    const dx = bx - ax, dz = bz - az;
    const d = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(d / 0.25));
    const px = d > 0 ? (-dz / d) * 0.42 : 0, pz = d > 0 ? (dx / d) * 0.42 : 0;
    for (let k = 0; k <= n; k++) {
      const x = ax + (dx * k) / n, z = az + (dz * k) / n;
      for (const s of [0, 1, -1]) {
        const i = w.cellIndexAt(x + px * s, z + pz * s);
        if (i < 0) return false;
        if (!this.nav[i] && i !== okA && i !== okB) return false;
      }
    }
    return true;
  }

  /**
   * A* over sea cells, around rocks, reefs, piers, rope bridges and anything built in the water,
   * hugging deeper water and keeping off obstacles; the route is then pulled straight where the
   * water allows. The target cell itself may be an obstacle (the route ends beside it).
   * @param partial if the target can't be reached, return a route to the nearest reachable water
   */
  waterPath(sx: number, sz: number, tx: number, tz: number, partial = false): { x: number; z: number }[] | null {
    this.refreshNav();
    const w = this.world;
    const N = w.N, nav = this.nav, g = this.g, from = this.from, seen = this.seen, shut = this.shut;
    const cl = (c: number) => Math.max(0, Math.min(N - 1, c));
    const [a, b] = w.cellOf(sx, sz);
    const [c, d] = w.cellOf(tx, tz);
    const scx = cl(a), scz = cl(b), tcx = cl(c), tcz = cl(d);
    const start = scz * N + scx, goal = tcz * N + tcx;
    const stamp = ++this.stamp;
    const heap = this.heap;
    heap.size = 0;
    const h = (i: number) => Math.hypot((i % N) - tcx, ((i / N) | 0) - tcz);
    g[start] = 0;
    from[start] = -1;
    seen[start] = stamp;
    heap.push(start, h(start));
    let best = start, bestH = h(start), found = -1;
    let it = 0;
    while (heap.size && it++ < N * N) {
      const cur = heap.pop();
      if (shut[cur] === stamp) continue;
      shut[cur] = stamp;
      const hc = h(cur);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      if (cur === goal || (hc < 2 && this.lineClear(w.centerX(cur % N), w.centerZ((cur / N) | 0), tx, tz, start, goal))) {
        found = cur;
        break;
      }
      const cx = cur % N, cz = (cur / N) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!w.inBounds(nx, nz)) continue;
          const ni = nz * N + nx;
          if (shut[ni] === stamp) continue;
          if (!nav[ni] && ni !== goal) continue;
          // No squeezing diagonally between two obstacles.
          if (dx && dz && (!nav[cz * N + nx] || !nav[nz * N + cx])) continue;
          const shallow = w.layer[ni] >= 0 ? 1.5 : 0;
          const edge = nav[ni] === 2 ? BOATS.edgeCost : 0;
          const ng = g[cur] + (dx && dz ? 1.414 : 1) + shallow + edge;
          if (seen[ni] !== stamp || ng < g[ni]) {
            seen[ni] = stamp;
            g[ni] = ng;
            from[ni] = cur;
            heap.push(ni, ng + h(ni));
          }
        }
      }
    }
    const reached = found >= 0;
    if (!reached) {
      if (!partial || best === start) return null;
      found = best;
    }
    const cells: number[] = [];
    for (let k = found; k >= 0; k = from[k]) cells.push(k);
    cells.reverse();
    const pts = [{ x: sx, z: sz }, ...cells.slice(1).map((k) => ({ x: w.centerX(k % N), z: w.centerZ((k / N) | 0) }))];
    if (reached) pts.push({ x: tx, z: tz });
    // Pull the route straight: from each point, on to the furthest one in clear sight.
    const out: { x: number; z: number }[] = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      for (let k = Math.min(pts.length - 1, i + 14); k > i + 1; k--) {
        if (this.lineClear(pts[i].x, pts[i].z, pts[k].x, pts[k].z, start, goal)) {
          j = k;
          break;
        }
      }
      out.push(pts[j]);
      i = j;
    }
    return out.length ? out : [{ x: tx, z: tz }];
  }

  /**
   * A point of open deep water out towards the edge of the map, roughly along `heading` from
   * (x, z): where trade boats vanish over the horizon and visitors appear from.
   */
  openSea(x: number, z: number, heading: number, dist = 80): { x: number; z: number } {
    const lim = this.world.half - 4;
    for (const da of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6]) {
      for (const f of [1, 0.75, 0.5]) {
        const tx = Math.max(-lim, Math.min(lim, x + Math.sin(heading + da) * dist * f)), tz = Math.max(-lim, Math.min(lim, z + Math.cos(heading + da) * dist * f));
        if (this.open(tx, tz) && this.world.heightAt(tx, tz) < -1.5) return { x: tx, z: tz };
      }
    }
    return { x: Math.max(-lim, Math.min(lim, x + Math.sin(heading) * dist)), z: Math.max(-lim, Math.min(lim, z + Math.cos(heading) * dist)) };
  }

  // ---------------- Sailing and keeping clear ----------------

  /** Every hull on the water this frame: fishing boats, settlers' canoes, trade boats and visitors. */
  traffic(): Hull[] {
    const out: Hull[] = [];
    for (const b of this.list) out.push({ x: b.x, z: b.z, heading: b.heading, half: HULL_HALF, beam: HULL_BEAM, speed: b.speed, pri: 10 + b.id, moored: b.state === 'docked' || (b.state === 'netting' && b.speed < 0.3), ref: b });
    for (const a of this.arrivals) out.push({ x: a.x, z: a.z, heading: a.heading, half: HULL_HALF * 1.1, beam: HULL_BEAM * 1.1, speed: a.speed, pri: 0, moored: a.state === 'beached', ref: a });
    for (const f of this.fleets) for (const h of f()) out.push(h);
    return out;
  }

  /**
   * Sail towards (tx, tz), turning away from and slowing for hulls across the course (see
   * giveWay), easing off when facing away from the target so boats don't circle it, and never
   * moving into rocks, reefs, piers, bridges or land. `me` is this boat's entry in `traffic`.
   */
  steerTo(v: Vessel, me: Hull, tx: number, tz: number, top: number, dt: number, traffic: Hull[], turnRate = 2.5, bow = true): void {
    const want = Math.atan2(tx - v.x, tz - v.z);
    const look = BOATS.lookAhead * Math.max(v.speed, 0.8) + 0.5;
    const gw = giveWay(me, want, traffic, BOATS.clearance, look);
    const dh = wrap(want + gw.turn * 0.8 - v.heading);
    v.heading = wrap(v.heading + Math.max(-BOATS.avoidTurn * dt * 2, Math.min(BOATS.avoidTurn * dt * 2, dh * Math.min(1, dt * turnRate))));
    const target = top * gw.slow * Math.max(0.25, Math.cos(dh));
    v.speed += (target - v.speed) * Math.min(1, dt * 1.5);
    this.move(v, me, dt, traffic, bow);
  }

  /** Move a boat along its heading (sliding along obstacles), then part it from any hull it touches. */
  move(v: Vessel, me: Hull, dt: number, traffic: Hull[], bow = true): void {
    const nx = v.x + Math.sin(v.heading) * v.speed * dt, nz = v.z + Math.cos(v.heading) * v.speed * dt;
    // A boat somehow already in a blocked cell may always move (to get out).
    const stuck = !this.open(v.x, v.z);
    if (stuck || this.roomFor(nx, nz, v.heading, me.half, bow)) {
      v.x = nx;
      v.z = nz;
    } else if (this.roomFor(nx, v.z, v.heading, me.half, bow)) v.x = nx;
    else if (this.roomFor(v.x, nz, v.heading, me.half, bow)) v.z = nz;
    else v.speed *= 0.5;
    me.x = v.x;
    me.z = v.z;
    me.heading = v.heading;
    me.speed = v.speed;
    this.separate(v, me, traffic);
  }

  /** Hulls never overlap: push this boat clear of any it touches (all the way if the other is moored or has the right of way). */
  separate(v: Vessel, me: Hull, traffic: Hull[]): void {
    for (const o of traffic) {
      if (o.ref === me.ref) continue;
      const r = me.half + o.half + 0.5;
      if (Math.abs(o.x - me.x) > r || Math.abs(o.z - me.z) > r) continue;
      const gp = hullGap(me, o);
      if (gp.gap >= BOATS.minGap) continue;
      const share = o.moored ? 1 : o.pri < me.pri ? 0.75 : 0.25;
      const push = Math.min(0.25, (BOATS.minGap - gp.gap) * share);
      const nx = v.x + gp.nx * push, nz = v.z + gp.nz * push;
      if (!this.open(v.x, v.z) || this.open(nx, nz)) {
        v.x = me.x = nx;
        v.z = me.z = nz;
      }
    }
  }

  /**
   * Follow a route, easing in to its last point. Returns the index of the waypoint being sailed
   * for (path.length once arrived).
   */
  sailPath(v: Vessel, me: Hull, path: { x: number; z: number }[], idx: number, top: number, dt: number, traffic: Hull[], bow = true): number {
    while (idx < path.length && Math.hypot(path[idx].x - v.x, path[idx].z - v.z) < (idx === path.length - 1 ? 0.3 : 0.6)) idx++;
    if (idx >= path.length) return idx;
    v.stuck = v.speed < 0.15 ? (v.stuck ?? 0) + dt : 0;
    if (v.stuck > 5) {
      v.stuck = 0;
      const end = path[path.length - 1];
      const again = this.waterPath(v.x, v.z, end.x, end.z, true);
      if (again) path.splice(idx, path.length - idx, ...again);
    }
    const wp = path[idx];
    const d = Math.hypot(wp.x - v.x, wp.z - v.z);
    const sp = idx === path.length - 1 ? Math.min(top, 0.5 + d * 0.8) : top;
    this.steerTo(v, me, wp.x, wp.z, sp, dt, traffic, 2.5, bow);
    return idx;
  }

  /**
   * Moor stern first: turn round at the approach point to face out to sea (waiting while a boat
   * with the right of way swings nearby), then back gently straight onto the berth. True once moored.
   */
  berthStep(v: Vessel, me: Hull, berth: { x: number; z: number; out: number; approach: { x: number; z: number } }, dt: number, traffic: Hull[]): boolean {
    const dh = wrap(berth.out - v.heading);
    v.speed *= Math.max(0, 1 - dt * 3);
    if (Math.abs(dh) > 0.05) {
      const busy = traffic.some((o) => o.ref !== me.ref && !o.moored && o.pri < me.pri && Math.hypot(o.x - v.x, o.z - v.z) < me.half + o.half + 0.3);
      if (!busy) v.heading = wrap(v.heading + Math.sign(dh) * Math.min(Math.abs(dh), BOATS.pivotSpeed * dt));
      const e = Math.min(1, dt * 0.8);
      v.x += (berth.approach.x - v.x) * e;
      v.z += (berth.approach.z - v.z) * e;
    } else {
      v.heading = berth.out;
      const dx = berth.x - v.x, dz = berth.z - v.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.03) {
        v.x = berth.x;
        v.z = berth.z;
        v.speed = 0;
        return true;
      }
      const step = Math.min(d, Math.min(BOATS.backSpeed, 0.1 + d * 0.5) * dt);
      v.x += (dx / d) * step;
      v.z += (dz / d) * step;
    }
    me.x = v.x;
    me.z = v.z;
    me.heading = v.heading;
    return false;
  }

  /**
   * Ride the swell: rise and fall with Water.waveHeight at the hull and pitch and roll with the
   * slope of the water bow to stern and side to side, eased so the motion stays gentle.
   * @param calm share of the motion (moored boats lie in the lee of the pier)
   */
  ride(mesh: THREE.Object3D, v: Vessel, time: number, dt: number, half: number, beam: number, calm = 1): void {
    const W = this.water;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading), px = Math.cos(v.heading), pz = -Math.sin(v.heading);
    const L = half * 0.85, B = Math.max(beam * 1.4, 0.3);
    const hb = W.waveHeight(v.x + fx * L, v.z + fz * L, time), hs = W.waveHeight(v.x - fx * L, v.z - fz * L, time);
    const hp = W.waveHeight(v.x + px * B, v.z + pz * B, time), hn = W.waveHeight(v.x - px * B, v.z - pz * B, time);
    const m = BOATS.maxTilt;
    const ty = SEA_SURFACE + 0.03 + ((hb + hs + hp + hn) / 4) * BOATS.bob * calm;
    const tp = Math.max(-m, Math.min(m, ((hs - hb) / (2 * L)) * BOATS.pitch * calm));
    const tr = Math.max(-m, Math.min(m, ((hp - hn) / (2 * B)) * BOATS.roll * calm));
    const r = v.ride;
    const e = r.init ? Math.min(1, dt * 4) : 1;
    r.init = true;
    r.y += (ty - r.y) * e;
    r.pitch += (tp - r.pitch) * e;
    r.roll += (tr - r.roll) * e;
    mesh.position.set(v.x, r.y, v.z);
    mesh.rotation.set(r.pitch, v.heading, r.roll, 'YXZ');
  }

  // ---------------- Settlers ----------------

  private arrivals: Arrival[] = [];

  /** Position of the first canoe still at sea (for the camera during the opening). */
  get arrivalPos(): { x: number; z: number } | null {
    const a = this.arrivals.find((x) => x.state === 'sail');
    return a ? { x: a.x, z: a.z } : null;
  }

  /** Settlers still on their way (not yet landed). */
  get arriving(): number {
    return this.arrivals.filter((a) => a.state === 'sail').reduce((s, a) => s + a.genders.length, 0);
  }

  /**
   * Send a canoe of settlers in from the open sea to the main island's shore nearest `to`.
   * Returns the landing point (for the camera), or null if no shore was found.
   */
  sendSettlers(genders: ('m' | 'f')[], to: { x: number; z: number }, onLand?: (people: Islander[]) => void): { x: number; z: number } | null {
    const w = this.world;
    const N = w.N;
    this.refreshNav();
    // Landing: the water cell next to a main-island beach closest to the destination.
    let best = -1, bestLand = -1, bd = Infinity;
    for (let i = 0; i < N * N; i++) {
      if (!this.nav[i]) continue;
      const cx = i % N, cz = (i / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!w.inBounds(cx + dx, cz + dz)) continue;
        const j = w.idx(cx + dx, cz + dz);
        if (w.layer[j] !== 1 || w.isle[j] !== 1 || w.occ[j]) continue;
        const d = Math.hypot(w.centerX(cx) - to.x, w.centerZ(cz) - to.z) - w.sandy[j] * 4;
        if (d < bd) {
          bd = d;
          best = i;
          bestLand = j;
        }
      }
    }
    if (best < 0) return null;
    const lx = w.centerX(best % N), lz = w.centerZ((best / N) | 0);
    const land = { x: w.centerX(bestLand % N), z: w.centerZ((bestLand / N) | 0) };
    // Start far out at sea, beyond the reef, on the side facing the landing.
    let dx = lx - to.x, dz = lz - to.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    let sx = lx + dx * 45, sz = lz + dz * 45;
    const lim = w.half - 4;
    sx = Math.max(-lim, Math.min(lim, sx));
    sz = Math.max(-lim, Math.min(lim, sz));
    const path = this.waterPath(sx, sz, lx, lz, true) ?? [{ x: lx, z: lz }];
    const mesh = new THREE.Group();
    const hull = new THREE.Mesh(this.geos[0], this.hullMat);
    hull.castShadow = true;
    mesh.add(hull);
    const rowers: CanoePassenger[] = [];
    genders.forEach((gender, k) => {
      const r = new CanoePassenger(gender, (0.62 / 1.8) / (BOAT_SCALE * 1.1), this.paddleGeo);
      r.castShadow = true;
      r.position.z = 0.35 - k * (0.7 / Math.max(1, genders.length - 1));
      mesh.add(r);
      rowers.push(r);
    });
    mesh.scale.setScalar(BOAT_SCALE * 1.1);
    mesh.position.set(sx, 0.03, sz);
    this.group.add(mesh);
    this.arrivals.push({ mesh, rowers, path, idx: 0, x: sx, z: sz, heading: Math.atan2(lx - sx, lz - sz), speed: 0, ride: newRide(), wakeAcc: 0, genders, land, state: 'sail', timer: 0, phase: 0, onLand });
    return { x: lx, z: lz };
  }

  private stepArrivals(dt: number, time: number, traffic: Hull[]): void {
    const half = HULL_HALF * 1.1, beam = HULL_BEAM * 1.1;
    for (const a of this.arrivals.slice()) {
      if (a.state === 'sail') {
        const me = traffic.find((h) => h.ref === a)!;
        // No bow check: the canoe runs up onto the beach at the end.
        a.idx = this.sailPath(a, me, a.path, a.idx, 2.6, dt, traffic, false);
        if (a.idx >= a.path.length) {
          // Landed: the settlers step ashore; the canoe is pulled up on the sand.
          a.state = 'beached';
          a.timer = 120;
          a.speed = 0;
          for (const r of a.rowers) r.dispose();
          const people = a.genders.map((g, k) => this.colony.spawn(g, a.land.x + (k - (a.genders.length - 1) / 2) * 0.5, a.land.z));
          this.sfx('splash', a.x, a.z);
          a.onLand?.(people);
        } else {
          a.phase += dt * 3.2 * Math.min(1, a.speed / 1.5 + 0.2);
          this.fx.wake(a, dt, half, beam, 2.6);
        }
      } else {
        a.timer -= dt;
        if (a.timer <= 0) {
          this.group.remove(a.mesh);
          this.arrivals = this.arrivals.filter((x) => x !== a);
          continue;
        }
      }
      if (a.state === 'sail') this.ride(a.mesh, a, time, dt, half, beam);
      else {
        a.mesh.position.set(a.x, 0.06, a.z);
        a.mesh.rotation.set(-0.05, a.heading, 0, 'YXZ');
      }
      a.rowers.forEach((r, k) => (r.rotation.z = Math.sin(a.phase + k * 0.7) * 0.04 * (k % 2 ? -1 : 1)));
    }
  }

  // ---------------- Fishing fleet ----------------

  update(dt: number, time: number): void {
    this.clock += dt;
    const traffic = this.traffic();
    this.stepArrivals(dt, time, traffic);
    // Boat construction at jetties.
    for (const j of this.bld.of('jetty')) {
      if (j.boatBuild > 0) {
        j.boatBuild += dt;
        if (j.boatBuild >= JETTY.boatBuildSeconds) {
          j.boatBuild = 0;
          this.spawn(j, j.boats.length % 2 === 1);
          this.sfx('complete', j.dockX, j.dockZ);
        }
      }
    }
    // Remove boats of demolished jetties.
    for (const b of this.list.slice()) {
      if (!this.bld.byId(b.jetty)) {
        if (b.crew) this.colony.disembark(b.crew, 0, b.x, b.z);
        this.group.remove(b.mesh, b.net);
        this.list = this.list.filter((x) => x !== b);
      }
    }
    for (const b of this.list) {
      const me = traffic.find((h) => h.ref === b);
      if (me) this.step(b, me, dt, time, traffic);
    }
    this.wildlife.boats = this.list.filter((b) => b.state !== 'docked').map((b) => ({ x: b.x, z: b.z }));
    this.fx.update(dt);
  }

  /** Lay the net out (again): a splash, a ring spreading from where it lands. */
  private cast(b: Boat): void {
    b.state = 'netting';
    b.timer = JETTY.netSeconds;
    b.rippleT = BOATS.rippleEvery * 0.5;
    const n = this.netSpot(b);
    this.sfx('splash', n.x, n.z);
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2;
      this.fx.splash.spawn(n.x + Math.cos(a) * 0.8, SEA_SURFACE, n.z + Math.sin(a) * 0.8, Math.cos(a) * 0.6, 1.2 + Math.random(), Math.sin(a) * 0.6, 0.9, 0.35);
    }
    this.fx.ring(n.x, n.z, 0.3, 2.2, 2, 0.45);
  }

  /** Where the net lies: beside the boat, on the school's side. */
  private netSpot(b: Boat): { x: number; z: number } {
    const s = b.school;
    let dx = Math.cos(b.heading), dz = -Math.sin(b.heading);
    if (s && dx * (s.x - b.x) + dz * (s.z - b.z) < 0) {
      dx = -dx;
      dz = -dz;
    }
    return { x: b.x + dx * 0.95, z: b.z + dz * 0.95 };
  }

  /** Trip over: head for the jetty with the catch. */
  private goHome(b: Boat, j: Building): void {
    b.onTrip = false;
    b.fishTime = 0;
    b.school = null;
    const { approach } = this.berth(j, this.slot(b, j));
    b.path = this.waterPath(b.x, b.z, approach.x, approach.z, true) ?? [approach];
    b.idx = 0;
    b.state = 'return';
    b.mooring = false;
  }

  private step(b: Boat, me: Hull, dt: number, time: number, traffic: Hull[]): void {
    const j = this.bld.byId(b.jetty)!;
    if (b.onTrip) b.fishTime -= dt;
    let moving = false;
    if (b.state === 'out' || b.state === 'return') {
      if (b.state === 'return' && b.mooring) {
        if (this.berthStep(b, me, this.berth(j, this.slot(b, j)), dt, traffic)) {
          // Docked: crew carries the catch to storage.
          b.state = 'docked';
          b.mooring = false;
          b.rower.visible = false;
          const crew = b.crew;
          b.crew = null;
          if (crew) this.colony.disembark(crew, b.catch, j.door.x, j.door.z);
          b.catch = 0;
          b.path = null;
        }
      } else if (!b.path || b.idx >= b.path.length) {
        if (b.state === 'out') {
          // On the grounds: the five minutes start with the first cast.
          if (!b.onTrip) {
            b.onTrip = true;
            b.fishTime = JETTY.fishingSeconds;
          }
          this.cast(b);
        } else b.mooring = true;
      } else {
        b.idx = this.sailPath(b, me, b.path, b.idx, JETTY.boatSpeed, dt, traffic);
        moving = true;
      }
    } else if (b.state === 'netting') {
      // Keep station on the school, paddling gently with the net out.
      const st = this.station(b);
      const d = Math.hypot(st.x - b.x, st.z - b.z);
      if (d > 0.6) this.steerTo(b, me, st.x, st.z, JETTY.followSpeed * Math.min(1, d / 2), dt, traffic, 1.2);
      else {
        b.speed *= Math.max(0, 1 - dt * 2);
        this.move(b, me, dt, traffic);
      }
      moving = b.speed > 0.15;
      b.timer -= dt;
      // Ripples spread round the hull and the net while the boat lies still.
      b.rippleT -= dt;
      if (b.rippleT <= 0 && b.speed < 0.5) {
        b.rippleT = BOATS.rippleEvery * (0.8 + Math.random() * 0.4);
        this.fx.ring(b.x, b.z, HULL_HALF * 0.9, HULL_HALF * 2.6, 2.6, 0.3);
        if (Math.random() < 0.6) {
          const n = this.netSpot(b);
          this.fx.ring(n.x + (Math.random() - 0.5), n.z + (Math.random() - 0.5), 0.15, 0.9, 1.6, 0.25);
        }
      }
      if (b.timer <= 0) {
        // Haul in: the catch comes aboard (up to what the hold takes).
        const s = b.school;
        const room = JETTY.catchPerTrip - b.catch;
        const n = s ? Math.max(0, Math.min(JETTY.catchPerCast, room, Math.floor(s.stock) - 2)) : 0;
        if (s) s.stock -= n;
        b.catch += n;
        this.sfx('splash', b.x, b.z);
        if (b.fishTime <= 0) this.goHome(b, j);
        else {
          // Fished out: move on to another school if there is one (else keep casting here).
          if (!s || s.stock < 4) b.school = this.chooseSchool(b) ?? s;
          const st2 = this.station(b);
          const hop = Math.hypot(st2.x - b.x, st2.z - b.z) > JETTY.rehop ? this.waterPath(b.x, b.z, st2.x, st2.z) : null;
          if (hop) {
            b.path = hop;
            b.idx = 0;
            b.state = 'out';
          } else this.cast(b);
        }
      }
    } else {
      // Docked (follows the berth if the jetty is moved).
      const at = this.berth(j, this.slot(b, j));
      b.speed = 0;
      b.x = at.x;
      b.z = at.z;
      b.heading = at.out;
    }
    if (moving) this.fx.wake(b, dt, HULL_HALF, HULL_BEAM, JETTY.boatSpeed);
    else b.wakeAcc = 0;
    this.ride(b.mesh, b, time, dt, HULL_HALF, HULL_BEAM, b.state === 'docked' || b.mooring ? BOATS.mooredSway : 1);
    b.paddlePhase += dt * (b.state === 'docked' || b.mooring ? 0 : b.state === 'netting' ? Math.min(3, b.speed * 3) : 3);
    b.rower.rotation.z = Math.sin(b.paddlePhase) * 0.25;
    // Net: thrown out beside the boat, lying spread while fishing, hauled in at the end of each cast.
    if (b.state === 'netting') {
      const t = 1 - b.timer / JETTY.netSeconds;
      const spread = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
      const n = this.netSpot(b);
      b.net.visible = true;
      b.net.position.set(n.x, SEA_SURFACE + 0.015, n.z);
      b.net.scale.setScalar(0.15 + spread * 0.75);
      b.net.rotation.y = time * 0.15;
    } else b.net.visible = false;
  }

  /** Canoes out netting fish (stirred-up fish draw pelicans). */
  fishing(): { x: number; z: number }[] {
    return this.list.filter((b) => b.state === 'netting').map((b) => ({ x: b.x, z: b.z }));
  }

  positions(): { x: number; z: number }[] {
    return this.list.map((b) => ({ x: b.x, z: b.z }));
  }

  /** Restore boats for a jetty from a save. */
  restore(j: Building, count: number): void {
    for (let k = 0; k < count; k++) this.spawn(j, k % 2 === 1);
  }
}
