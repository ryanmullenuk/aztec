import * as THREE from 'three';
import { FAUNA, WILDLIFE } from '../config';
import { fishMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { View } from '../render/View';
import { FishType, fishGeometry } from './animalModels';
import { SEA_SURFACE } from '../water/Water';

/** Beyond this distance (squared) reef fish use the lighter model (they're small: it kicks in early). */
const REEF_LOD2 = 11 * 11;

/** Beyond this distance (squared) reef fish are sub-pixel: neither steered nor drawn. */
const FAR2 = WILDLIFE.fishDrawDistance * WILDLIFE.fishDrawDistance;

const TYPES: FishType[] =['blueYellow', 'yellow', 'clown', 'idol', 'silver', 'tang'];
/**
 * Relative abundance, nose-to-tail length in world units (an islander is ~0.62 tall, a canoe
 * ~1.2 long) and cruising speed of each variety. Small fish are clearly smaller than big ones.
 */
const TYPE_INFO: Record<FishType, { weight: number; size: [number, number]; speed: number }> = {
  clown: { weight: 1.5, size: [0.055, 0.075], speed: 0.24 },
  blueYellow: { weight: 3, size: [0.065, 0.09], speed: 0.36 },
  silver: { weight: 2.5, size: [0.09, 0.13], speed: 0.55 },
  yellow: { weight: 3, size: [0.1, 0.13], speed: 0.36 },
  idol: { weight: 1.2, size: [0.14, 0.18], speed: 0.3 },
  tang: { weight: 1.5, size: [0.17, 0.24], speed: 0.4 },
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
  /** On screen this frame (full per-fish swimming); off-screen fish ride along with the school. */
  vis: boolean;
}

export interface RFish {
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
  /** Caught by a heron: gone for this many seconds, then a new fish joins the school. */
  gone: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Shallow-water reef fish: small schools of one variety each, lingering around reefs, rocks and
 * the lagoon (sometimes foraging along the shallow margins), turning gently and darting from
 * disturbances. Not a food source for the village, but herons and pelicans hunt them.
 */
export class ReefFish {
  readonly group = new THREE.Group();
  private reefs: Reef[] = [];
  schools: RSchool[] = [];
  fish: RFish[] = [];
  private rng: RNG;
  private meshes = new Map<FishType, THREE.InstancedMesh>();
  /** Lighter geometry for fish far from the camera. */
  private meshesLo = new Map<FishType, THREE.InstancedMesh>();
  private time = 0;
  /** Nose-to-tail length of each variety's model (before instance scaling). */
  private modelLen = new Map<FishType, number>();

  constructor(private world: World, reefPoints: { x: number; z: number }[]) {
    this.rng = new RNG(world.seed * 59 + 17);
    // Model length per variety, so each fish can be scaled to its real world length.
    const geoHi = new Map<FishType, THREE.BufferGeometry>();
    for (const t of TYPES) {
      const g = fishGeometry(t, 'hi');
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      this.modelLen.set(t, Math.max(0.01, bb.max.z - bb.min.z));
      geoHi.set(t, g);
    }
    this.findReefs(reefPoints);
    this.spawn();
    // Drawn after the water, softly blended, so their colours read through the surface. They are
    // depth-tested at the point where the view ray enters the sea, so the surface doesn't hide them
    // but land, trees, rocks and buildings in front do.
    const mat = fishMaterial(8, { transparent: true, opacity: 0.62 }, SEA_SURFACE);
    mat.depthWrite = false;
    for (const t of TYPES) {
      const n = this.fish.filter((f) => this.schools[f.school].type === t).length;
      for (const lo of [false, true]) {
        const m = new THREE.InstancedMesh(lo ? fishGeometry(t, 'lo') : geoHi.get(t)!, mat, Math.max(1, n));
        m.castShadow = false;
        m.frustumCulled = false;
        m.renderOrder = 12;
        m.count = 0;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        (lo ? this.meshesLo : this.meshes).set(t, m);
        this.group.add(m);
      }
    }
  }

  private shallow(x: number, z: number): boolean {
    const bed = this.world.heightAt(x, z);
    return bed < -0.55 && bed > -2.8;
  }

  /** Where schools may roam: reef depths and the shallower lagoon margins (where herons fish). */
  private roam(x: number, z: number): boolean {
    const bed = this.world.heightAt(x, z);
    return bed < -0.24 && bed > -2.8;
  }

  /** Hotspots: reefs and sea rocks, plus sampled shallow water and the lagoon. */
  private findReefs(points: { x: number; z: number }[]): void {
    const w = this.world;
    const cand: Reef[] = [];
    for (const p of points) if (this.shallow(p.x, p.z)) cand.push({ x: p.x, z: p.z, r: 3.2 });
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
    for (let s = 0; s < nS && total < WILDLIFE.reefFish + 80; s++) {
      const reef = s % this.reefs.length;
      const R = this.reefs[reef];
      const type = this.pickType();
      // Big fish swim in small groups; small ones in bigger schools.
      const size = type === 'tang' || type === 'idol' ? this.rng.int(10, 18) : this.rng.int(FAUNA.reefSchoolSize[0], FAUNA.reefSchoolSize[1]);
      const sc: RSchool = { type, reef, x: R.x, z: R.z, tx: R.x, tz: R.z, heading: this.rng.range(0, 6.28), speed: TYPE_INFO[type].speed, timer: 0, excursion: 0, vis: true };
      this.schools.push(sc);
      // Schools of small fish pack tighter than the old, bigger fish did.
      const spread = 0.22 + Math.sqrt(size) * 0.09;
      const [a, b] = TYPE_INFO[type].size;
      const len = this.modelLen.get(type) ?? 0.2;
      for (let k = 0; k < size; k++) {
        const f: RFish = {
          school: this.schools.length - 1, x: R.x + this.rng.range(-1, 1), y: -0.4, z: R.z + this.rng.range(-1, 1), heading: sc.heading,
          speed: 0, ox: this.rng.range(-spread, spread), oz: this.rng.range(-spread, spread), oy: this.rng.range(-0.08, 0.08),
          phase: this.rng.range(0, 10), scale: this.rng.range(a, b) / len, dart: 0, gone: 0,
        };
        this.fish.push(f);
        total++;
      }
    }
  }

  private threats: { x: number; z: number; r: number; t: number }[] = [];

  /** A heron's strike or a pelican's dive: fish nearby dart away. */
  scatter(x: number, z: number, r: number): void {
    this.threats.push({ x, z, r, t: 1.2 });
  }

  /** The nearest reef fish to a point (for a hunting heron). */
  nearest(x: number, z: number, r: number): RFish | null {
    let best: RFish | null = null, bd = r * r;
    for (const f of this.fish) {
      if (f.gone > 0) continue;
      const d = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  /** Centres of the reef schools (herons look for fish near these). */
  schoolSpots(): { x: number; z: number }[] {
    return this.schools.map((s) => ({ x: s.x, z: s.z }));
  }

  /** A fish caught: it's gone, and after a while another joins its school. */
  take(f: RFish): void {
    f.gone = this.rng.range(90, 160);
  }

  update(dt: number, cursor: THREE.Vector3 | null, boats: { x: number; z: number }[]): void {
    this.time += dt;
    for (const th of this.threats) th.t -= dt;
    if (this.threats.length) this.threats = this.threats.filter((th) => th.t > 0);
    if (dt > 0) {
      for (const s of this.schools) {
        const R = this.reefs[s.reef];
        s.timer -= dt;
        if (s.timer <= 0 || Math.hypot(s.tx - s.x, s.tz - s.z) < 0.4) {
          s.timer = 4 + this.rng.next() * 8;
          s.excursion = this.rng.chance(0.12) ? 1 : 0;
          // Now and then the school forages along the shallow margins (where herons wait).
          const margin = !s.excursion && this.rng.chance(0.3);
          const rr = R.r * (s.excursion ? 2.2 : margin ? 3 : 1);
          for (let k = 0; k < (margin ? 16 : 8); k++) {
            const a = this.rng.range(0, 6.28), d = Math.sqrt(this.rng.next()) * rr;
            const x = R.x + Math.cos(a) * d, z = R.z + Math.sin(a) * d;
            if (!this.roam(x, z)) continue;
            if (margin && this.world.heightAt(x, z) < -0.55) continue;
            s.tx = x;
            s.tz = z;
            break;
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
        s.vis = View.sees(s.x, -0.4, s.z, 3.5) && View.dist2(s.x, -0.4, s.z) < FAR2;
        if (this.roam(nx, nz)) {
          s.x = nx;
          s.z = nz;
        } else s.timer = 0;
      }
      const w = this.world;
      for (const f of this.fish) {
        const s = this.schools[f.school];
        if (f.gone > 0) {
          f.gone -= dt;
          if (f.gone <= 0) {
            f.gone = 0;
            f.x = s.x;
            f.z = s.z;
          }
          continue;
        }
        if (!s.vis) {
          // Off-screen: settle into its slot in the school without the per-fish steering.
          const c = Math.cos(s.heading), sn = Math.sin(s.heading);
          f.x = s.x + f.ox * c + f.oz * sn;
          f.z = s.z - f.ox * sn + f.oz * c;
          f.heading = s.heading;
          continue;
        }
        // Personal slots drift so the school breathes and reshapes.
        const ph = this.time * 0.25 + f.phase;
        const c = Math.cos(s.heading), sn = Math.sin(s.heading);
        const ox = f.ox + Math.sin(ph) * 0.1, oz = f.oz + Math.cos(ph * 1.3) * 0.1;
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
        for (const th of this.threats) scare(th.x, th.z, th.r);
        for (const b of boats) scare(b.x, b.z, 2.2);
        if (flee) f.dart = 1.2;
        f.dart = Math.max(0, f.dart - dt);
        const dx = tx - f.x, dz = tz - f.z;
        const d = Math.hypot(dx, dz);
        const maxS = f.dart > 0 ? 2.4 : s.speed * 1.9;
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
        const R = this.reefs[s.reef];
        if (bed < -0.23) {
          f.x = nx;
          f.z = nz;
        } else {
          // Too shallow ahead: turn back toward the middle of the reef (and swim, don't spin in place).
          const back = Math.atan2(R.x - f.x, R.z - f.z);
          let dh2 = back - f.heading;
          while (dh2 > Math.PI) dh2 -= Math.PI * 2;
          while (dh2 < -Math.PI) dh2 += Math.PI * 2;
          f.heading += dh2 * Math.min(1, dt * 6);
          if (w.heightAt(f.x, f.z) >= -0.23) {
            // Already stranded in the shallows (e.g. the land was raised): slip back out.
            f.x += Math.sin(back) * dt * 1.2;
            f.z += Math.cos(back) * dt * 1.2;
          }
          s.timer = Math.min(s.timer, 0.5);
        }
        // Hover above the bed, a little deeper on excursions.
        const wantY = Math.min(-0.12, Math.max(bed + 0.12, (s.excursion ? -0.8 : -0.38) + f.oy + Math.sin(this.time * 0.7 + f.phase) * 0.04));
        f.y += (wantY - f.y) * Math.min(1, dt * 1.5);
      }
    }
    this.render();
  }

  private render(): void {
    const cnt = this.cnt;
    const cntLo = this.cntLo;
    cnt.clear();
    cntLo.clear();
    for (const f of this.fish) {
      const s = this.schools[f.school];
      if (f.gone > 0 || !s.vis || !View.sees(f.x, f.y, f.z, 0.2)) continue;
      const lo = View.dist2(f.x, f.y, f.z) > REEF_LOD2;
      const m = (lo ? this.meshesLo : this.meshes).get(s.type)!;
      const c = lo ? cntLo : cnt;
      const i = c.get(s.type) ?? 0;
      // The body bends in the shader; a small yaw on top keeps the head searching.
      const wig = Math.sin(this.time * (3 + f.speed * 4) + f.phase) * (0.03 + f.speed * 0.02);
      _e.set(0, f.heading + wig, 0, 'YXZ');
      _q.setFromEuler(_e);
      // (f.scale already maps the model to the fish's world length.)
      _m.compose(_p.set(f.x, f.y, f.z), _q, _s.setScalar(f.scale));
      m.setMatrixAt(i, _m);
      c.set(s.type, i + 1);
    }
    for (const [t, m] of this.meshes) {
      m.count = cnt.get(t) ?? 0;
      m.instanceMatrix.needsUpdate = true;
    }
    for (const [t, m] of this.meshesLo) {
      m.count = cntLo.get(t) ?? 0;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  private cnt = new Map<FishType, number>();
  private cntLo = new Map<FishType, number>();
}
