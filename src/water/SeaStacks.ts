import * as THREE from 'three';
import { SEA_STACKS } from '../config';
import { GeoBuilder, M } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { Particles } from '../render/Particles';
import { angularRockGeometry, rockColor } from '../render/rocks';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { SEA_SURFACE, Water } from './Water';

export interface StackRock {
  x: number;
  z: number;
  /** Radius, and height of the top above the sea. */
  r: number;
  top: number;
}

export interface StackSite {
  x: number;
  z: number;
  /** Seaward direction (unit, XZ): the side the waves come in on. */
  sx: number;
  sz: number;
  /** The sea stack itself, then the smaller rocks scattered round it. */
  main: StackRock;
  rocks: StackRock[];
}

/** Open sea: water cells reachable from the map edge (not lakes, rivers, canals or pools). */
function openSea(w: World): Uint8Array {
  const N = w.N;
  const sea = new Uint8Array(N * N);
  const q: number[] = [];
  const water = (i: number) => w.layer[i] <= 0 && Number.isNaN(w.riverY[i]) && !w.canal[i];
  for (let k = 0; k < N; k++) for (const i of [k, (N - 1) * N + k, k * N, k * N + N - 1]) {
    if (water(i) && !sea[i]) (sea[i] = 1), q.push(i);
  }
  while (q.length) {
    const i = q.pop()!;
    const cx = i % N;
    for (const j of [cx > 0 ? i - 1 : -1, cx < N - 1 ? i + 1 : -1, i - N, i + N]) {
      if (j < 0 || j >= N * N || sea[j] || !water(j)) continue;
      sea[j] = 1;
      q.push(j);
    }
  }
  return sea;
}

/** Cells from each sea cell to the nearest land (multi-source BFS over the sea). */
function landDistance(w: World): Float32Array {
  const N = w.N;
  const d = new Float32Array(N * N).fill(1e9);
  const q = new Int32Array(N * N);
  let head = 0, tail = 0;
  for (let i = 0; i < N * N; i++) if (w.layer[i] >= 1) (d[i] = 0), (q[tail++] = i);
  while (head < tail) {
    const i = q[head++];
    const cx = i % N;
    for (const j of [cx > 0 ? i - 1 : -1, cx < N - 1 ? i + 1 : -1, i - N, i + N]) {
      if (j < 0 || j >= N * N || d[j] <= d[i] + 1) continue;
      d[j] = d[i] + 1;
      q[tail++] = j;
    }
  }
  return d;
}

/**
 * Where the settlers' canoe lands (the water beside the main island's beach nearest the village
 * plain, as Boats.sendSettlers picks it) and the way it comes in from the open sea.
 */
function canoeLanding(w: World): { x: number; z: number; dx: number; dz: number } | null {
  const N = w.N, to = w.meadow;
  let best = -1, bd = Infinity;
  for (let i = 0; i < N * N; i++) {
    if (w.layer[i] > 0) continue;
    const cx = i % N, cz = (i / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!w.inBounds(cx + dx, cz + dz)) continue;
      const j = w.idx(cx + dx, cz + dz);
      if (w.layer[j] !== 1 || w.isle[j] !== 1) continue;
      const d = Math.hypot(w.centerX(cx) - to.x, w.centerZ(cz) - to.z) - w.sandy[j] * 4;
      if (d < bd) (bd = d), (best = i);
    }
  }
  if (best < 0) return null;
  const x = w.centerX(best % N), z = w.centerZ((best / N) | 0);
  const l = Math.hypot(x - to.x, z - to.z) || 1;
  return { x, z, dx: (x - to.x) / l, dz: (z - to.z) / l };
}

/**
 * Pick the sea-stack sites (deterministic from the seed): just off exposed stretches of coast
 * (open sea straight out from them, preferring rocky, high shores), never off the village plain
 * or where the settlers' canoe comes in, in the strait, the lagoon or the pools, on the reefs
 * (`avoid`: coral patches, reef and sea-rock clusters) or overlapping rocks already placed.
 * Every rock stands wholly in the sea, so none blocks building land.
 */
