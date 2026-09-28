import * as THREE from 'three';
import { View } from '../render/View';
import { JAGUARS } from '../config';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import type { Dog, Dogs } from './Dogs';
import { Islander } from './Islander';
import { JAG_DIMS, QuadMeshes, blankPose, drawQuad, jaguarBodyHalves, jaguarHead, legParts, stepGait, tailPiece } from './quadRig';
import { steer, turnTo } from './steer';

/** Selection ids for jaguars (animals, monkeys and dogs have their own ranges). */
export const JAG_BASE = 3_000_000;

type JState = 'rest' | 'prowl' | 'stalk' | 'charge' | 'confront' | 'fight' | 'retreat';

export interface Jaguar {
  id: number;
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  state: JState;
  timer: number;
  tx: number;
  tz: number;
  den: { x: number; z: number; r: number };
  /** Seconds until it next grows hungry and heads for the village. */
  hunt: number;
  target: number;
  stalkT: number;
  /** Confrontation already decided on this approach (re-checked after a while). */
  resolved: boolean;
  recheck: number;
  /** What the confrontation turned into once the growling is over. */
  then: 'retreat' | 'fight' | 'press';
  fightDog: number;
  lungeT: number;
  noticed: boolean;
  /** Driven off (rather than done hunting): waits longer before trying again. */
  driven: boolean;
  color: THREE.Color;
  scale: number;
  gait: number;
  prevHeading: number;
  turn: number;
  crouch: number;
  lunge: number;
  lie: number;
  growl: number;
  phase: number;
}

export interface JaguarHooks {
  villagers: () => Islander[];
  byId: (id: number) => Islander | undefined;
  alarm: (x: number, z: number, r: number) => void;
  maul: (isl: Islander, killed: boolean) => void;
  godMode: () => boolean;
  /** A villager (or dog) has spotted the jaguar: warn the player (throttled by the game). */
  danger: (j: Jaguar, by: 'dogs' | 'villagers') => void;
  sfx: (name: string, x: number, z: number) => void;
}

const STATE_TEXT: Record<JState, string> = {
  rest: 'Resting in the shade', prowl: 'Prowling its territory', stalk: 'Stalking toward the village', charge: 'Charging!',
  confront: 'Snarling at the dogs', fight: 'Fighting the dogs', retreat: 'Retreating into the jungle',
};

/**
 * Jaguars: a pair of big cats with dens deep in the jungle (the wild island and the far forest).
 * They rest and prowl, and every few minutes (more often at night) one grows hungry and stalks
 * toward the village after a villager, crouched low, then charges. Villagers only notice when
 * it's close; dogs smell it far sooner. Dogs, and even more so warriors, usually drive it off.
 */
export class Jaguars {
  readonly meshes = new QuadMeshes();
  list: Jaguar[] = [];
  private rng: RNG;
  private time = 0;
  dogs: Dogs | null = null;
  hooks: JaguarHooks | null = null;

  constructor(private world: World) {
    this.rng = new RNG(world.seed * 211 + 5);
    const [F, R] = jaguarBodyHalves();
    const [lu, ll, pw] = legParts(JAG_DIMS, 0x2a1c12);
    const n = 4;
    this.meshes.add('jag_F', F, n);
    this.meshes.add('jag_R', R, n);
    this.meshes.add('jag_head', jaguarHead(), n);
    this.meshes.add('jag_tail0', tailPiece(JAG_DIMS.tailLen[0], 0.024, 0.018), n);
    this.meshes.add('jag_tail1', tailPiece(JAG_DIMS.tailLen[1], 0.018, 0.014, 0x1c140e), n);
    this.meshes.add('jag_legU', lu, n * 4);
    this.meshes.add('jag_legL', ll, n * 4);
    this.meshes.add('jag_paw', pw, n * 4);
    this.spawn();
  }

