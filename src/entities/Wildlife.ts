import * as THREE from 'three';
import { WILDLIFE } from '../config';
import { fishMaterial } from '../render/materials';
import { View } from '../render/View';

/** Beyond this distance (squared) fish are drawn with the lighter model (they're small: it kicks in early). */
const FISH_LOD2 = 13 * 13;
/** Beyond this distance (squared) school fish are sub-pixel: neither flocked nor drawn. */
const FISH_FAR2 = WILDLIFE.fishDrawDistance * WILDLIFE.fishDrawDistance;
/** Nose-to-tail length of a school fish in world units (an islander is ~0.62 tall). */
const SCHOOL_FISH_LEN: [number, number] = [0.085, 0.14];
import { Building } from '../buildings/Buildings';
import { Islander } from './Islander';
import { SpatialHash } from '../world/SpatialHash';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { PlantState, Vegetation } from '../vegetation/Vegetation';
import { Animals } from './Animals';
import { Birds } from './Birds';
import { Critters } from './Critters';
import { Monkeys } from './Monkeys';
import { ReefFish } from './ReefFish';
import { Coral } from './Coral';
import { fishGeometry } from './animalModels';

/** A deep-water fish school: the fishing boats' resource. */
export interface School {
  x: number;
  z: number;
  tx: number;
  tz: number;
  stock: number;
  max: number;
  deep: boolean;
  /** On screen this frame (full flocking); off-screen schools just carry their fish along. */
  vis?: boolean;
}

interface Fish {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  school: number;
  phase: number;
  scale: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export interface WildlifeInput {
  /** Pointer ray for birds (null when the pointer should not disturb them, e.g. while panning on touch). */
  ray: THREE.Ray | null;
  /** Pointer on the ground / sea surface. */
  ground: THREE.Vector3 | null;
  camTarget: THREE.Vector3;
}

/**
 * All ambient wildlife, composed from data-driven modules:
 * land animals (capturable livestock and game), birds (gulls, toucans), spider monkeys,
 * beach crabs and stingrays, decorative reef fish, and the deep ocean schools boats fish from.
 */
export class Wildlife {
  readonly group = new THREE.Group();
  readonly animals: Animals;
  readonly birds: Birds;
  readonly monkeys: Monkeys;
  readonly critters: Critters;
  readonly reef: ReefFish;
  readonly coral: Coral;
  /** Deep schools only: reef fish are decorative. */
  schools: School[] = [];
  private fish: Fish[] = [];
  private fishHash = new SpatialHash<Fish>(3);
  private fishMesh: THREE.InstancedMesh;
  /** The same fish in lighter geometry for those far from the camera. */
  private fishMeshLo: THREE.InstancedMesh;
  private rng: RNG;
  private time = 0;
  /** Length of the school-fish model before instance scaling. */
  private fishModelLen = 0.2;
  /** Positions boats scare fish from. */
  boats: { x: number; z: number }[] = [];