export function placeSeaStacks(w: World, seed: number, avoid: { x: number; z: number; r: number }[] = []): StackSite[] {
  const C = SEA_STACKS;
  const rng = new RNG(seed * 131 + 71);
  const N = w.N;
  const sea = openSea(w);
  const dLand = landDistance(w);
  const landing = canoeLanding(w);
  const lag = w.lagoon;
  const isSea = (x: number, z: number) => {
    const i = w.cellIndexAt(x, z);
    return i >= 0 && sea[i] === 1 && w.blockFixed[i] === 0;
  };
  const clearOf = (x: number, z: number, r: number) => avoid.every((a) => Math.hypot(a.x - x, a.z - z) > a.r + r);
  /** Every cell under a round footprint is open sea. */
  const inSea = (x: number, z: number, r: number) => {
    const [cx, cz] = w.cellOf(x, z);
    for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const px = w.centerX(cx + dx), pz = w.centerZ(cz + dz);
      if (Math.hypot(px - x, pz - z) <= r + 0.2 && !isSea(px, pz)) return false;
    }
    return isSea(x, z);
  };
  const cands: { x: number; z: number; sx: number; sz: number; k: number }[] = [];
  for (let cz = 4; cz < N - 4; cz++) {
    for (let cx = 4; cx < N - 4; cx++) {
      const i = cz * N + cx;
      if (!sea[i] || dLand[i] < C.offshore[0] || dLand[i] > C.offshore[1]) continue;
      const x = w.centerX(cx), z = w.centerZ(cz);
      if (Math.hypot(x - w.meadow.x, z - w.meadow.z) < w.meadow.r + C.plainClear) continue;
      if (lag && Math.hypot(x - lag.x, z - lag.z) < lag.r + 12) continue;
      if (landing) {
        // The canoe's landing beach and its run in from the open sea.
        const ox = x - landing.x, oz = z - landing.z;
        const along = THREE.MathUtils.clamp(ox * landing.dx + oz * landing.dz, 0, 50);
        if (Math.hypot(ox - landing.dx * along, oz - landing.dz * along) < C.canoeClear) continue;
      }
      // Seaward: away from the land round it; the strait has both islands' shores close by.
      let sx = 0, sz = 0, rock = 0, isles = 0;
      for (let dz = -7; dz <= 7; dz++) for (let dx = -7; dx <= 7; dx++) {
        const j = w.idx(cx + dx, cz + dz);
        if (w.layer[j] < 1) continue;
        sx -= dx;
        sz -= dz;
        rock += w.rocky[j] + (w.layer[j] >= 4 ? 0.3 : 0);
        isles |= w.isle[j] === 2 ? 2 : w.isle[j] === 1 ? 1 : 0;
      }
      if (isles === 3) continue;
      const sl = Math.hypot(sx, sz);
      if (sl < 1e-3) continue;
      sx /= sl;
      sz /= sl;
      // Exposed: open water straight out to sea (and a little either side) reaching the deep.
      let exposed = true;
      for (const a of [0, -0.45, 0.45]) {
        const ex = sx * Math.cos(a) - sz * Math.sin(a), ez = sx * Math.sin(a) + sz * Math.cos(a);
        let deep = false;
        for (let d = 2; d <= C.exposure && exposed && !deep; d += 1.5) {
          const j = w.cellIndexAt(x + ex * d, z + ez * d);
          if (j < 0) deep = true;
          else if (w.layer[j] >= 1) exposed = false;
          else if (w.layer[j] <= -6) deep = true;
        }
        if (!deep) exposed = false;
      }
      if (!exposed) continue;
      cands.push({ x, z, sx, sz, k: rng.next() * 0.6 + Math.min(1, rock / 40) * 0.4 });
    }
  }
  // Rockier, higher coasts first (with some chance), spread well apart round the island.
  cands.sort((a, b) => b.k - a.k);
  const want = rng.int(C.count[0], C.count[1]);
  const out: StackSite[] = [];
  for (const c of cands) {
    if (out.length >= want) break;
    if (out.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < C.spacing)) continue;
    const r = rng.range(C.radius[0], C.radius[1]);
    if (!inSea(c.x, c.z, r + 1) || !clearOf(c.x, c.z, r + 2)) continue;
    const main = { x: c.x, z: c.z, r, top: rng.range(C.height[0], C.height[1]) };
    const rocks: StackRock[] = [];
    const n = rng.int(5, 9);
    for (let k = 0; k < 40 && rocks.length < n; k++) {
      const a = rng.range(0, Math.PI * 2);
      // More of the scatter lies on the seaward side, where the stack has broken away from.
      const d = r + rng.range(0.5, 3.4) * (Math.cos(a) * c.sx + Math.sin(a) * c.sz > 0 ? 1.2 : 0.8);
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      const rr = rng.range(0.25, 0.85);
      const top = SEA_SURFACE + rng.range(-0.08, 0.35 + rr * 1.1);
      if (!inSea(x, z, rr + 0.4) || !clearOf(x, z, rr + 0.6) || rocks.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + rr)) continue;
      rocks.push({ x, z, r: rr, top });
    }
    out.push({ x: c.x, z: c.z, sx: c.sx, sz: c.sz, main, rocks });
  }
  return out;
}