  private spawn(): void {
    const w = this.world;
    const dens: { x: number; z: number; r: number }[] = [];
    const m = w.meadow;
    const pick = (ok: (i: number, x: number, z: number) => boolean) => {
      let best: { x: number; z: number; r: number } | null = null, bs = -Infinity;
      for (let k = 0; k < 4000; k++) {
        const cx = this.rng.int(2, w.N - 3), cz = this.rng.int(2, w.N - 3);
        const i = w.idx(cx, cz);
        const x = w.centerX(cx), z = w.centerZ(cz);
        if (!w.isLandCell(i) || !ok(i, x, z)) continue;
        if (dens.some((d) => Math.hypot(d.x - x, d.z - z) < 25)) continue;
        const s = w.forest[i] + this.rng.next() * 0.2;
        if (s > bs) {
          bs = s;
          best = { x, z, r: 11 };
        }
      }
      if (best) dens.push(best);
    };
    // One on the wild island, one in the main island's far jungle.
    pick((i) => w.isle[i] === 2 && w.forest[i] > 0.45);
    pick((i, x, z) => w.isle[i] === 1 && w.forest[i] > 0.4 && Math.hypot(x - m.x, z - m.z) > 42);
    while (dens.length < JAGUARS.count) {
      const before = dens.length;
      pick((_i, x, z) => Math.hypot(x - m.x, z - m.z) > 40);
      if (dens.length === before) break;
    }
    dens.slice(0, JAGUARS.count).forEach((den, id) => {
      const black = this.rng.chance(0.12);
      const coat = black ? 0x2e2824 : [0xd9a043, 0xcf9a3e, 0xe0ab52][id % 3];
      this.list.push({
        id, x: den.x, z: den.z, y: 0, heading: this.rng.range(0, 6.28), speed: 0, state: 'rest', timer: this.rng.range(10, 40), tx: den.x, tz: den.z,
        den, hunt: this.rng.range(JAGUARS.huntEvery[0], JAGUARS.huntEvery[1]) * (0.6 + id * 0.5), target: -1, stalkT: 0, resolved: false, recheck: 0,
        then: 'retreat', fightDog: -1, lungeT: 0, noticed: false, driven: false,
        color: new THREE.Color(coat), scale: this.rng.range(0.92, 1.08), gait: 0, prevHeading: 0, turn: 0, crouch: 0, lunge: 0, lie: 1, growl: 0, phase: this.rng.range(0, 10),
      });
    });
  }

  /** Jaguars out of their dens and heading for (or at) the village. */
  get hunting(): Jaguar[] {
    return this.list.filter((j) => j.state === 'stalk' || j.state === 'charge' || j.state === 'confront' || j.state === 'fight');
  }

  update(dt: number, night: boolean, villageCenter: { x: number; z: number } | null): void {
    this.time += dt;
    if (dt > 0 && this.hooks) for (const j of this.list) this.think(j, dt, night, villageCenter);
    this.draw(dt);
  }

  private retreat(j: Jaguar, driven: boolean): void {
    j.state = 'retreat';
    j.driven = driven;
    j.target = -1;
    j.fightDog = -1;
    j.tx = j.den.x + this.rng.range(-3, 3);
    j.tz = j.den.z + this.rng.range(-3, 3);
  }

  private pickTarget(j: Jaguar, maxD: number): Islander | null {
    let best: Islander | null = null, bs = Infinity;
    for (const i of this.hooks!.villagers()) {
      if (i.hidden || i.sleeping) continue;
      const d = Math.hypot(i.x - j.x, i.z - j.z);
      if (d > maxD) continue;
      // Stragglers are easier prey than villagers among the dogs and warriors.
      const guarded = this.dogs ? this.dogs.nearCount(i.x, i.z, 5) * 6 : 0;
      const s = d + guarded + (i.warrior ? 40 : 0) + (i.child ? -4 : 0);
      if (s < bs) {
        bs = s;
        best = i;
      }
    }
    return best;
  }

