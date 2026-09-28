import * as THREE from 'three';
import { JETTY } from '../config';
import { Building, BuildingSystem } from '../buildings/Buildings';
import { Colony } from '../ai/Colony';
import { Economy } from '../economy/Economy';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { patchStylised, stylisedMaterial } from '../render/materials';
import { Vegetation } from '../vegetation/Vegetation';
import { SEA_SURFACE, Water } from '../water/Water';
import { Particles } from '../render/Particles';
export { Particles };
import { World } from '../world/World';
import { Islander } from './Islander';
import { School, Wildlife } from './Wildlife';

interface Boat {
  id: number;
  jetty: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  state: 'docked' | 'out' | 'netting' | 'return';
  crew: Islander | null;
  path: { x: number; z: number }[] | null;
  idx: number;
  timer: number;
  catch: number;
  school: School | null;
  mesh: THREE.Group;
  net: THREE.Mesh;
  rower: THREE.Mesh;
  paddlePhase: number;
  sail: boolean;
  wakeTimer: number;
  /** Seconds of fishing left on this trip (counts down once the boat reaches the fishing grounds). */
  fishTime: number;
  onTrip: boolean;
}

/** Boats were oversized next to islanders. */
export const BOAT_SCALE = 0.65;

export function boatGeometry(sail: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const hull = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  b.add(hull, { color: (p) => (p.y > -0.05 ? new THREE.Color(0xb8452f) : new THREE.Color(0x8b5a34)) }, M.t(0, 0.18, 0, 0, 0, 0, 0.32, 0.22, 1.05));
  // Inner hull and deck: the half-sphere shell alone is see-through from above.
  b.add(hull.clone().scale(-1, 1, 1), { color: 0x5e3a22 }, M.t(0, 0.18, 0, 0, 0, 0, 0.29, 0.19, 1.0));
  b.add(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), { color: 0x7a4e2e }, M.t(0, 0.1, 0, 0, 0, 0, 0.27, 1, 0.95));
  // Gunwale rim.
  b.add(new THREE.TorusGeometry(1, 0.04, 4, 20).rotateX(Math.PI / 2), { color: 0xd8b04a }, M.t(0, 0.185, 0, 0, 0, 0, 0.32, 1, 1.05));
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
    b.add(sg, { color: (p) => ((p.y * 6) % 1 < 0.2 ? new THREE.Color(0xd4a017) : new THREE.Color(0xf4ecd8)), sway: 0.15 }, M.t(0, 0.22, 0.38));
  }
  return b.build();
}

function rowerGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.05, 0.07, 0.2, 7), { color: 0xf1e6cf }, M.t(0, 0.3, 0));
  b.add(P.sphere(0.05, 1), { color: 0x9c6644 }, M.t(0, 0.46, 0));
  b.add(P.sphere(0.052, 1), { color: 0x1c1410 }, M.t(0, 0.475, -0.01, 0, 0, 0, 1, 0.7, 1));
  // Paddle.
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

/** A canoe bringing new settlers across the sea to the island. */
interface Arrival {
  mesh: THREE.Group;
  rowers: THREE.Mesh[];
  path: { x: number; z: number }[];
  idx: number;
  x: number;
  z: number;
  heading: number;
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
  private wake = new Particles(500, 0xf5fbff);
  private splash = new Particles(240, 0xe8fbff);
  private geos = [boatGeometry(false), boatGeometry(true)];
  private rowerGeo = rowerGeometry();
  /** Boats' own double-sided material (never modify the shared stylised one). */
  private hullMat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
  private netMat = new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
  private blocked: Uint8Array;
  /** Number of boats ever launched (milestone). */
  launched = 0;
  onLaunch: () => void = () => {};
  sfx: (n: string, x: number, z: number) => void = () => {};

  constructor(private world: World, private water: Water, private bld: BuildingSystem, private colony: Colony, private eco: Economy, private wildlife: Wildlife, veg: Vegetation) {
    this.group.add(this.wake.points, this.splash.points);
    // Rocks and reefs are obstacles for boats.
    this.blocked = new Uint8Array(world.N * world.N);
    for (const p of veg.plants) {
      if (p.kind === 'searock' || p.kind === 'reef') {
        const i = world.cellIndexAt(p.x, p.z);
        if (i >= 0) this.blocked[i] = 1;
      }
    }
  }

