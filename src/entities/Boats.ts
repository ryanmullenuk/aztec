import * as THREE from 'three';
import { JETTY } from '../config';
import { Building, BuildingSystem } from '../buildings/Buildings';
import { Colony } from '../ai/Colony';
import { Economy } from '../economy/Economy';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { Vegetation } from '../vegetation/Vegetation';
import { Water } from '../water/Water';
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
}

/** Particle pool with per-particle alpha, used for wakes and splashes. */
export class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private alpha: Float32Array;
  private size: Float32Array;
  private grow: Float32Array;
  private next = 0;
  constructor(private n: number, color: number) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.alpha = new Float32Array(n);
    this.size = new Float32Array(n);
    this.grow = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: 600 } },
      vertexShader: `attribute float aAlpha; attribute float aSize; varying float vA; uniform float uScale;
        void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = pow(smoothstep(0.5, 0.0, d), 1.6) * vA * 1.25; if (a < 0.01) discard; gl_FragColor = vec4(uColor, min(a, 1.0)); }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 14;
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
  }
  update(dt: number, gravity = 0): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.max[i];
      this.alpha[i] = Math.max(0, t) * 0.7;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Boats were oversized next to islanders. */
const BOAT_SCALE = 0.65;

function boatGeometry(sail: boolean): THREE.BufferGeometry {
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

/** Canoes and fishing boats: built at jetties, crewed by fishers, sail to fish schools, net and return. */
export class Boats {
  readonly group = new THREE.Group();
  list: Boat[] = [];
  private nextId = 1;
  private wake = new Particles(500, 0xf5fbff);
  private splash = new Particles(240, 0xe8fbff);
  private geos = [boatGeometry(false), boatGeometry(true)];
  private rowerGeo = rowerGeometry();
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

  /** Start building a boat at a jetty (pays the cost). */
  order(j: Building): boolean {
    if (!j.complete || j.boatBuild > 0 || j.boats.length >= JETTY.maxBoats) return false;
    if (!this.eco.spend(JETTY.boatCost)) return false;
    j.boatBuild = 0.001;
    return true;
  }

  private spawn(j: Building, sail: boolean): Boat {
    const mesh = new THREE.Group();
    const hullMat = stylisedMaterial();
    hullMat.side = THREE.DoubleSide;
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
      state: 'docked', crew: null, path: null, idx: 0, timer: 0, catch: 0, school: null, mesh, net, rower, paddlePhase: Math.random() * 6, sail, wakeTimer: 0,
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
  private waterPath(sx: number, sz: number, tx: number, tz: number): { x: number; z: number }[] | null {
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

  update(dt: number, time: number): void {
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
    if (b.state === 'out' || b.state === 'return') {
      if (!b.path || b.idx >= b.path.length) {
        if (b.state === 'out') {
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
      b.timer -= dt;
      if (b.timer <= 0) {
        const s = b.school;
        const n = s ? Math.max(0, Math.min(JETTY.catchPerTrip, Math.floor(s.stock) - 2)) : 0;
        if (s) s.stock -= n;
        b.catch = n;
        this.sfx('splash', b.x, b.z);
        const path = this.waterPath(b.x, b.z, j.dockX, j.dockZ);
        b.path = path ?? [{ x: j.dockX, z: j.dockZ }];
        b.idx = 0;
        b.state = 'return';
      }
    } else {
      b.speed = 0;
    }
    // Bob on the waves.
    const y = this.water.waveHeight(b.x, b.z, time);
    const yF = this.water.waveHeight(b.x + Math.sin(b.heading) * 0.6, b.z + Math.cos(b.heading) * 0.6, time);
    const yS = this.water.waveHeight(b.x + Math.cos(b.heading) * 0.3, b.z - Math.sin(b.heading) * 0.3, time);
    b.mesh.position.set(b.x, y + 0.01, b.z);
    b.mesh.rotation.set((y - yF) * 1.2, b.heading, (yS - y) * 1.5, 'YXZ');
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

  positions(): { x: number; z: number }[] {
    return this.list.map((b) => ({ x: b.x, z: b.z }));
  }

  /** Restore boats for a jetty from a save. */
  restore(j: Building, count: number): void {
    for (let k = 0; k < count; k++) this.spawn(j, k % 2 === 1);
  }
}