  private think(j: Jaguar, dt: number, night: boolean, center: { x: number; z: number } | null): void {
    const h = this.hooks!;
    const w = this.world;
    j.phase += dt;
    j.lunge = Math.max(0, j.lunge - dt * 2.2);
    j.growl = Math.max(0, j.growl - dt);
    let speed = 0;
    const tgt = j.target >= 0 ? h.byId(j.target) : undefined;
    switch (j.state) {
      case 'rest':
        j.timer -= dt;
        j.hunt -= dt * (night ? 2 : 1);
        if (j.timer <= 0) {
          j.state = 'prowl';
          j.timer = 0;
        }
        break;
      case 'prowl': {
        j.hunt -= dt * (night ? 2 : 1);
        if (j.hunt <= 0 && center) {
          const t = this.pickTarget(j, 130);
          if (t) {
            j.state = 'stalk';
            j.target = t.id;
            j.stalkT = JAGUARS.stalkTime;
            j.resolved = false;
            j.noticed = false;
            break;
          }
          j.hunt = 30;
        }
        if (steer(w, j, j.tx, j.tz, JAGUARS.prowlSpeed, dt, true, 0.3)) {
          if (this.rng.chance(0.35)) {
            j.state = 'rest';
            j.timer = this.rng.range(20, 60);
          } else {
            const a = this.rng.range(0, 6.28), r = Math.sqrt(this.rng.next()) * j.den.r;
            j.tx = j.den.x + Math.cos(a) * r;
            j.tz = j.den.z + Math.sin(a) * r;
          }
        } else speed = JAGUARS.prowlSpeed;
        break;
      }
      case 'stalk':
      case 'charge': {
        let t = tgt;
        if (!t || t.hidden) {
          t = this.pickTarget(j, j.state === 'charge' ? 12 : 60) ?? undefined;
          if (!t) {
            this.retreat(j, false);
            break;
          }
          j.target = t.id;
        }
        const d = Math.hypot(t.x - j.x, t.z - j.z);
        // Villagers only see it when it's close.
        if (!j.noticed) {
          for (const v of h.villagers()) {
            if (!v.hidden && Math.hypot(v.x - j.x, v.z - j.z) < JAGUARS.villagerNotice) {
              j.noticed = true;
              h.alarm(j.x, j.z, 11);
              h.danger(j, 'villagers');
              break;
            }
          }
        }
        if (this.confrontCheck(j, dt)) break;
        if (j.state === 'stalk') {
          // A long unseen lope through the jungle, then the slow crouched stalk for the last stretch.
          const far = d > 26;
          if (!far) j.stalkT -= dt;
          if (j.stalkT <= 0) {
            this.retreat(j, false);
            break;
          }
          if (far) {
            steer(w, j, t.x, t.z, JAGUARS.prowlSpeed * 2.2, dt, true);
            speed = JAGUARS.prowlSpeed * 2.2;
            break;
          }
          if (d < JAGUARS.chargeRange) {
            j.state = 'charge';
            h.sfx('growl', j.x, j.z);
            if (!j.noticed) {
              j.noticed = true;
              h.alarm(j.x, j.z, 11);
              h.danger(j, 'villagers');
            }
          }
          steer(w, j, t.x, t.z, JAGUARS.stalkSpeed, dt, true);
          speed = JAGUARS.stalkSpeed;
        } else {
          if (d < JAGUARS.pounceRange) {
            this.pounce(j, t);
            break;
          }
          steer(w, j, t.x, t.z, JAGUARS.chargeSpeed, dt, true);
          speed = JAGUARS.chargeSpeed;
        }
        break;
      }
      case 'confront': {
        // Crouched and snarling, facing the nearest dog.
        const d0 = this.dogs?.nearest(j.x, j.z, 6);
        if (d0) turnTo(j, Math.atan2(d0.x - j.x, d0.z - j.z), dt, 6);
        if (j.growl <= 0) {
          j.growl = 0.9 + this.rng.next() * 0.5;
          h.sfx('growl', j.x, j.z);
        }
        j.timer -= dt;
        if (j.timer <= 0) {
          if (j.then === 'retreat') this.retreat(j, true);
          else if (j.then === 'fight' && d0) {
            j.state = 'fight';
            j.fightDog = d0.id;
            j.timer = this.rng.range(2.5, 4.5);
            j.lungeT = 0.3;
          } else {
            j.state = tgt ? 'charge' : 'stalk';
            j.resolved = true;
            j.recheck = 7;
          }
        }
        break;
      }
      case 'fight': {
        let dog = this.dogs?.byId(j.fightDog);
        if (!dog || dog.state === 'dead') dog = this.dogs?.nearest(j.x, j.z, 5) ?? undefined;
        j.timer -= dt;
        if (!dog || j.timer <= 0) {
          // After the scuffle: usually slinks off, sometimes goes back for its prey.
          const n = this.dogs ? this.dogs.engaged(j, 4).length : 0;
          if (this.rng.next() < 0.55 + 0.1 * n || !tgt) this.retreat(j, true);
          else {
            j.state = 'charge';
            j.resolved = true;
            j.recheck = 7;
          }
          break;
        }
        j.fightDog = dog.id;
        const dd = Math.hypot(dog.x - j.x, dog.z - j.z);
        turnTo(j, Math.atan2(dog.x - j.x, dog.z - j.z), dt, 8);
        j.lungeT -= dt;
        if (j.lungeT <= 0) {
          j.lungeT = this.rng.range(0.8, 1.3);
          j.lunge = 1;
          h.sfx('growl', j.x, j.z);
          if (dd < 1.4) this.dogs!.lungedAt(dog, j);
        } else if (dd > 1.0) {
          steer(w, j, dog.x, dog.z, 1.6, dt, true, 0.9);
          speed = 1.6;
        }
        break;
      }
      case 'retreat': {
        if (steer(w, j, j.tx, j.tz, JAGUARS.retreatSpeed, dt, true, 0.6)) {
          j.state = 'rest';
          j.timer = this.rng.range(30, 70);
          j.hunt = this.rng.range(JAGUARS.huntEvery[0], JAGUARS.huntEvery[1]) * (j.driven ? 1.35 : 1);
        } else speed = Math.hypot(j.tx - j.x, j.tz - j.z) > j.den.r ? JAGUARS.retreatSpeed : JAGUARS.prowlSpeed * 1.4;
        break;
      }
    }
    j.speed += (speed - j.speed) * Math.min(1, dt * 5);
    const crouchT = j.state === 'stalk' && j.speed < 1.3 ? 1 : j.state === 'confront' ? 0.7 : j.state === 'fight' ? 0.4 : 0;
    j.crouch += (crouchT - j.crouch) * Math.min(1, dt * 4);
    j.lie += ((j.state === 'rest' ? 1 : 0) - j.lie) * Math.min(1, dt * 2);
    const gh = w.heightAt(j.x, j.z);
    const ci = w.cellIndexAt(j.x, j.z);
    // Swimming: only the head and back show above the water.
    j.y = ci >= 0 && w.bridge[ci] ? Math.max(gh, 0.3) : gh < -0.05 ? -0.17 * j.scale : gh;
  }