/** Grid cells under the rocks (for the boats' obstacle map). */
export function stackCells(w: World, sites: StackSite[]): number[] {
  const out = new Set<number>();
  for (const s of sites) {
    for (const r of [s.main, ...s.rocks]) {
      const R = r.r + (r === s.main ? 0.8 : 0.4);
      const [cx, cz] = w.cellOf(r.x, r.z);
      for (let dz = -Math.ceil(R); dz <= Math.ceil(R); dz++) for (let dx = -Math.ceil(R); dx <= Math.ceil(R); dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) continue;
        const d = Math.hypot(w.centerX(cx + dx) - r.x, w.centerZ(cz + dz) - r.z);
        if (d <= R + 0.2 || (dx === 0 && dz === 0)) out.add(w.idx(cx + dx, cz + dz));
      }
    }
  }
  return [...out];
}

interface Surf {
  site: StackSite;
  /** Where the swell is read (just seaward of the stack). */
  px: number;
  pz: number;
  prev: number;
  rising: boolean;
  cool: number;
  /** Swell height needed to break, and the least gap between big bursts (varied per stack). */
  crashAt: number;
  gap: number;
  churn: number;
}

/**
 * A few great sea stacks off the exposed coasts, each a towering faceted rock with a scatter of
 * smaller ones round its foot, and the swell crashing on them: when a crest reaches a stack
 * (the same swell maths the sea shader uses), white water bursts up its seaward face, several
 * units high, and falls back, and foam spreads round its base. Placed from the seed; the rocks
 * are obstacles for boats (see cells()) but never touch the land.
 */
export class SeaStacks {
  readonly group = new THREE.Group();
  readonly sites: StackSite[];
  private surf: Surf[] = [];
  private spray = new Particles(3600, 0xf6fcff);
  private sheet = new Particles(700, 0xf4fbff, 0.8);
  private mist = new Particles(600, 0xeef8ff, 0.3);
  private foam = new Particles(1400, 0xf2f9ff, 0.75);