  constructor(private world: World, veg: Vegetation) {
    this.rng = new RNG(world.seed * 97 + 5);
    this.animals = new Animals(world);
    const rocks = veg.plants.filter((p) => p.kind === 'searock' || p.kind === 'rock' && world.distWater[world.cellIndexAt(p.x, p.z)] <= 1);
    const landing = rocks.map((p) => new THREE.Vector3(p.x, Math.max(0.05, p.y + 0.45 * p.scale), p.z));
    // Beach spots too.
    for (let k = 0; k < 3000 && landing.length < 80; k++) {
      const cx = this.rng.int(2, world.N - 3), cz = this.rng.int(2, world.N - 3);
      const i = world.idx(cx, cz);
      if (world.layer[i] === 1 && world.sandy[i] > 0.6 && world.occ[i] === 0) {
        const x = world.centerX(cx), z = world.centerZ(cz);
        landing.push(new THREE.Vector3(x, world.groundY(x, z), z));
      }
    }
    this.birds = new Birds(world, veg.canopyPoints(260, this.rng), landing);
    const alive = (id: number) => veg.plants[id]?.state === PlantState.Alive;
    this.monkeys = new Monkeys(world, veg.canopyTrees(), alive);
    this.critters = new Critters(world);
    // Coral reefs first: the reef fish gather over them.
    this.coral = new Coral(world);
    const reefPts = [...this.coral.patches.map((p) => ({ x: p.x, z: p.z })), ...veg.plants.filter((p) => p.kind === 'reef' || p.kind === 'searock').map((p) => ({ x: p.x, z: p.z }))];
    this.reef = new ReefFish(world, reefPts);
    this.group.add(this.animals.group, this.birds.group, this.monkeys.group, this.critters.group, this.reef.group, this.coral.group);
    const fmat = fishMaterial(11);
    const cap = Math.max(1, WILDLIFE.schools * WILDLIFE.schoolFishShown);
    const mk = (g: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(g, fmat, cap);
      m.castShadow = false;
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    const geo = fishGeometry('silver');
    geo.computeBoundingBox();
    this.fishModelLen = Math.max(0.01, geo.boundingBox!.max.z - geo.boundingBox!.min.z);
    this.fishMesh = mk(geo);
    this.fishMeshLo = mk(fishGeometry('silver', 'lo'));
    this.spawnSchools();
    this.shownCount = new Int32Array(this.schools.length);
  }

  // ---------------- Pens (delegated) ----------------

  registerPen(b: Building): void {
    this.animals.registerPen(b);
  }
  releasePen(id: number): void {
    this.animals.releasePen(id);
  }
  penCount(b: Building): number {
    return this.animals.penCount(b);
  }
  takeFromPen(b: Building): boolean {
    return this.animals.takeFromPen(b);
  }

  // ---------------- Deep schools ----------------

  private spawnSchools(): void {
    const w = this.world;
    for (let s = 0; s < WILDLIFE.schools; s++) {
      let pos: { x: number; z: number } | null = null;
      for (let k = 0; k < 200 && !pos; k++) {
        const a = this.rng.range(0, Math.PI * 2), d = this.rng.range(w.half * 0.5, w.half * 0.9);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (w.heightAt(x, z) < -1.8) pos = { x, z };
      }
      if (!pos) continue;
      this.schools.push({ x: pos.x, z: pos.z, tx: pos.x, tz: pos.z, stock: WILDLIFE.fishPerSchool, max: WILDLIFE.fishPerSchool, deep: true });
      // More fish are drawn than the stock counts (stock is the fishing yield; see shownFor).
      for (let k = 0; k < WILDLIFE.schoolFishShown; k++) {
        const len = this.rng.range(SCHOOL_FISH_LEN[0], SCHOOL_FISH_LEN[1]);
        this.fish.push({ x: pos.x + this.rng.range(-2, 2), y: -0.5 - this.rng.next() * 0.5, z: pos.z + this.rng.range(-2, 2), vx: 0, vz: 0, heading: 0, school: this.schools.length - 1, phase: this.rng.range(0, 10), scale: len / this.fishModelLen });
      }
    }
  }

  update(dt: number, input: WildlifeInput, islanders: SpatialHash<Islander>): void {
    this.time += dt;
    this.animals.update(dt, input.camTarget, input.ground && input.ground.y > 0.02 ? input.ground : null, islanders);
    this.birds.update(dt, input.ray, islanders);
    this.monkeys.update(dt, input.camTarget, islanders, input.ground);
    this.critters.update(dt, this.time, input.ground, islanders);
    this.reef.update(dt, input.ground, this.boats);
    if (dt > 0) this.updateSchools(dt, input.ground);
    this.renderSchools();
  }

  private updateSchools(dt: number, cursor: THREE.Vector3 | null): void {
    const w = this.world;
    const bo = WILDLIFE.boids;
    for (const s of this.schools) {
      s.stock = Math.min(s.max, s.stock + WILDLIFE.schoolRegrowPerSecond * dt);
      if (Math.hypot(s.tx - s.x, s.tz - s.z) < 1) {
        for (let k = 0; k < 10; k++) {
          const x = s.x + (this.rng.next() - 0.5) * 28, z = s.z + (this.rng.next() - 0.5) * 28;
          if (w.heightAt(x, z) < -1.8) {
            s.tx = x;
            s.tz = z;
            break;
          }
        }
      }
      const d = Math.hypot(s.tx - s.x, s.tz - s.z) || 1;
      const nx = s.x + ((s.tx - s.x) / d) * 0.9 * dt, nz = s.z + ((s.tz - s.z) / d) * 0.9 * dt;
      s.vis = View.sees(s.x, -0.6, s.z, 6) && View.dist2(s.x, -0.6, s.z) < FISH_FAR2;
      if (w.heightAt(nx, nz) < -1.8) {
        // Off-screen: the fish simply travel with their school (flocking resumes on screen).
        if (!s.vis) for (const f of this.fish) if (this.schools[f.school] === s) {
          f.x += nx - s.x;
          f.z += nz - s.z;
        }
        s.x = nx;
        s.z = nz;
      } else {
        // Heading into shallower water: pick a new target further out to sea instead.
        const out = Math.atan2(s.x, s.z) + (this.rng.next() - 0.5) * 1.2;
        s.tx = s.x + Math.sin(out) * 12;
        s.tz = s.z + Math.cos(out) * 12;
      }
    }
    for (const th of this.threats) th.t -= dt;
    if (this.threats.length) this.threats = this.threats.filter((th) => th.t > 0);
    this.fishHash.clear();
    for (const f of this.fish) if (this.schools[f.school].vis) this.fishHash.insert(f);
    for (const f of this.fish) {
      const s = this.schools[f.school];
      if (!s.vis) continue;
      let fx = (s.x - f.x) * 0.6, fz = (s.z - f.z) * 0.6;
      // Bait-ball swirl: circle the school centre with a slowly changing radius.
      const dx = f.x - s.x, dz = f.z - s.z;
      const dd = Math.hypot(dx, dz) || 1;
      const want = 1.2 + (f.phase % 1) * 2.4;
      fx += (-dz / dd) * 1.4 + (dx / dd) * (want - dd) * 0.8;
      fz += (dx / dd) * 1.4 + (dz / dd) * (want - dd) * 0.8;
      let sx = 0, sz = 0, ax = 0, az = 0, n = 0;
      // Twice the fish at under half the size: a tighter neighbourhood keeps the cost flat.
      this.fishHash.query(f.x, f.z, 1.0, (o, d2) => {
        if (o === f || o.school !== f.school) return;
        n++;
        ax += o.vx;
        az += o.vz;
        if (d2 < 0.07) {
          sx += f.x - o.x;
          sz += f.z - o.z;
        }
      });
      if (n) {
        fx += sx * bo.separation * 3 + (ax / n - f.vx) * bo.alignment;
        fz += sz * bo.separation * 3 + (az / n - f.vz) * bo.alignment;
      }
      let flee = false;
      const scare = (x: number, z: number, r: number) => {
        const ex = f.x - x, ez = f.z - z;
        const d = Math.hypot(ex, ez);
        if (d < r && d > 0.001) {
          fx += (ex / d) * 30;
          fz += (ez / d) * 30;
          flee = true;
        }
      };
      if (cursor) scare(cursor.x, cursor.z, WILDLIFE.fishFleeRadius);
      for (const th of this.threats) scare(th.x, th.z, th.r);
      for (const bt of this.boats) scare(bt.x, bt.z, WILDLIFE.fishFleeRadius * 0.8);
      fx += Math.sin(this.time * 0.8 + f.phase) * 0.4;
      fz += Math.cos(this.time * 0.7 + f.phase * 1.3) * 0.4;
      f.vx += fx * dt;
      f.vz += fz * dt;
      const sp = Math.hypot(f.vx, f.vz);
      const maxS = flee ? 5 : 1.6;
      if (sp > maxS) {
        f.vx *= maxS / sp;
        f.vz *= maxS / sp;
      }
      const nx = f.x + f.vx * dt, nz = f.z + f.vz * dt;
      if (w.heightAt(nx, nz) < -0.3) {
        f.x = nx;
        f.z = nz;
      } else {
        // Blocked by the shore: swim back toward the school rather than bouncing in place.
        const bx = s.x - f.x, bz = s.z - f.z, bl = Math.hypot(bx, bz) || 1;
        f.vx = (bx / bl) * 1.2;
        f.vz = (bz / bl) * 1.2;
        if (w.heightAt(f.x, f.z) >= -0.3) {
          f.x += (bx / bl) * dt * 1.5;
          f.z += (bz / bl) * dt * 1.5;
        }
      }
      const wy = -0.18 - (f.phase % 1) * 0.55 + Math.sin(this.time * 0.9 + f.phase) * 0.06;
      f.y += (wy - f.y) * Math.min(1, dt * 2);
      if (sp > 0.05) {
        let dh = Math.atan2(f.vx, f.vz) - f.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        f.heading += dh * Math.min(1, dt * 8);
      }
    }
  }

  private renderSchools(): void {
    // Only fish on screen are drawn (packed to the front); far ones use the lighter model.
    // A school shows as many fish as its current stock (over-fishing visibly thins it).
    const shown = this.shownCount;
    shown.fill(0);
    let hi = 0, lo = 0;
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      const s = this.schools[f.school];
      const n = shown[f.school]++;
      if (n >= this.shownFor(s) || !s.vis || !View.sees(f.x, f.y, f.z, 0.2)) continue;
      const wig = Math.sin(this.time * 4 + f.phase) * 0.05;
      _e.set(0, f.heading + wig, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(f.x, f.y, f.z), _q, _s.setScalar(f.scale));
      if (View.dist2(f.x, f.y, f.z) < FISH_LOD2) this.fishMesh.setMatrixAt(hi++, _m);
      else this.fishMeshLo.setMatrixAt(lo++, _m);
    }
    this.fishMesh.count = hi;
    this.fishMeshLo.count = lo;
    this.fishMesh.instanceMatrix.needsUpdate = true;
    this.fishMeshLo.instanceMatrix.needsUpdate = true;
  }

