import * as THREE from 'three';
import { GeoBuilder, M } from './GeoBuilder';
import { stylisedMaterial } from './materials';
import { Particles } from './Particles';
import { angularRockGeometry, rockColor } from './rocks';
import { View } from './View';
import { SEA_SURFACE, Water } from '../water/Water';
import { RNG } from '../world/rng';
import { World } from '../world/World';

/** Tuning for the rocky coasts. */
export const COAST_ROCKS = {
  /** Most rock clusters placed round the coasts. */
  maxSites: 46,
  /** Closest two clusters may be (world units). */
  spacing: 6.5,
  /** Swell height a crest must reach to break on a rock, and the least time between breaks. */
  crashAt: 0.035,
  cooldown: 1.6,
};

interface Site {
  x: number;
  z: number;
  /** Seaward direction (unit, XZ). */
  sx: number;
  sz: number;
  /** Radius of the main rock, and how high it stands above the sea. */
  r: number;
  top: number;
  prev: number;
  rising: boolean;
  cool: number;
}

/**
 * Clusters of chunky faceted rocks just offshore along the rocky headlands and cliffs (and round
 * the sea rocks), with foam stamped round them into the sea, and waves breaking on them: when a
 * swell crest reaches a rock (the same swell maths the water shader uses), spray bursts up over it
 * and a ring of white water spreads out. Purely visual and placed from the seed, so saves and
 * gameplay are unaffected.
 */
export class CoastRocks {
  readonly group = new THREE.Group();
  private sites: Site[] = [];
  private spray = new Particles(800, 0xf6fcff);
  private foam = new Particles(300, 0xf2f9ff, 0.7);

