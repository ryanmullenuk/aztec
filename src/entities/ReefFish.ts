import * as THREE from 'three';
import { FAUNA, WILDLIFE } from '../config';
import { stylisedMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { FishType, fishGeometry } from './animalModels';

const TYPES: FishType[] = ['blueYellow', 'yellow', 'clown', 'idol', 'silver', 'tang'];
/** Relative abundance and size of each variety. */
const TYPE_INFO: Record<FishType, { weight: number; size: [number, number]; speed: number }> = {
  blueYellow: { weight: 3, size: [0.9, 1.15], speed: 0.55 },
  yellow: { weight: 3, size: [0.85, 1.1], speed: 0.5 },
  clown: { weight: 1.5, size: [0.8, 1], speed: 0.35 },
  idol: { weight: 1.2, size: [0.9, 1.1], speed: 0.4 },
  silver: { weight: 2.5, size: [0.9, 1.2], speed: 0.75 },
  tang: { weight: 1.5, size: [0.9, 1.2], speed: 0.5 },
};

interface Reef {
  x: number;
  z: number;
  r: number;
}

interface RSchool {
  type: FishType;
  reef: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  heading: number;
  speed: number;
  timer: number;
  /** Occasional short excursion a little deeper / further out. */
  excursion: number;
}

interface RFish {
  school: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  /** Personal slot in the school, drifting slowly. */
  ox: number;
  oz: number;
  oy: number;
  phase: number;
  scale: number;
  dart: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Decorative shallow-water reef fish (not a food source): small schools of one variety each,
 * lingering around reefs, rocks and the lagoon, turning gently and darting from disturbances.
 */
export class ReefFish {
  readonly group = new THREE.Group();
  private reefs: Reef[] = [];
  schools: RSchool[] = [];
  fish: RFish[] = [];
  private rng: RNG;
  private meshes = new Map<FishType, THREE.InstancedMesh>();
  private time = 0;

  constructor(private world: World, reefPoints: { x: number; z: number }[]) {
    this.rng = new RNG(world.seed * 59 + 17);
    this.findReefs(reefPoints);
    this.spawn();
    // Drawn after the water, softly blended, so their colours read through the surface.
    const mat = stylisedMaterial();
    mat.transparent = true;
    mat.opacity = 0.5;
    mat.depthWrite = false;
    // The ocean writes depth; the fish keep to water deeper than the surf, so skipping the test is safe.
    mat.depthTest = false;
    for (const t of TYPES) {
      const n = this.fish.filter((f) => this.schools[f.school].type === t).length;
      const m = new THREE.InstancedMesh(fishGeometry(t), mat, Math.max(1, n));
      m.castShadow = false;
      m.frustumCulled = false;
      m.renderOrder = 12;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.set(t, m);
      this.group.add(m);
    }
  }

  private shallow(x: number, z: number): boolean {
    const bed = this.world.heightAt(x, z);
    return bed < -0.55 && bed > -2.8;
  }

  /** Hotspots: reefs and sea rocks, plus sampled shallow water and the lagoon. */
  private findReefs(points: { x: number; z: number }[]): void {
    const w = this.world;
    const cand: Reef[] = [];
    for (const p of points) if (this.shallow(p.x, p.z)) cand.push({ x: p.x, z: p.z, r: 2.5 });
    if (w.lagoon && this.shallow(w.lagoon.x, w.lagoon.z)) cand.unshift({ x: w.lagoon.x, z: w.lagoon.z, r: 4 });
    for (let k = 0; k < 3000 && cand.length < 30; k++) {
      const cx = this.rng.int(2, w.N - 3), cz = this.rng.int(2, w.N - 3);
      const x = w.centerX(cx), z = w.centerZ(cz);
      if (this.shallow(x, z) && w.heightAt(x, z) > -1.8) cand.push({ x, z, r: 3 });
    }
    // Keep hotspots spread out.
    for (const c of cand) if (this.reefs.every((r) => Math.hypot(r.x - c.x, r.z - c.z) > 6)) this.reefs.push(c);
  }

  private pickType(): FishType {
    const tot = TYPES.reduce((s, t) => s + TYPE_INFO[t].weight, 0);
    let r = this.rng.next() * tot;
    for (const t of TYPES) if ((r -= TYPE_INFO[t].weight) <= 0) return t;
    return 'yellow';
  }

  private spawn(): void {
    if (!this.reefs.length) return;
    const nS = this.rng.int(FAUNA.reefSchools[0], FAUNA.reefSchools[1]);
    let total = 0;
    for (let s = 0; s < nS && total < WILDLIFE.reefFish + 40; s++) {
      const reef = s % this.reefs.length;
      const R = this.reefs[reef];
      const type = this.pickType();
      // Big fish swim in small groups; small ones in bigger schools.
      const size = type === 'tang' || type === 'idol' ? this.rng.int(5, 9) : this.rng.int(FAUNA.reefSchoolSize[0], FAUNA.reefSchoolSize[1]);
      const sc: RSchool = { type, reef, x: R.x, z: R.z, tx: R.x, tz: R.z, heading: this.rng.range(0, 6.28), speed: TYPE_INFO[type].speed, timer: 0, excursion: 0 };
      this.schools.push(sc);
      const spread = 0.35 + Math.sqrt(size) * 0.14;
      for (let k = 0; k < size; k++) {
        const [a, b] = TYPE_INFO[type].size;
        const f: RFish = {
          school: this.schools.length - 1, x: R.x + this.rng.range(-1, 1), y: -0.4, z: R.z + this.rng.range(-1, 1), heading: sc.heading,
          speed: 0, ox: this.rng.range(-spread, spread), oz: this.rng.range(-spread, spread), oy: this.rng.range(-0.12, 0.12),
          phase: this.rng.range(0, 10), scale: this.rng.range(a, b), dart: 0,
        };
        this.fish.push(f);
        total++;
      }
    }
  }

  update(dt: number, cursor: THREE.Vector3 | null, boats: { x: number; z: number }[]): void {
    this.time += dt;
    if (dt > 0) {
      for (const s of this.schools) {
        const R = this.reefs[s.reef];
        s.timer -= dt;
        if (s.timer <= 0 || Math.hypot(s.tx - s.x, s.tz - s.z) < 0.4) {
          s.timer = 4 + this.rng.next() * 8;
          s.excursion = this.rng.chance(0.12) ? 1 : 0;
          const rr = R.r * (s.excursion ? 2.2 : 1);
          for (let k = 0; k < 8; k++) {
            const a = this.rng.range(0, 6.28), d = Math.sqrt(this.rng.next()) * rr;
            const x = R.x + Math.cos(a) * d, z = R.z + Math.sin(a) * d;
            if (this.shallow(x, z)) {
              s.tx = x;
              s.tz = z;
              break;
            }
          }
        }
        // Gentle turning toward the target.
        const want = Math.atan2(s.tx - s.x, s.tz - s.z);
        let dh = want - s.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        s.heading += Math.max(-0.7 * dt, Math.min(0.7 * dt, dh));
        const sp = s.speed * (0.6 + 0.4 * Math.cos(dh));
        const nx = s.x + Math.sin(s.heading) * sp * dt, nz = s.z + Math.cos(s.heading) * sp * dt;
        if (this.shallow(nx, nz)) {
          s.x = nx;
          s.z = nz;
        } else s.timer = 0;
      }
      const w = this.world;
      for (const f of this.fish) {
        const s = this.schools[f.school];
        // Personal slots drift so the school breathes and reshapes.
        const ph = this.time * 0.25 + f.phase;
        const c = Math.cos(s.heading), sn = Math.sin(s.heading);
        const ox = f.ox + Math.sin(ph) * 0.18, oz = f.oz + Math.cos(ph * 1.3) * 0.18;
        let tx = s.x + ox * c + oz * sn, tz = s.z - ox * sn + oz * c;
        let flee = false;
        const scare = (x: number, z: number, r: number) => {
          const dx = f.x - x, dz = f.z - z;
          const d = Math.hypot(dx, dz);
          if (d < r && d > 0.001) {
            tx = f.x + (dx / d) * 2;
            tz = f.z + (dz / d) * 2;
            flee = true;
          }
        };
        if (cursor) scare(cursor.x, cursor.z, WILDLIFE.fishFleeRadius);
        for (const b of boats) scare(b.x, b.z, 2.2);
        if (flee) f.dart = 1.2;
        f.dart = Math.max(0, f.dart - dt);
        const dx = tx - f.x, dz = tz - f.z;
        const d = Math.hypot(dx, dz);
        const maxS = f.dart > 0 ? 3.2 : s.speed * 1.9;
        const targetSpeed = Math.min(maxS, d * 1.6 + s.speed * 0.3);
        f.speed += (targetSpeed - f.speed) * Math.min(1, dt * (f.dart > 0 ? 8 : 2));
        if (d > 0.02) {
          let dh = Math.atan2(dx, dz) - f.heading;
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          const turn = f.dart > 0 ? 9 : 2.2;
          f.heading += Math.max(-turn * dt, Math.min(turn * dt, dh));
        }
        const nx = f.x + Math.sin(f.heading) * f.speed * dt, nz = f.z + Math.cos(f.heading) * f.speed * dt;
        const bed = w.heightAt(nx, nz);
        if (bed < -0.5) {
          f.x = nx;
          f.z = nz;
        } else f.heading += Math.PI * 0.5 * dt * 4;
        // Hover above the bed, a little deeper on excursions.
        const wantY = Math.min(-0.2, Math.max(bed + 0.16, (s.excursion ? -0.8 : -0.38) + f.oy + Math.sin(this.time * 0.7 + f.phase) * 0.04));
        f.y += (wantY - f.y) * Math.min(1, dt * 1.5);
      }
    }
    this.render();
  }

  private render(): void {
    const cnt = new Map<FishType, number>();
    for (const f of this.fish) {
      const s = this.schools[f.school];
      const m = this.meshes.get(s.type)!;
      const i = cnt.get(s.type) ?? 0;
      const wig = Math.sin(this.time * (8 + f.speed * 10) + f.phase) * (0.08 + f.speed * 0.05);
      _e.set(0, f.heading + wig, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(f.x, f.y, f.z), _q, _s.setScalar(f.scale * 1.7));
      m.setMatrixAt(i, _m);
      cnt.set(s.type, i + 1);
    }
    for (const [t, m] of this.meshes) {
      m.count = cnt.get(t) ?? 0;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}