  constructor(private world: World, seed: number, avoid: { x: number; z: number; r: number }[] = []) {
    const w = world;
    const rng = new RNG(seed * 197 + 3);
    this.sites = placeSeaStacks(w, seed, avoid);
    const b = new GeoBuilder();
    // Wet and dark up to where the spray reaches.
    const wet = SEA_SURFACE + 0.45;
    const bedAt = (x: number, z: number) => Math.min(w.heightAt(x, z), SEA_SURFACE - 0.05) - 0.2;
    for (const s of this.sites) {
      const m = s.main;
      const bed = bedAt(m.x, m.z);
      const top = SEA_SURFACE + m.top;
      const turn = rng.next() * 6.28;
      // A broad, broken skirt at the waterline, the main column, and a narrower upper column
      // stepped off-centre (like layered strata), capped with a tilted crown.
      b.add(angularRockGeometry(Math.floor(rng.next() * 1e6), { taper: 0.8, tilt: 0.25 }), { color: rockColor(0.1, wet) }, M.t(m.x, bed, m.z, 0, turn, 0, m.r * 1.45, SEA_SURFACE + 0.55 - bed, m.r * 1.3));
      b.add(angularRockGeometry(Math.floor(rng.next() * 1e6), { taper: 0.78, tilt: 0.12 }), { color: rockColor(0.3, wet), ao: { y0: bed, y1: top, min: 0.72 } }, M.t(m.x, bed, m.z, 0, turn + 0.5, 0, m.r, (top - bed) * 0.72, m.r * 0.92));
      const ox = m.x - s.sx * m.r * 0.18 + rng.range(-0.15, 0.15), oz = m.z - s.sz * m.r * 0.18 + rng.range(-0.15, 0.15);
      const y1 = bed + (top - bed) * 0.66;
      b.add(angularRockGeometry(Math.floor(rng.next() * 1e6), { taper: 0.7, tilt: 0.22 }), { color: rockColor(0.55, wet) }, M.t(ox, y1, oz, 0, turn + 1.3, 0, m.r * 0.74, top - y1, m.r * 0.68));
      // Boulders fallen from it, round its foot.
      for (const r of s.rocks) {
        const rb = bedAt(r.x, r.z);
        b.add(angularRockGeometry(Math.floor(rng.next() * 1e6), { tilt: 0.2 }), { color: rockColor(0.15, wet) }, M.t(r.x, rb, r.z, 0, rng.next() * 6.28, 0, r.r, Math.max(0.2, SEA_SURFACE + r.top - rb), r.r * rng.range(0.8, 1.15)));
      }
      // Solid for anything steering by the world's obstacle map (all sea cells).
      for (const i of stackCells(w, [s])) w.blockFixed[i] = 1;
      this.stampFoam(s);
      this.surf.push({
        site: s, px: m.x + s.sx * (m.r + 1), pz: m.z + s.sz * (m.r + 1), prev: 0, rising: false,
        cool: rng.range(0, 3), crashAt: rng.range(0.03, 0.07), gap: rng.range(1.6, 3.4), churn: rng.next(),
      });
    }
    if (b.vertexCount) {
      const mesh = new THREE.Mesh(b.build(), stylisedMaterial());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'seaStacks';
      this.group.add(mesh);
    }
    this.spray.points.renderOrder = 15;
    this.sheet.points.renderOrder = 15;
    this.mist.points.renderOrder = 16;
    this.foam.points.renderOrder = 13;
    (this.mist.points.material as THREE.ShaderMaterial).blending = THREE.NormalBlending;
    this.group.add(this.spray.points, this.sheet.points, this.mist.points, this.foam.points);
  }

  /** Grid cells the rocks stand in (boats steer round them). */
  cells(): number[] {
    return stackCells(this.world, this.sites);
  }

