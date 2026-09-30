import * as THREE from 'three';
import { View } from '../render/View';
import { DEFENCE, JAGUARS } from '../config';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import type { Dog, Dogs } from './Dogs';
import { Islander } from './Islander';
import {
  JAG_DIMS, JAG_EAR, QuadKeys, QuadMeshes, blankPose, drawQuad, envelope, idleHash, jaguarBodyHalves, jaguarEar, jaguarHead, jaguarJaw, jaguarNeck, jaguarTail, legParts, smooth, stepGait,
} from './quadRig';
import { steer, turnTo } from './steer';

/** Selection ids for jaguars (animals, monkeys and dogs have their own ranges). */
export const JAG_BASE = 3_000_000;

type JState = 'rest' | 'prowl' | 'stalk' | 'charge' | 'confront' | 'fight' | 'retreat' | 'dead' | 'arrive';

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
  /** Arrow hits it can still take; lying dead (0..1, then sinking away). */
  hp: number;
  flat: number;
  /** A newcomer still out in the water (it hasn't yet come ashore). */
  swimming: boolean;
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
  /** A new jaguar has swum over from beyond the map and come ashore (optional). */
  arrived?: (j: Jaguar) => void;
}

const STATE_TEXT: Record<JState, string> = {
  rest: 'Resting in the shade', prowl: 'Prowling its territory', stalk: 'Stalking toward the village', charge: 'Charging!',
  confront: 'Snarling at the dogs', fight: 'Fighting the dogs', retreat: 'Retreating into the jungle',
  dead: 'Brought down by the watchtower archer', arrive: 'Swimming over from the mainland',
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
  /** Dens waiting for a new jaguar (one killed there), and when it sets out from beyond the map. */
  private pending: { den: { x: number; z: number; r: number }; at: number }[] = [];
  private nextId = 0;

  constructor(private world: World) {
    this.rng = new RNG(world.seed * 211 + 5);
    const [F, R] = jaguarBodyHalves();
    const n = Math.max(4, JAGUARS.count);
    // Pale belly, chin and whisker pads are markings: cream on a golden cat, dark on a black one.
    this.meshes.add('jag_F', F, n, true);
    this.meshes.add('jag_R', R, n, true);
    this.meshes.add('jag_neck', jaguarNeck(), n, true);
    this.meshes.add('jag_head', jaguarHead(), n, true);
    this.meshes.add('jag_jaw', jaguarJaw(), n, true);
    this.meshes.add('jag_ear', jaguarEar(), n * 2, true);
    jaguarTail().forEach((g, i) => this.meshes.add(`jag_tail${i}`, g, n));
    const legs = legParts(JAG_DIMS, 0x2a1c12, true);
    ['jag_legUF', 'jag_legLF', 'jag_pawF', 'jag_legUH', 'jag_legLH', 'jag_pawH'].forEach((k, i) => this.meshes.add(k, legs[i], n * 2));
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
    dens.slice(0, JAGUARS.count).forEach((den, id) => this.list.push(this.make(den, den.x, den.z, id)));
  }

  private make(den: { x: number; z: number; r: number }, x: number, z: number, k: number): Jaguar {
    const id = this.nextId++;
    const black = this.rng.chance(0.12);
    const coat = black ? 0x2e2824 : [0xd9a043, 0xcf9a3e, 0xe0ab52][id % 3];
    return {
      id, x, z, y: this.world.heightAt(x, z), heading: this.rng.range(0, 6.28), speed: 0, state: 'rest', timer: this.rng.range(10, 40), tx: den.x, tz: den.z,
      den, hunt: this.rng.range(JAGUARS.huntEvery[0], JAGUARS.huntEvery[1]) * (0.6 + k * 0.5), target: -1, stalkT: 0, resolved: false, recheck: 0,
      then: 'retreat', fightDog: -1, lungeT: 0, noticed: false, driven: false,
      color: new THREE.Color(coat), scale: this.rng.range(0.92, 1.08), gait: 0, prevHeading: 0, turn: 0, crouch: 0, lunge: 0, lie: 1, growl: 0, phase: this.rng.range(0, 10),
      hp: DEFENCE.jaguarHits, flat: 0, swimming: false,
    };
  }

  /**
   * Where a new jaguar sets out from: out at sea beyond the edge of the map nearest its den (the
   * island's jaguars never die out: others swim over from the mainland to take a dead one's place).
   */
  offMapStart(den: { x: number; z: number }): { x: number; z: number } {
    const H = this.world.half, out = H * 1.1;
    // The nearest edge, a little way along it at random.
    const ax = Math.abs(den.x), az = Math.abs(den.z);
    const along = THREE.MathUtils.clamp((ax > az ? den.z : den.x) + this.rng.range(-12, 12), -H * 0.8, H * 0.8);
    return ax > az ? { x: Math.sign(den.x || 1) * out, z: along } : { x: along, z: Math.sign(den.z || 1) * out };
  }

  /** Jaguars an archer may shoot at: alive and on the island. */
  get targets(): Jaguar[] {
    return this.list.filter((j) => j.state !== 'dead' && this.world.cellIndexAt(j.x, j.z) >= 0);
  }

  /**
   * Struck by an arrow: it snarls and bolts for its den, or falls dead after enough hits (and
   * another jaguar will come over from beyond the map to take its den, after a while).
   */
  hitByArrow(j: Jaguar): 'hurt' | 'killed' {
    if (j.state === 'dead') return 'killed';
    j.hp--;
    j.growl = 0.8;
    this.hooks?.sfx('growl', j.x, j.z);
    if (j.hp > 0) {
      this.retreat(j, true);
      return 'hurt';
    }
    j.state = 'dead';
    j.timer = 14;
    j.target = -1;
    j.fightDog = -1;
    this.pending.push({ den: j.den, at: this.time + this.rng.range(DEFENCE.respawn[0], DEFENCE.respawn[1]) });
    return 'killed';
  }

  /** Jaguars out of their dens and heading for (or at) the village. */
  get hunting(): Jaguar[] {
    return this.list.filter((j) => j.state === 'stalk' || j.state === 'charge' || j.state === 'confront' || j.state === 'fight');
  }

  update(dt: number, night: boolean, villageCenter: { x: number; z: number } | null): void {
    this.time += dt;
    if (dt > 0 && this.hooks) for (const j of this.list) this.think(j, dt, night, villageCenter);
    // The dead sink away; newcomers set out from beyond the map for the empty dens.
    this.list = this.list.filter((j) => j.state !== 'dead' || j.timer > 0);
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const p = this.pending[k];
      if (this.time < p.at) continue;
      this.pending.splice(k, 1);
      const s = this.offMapStart(p.den);
      const j = this.make(p.den, s.x, s.z, 1);
      j.state = 'arrive';
      j.swimming = true;
      j.lie = 0;
      j.heading = Math.atan2(p.den.x - s.x, p.den.z - s.z);
      this.list.push(j);
    }
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
      // Indoors, asleep, or sheltering in the Great Hall: out of reach.
      if (i.hidden || i.sleeping || i.safe) continue;
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
      case 'dead':
        // Falls on its side, lies a while, then sinks away into the undergrowth.
        j.timer -= dt;
        j.flat = Math.min(1, j.flat + dt * 2.5);
        j.lie = 0;
        break;
      case 'arrive': {
        // Swimming in from the open sea, then padding up to its new den. Off the map there's no
        // ground to steer by: it heads straight in.
        if (w.cellIndexAt(j.x, j.z) < 0) {
          const a = Math.atan2(j.tx - j.x, j.tz - j.z);
          turnTo(j, a, dt, 3);
          j.x += Math.sin(j.heading) * JAGUARS.prowlSpeed * 1.3 * dt;
          j.z += Math.cos(j.heading) * JAGUARS.prowlSpeed * 1.3 * dt;
          speed = JAGUARS.prowlSpeed * 1.3;
        } else {
          if (steer(w, j, j.tx, j.tz, JAGUARS.prowlSpeed * 1.3, dt, true, 1.2)) {
            j.state = 'rest';
            j.timer = this.rng.range(20, 50);
          } else speed = JAGUARS.prowlSpeed * 1.3;
          if (j.swimming && w.heightAt(j.x, j.z) > 0.05) {
            j.swimming = false;
            h.arrived?.(j);
          }
        }
        break;
      }
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
        if (!t || t.hidden || t.safe) {
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
    const ci = w.cellIndexAt(j.x, j.z);
    const gh = ci >= 0 ? w.heightAt(j.x, j.z) : -3;
    // Swimming: only the head and back show above the water.
    j.y = ci >= 0 && w.bridge[ci] ? Math.max(gh, 0.3) : gh < -0.05 ? -0.17 * j.scale : gh;
    if (j.state === 'dead') j.y -= Math.max(0, 3 - j.timer) * 0.12;
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
  private keys: QuadKeys = {
    F: 'jag_F', R: 'jag_R', neck: 'jag_neck', head: 'jag_head', jaw: 'jag_jaw', ear: 'jag_ear', earPos: JAG_EAR.pos, earRest: JAG_EAR.rest,
    tail: ['jag_tail0', 'jag_tail1', 'jag_tail2'], legUF: 'jag_legUF', legLF: 'jag_legLF', pawF: 'jag_pawF', legUH: 'jag_legUH', legLH: 'jag_legLH', pawH: 'jag_pawH',
  };

  private draw(dt: number): void {
    const m = this.meshes;
    m.begin();
    const p = this.pose;
    for (const j of this.list) {
      if (!View.sees(j.x, j.y + 0.2, j.z, 0.7)) continue;
      const spd = j.speed;
      j.gait = stepGait(j.gait, spd, dt, JAG_DIMS, j.scale);
      let dh = j.heading - j.prevHeading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      j.prevHeading = j.heading;
      if (dt > 0) j.turn += (THREE.MathUtils.clamp(dh / dt, -4, 4) - j.turn) * Math.min(1, dt * 6);
      const t = j.phase;
      const G = j.gait * Math.PI * 2;
      const run = smooth(1.6, 2.6, spd);
      const agit = j.state === 'confront' || j.state === 'fight';
      const stalk = j.state === 'stalk' ? j.crouch : 0;
      p.x = j.x;
      p.y = j.y;
      p.z = j.z;
      p.heading = j.heading;
      p.scale = j.scale;
      p.gait = j.gait;
      p.speed = spd;
      p.bend = THREE.MathUtils.clamp(j.turn * 0.12, -0.35, 0.35);
      p.sit = 0;
      p.lie = j.lie;
      p.curl = 0;
      p.flat = j.flat;
      p.crouch = j.crouch;
      p.lunge = j.lunge;
      p.limp = 0;
      p.wiggle = 0;
      p.bob = 0;
      // Snarling: back hunched a little; stalking: long and level.
      p.spine = j.state === 'confront' ? 0.08 : 0;
      p.ovLeg = -1;
      p.ovW = 0;

      // ---- Head: low and locked on when stalking, snarling at dogs, looking about when at ease ----
      let neck = stalk * 0.3 + run * 0.1;
      let hp = stalk * 0.05 - j.lunge * 0.3 + j.lie * 0.1;
      let hy = j.state === 'rest' || j.state === 'prowl' ? Math.sin(t * 0.4) * 0.35 : 0;
      let jaw = j.lunge * 0.6;
      if (j.growl > 0) {
        jaw += 0.3 + Math.sin(t * 22) * 0.08;
        hp += Math.sin(t * 22) * 0.04;
      }
      if (agit) {
        jaw += 0.12;
        neck += 0.15;
        hp -= 0.1;
      }
      let ears = stalk * 0.2 - (agit ? 0.8 : 0) - run * 0.4;
      p.breath = run > 0.5 ? 0 : j.lie > 0.5 ? Math.sin(t * 1.3) * 0.025 : Math.sin(t * 2) * 0.012;

      // ---- Resting idles: licking a paw, yawning, looking round, dozing with the head on the paws ----
      if (j.lie > 0.8) {
        const wt = t + j.id * 3.1, wk = Math.floor(wt / JAG_IDLE_WINDOW), u = wt - wk * JAG_IDLE_WINDOW;
        const h = idleHash(wk, j.id + 100);
        if (h < 0.25) {
          const e = envelope(u, 0.5, 5.5, 0.6);
          p.ovLeg = 0;
          p.ovW = e * j.lie;
          p.ov[0] = -1.6;
          p.ov[1] = -1.3;
          p.ov[2] = 0.6 + Math.sin(t * 9) * 0.1;
          neck += 0.3 * e;
          hp += (0.45 + Math.sin(t * 9) * 0.12) * e;
          hy += (0.25 - hy) * e;
          jaw += (0.18 + Math.sin(t * 9) * 0.1) * e;
        } else if (h < 0.45) {
          const e = envelope(u, 0.6, 2.8, 0.6);
          jaw += 0.95 * e;
          hp -= 0.5 * e;
          neck -= 0.2 * e;
          ears -= 0.5 * e;
        } else if (h < 0.7) {
          const e = envelope(u, 0.4, 6);
          neck -= 0.35 * e;
          hp -= 0.2 * e;
          hy += Math.sin(t * 0.7) * 0.5 * e;
        } else {
          const e = envelope(u, 0.5, 6.5, 0.8);
          neck += 0.25 * e;
          hp += 0.2 * e;
          hy *= 1 - e;
        }
      }
      p.neck = neck;
      p.headPitch = hp;
      p.headYaw = hy;
      p.headRoll = j.lie > 0.8 ? Math.sin(t * 0.23 + j.id) * 0.12 : 0;
      p.jaw = Math.min(1, jaw);
      p.earL = ears + this.flick(t, j.id, 0) * -0.6;
      p.earR = ears + this.flick(t, j.id, 1) * -0.6;
      p.earYaw = agit ? 0.35 : 0;

      // ---- Tail: a low J swinging with the stride; straight and still with a twitching tip when
      // stalking; lashing when angry; streaming out behind at a run; curled round when resting ----
      let tp0 = -0.95, tp1 = 0.55, tp2 = 0.5, amp = 0.22, ph = spd > 0.05 ? G : t * 1.1;
      if (agit) {
        tp0 = -0.8;
        tp1 = 0.4;
        tp2 = 0.4;
        amp = 0.5;
        ph = t * 5;
      }
      tp0 = THREE.MathUtils.lerp(tp0, -0.55, stalk);
      tp1 = THREE.MathUtils.lerp(tp1, 0.12, stalk);
      tp2 = THREE.MathUtils.lerp(tp2, 0.08, stalk);
      amp = THREE.MathUtils.lerp(amp, 0.05, stalk);
      tp0 = THREE.MathUtils.lerp(tp0, -0.15 + 0.2 * Math.sin(G - 1), run);
      tp1 = THREE.MathUtils.lerp(tp1, 0.08 + 0.15 * Math.sin(G - 1.8), run);
      tp2 = THREE.MathUtils.lerp(tp2, 0.15 + 0.12 * Math.sin(G - 2.6), run);
      amp *= 1 - run * 0.7;
      const flickTip = this.flick(t * (stalk > 0.5 ? 2.2 : 1), j.id, 2);
      const tipYaw = flickTip * Math.sin(t * 25) * 0.55;
      const lie = j.lie;
      p.tailP[0] = THREE.MathUtils.lerp(tp0, -0.35, lie);
      p.tailP[1] = THREE.MathUtils.lerp(tp1, 0.15, lie);
      p.tailP[2] = THREE.MathUtils.lerp(tp2, 0.2, lie) + flickTip * 0.4;
      p.tailY[0] = THREE.MathUtils.lerp(amp * Math.sin(ph), 0.55, lie);
      p.tailY[1] = THREE.MathUtils.lerp(amp * Math.sin(ph - 0.9), 0.45, lie);
      p.tailY[2] = THREE.MathUtils.lerp(amp * Math.sin(ph - 1.8), 0.45 + Math.sin(t * 0.8) * 0.25, lie) + tipYaw;
      drawQuad(m, this.keys, JAG_DIMS, p, j.color, JAG_HEAD_SCALE, j.color.r < 0.3 ? JAG_MARK_BLACK : JAG_MARK);
    }
    m.end();
  }

  /** A quick twitch now and then (0..1 pulse) for an ear or the tail tip. */
  private flick(t: number, id: number, k: number): number {
    const x = t * 0.31 + id * 2.3 + k * 0.7, n = Math.floor(x);
    return idleHash(n, id * 3 + k) < 0.3 ? envelope((x - n) * 2.7, 0.2, 0.7, 0.2) : 0;
  }
}

/** Marking colours (belly, chin, muzzle): cream on a golden jaguar, near-coat on a black one. */
const JAG_MARK = new THREE.Color(0xeee0c2);
const JAG_MARK_BLACK = new THREE.Color(0x3a322c);
/** Seconds between resting fidget choices. */
const JAG_IDLE_WINDOW = 7;
/** Jaguars get a big, broad head. */
const JAG_HEAD_SCALE = 1.12;

export type { Dog };