  /** Dogs (and warriors) in its face: decide whether it backs off, snarls, fights or presses on. */
  private confrontCheck(j: Jaguar, dt: number): boolean {
    if (j.resolved) {
      j.recheck -= dt;
      if (j.recheck > 0) return false;
      j.resolved = false;
    }
    const dogs = this.dogs ? this.dogs.engaged(j, 3.4) : [];
    const warriors = this.hooks!.villagers().filter((v) => v.warrior && !v.hidden && Math.hypot(v.x - j.x, v.z - j.z) < 6).length;
    if (!dogs.length && !warriors) return false;
    const nEff = dogs.length + warriors * JAGUARS.warriorAsDogs;
    const pRetreat = Math.min(JAGUARS.retreatMax, JAGUARS.retreatBase + JAGUARS.retreatPerDog * nEff);
    j.resolved = true;
    j.recheck = 7;
    if (this.rng.next() < pRetreat) {
      if (this.rng.chance(0.5)) {
        j.state = 'confront';
        j.then = 'retreat';
        j.timer = this.rng.range(1.4, 2.6);
      } else {
        this.hooks!.sfx('growl', j.x, j.z);
        this.retreat(j, true);
      }
      return true;
    }
    if (dogs.length && this.rng.next() < JAGUARS.fightShare) {
      j.state = 'confront';
      j.then = 'fight';
      j.timer = this.rng.range(0.6, 1.2);
      return true;
    }
    // Presses on toward its prey regardless.
    return false;
  }