  /** Foam in the sea round the stack and its rocks (read by the sea shader: refresh the water after). */
  private stampFoam(s: StackSite): void {
    const w = this.world;
    for (const r of [s.main, ...s.rocks]) {
      const R = r === s.main ? r.r + 2.2 : r.r + 0.9;
      const [cx, cz] = w.cellOf(r.x, r.z);
      const K = Math.ceil(R + 1);
      for (let dz = -K; dz <= K; dz++) for (let dx = -K; dx <= K; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) continue;
        const i = w.idx(cx + dx, cz + dz);
        if (w.layer[i] > 0) continue;
        const d = Math.hypot(w.centerX(cx + dx) - r.x, w.centerZ(cz + dz) - r.z);
        w.foam[i] = Math.max(w.foam[i], THREE.MathUtils.clamp(1 - (d - r.r * 0.5) / (R - r.r * 0.5 + 0.4), 0, 1));
      }
    }
  }

  /** Push the stamped foam into the sea's seabed/foam texture. */
  refreshWater(water: Water): void {
    const w = this.world;
    for (const s of this.sites) {
      const [cx, cz] = w.cellOf(s.x, s.z);
      const R = Math.ceil(s.main.r + 6);
      water.updateHeight(Math.max(0, cx - R), Math.max(0, cz - R), Math.min(w.N - 1, cx + R), Math.min(w.N - 1, cz + R));
    }
  }

  update(dt: number, time: number, water: Water): void {
    if (dt <= 0) return;
    for (const u of this.surf) {
      u.cool -= dt;
      const m = u.site.main;
      // Only animated when near and on screen.
      if (View.dist2(m.x, 2, m.z) > SEA_STACKS.viewRange * SEA_STACKS.viewRange || !View.sees(m.x, SEA_SURFACE + m.top * 0.5, m.z, m.r + m.top)) {
        u.rising = false;
        continue;
      }
      // A crest has just arrived when the swell seaward of the stack stops rising.
      const h = water.waveHeight(u.px, u.pz, time);
      const rising = h > u.prev;
      if (u.rising && !rising && h > u.crashAt && u.cool <= 0) {
        this.crash(u, THREE.MathUtils.clamp(0.75 + (h - u.crashAt) * 6, 0.75, 1.6));
        u.cool = u.gap * (0.8 + Math.random() * 0.5);
      } else if (u.rising && !rising && u.cool <= u.gap * 0.5) {
        // Smaller crests between the big ones still slap up the face.
        this.crash(u, 0.4 + Math.random() * 0.2);
      }
      u.rising = rising;
      u.prev = h;
      // Between the big bursts, a restless churn of white water round the foot.
      u.churn += dt * 3.5;
      if (u.churn >= 1) {
        u.churn -= 1;
        this.churn(u.site);
      }
    }
    this.spray.update(dt, 7);
    this.sheet.update(dt, 6);
    this.mist.update(dt, 0.35);
    this.foam.update(dt, 0);
    const day = 0.35 + 0.65 * water.shared.uDay.value;
    for (const p of [this.spray, this.sheet, this.mist, this.foam]) ((p.points.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setRGB(0.95 * day, 0.985 * day, day);
  }

  /** A wave breaks on the stack: white water bursts up its seaward face and falls back, foam spreads round it. */
  private crash(u: Surf, k: number): void {
    const s = u.site, m = s.main;
    const y = SEA_SURFACE + 0.05;
    // The wave comes in from the sea side; the burst climbs the face and is thrown up and over.
    const ix = -s.sx, iz = -s.sz, tx = -iz, tz = ix;
    const R = m.r * 1.3;
    const H = Math.min(m.top + 3, SEA_STACKS.burstHeight * k);
    const up = Math.sqrt(2 * 7 * H);
    for (let i = 0; i < Math.round(320 * k); i++) {
      // Across the seaward face, strongest in the middle.
      const side = (Math.random() + Math.random() - 1) * 1.1;
      const face = Math.sqrt(Math.max(0, 1 - side * side * 0.6));
      const px = m.x + s.sx * R * face + tx * side * R, pz = m.z + s.sz * R * face + tz * side * R;
      const v = up * (0.45 + Math.random() * 0.6) * (1 - Math.abs(side) * 0.3);
      // Fanned out wide across and over the face, some thrown back out to sea.
      const out = (Math.random() < 0.3 ? -0.6 : 0.4) + Math.random() * 1.6;
      const fan = 1.4 + k * 0.8;
      this.spray.spawn(px, y + Math.random() * 0.4, pz, -ix * out * 0.9 + tx * side * fan + (Math.random() - 0.5) * 1.4, v, -iz * out * 0.9 + tz * side * fan + (Math.random() - 0.5) * 1.4, 1.2 + Math.random() * 1.0, 0.16 + Math.random() * 0.3, 0.08);
    }
    // Heavy sheets of white water heaving up the face.
    for (let i = 0; i < Math.round(55 * k); i++) {
      const side = (Math.random() - 0.5) * 1.8;
      const px = m.x + s.sx * R + tx * side * R, pz = m.z + s.sz * R + tz * side * R;
      this.sheet.spawn(px, y + 0.1, pz, tx * side * 1.2 + s.sx * Math.random() * 0.6 + (Math.random() - 0.5) * 0.5, up * (0.35 + Math.random() * 0.35), tz * side * 1.2 + s.sz * Math.random() * 0.6 + (Math.random() - 0.5) * 0.5, 1.1 + Math.random() * 0.6, 0.65 + Math.random() * 0.5, 0.5);
    }
    // Fine mist hanging and drifting off the top of the burst.
    for (let i = 0; i < Math.round(45 * k); i++) {
      const side = (Math.random() - 0.5) * 2;
      this.mist.spawn(m.x + s.sx * R + tx * side * R, y + H * (0.35 + Math.random() * 0.5), m.z + s.sz * R + tz * side * R, ix * 0.4 + (Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 0.5, iz * 0.4 + (Math.random() - 0.5) * 0.5, 2.4 + Math.random() * 1.8, 1.2 + Math.random() * 1.2, 0.9);
    }
    // White water rushing round both sides of the foot and spreading out.
    const nf = Math.round(28 + 26 * k);
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * Math.PI * 2 + Math.random() * 0.3;
      const cx = Math.cos(a), cz = Math.sin(a);
      const lee = cx * s.sx + cz * s.sz < 0 ? 0.6 : 1;
      const d = m.r * (1.0 + Math.random() * 0.35);
      const v = (0.5 + Math.random() * 0.7) * lee;
      this.foam.spawn(m.x + cx * d, y, m.z + cz * d, cx * v + ix * 0.35, 0.02, cz * v + iz * 0.35, 2.0 + Math.random() * 1.4, 0.6 + Math.random() * 0.45, 0.5);
    }
    // Smaller bursts off the rocks on the seaward side.
    for (const r of s.rocks) {
      if (r.top < 0) continue;
      // Full bursts off the seaward rocks, lesser ones off those sheltered behind the stack.
      const lee = (r.x - m.x) * s.sx + (r.z - m.z) * s.sz < 0 ? 0.45 : 1;
      const n = Math.round((18 + r.r * 40) * k * lee);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        this.spray.spawn(r.x + s.sx * r.r + Math.cos(a) * r.r * 0.6, y, r.z + s.sz * r.r + Math.sin(a) * r.r * 0.6, ix * 0.4 + Math.cos(a) * 0.4, (2.2 + Math.random() * 3.2) * k * lee, iz * 0.4 + Math.sin(a) * 0.4, 0.8 + Math.random() * 0.6, 0.12 + Math.random() * 0.18, 0.06);
      }
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        this.foam.spawn(r.x + Math.cos(a) * r.r, y, r.z + Math.sin(a) * r.r, Math.cos(a) * 0.4, 0.02, Math.sin(a) * 0.4, 1.4 + Math.random(), 0.35 + Math.random() * 0.25, 0.4);
      }
    }
  }

  /** A little white water swirling round the foot of the stack and its rocks. */
  private churn(s: StackSite): void {
    const y = SEA_SURFACE + 0.04;
    for (const r of [s.main, s.main, ...s.rocks.slice(0, 3)]) {
      const a = Math.random() * Math.PI * 2;
      const d = r.r * (r === s.main ? 1.15 : 1);
      this.foam.spawn(r.x + Math.cos(a) * d, y, r.z + Math.sin(a) * d, Math.cos(a) * 0.25, 0.01, Math.sin(a) * 0.25, 1.6 + Math.random(), 0.4 + Math.random() * 0.3, 0.3);
    }
    // And spits of spray off the seaward face.
    const m = s.main;
    for (let i = 0; i < 6; i++) {
      const side = (Math.random() - 0.5) * 1.6;
      this.spray.spawn(m.x + s.sx * m.r * 1.2 - s.sz * side * m.r, y, m.z + s.sz * m.r * 1.2 + s.sx * side * m.r,
        s.sx * 0.3, 1.5 + Math.random() * 2, s.sz * 0.3, 0.6 + Math.random() * 0.4, 0.1 + Math.random() * 0.12, 0.05);
    }
  }
}
