import * as THREE from 'three';
import { DEFENCE } from '../config';
import type { Building, BuildingSystem } from '../buildings/Buildings';
import { arrowGeometry, towerWindows } from '../buildings/models';
import { buildingMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import type { World } from '../world/World';

/** Anything a watchtower can shoot at: a jaguar or an alligator (its own object, by reference). */
export interface Quarry {
  x: number;
  y: number;
  z: number;
}

export type QuarryKind = 'jaguar' | 'alligator';

export interface DefenceHooks {
  /** Predators out on the island now, with the height to aim at (the middle of the body). */
  quarry: () => { kind: QuarryKind; ref: Quarry; aimY: number }[];
  /** An arrow struck it home: what became of it. */
  hit: (kind: QuarryKind, ref: Quarry) => 'hurt' | 'killed';
  sfx: (name: string, x: number, z: number) => void;
  /** A predator brought down (optional; the game tells the player). */
  killed?: (kind: QuarryKind, at: { x: number; z: number }) => void;
}

interface Arrow {
  p: THREE.Vector3;
  v: THREE.Vector3;
  t: number;
  /** Flight time to the aim point; whether it was loosed true (not a miss). */
  T: number;
  true: boolean;
  kind: QuarryKind;
  ref: Quarry;
  aim: THREE.Vector3;
  tower: number;
  /** Seconds left stuck in the ground (≥ 0 once it has landed), or −1 while flying. */
  stuck: number;
  q: THREE.Quaternion;
}

interface Watch {
  reload: number;
  shots: number;
  kills: number;
}

const G = 9.8;
const MAX_ARROWS = 48;
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
/** Drawn a little larger than life so they read at game zoom. */
const _s = new THREE.Vector3(1.5, 1.5, 1.5);
const FWD = new THREE.Vector3(0, 0, 1);
const _e = new THREE.Euler();
const WINDOWS = towerWindows();

/**
 * Watchtowers defend themselves: a finished tower needs nobody to man it. Whenever a jaguar or an
 * alligator comes within range, arrows fly out of whichever of its windows faces the beast, on a
 * real ballistic arc that leads a moving target. Most fly true; a hit sends the beast fleeing (or
 * kills it after a few); a miss sticks quivering in the ground for a while.
 */
export class Defence {
  readonly mesh: THREE.InstancedMesh;
  private arrows: Arrow[] = [];
  private watch = new Map<number, Watch>();
  /** Where each quarry was last frame, to lead a moving target. */
  private last = new WeakMap<Quarry, { x: number; z: number; vx: number; vz: number }>();
  private rng: RNG;
  hooks: DefenceHooks | null = null;

  constructor(private world: World, private buildings: BuildingSystem) {
    this.rng = new RNG(world.seed * 59 + 17);
    this.mesh = new THREE.InstancedMesh(arrowGeometry(), buildingMaterial(), MAX_ARROWS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'arrows';
  }

  /** Arrows loosed and predators brought down by this tower (since the game was loaded). */
  stats(b: Building): { shots: number; kills: number } {
    const w = this.watch.get(b.id);
    return { shots: w?.shots ?? 0, kills: w?.kills ?? 0 };
  }

  /** Where an arrow leaves the tower for a target at (tx, tz): the window facing it most nearly (world). */
  windowFor(b: Building, tx: number, tz: number, out = new THREE.Vector3()): THREE.Vector3 {
    _e.set(0, (b.rot * Math.PI) / 2, 0);
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz) || 1;
    let best = -Infinity;
    for (const w of WINDOWS) {
      _v.copy(w.out).applyEuler(_e);
      const f = (_v.x * dx + _v.z * dz) / d;
      if (f > best) {
        best = f;
        out.copy(w.at).applyEuler(_e).add(b.group.position);
      }
    }
    return out;
  }

  update(dt: number): void {
    if (dt <= 0) return this.draw();
    const h = this.hooks;
    const quarry = h ? h.quarry() : [];
    // Track how each predator is moving, to aim where it will be.
    for (const q of quarry) {
      const l = this.last.get(q.ref);
      if (l) {
        l.vx += ((q.ref.x - l.x) / dt - l.vx) * Math.min(1, dt * 4);
        l.vz += ((q.ref.z - l.z) / dt - l.vz) * Math.min(1, dt * 4);
        l.x = q.ref.x;
        l.z = q.ref.z;
      } else this.last.set(q.ref, { x: q.ref.x, z: q.ref.z, vx: 0, vz: 0 });
    }
    for (const b of this.buildings.list) {
      if (b.key !== 'watchtower' || !b.complete) continue;
      let w = this.watch.get(b.id);
      if (!w) this.watch.set(b.id, (w = { reload: 1, shots: 0, kills: 0 }));
      w.reload = Math.max(0, w.reload - dt);
      // The nearest predator within range.
      let best: (typeof quarry)[number] | null = null, bd = DEFENCE.range;
      for (const q of quarry) {
        const d = Math.hypot(q.ref.x - b.x, q.ref.z - b.z);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      // Nothing about: the first arrow waits a moment once something comes into range.
      if (!best) {
        w.reload = Math.max(w.reload, 0.6);
        continue;
      }
      if (w.reload <= 0 && this.arrows.length < MAX_ARROWS && h) {
        this.loose(b, best.kind, best.ref, best.aimY);
        w.reload = DEFENCE.reload * this.rng.range(0.85, 1.2);
        w.shots++;
        h.sfx('bow', b.x, b.z);
      }
    }
    this.fly(dt, quarry);
    this.draw();
  }

  private loose(b: Building, kind: QuarryKind, ref: Quarry, aimY: number): void {
    const from = this.windowFor(b, ref.x, ref.z);
    const l = this.last.get(ref);
    const d0 = Math.hypot(ref.x - from.x, aimY - from.y, ref.z - from.z);
    const T = Math.max(0.15, d0 / DEFENCE.arrowSpeed);
    const aim = new THREE.Vector3(ref.x + (l?.vx ?? 0) * T, aimY, ref.z + (l?.vz ?? 0) * T);
    const good = this.rng.next() < DEFENCE.accuracy;
    if (!good) {
      // Wide of the mark: into the ground a pace or two off.
      const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(0.9, 2.2);
      aim.x += Math.sin(a) * r;
      aim.z += Math.cos(a) * r;
      aim.y = this.world.heightAt(aim.x, aim.z);
    }
    const v = new THREE.Vector3((aim.x - from.x) / T, (aim.y - from.y + 0.5 * G * T * T) / T, (aim.z - from.z) / T);
    this.arrows.push({ p: from, v, t: 0, T, true: good, kind, ref, aim, tower: b.id, stuck: -1, q: new THREE.Quaternion().setFromUnitVectors(FWD, _v.copy(v).normalize()) });
  }

  private fly(dt: number, quarry: { kind: QuarryKind; ref: Quarry }[]): void {
    const h = this.hooks;
    for (let k = this.arrows.length - 1; k >= 0; k--) {
      const a = this.arrows[k];
      if (a.stuck >= 0) {
        a.stuck -= dt;
        if (a.stuck < 0) this.arrows.splice(k, 1);
        continue;
      }
      a.t += dt;
      a.p.addScaledVector(a.v, dt);
      a.v.y -= G * dt;
      a.q.setFromUnitVectors(FWD, _v.copy(a.v).normalize());
      // Arriving at the target: struck home, if the beast is still there.
      if (a.true && a.t >= a.T) {
        a.true = false;
        const alive = quarry.some((q) => q.ref === a.ref);
        if (alive && h && Math.hypot(a.ref.x - a.aim.x, a.ref.z - a.aim.z) < 0.9) {
          const r = h.hit(a.kind, a.ref);
          h.sfx('arrowhit', a.ref.x, a.ref.z);
          if (r === 'killed') {
            const w = this.watch.get(a.tower);
            if (w) w.kills++;
            h.killed?.(a.kind, { x: a.ref.x, z: a.ref.z });
          }
          this.arrows.splice(k, 1);
          continue;
        }
      }
      // Into the ground (stuck, quivering, for a while) or the water (gone).
      const ci = this.world.cellIndexAt(a.p.x, a.p.z);
      const ground = ci >= 0 ? this.world.heightAt(a.p.x, a.p.z) : -5;
      if (a.p.y <= Math.max(ground, 0)) {
        if (ground < 0 || a.t > 5) this.arrows.splice(k, 1);
        else {
          a.p.y = ground + 0.02;
          a.p.addScaledVector(_v.copy(a.v).normalize(), -0.06);
          a.stuck = 6;
        }
      }
    }
  }

  private draw(): void {
    let n = 0;
    for (const a of this.arrows) {
      let q = a.q;
      if (a.stuck >= 0 && a.stuck > 5.4) {
        // A quiver as it strikes.
        const wob = Math.sin(a.stuck * 60) * (a.stuck - 5.4) * 0.25;
        q = _q.copy(a.q).multiply(_qw.setFromAxisAngle(_ax, wob));
      }
      _m.compose(a.p, q, _s);
      this.mesh.setMatrixAt(n++, _m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _ax = new THREE.Vector3(1, 0, 0);