  private shownCount = new Int32Array(0);

  /** How many of a school's fish are drawn: its share of full stock, times the fish it shows when full. */
  private shownFor(s: School): number {
    return s.max > 0 ? Math.floor((s.stock / s.max) * WILDLIFE.schoolFishShown) : 0;
  }

  // ---------------- Predators (pelicans) ----------------

  private threats: { x: number; z: number; r: number; t: number }[] = [];

  /** A dive or a strike: fish nearby dart away for a moment. */
  scatter(x: number, z: number, r: number): void {
    this.threats.push({ x, z, r, t: 1.6 });
  }

  /** The nearest fish a predator can see near a point (only fish a school's stock shows). */
  fishNear(x: number, z: number, r: number): { x: number; y: number; z: number; school: number } | null {
    const shown = this.shownCount;
    shown.fill(0);
    let best: Fish | null = null, bd = r * r;
    for (const f of this.fish) {
      const n = shown[f.school]++;
      if (n >= this.shownFor(this.schools[f.school])) continue;
      const d = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best ? { x: best.x, y: best.y, z: best.z, school: best.school } : null;
  }

  /** A fish caught from a school (the school visibly thins, and regrows over time). */
  takeFish(school: number): boolean {
    const s = this.schools[school];
    if (!s || s.stock < 1) return false;
    s.stock -= 1;
    return true;
  }

  /** Nearest deep school with fish, for a boat. */
  nearestSchool(x: number, z: number): School | null {
    let best: School | null = null, bd = Infinity;
    for (const s of this.schools) {
      if (s.stock < 4) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  serialize(): { animals: number[][]; schools: number[] } {
    return { animals: this.animals.serialize(), schools: this.schools.map((s) => Math.round(s.stock * 10) / 10) };
  }
}