  /** Extra obstacle cells (coral reefs) that boats steer around. */
  blockCells(cells: number[]): void {
    for (const i of cells) this.blocked[i] = 1;
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
    const rower = new THREE.Mesh(this.rowerGeo, stylisedMaterial());
    rower.castShadow = true;
    rower.visible = false;
    const net = new THREE.Mesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), this.netMat);
    net.visible = false;
    net.renderOrder = 15;
    mesh.add(hull, rower);
    mesh.scale.setScalar(BOAT_SCALE);
    this.group.add(mesh, net);
    const [dx, dz] = j.dir;
    const slot = j.boats.length;
    const b: Boat = {
      id: this.nextId++, jetty: j.id, x: j.dockX + dz * (slot - 1) * 0.9, z: j.dockZ - dx * (slot - 1) * 0.9, heading: Math.atan2(dx, dz), speed: 0,
      state: 'docked', crew: null, path: null, idx: 0, timer: 0, catch: 0, school: null, mesh, net, rower, paddlePhase: Math.random() * 6, sail, wakeTimer: 0, fishTime: 0, onTrip: false,
    };
    j.boats.push(b.id);
    this.list.push(b);
    this.launched++;
    this.onLaunch();
    return b;
  }

  /** A fisher arrives at the jetty: crew a free docked boat. */
  board(isl: Islander, j: Building): boolean {
    const b = this.list.find((x) => x.jetty === j.id && x.state === 'docked' && !x.crew);
    if (!b) return false;
    const school = this.wildlife.nearestSchool(b.x, b.z);
    if (!school) return false;
    const path = this.waterPath(b.x, b.z, school.x, school.z);
    if (!path) return false;
    b.crew = isl;
    b.school = school;
    b.path = path;
    b.idx = 0;
    b.state = 'out';
    b.rower.visible = true;
    this.sfx('splash', b.x, b.z);
    return true;
  }

  private waterCell(i: number): boolean {
    return this.world.layer[i] <= 0 && !this.blocked[i];
  }

  /** A* over sea cells, avoiding rocks and reefs and hugging deeper water. */
  waterPath(sx: number, sz: number, tx: number, tz: number): { x: number; z: number }[] | null {
    const w = this.world;
    const N = w.N;
    const [scx, scz] = w.cellOf(sx, sz);
    const [tcx, tcz] = w.cellOf(tx, tz);
    const start = scz * N + scx, goal = tcz * N + tcx;
    const g = new Map<number, number>();
    const from = new Map<number, number>();
    const open: [number, number][] = [[start, 0]];
    g.set(start, 0);
    const closed = new Set<number>();
    let it = 0;
    while (open.length && it++ < 20000) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k][1] < open[bi][1]) bi = k;
      const [cur] = open.splice(bi, 1)[0];
      if (cur === goal || Math.hypot((cur % N) - tcx, ((cur / N) | 0) - tcz) < 2) {
        const out: { x: number; z: number }[] = [];
        for (let c: number | undefined = cur; c !== undefined; c = from.get(c)) out.push({ x: w.centerX(c % N), z: w.centerZ((c / N) | 0) });
        out.reverse();
        out.push({ x: tx, z: tz });
        // Thin out waypoints.
        return out.filter((_, i) => i % 2 === 0 || i === out.length - 1);
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      const cx = cur % N, cz = (cur / N) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!w.inBounds(nx, nz)) continue;
          const ni = nz * N + nx;
          // The first cells next to the jetty may be shallow; allow the start cell's neighbours.
          if (!this.waterCell(ni) && ni !== goal) continue;
          const shallow = w.layer[ni] >= 0 ? 1.5 : 0;
          const ng = g.get(cur)! + (dx && dz ? 1.414 : 1) + shallow;
          if (ng < (g.get(ni) ?? Infinity)) {
            g.set(ni, ng);
            from.set(ni, cur);
            open.push([ni, ng + Math.hypot(nx - tcx, nz - tcz)]);
          }
        }
      }
    }
    return null;
  }

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
    // Landing: the water cell next to a main-island beach closest to the destination.
    let best = -1, bestLand = -1, bd = Infinity;
    for (let i = 0; i < N * N; i++) {
      if (w.layer[i] > 0 || this.blocked[i]) continue;
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
    const path = this.waterPath(sx, sz, lx, lz) ?? [{ x: lx, z: lz }];
    const mesh = new THREE.Group();
    const hull = new THREE.Mesh(this.geos[0], this.hullMat);
    hull.castShadow = true;
    mesh.add(hull);
    const rowers: THREE.Mesh[] = [];
    genders.forEach((_, k) => {
      const r = new THREE.Mesh(this.rowerGeo, stylisedMaterial());
      r.castShadow = true;
      r.position.z = 0.35 - k * (0.7 / Math.max(1, genders.length - 1));
      mesh.add(r);
      rowers.push(r);
    });
    mesh.scale.setScalar(BOAT_SCALE * 1.1);
    mesh.position.set(sx, 0.03, sz);
    this.group.add(mesh);
    this.arrivals.push({ mesh, rowers, path, idx: 0, x: sx, z: sz, heading: Math.atan2(lx - sx, lz - sz), genders, land, state: 'sail', timer: 0, phase: 0, onLand });
    return { x: lx, z: lz };
  }

  private stepArrivals(dt: number, time: number): void {
    for (const a of this.arrivals.slice()) {
      if (a.state === 'sail') {
        const p = a.path[Math.min(a.idx, a.path.length - 1)];
        const dx = p.x - a.x, dz = p.z - a.z;
        const d = Math.hypot(dx, dz);
        // Slow down for the last stretch onto the beach.
        const sp = Math.min(2.4, 0.6 + d * 0.8) * (a.idx >= a.path.length - 1 ? 1 : 1.2);
        if (d < 0.3) {
          a.idx++;
          if (a.idx >= a.path.length) {
            // Landed: the settlers step ashore; the canoe is pulled up on the sand.
            a.state = 'beached';
            a.timer = 120;
            for (const r of a.rowers) r.visible = false;
            const people = a.genders.map((g, k) => this.colony.spawn(g, a.land.x + (k - (a.genders.length - 1) / 2) * 0.5, a.land.z));
            this.sfx('splash', a.x, a.z);
            a.onLand?.(people);
          }
        } else {
          const want = Math.atan2(dx, dz);
          let dh = want - a.heading;
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          a.heading += dh * Math.min(1, dt * 2.5);
          a.x += Math.sin(a.heading) * sp * dt;
          a.z += Math.cos(a.heading) * sp * dt;
          a.phase += dt * 3.2;
          if (Math.random() < dt * 6) this.wake.spawn(a.x - Math.sin(a.heading) * 0.5, 0.05, a.z - Math.cos(a.heading) * 0.5, 0, 0.05, 0, 1.2, 0.2, 0.25);
        }
      } else {
        a.timer -= dt;
        if (a.timer <= 0) {
          this.group.remove(a.mesh);
          this.arrivals = this.arrivals.filter((x) => x !== a);
          continue;
        }
      }
      const y = this.water.waveHeight(a.x, a.z, time);
      const yF = this.water.waveHeight(a.x + Math.sin(a.heading) * 0.6, a.z + Math.cos(a.heading) * 0.6, time);
      a.mesh.position.set(a.x, (a.state === 'beached' ? 0.06 : 0.03 + SEA_SURFACE) + (a.state === 'sail' ? y * 0.12 : 0), a.z);
      a.mesh.rotation.set(a.state === 'sail' ? (y - yF) * 0.8 : -0.05, a.heading, 0, 'YXZ');
      a.rowers.forEach((r, k) => (r.rotation.z = Math.sin(a.phase + k * 0.7) * 0.25 * (k % 2 ? -1 : 1)));
    }
  }

  update(dt: number, time: number): void {
    this.stepArrivals(dt, time);
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
    for (const b of this.list) this.step(b, dt, time);
    this.wildlife.boats = this.list.filter((b) => b.state !== 'docked').map((b) => ({ x: b.x, z: b.z }));
    this.wake.update(dt);
    this.splash.update(dt, 3);
  }

  private step(b: Boat, dt: number, time: number): void {
    const j = this.bld.byId(b.jetty)!;
    if (b.onTrip) b.fishTime -= dt;
    if (b.state === 'out' || b.state === 'return') {
      if (!b.path || b.idx >= b.path.length) {
        if (b.state === 'out') {
          if (!b.onTrip) {
            b.onTrip = true;
            b.fishTime = JETTY.fishingSeconds;
          }
          b.state = 'netting';
          b.timer = JETTY.netSeconds;
          this.sfx('splash', b.x, b.z);
          for (let k = 0; k < 24; k++) {
            const a = Math.random() * Math.PI * 2;
            this.splash.spawn(b.x + Math.cos(a) * 0.8, 0.05, b.z + Math.sin(a) * 0.8, Math.cos(a) * 0.6, 1.2 + Math.random(), Math.sin(a) * 0.6, 0.9, 0.35);
          }
        } else {
          // Docked: crew carries the catch to storage.
          b.state = 'docked';
          b.rower.visible = false;
          const crew = b.crew;
          b.crew = null;
          if (crew) this.colony.disembark(crew, b.catch, j.door.x, j.door.z);
          b.catch = 0;
          b.path = null;
        }
      } else {
        const wp = b.path[b.idx];
        const dx = wp.x - b.x, dz = wp.z - b.z;
        const d = Math.hypot(dx, dz);
        b.speed += (JETTY.boatSpeed - b.speed) * Math.min(1, dt * 1.5);
        if (d < 0.4) b.idx++;
        else {
          let dh = Math.atan2(dx, dz) - b.heading;
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          b.heading += dh * Math.min(1, dt * 2.5);
          b.x += Math.sin(b.heading) * b.speed * dt;
          b.z += Math.cos(b.heading) * b.speed * dt;
        }
        // Wake: foam puffs trailing from the stern.
        b.wakeTimer -= dt;
        if (b.wakeTimer <= 0) {
          b.wakeTimer = 0.07;
          const sx = b.x - Math.sin(b.heading) * 0.9 * BOAT_SCALE, sz = b.z - Math.cos(b.heading) * 0.9 * BOAT_SCALE;
          const px = Math.cos(b.heading) * 0.25 * BOAT_SCALE, pz = -Math.sin(b.heading) * 0.25 * BOAT_SCALE;
          this.wake.spawn(sx + px, 0.04, sz + pz, px * 0.6, 0, pz * 0.6, 1.8, 0.35, 0.5);
          this.wake.spawn(sx - px, 0.04, sz - pz, -px * 0.6, 0, -pz * 0.6, 1.8, 0.35, 0.5);
        }
      }
    } else if (b.state === 'netting') {
      b.speed *= 1 - dt * 2;
      // Drift gently with the school while the net is out.
      if (b.school) {
        b.x += (b.school.x - b.x) * Math.min(1, dt * 0.05);
        b.z += (b.school.z - b.z) * Math.min(1, dt * 0.05);
      }
      b.timer -= dt;
      if (b.timer <= 0) {
        const s = b.school;
        const room = JETTY.catchPerTrip - b.catch;
        const n = s ? Math.max(0, Math.min(JETTY.catchPerCast, room, Math.floor(s.stock) - 2)) : 0;
        if (s) s.stock -= n;
        b.catch += n;
        this.sfx('splash', b.x, b.z);
        // Keep fishing until the trip is over or the hold is full, following the school between casts.
        const next = b.fishTime > 0 && b.catch < JETTY.catchPerTrip ? this.wildlife.nearestSchool(b.x, b.z) : null;
        const hop = next ? this.waterPath(b.x, b.z, next.x + (Math.random() - 0.5) * 4, next.z + (Math.random() - 0.5) * 4) : null;
        if (next && hop) {
          b.school = next;
          b.path = hop;
          b.idx = 0;
          b.state = 'out';
        } else {
          b.onTrip = false;
          b.fishTime = 0;
          const path = this.waterPath(b.x, b.z, j.dockX, j.dockZ);
          b.path = path ?? [{ x: j.dockX, z: j.dockZ }];
          b.idx = 0;
          b.state = 'return';
        }
      }
    } else {
      b.speed = 0;
    }
    // Bob on the waves.
    // The sea surface is drawn flat (waves are in the shading), so the hull rides at y = 0 with only a
    // gentle bob, and pitches and rolls with the swell.
    const y = this.water.waveHeight(b.x, b.z, time);
    const yF = this.water.waveHeight(b.x + Math.sin(b.heading) * 0.6, b.z + Math.cos(b.heading) * 0.6, time);
    const yS = this.water.waveHeight(b.x + Math.cos(b.heading) * 0.3, b.z - Math.sin(b.heading) * 0.3, time);
    b.mesh.position.set(b.x, 0.03 + SEA_SURFACE + y * 0.12, b.z);
    b.mesh.rotation.set((y - yF) * 0.8, b.heading, (yS - y) * 1.0, 'YXZ');
    b.paddlePhase += dt * (b.state === 'docked' || b.state === 'netting' ? 0 : 3);
    b.rower.rotation.z = Math.sin(b.paddlePhase) * 0.25;
    // Net: spreads out beside the boat while netting, hauled in at the end.
    if (b.state === 'netting') {
      const t = 1 - b.timer / JETTY.netSeconds;
      const spread = t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1;
      b.net.visible = true;
      b.net.position.set(b.x + Math.cos(b.heading) * 0.8, 0.03, b.z - Math.sin(b.heading) * 0.8);
      b.net.scale.setScalar((0.2 + spread * 1.1) * 0.8);
      b.net.rotation.y = time * 0.2;
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