  /** Leaping on its prey: a dog may throw itself in the way; otherwise the villager is caught. */
  private pounce(j: Jaguar, t: Islander): void {
    const h = this.hooks!;
    j.lunge = 1;
    h.sfx('growl', j.x, j.z);
    const close = this.dogs ? this.dogs.engaged(j, 2.4) : [];
    for (const d of close) {
      if (this.rng.next() < JAGUARS.interceptChance * (d.owner === t.id ? 1.4 : 1)) {
        this.dogs!.lungedAt(d, j, true);
        if (this.rng.next() < 0.7) this.retreat(j, true);
        else {
          j.state = 'charge';
          j.resolved = true;
          j.recheck = 6;
        }
        return;
      }
    }
    const guarded = (this.dogs?.nearCount(t.x, t.z, 6) ?? 0) > 0 || h.villagers().some((v) => v.warrior && Math.hypot(v.x - t.x, v.z - t.z) < 6);
    const killed = !h.godMode() && this.rng.next() < JAGUARS.killChance * (guarded ? 0.5 : 1);
    h.maul(t, killed);
    this.retreat(j, false);
  }

  // ---------------- Picking / info ----------------

  pick(camera: THREE.Camera, sx: number, sy: number, rect: DOMRect, radius = 22): Jaguar | null {
    const v = new THREE.Vector3();
    let best: Jaguar | null = null, bd = radius * radius;
    for (const j of this.list) {
      v.set(j.x, j.y + 0.25, j.z).project(camera);
      if (v.z > 1) continue;
      const px = (v.x * 0.5 + 0.5) * rect.width + rect.left, py = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      const d = (px - sx) ** 2 + (py - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    return best;
  }

  describe(j: Jaguar): string {
    return STATE_TEXT[j.state];
  }

  // ---------------- Drawing ----------------

  private pose = blankPose();

  private draw(dt: number): void {
    const m = this.meshes;
    m.begin();
    const p = this.pose;
    for (const j of this.list) {
      if (!View.sees(j.x, j.y + 0.2, j.z, 0.7)) continue;
      const fast = j.speed > 1.8;
      j.gait = stepGait(j.gait, j.speed, dt, JAG_DIMS, fast);
      let dh = j.heading - j.prevHeading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      j.prevHeading = j.heading;
      if (dt > 0) j.turn += (THREE.MathUtils.clamp(dh / dt, -4, 4) - j.turn) * Math.min(1, dt * 6);
      const t = j.phase;
      p.x = j.x;
      p.y = j.y;
      p.z = j.z;
      p.heading = j.heading;
      p.scale = j.scale;
      p.gait = j.gait;
      p.gallop = fast;
      p.amp = j.speed > 0.05 ? (fast ? 0.75 : 0.36) * Math.min(1, j.speed + 0.3) : 0;
      p.bend = THREE.MathUtils.clamp(j.turn * 0.12, -0.35, 0.35);
      p.sit = 0;
      p.lie = j.lie;
      p.crouch = j.crouch;
      p.lunge = j.lunge;
      p.limp = 0;
      // Head low and level when stalking, snarling jerks when growling, resting head on paws.
      p.headPitch = j.crouch * 0.18 + j.lie * 0.35 + (j.growl > 0 ? Math.sin(t * 22) * 0.05 : 0) - j.lunge * 0.2;
      p.headYaw = j.state === 'rest' || j.state === 'prowl' ? Math.sin(t * 0.4) * 0.35 : 0;
      // Tail: hangs and swings, lashes when agitated, straight out behind when running.
      const agit = j.state === 'confront' || j.state === 'fight' || j.state === 'stalk';
      p.tailPitch = fast ? 0.12 : -0.95 + j.lie * 0.7;
      p.tailYaw = Math.sin(t * (agit ? 5 : 1.1)) * (agit ? 0.5 : 0.25);
      p.tailCurl = fast ? 0.05 : 0.95 + Math.sin(t * 0.9) * 0.2;
      p.bob = j.speed > 0.05 ? Math.abs(Math.sin(j.gait * Math.PI * 4)) * (fast ? 0.03 : 0.008) : Math.sin(t * 1.6) * 0.002;
      drawQuad(m, { F: 'jag_F', R: 'jag_R', head: 'jag_head', tail0: 'jag_tail0', tail1: 'jag_tail1', legU: 'jag_legU', legL: 'jag_legL', paw: 'jag_paw' }, JAG_DIMS, p, j.color);
    }
    m.end();
  }
}

export type { Dog };