  /** @param extra sea rocks already in the world (they get breaking waves too) */
  constructor(private world: World, seed: number, extra: { x: number; z: number }[] = []) {
    const rng = new RNG(seed * 83 + 29);
    const w = world, N = w.N;
    // Open sea: water reachable from the map edge (not lakes, rivers or the lagoon).
    const sea = new Uint8Array(N * N);
    const q: number[] = [];
    for (let k = 0; k < N; k++) for (const i of [k, (N - 1) * N + k, k * N, k * N + N - 1]) {
      if (w.layer[i] <= 0 && !sea[i]) (sea[i] = 1), q.push(i);
    }
    while (q.length) {
      const i = q.pop()!;
      const cx = i % N;
      for (const j of [cx > 0 ? i - 1 : -1, cx < N - 1 ? i + 1 : -1, i - N, i + N]) {
        if (j < 0 || j >= N * N || sea[j] || w.layer[j] > 0 || !Number.isNaN(w.riverY[j])) continue;
        sea[j] = 1;
        q.push(j);
      }
    }
    const lag = w.lagoon;
    // Candidate spots: sea cells touching a rocky or high shore, away from the village beach.
    const cands: { i: number; k: number }[] = [];
    for (let cz = 2; cz < N - 2; cz++) {
      for (let cx = 2; cx < N - 2; cx++) {
        const i = cz * N + cx;
        const L = w.layer[i];
        if (!sea[i] || L < -3 || w.canal[i]) continue;
        let rocky = 0;
        for (const o of [-1, 1, -N, N]) {
          const j = i + o;
          if (w.layer[j] >= 1 && (w.rocky[j] > 0.4 || w.layer[j] >= 3)) rocky++;
        }
        if (!rocky) continue;
        const x = w.centerX(cx), z = w.centerZ(cz);
        if (Math.hypot(x - w.meadow.x, z - w.meadow.z) < w.meadow.r + 6) continue;
        if (lag && Math.hypot(x - lag.x, z - lag.z) < lag.r + 3) continue;
        cands.push({ i, k: rng.next() });
      }
    }
    cands.sort((a, b) => a.k - b.k);
    const b = new GeoBuilder();
    const wet = SEA_SURFACE + 0.16;
    const rock = (x: number, z: number, r: number, top: number, turn: number) => {
      const bed = Math.min(w.heightAt(x, z), SEA_SURFACE - 0.05) - 0.15;
      const h = Math.max(0.2, top - bed);
      b.add(angularRockGeometry(Math.floor(rng.next() * 1e6), { tilt: 0.2 }), { color: rockColor(0.22, wet) }, M.t(x, bed, z, 0, turn, 0, r, h, r * rng.range(0.8, 1.15)));
    };
    for (const c of cands) {
      if (this.sites.length >= COAST_ROCKS.maxSites) break;
      const cx = c.i % N, cz = (c.i / N) | 0;
      let x = w.centerX(cx), z = w.centerZ(cz);
      if (this.sites.some((s) => Math.hypot(s.x - x, s.z - z) < COAST_ROCKS.spacing)) continue;
      // Seaward: away from the land cells around it.
      let sx = 0, sz = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (w.layer[w.idx(cx + dx, cz + dz)] >= 1) (sx -= dx), (sz -= dz);
      }
      const sl = Math.hypot(sx, sz) || 1;
      sx /= sl;
      sz /= sl;
      x += sx * 0.35;
      z += sz * 0.35;
      const r = rng.range(0.45, 0.8);
      const top = SEA_SURFACE + rng.range(0.25, 0.75);
      rock(x, z, r, top, rng.next() * 6.28);
      // Two or three smaller rocks round it, some barely breaking the surface.
      const n = rng.int(2, 4);
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2);
        const d = r + rng.range(0.25, 0.9);
        rock(x + Math.cos(a) * d, z + Math.sin(a) * d, rng.range(0.2, 0.45), SEA_SURFACE + rng.range(-0.02, 0.35), rng.next() * 6.28);
      }
      this.sites.push({ x, z, sx, sz, r, top, prev: 0, rising: false, cool: rng.range(0, 2) });
      this.stampFoam(x, z, r + 1.1);
    }
    for (const e of extra) this.sites.push({ x: e.x, z: e.z, sx: 0, sz: 0, r: 0.5, top: SEA_SURFACE + 0.3, prev: 0, rising: false, cool: rng.range(0, 2) });
    if (b.vertexCount) {
      const mesh = new THREE.Mesh(b.build(), stylisedMaterial());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'coastRocks';
      this.group.add(mesh);
    }
    this.spray.points.renderOrder = 15;
    this.foam.points.renderOrder = 13;
    this.group.add(this.spray.points, this.foam.points);
  }

  /** Foam in the water round a rock (read by the sea shader, so call before the water is built). */
  private stampFoam(x: number, z: number, r: number): void {
    const w = this.world;
    const [cx, cz] = w.cellOf(x, z);
    const R = Math.ceil(r + 1);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (!w.inBounds(cx + dx, cz + dz)) continue;
      const i = w.idx(cx + dx, cz + dz);
      const d = Math.hypot(w.centerX(cx + dx) - x, w.centerZ(cz + dz) - z);
      w.foam[i] = Math.max(w.foam[i], THREE.MathUtils.clamp(1 - d / (r + 0.6), 0, 1));
    }
  }

  update(dt: number, time: number, water: Water): void {
    if (dt <= 0) return;
    const C = COAST_ROCKS;
    for (const s of this.sites) {
      s.cool -= dt;
      if (!View.sees(s.x, SEA_SURFACE + 0.3, s.z, 2.5)) continue;
      // A crest has just passed when the swell stops rising.
      const h = water.waveHeight(s.x, s.z, time);
      const rising = h > s.prev;
      if (s.rising && !rising && h > C.crashAt && s.cool <= 0) {
        this.crash(s, Math.min(1.4, 0.5 + (h - C.crashAt) * 7));
        s.cool = C.cooldown;
      }
      s.rising = rising;
      s.prev = h;
    }
    this.spray.update(dt, 7);
    this.foam.update(dt, 0);
    const day = 0.35 + 0.65 * water.shared.uDay.value;
    ((this.spray.points.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setRGB(0.96 * day, 0.99 * day, day);
    ((this.foam.points.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setRGB(0.93 * day, 0.97 * day, day);
  }

  /** The wave breaks: spray thrown up and over the rock, white water spreading round it. */
  private crash(s: Site, k: number): void {
    const y = SEA_SURFACE + 0.05;
    // The wave arrives from the sea side (towards the shore).
    const ix = -s.sx, iz = -s.sz;
    const bx = s.x + s.sx * s.r * 0.7, bz = s.z + s.sz * s.r * 0.7;
    const n = Math.round(26 + 30 * k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const side = (Math.random() - 0.5) * 2;
      const px = bx - iz * side * s.r * 1.1, pz = bz + ix * side * s.r * 1.1;
      const up = (2.4 + Math.random() * 2.8) * k;
      const fwd = 0.2 + Math.random() * 1.4;
      this.spray.spawn(px, y + Math.random() * 0.2, pz, ix * fwd + Math.cos(a) * 0.6, up, iz * fwd + Math.sin(a) * 0.6, 0.7 + Math.random() * 0.6, 0.16 + Math.random() * 0.2);
    }
    // A white mound of broken water heaving up against the rock face.
    for (let i = 0; i < 9; i++) {
      const side = (Math.random() - 0.5) * 2;
      this.foam.spawn(bx - iz * side * s.r, y + 0.05, bz + ix * side * s.r, ix * 0.3, 0.5 + Math.random() * 0.7 * k, iz * 0.3, 0.55 + Math.random() * 0.35, 0.4 + Math.random() * 0.3, 0.6);
    }
    // Then a ring of white water spreading out round it.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      const d = s.r * (0.7 + Math.random() * 0.4);
      const v = 0.4 + Math.random() * 0.5;
      this.foam.spawn(s.x + Math.cos(a) * d, y, s.z + Math.sin(a) * d, Math.cos(a) * v, 0.03, Math.sin(a) * v, 1.4 + Math.random() * 0.9, 0.5 + Math.random() * 0.35, 0.6);
    }
  }
}
