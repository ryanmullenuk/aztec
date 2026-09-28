import * as THREE from 'three';
import { View } from '../render/View';
import { DOGS, FOOD_KEYS, JAGUARS, ResourceKey } from '../config';
import { Building, BuildingSystem } from '../buildings/Buildings';
import { Economy } from '../economy/Economy';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { Islander } from './Islander';
import type { Jaguar, Jaguars } from './Jaguars';
import {
  DOG_DIMS, DOG_EARS, QuadDyn, QuadKeys, QuadMeshes, blankPose, dogBodyParts, dogEar, dogHead, dogJaw, dogLegParts, dogNeckParts, dogTail, dogTongue, drawQuad, envelope, idleHash,
  smooth, stepGait,
} from './quadRig';
import { steer, turnTo, walkable } from './steer';

export const DOG_BASE = 2_000_000;

export type DogRole = 'roam' | 'guard';
type DState =
  | 'stand' | 'walk' | 'sit' | 'lie' | 'sleep' | 'follow' | 'sniff' | 'zoom' | 'social' | 'return'
  | 'alert' | 'chase' | 'intercept' | 'fight' | 'yelp' | 'hide' | 'dead';

export interface Dog {
  id: number;
  name: string;
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  state: DState;
  timer: number;
  tx: number;
  tz: number;
  coat: number;
  color: THREE.Color;
  tri: boolean;
  ears: 'prick' | 'floppy';
  scale: number;
  puppy: boolean;
  age: number;
  kennel: number;
  /** Islander this dog has attached itself to (-1 none). */
  owner: number;
  hunger: number;
  injured: number;
  /** Who/what it's paying attention to: islander to follow, dog to greet, animal to sniff. */
  follow: number;
  buddy: number;
  sniffX: number;
  sniffZ: number;
  jaguar: number;
  bark: number;
  barkCool: number;
  /** Alert has been passed on (rallied other dogs, warned the village). */
  raised: boolean;
  calm: number;
  gait: number;
  prevHeading: number;
  turn: number;
  sit: number;
  lie: number;
  crouch: number;
  lunge: number;
  headYaw: number;
  phase: number;
  /** Panting after a run (drawing only, 0..1). */
  pant: number;
  /** Waypoints for a long walk home, and where along them it is. */
  route: { x: number; z: number }[] | null;
  routeIdx: number;
  /** Drawing-only animation state (springs, stretch and shake timers); never saved. */
  anim?: DogAnim;
}

/** Per-dog animation state kept between frames for drawing. */
interface DogAnim {
  dyn: QuadDyn;
  /** View frame it was last drawn in (the springs reset after time off screen). */
  frame: number;
  /** Lying weight last frame, to catch the dog getting up (it stretches, then may shake off). */
  prevLie: number;
  stretch: number;
  shake: number;
  shakePh: number;
}

/** Coat colours: tan, brown, dark brown, black, cream. */
const COATS = [0xc89a64, 0x8a5a34, 0x4e3222, 0x262220, 0xe6d6b4];
const COAT_W = [3, 3, 2, 2, 1.5];
const NAMES = ['Itzcuin', 'Xolo', 'Tochtli', 'Chichi', 'Coyotl', 'Ozomatli', 'Cuetzpal', 'Mazatl', 'Tlaco', 'Ehecatl', 'Cipac', 'Tecolotl', 'Huitzil', 'Cozcatl', 'Nochtli', 'Xochi', 'Metztli', 'Tonal', 'Ayotl', 'Poctli'];

export interface DogHooks {
  villagers: () => Islander[];
  byId: (id: number) => Islander | undefined;
  /** Animals a dog might go and sniff at. */
  animals: () => { x: number; z: number }[];
  alarm: (x: number, z: number, r: number) => void;
  danger: (j: Jaguar, by: 'dogs' | 'villagers') => void;
  notify: (msg: string, kind?: 'info' | 'warn') => void;
  sfx: (name: string, x: number, z: number) => void;
  godMode: () => boolean;
  /** Grid path over land (for long trips home around coasts and buildings). */
  path: (x: number, z: number, tx: number, tz: number) => { x: number; z: number }[] | null;
  /** A pelican or heron on the ground nearby (dogs sometimes give chase). */
  birdNear: (x: number, z: number, r: number) => { x: number; z: number } | null;
}

const STATE_TEXT: Record<DState, string> = {
  stand: 'Looking around', walk: 'Trotting about the village', sit: 'Sitting', lie: 'Lying in the shade', sleep: 'Asleep',
  follow: 'Following', sniff: 'Sniffing at an animal', zoom: 'Racing about', social: 'Greeting another dog', return: 'Heading home',
  alert: 'Barking — a jaguar is near!', chase: 'Chasing off a jaguar', intercept: 'Running to protect a villager', fight: 'Fighting a jaguar',
  yelp: 'Yelping', hide: 'Hiding at the kennel', dead: 'Lying still',
};

/**
 * Village dogs: bred at kennels, living loosely around the houses, fires and villagers. Most of
 * the time they sit, doze and potter about; some attach themselves to a household. They smell
 * jaguars long before villagers see them, bark the alarm (rallying the other dogs), and go out
 * to drive the cat away, sometimes at a cost.
 */
export class Dogs {
  readonly meshes = new QuadMeshes();
  list: Dog[] = [];
  private rng: RNG;
  private nextId = 0;
  private time = 0;
  private foodTimer = 60;
  private starving = 0;
  /** The first kennel's two strays have arrived. */
  founded = false;
  jaguars: Jaguars | null = null;
  hooks: DogHooks | null = null;

  constructor(private world: World, private bld: BuildingSystem, private eco: Economy) {
    this.rng = new RNG(world.seed * 97 + 13);
    const n = DOGS.maxTotal + 4;
    // One set of meshes for every coat: markings (tricolour bib, socks, muzzle) take a second
    // per-dog colour, which for plain dogs is just the coat colour.
    const body = dogBodyParts();
    this.meshes.add('dog_F', body.chest, n, true);
    this.meshes.add('dog_M', body.loin, n, true);
    this.meshes.add('dog_R', body.pelvis, n, true);
    const [neck1, neck2] = dogNeckParts();
    this.meshes.add('dog_neck', neck1, n, true);
    this.meshes.add('dog_neck2', neck2, n, true);
    this.meshes.add('dog_head', dogHead(), n, true);
    this.meshes.add('dog_jaw', dogJaw(), n, true);
    this.meshes.add('dog_tongue', dogTongue(), n);
    this.meshes.add('dog_ear_prick', dogEar('prick'), n * 2);
    this.meshes.add('dog_ear_floppy', dogEar('floppy'), n * 2);
    dogTail().forEach((g, i) => this.meshes.add(`dog_tail${i}`, g, n, true));
    const legs = dogLegParts(0x2a2220);
    DOG_LEG_KEYS.forEach((k, i) => this.meshes.add(k, legs[i], n * 2, true));
  }

  // ---------------- Population ----------------

  kennels(): Building[] {
    return this.bld.list.filter((b) => b.key === 'kennel' && b.complete);
  }

  get capacity(): number {
    return Math.min(DOGS.maxTotal, this.kennels().length * DOGS.perKennel);
  }

  get alive(): Dog[] {
    return this.list.filter((d) => d.state !== 'dead');
  }

  of(k: Building): Dog[] {
    return this.alive.filter((d) => d.kennel === k.id);
  }

  /** Pending litters count toward the cap so breeding can't overshoot it. */
  private pending(): number {
    return this.kennels().filter((k) => k.breedT > 0).length;
  }

  role(d: Dog): DogRole {
    const k = this.bld.byId(d.kennel);
    return k?.dogRole ?? 'roam';
  }

  canBreed(k: Building): { ok: boolean; reason: string } {
    if (!k.complete) return { ok: false, reason: 'The kennel is not finished yet' };
    if (k.breedT > 0) return { ok: false, reason: 'A litter is already on the way' };
    if (k.breedCool > 0) return { ok: false, reason: `The dogs need a rest (${Math.ceil(k.breedCool)}s)` };
    if (this.alive.filter((d) => !d.puppy).length < 2) return { ok: false, reason: 'Needs at least two grown dogs' };
    if (this.alive.length + this.pending() >= this.capacity) return { ok: false, reason: 'No room: build another kennel' };
    if (!this.eco.godMode && this.eco.food < DOGS.breedFood) return { ok: false, reason: `Needs ${DOGS.breedFood} food` };
    return { ok: true, reason: '' };
  }

  breed(k: Building): string {
    const c = this.canBreed(k);
    if (!c.ok) return c.reason;
    this.takeFood(DOGS.breedFood);
    k.breedT = DOGS.gestation;
    return 'A litter is on the way at the kennel.';
  }

  /** Take food from the stores, meat and fish first. Returns how much was found. */
  private takeFood(n: number): number {
    if (this.eco.godMode) return n;
    let got = 0;
    const order: ResourceKey[] = ['meat', 'fish', 'grain', 'fruit'];
    for (const k of order) {
      if (!FOOD_KEYS.includes(k)) continue;
      const take = Math.min(this.eco.res[k], n - got);
      this.eco.res[k] -= take;
      got += take;
      if (got >= n - 1e-6) break;
    }
    return got;
  }

  /** A finished kennel: the very first one draws in two village strays. */
  onKennelBuilt(k: Building): void {
    if (this.founded) return;
    this.founded = true;
    for (let i = 0; i < DOGS.foundingDogs; i++) this.spawn(k, false, i);
    this.hooks?.notify('Two dogs have wandered in and made the new kennel their home.');
  }

  /** A demolished kennel: its dogs move to another kennel (or stay on as strays by the fire). */
  onKennelRemoved(k: Building): void {
    const other = this.kennels().find((b) => b.id !== k.id);
    for (const d of this.list) if (d.kennel === k.id) d.kennel = other ? other.id : -1;
  }

  /** A villager died or left: their dog is free again. */
  onVillagerGone(id: number): void {
    for (const d of this.list) {
      if (d.owner === id) d.owner = -1;
      if (d.follow === id) d.follow = -1;
    }
  }

  private spawn(k: Building, puppy: boolean, i = 0): Dog {
    const r = this.rng;
    let tot = COAT_W.reduce((a, b) => a + b, 0), pick = r.next() * tot, coat = 0;
    for (let c = 0; c < COATS.length; c++) if ((pick -= COAT_W[c]) <= 0) {
      coat = c;
      break;
    }
    const col = new THREE.Color(COATS[coat]).offsetHSL(r.range(-0.015, 0.015), r.range(-0.05, 0.05), r.range(-0.04, 0.04));
    const used = new Set(this.list.map((d) => d.name));
    const free = NAMES.filter((n) => !used.has(n));
    const name = free.length ? free[r.int(0, free.length - 1)] : NAMES[r.int(0, NAMES.length - 1)];
    const a = r.range(0, 6.28) + i * 1.3;
    const d: Dog = {
      id: this.nextId++, name, x: k.x + Math.cos(a) * 0.9, z: k.z + Math.sin(a) * 0.9 + 0.8, y: k.y, heading: r.range(0, 6.28), speed: 0,
      state: 'sit', timer: r.range(3, 8), tx: k.x, tz: k.z, coat, color: col, tri: coat !== 4 && r.chance(0.4), ears: r.chance(0.6) ? 'prick' : 'floppy',
      scale: r.range(0.88, 1.12), puppy, age: 0, kennel: k.id, owner: -1, hunger: 1, injured: 0, follow: -1, buddy: -1, sniffX: 0, sniffZ: 0,
      jaguar: -1, bark: 0, barkCool: 0, raised: false, calm: 0, gait: r.next(), prevHeading: 0, turn: 0, sit: 1, lie: 0, crouch: 0, lunge: 0, headYaw: 0, phase: r.range(0, 10), pant: 0, route: null, routeIdx: 0,
    };
    if (!puppy) this.maybeAttach(d);
    this.list.push(d);
    return d;
  }

  /** Grown dogs sometimes adopt a household (preferring homes without a dog). */
  private maybeAttach(d: Dog): void {
    if (!this.hooks || !this.rng.chance(DOGS.attachChance)) return;
    const taken = new Set(this.list.map((o) => o.owner));
    const cand = this.hooks.villagers().filter((v) => !v.child && v.home >= 0 && !taken.has(v.id));
    if (!cand.length) return;
    d.owner = cand[this.rng.int(0, cand.length - 1)].id;
  }

  // ---------------- Places ----------------

  /** Where this dog calls home: outside its villager's house, else its kennel, else the fire. */
  private home(d: Dog): { x: number; z: number } {
    const h = this.hooks;
    if (d.owner >= 0 && !d.puppy && h) {
      const o = h.byId(d.owner);
      const b = o && o.home >= 0 ? this.bld.byId(o.home) : undefined;
      if (b && b.complete) return { x: b.door.x + Math.sin(d.phase) * 0.3, z: b.door.z + Math.cos(d.phase) * 0.3 };
    }
    const k = this.bld.byId(d.kennel);
    if (k) return { x: k.door.x, z: k.door.z };
    return this.center() ?? { x: d.x, z: d.z };
  }

  private center(): { x: number; z: number } | null {
    const fire = this.bld.list.find((b) => b.key === 'campfire');
    return fire ? { x: fire.x, z: fire.z } : null;
  }

  private range(d: Dog): number {
    if (d.puppy) return 7;
    return this.role(d) === 'guard' ? DOGS.guardRange : d.state === 'follow' ? DOGS.followRange : DOGS.roamRange;
  }

  // ---------------- Queries for the jaguars ----------------

  byId(id: number): Dog | undefined {
    return this.list.find((d) => d.id === id);
  }

  nearest(x: number, z: number, r: number): Dog | null {
    let best: Dog | null = null, bd = r;
    for (const d of this.list) {
      if (d.state === 'dead' || d.puppy) continue;
      const dd = Math.hypot(d.x - x, d.z - z);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return best;
  }

  nearCount(x: number, z: number, r: number): number {
    let n = 0;
    for (const d of this.list) if (d.state !== 'dead' && !d.puppy && d.injured <= 0 && Math.hypot(d.x - x, d.z - z) < r) n++;
    return n;
  }

  /** Dogs actively confronting this jaguar within range. */
  engaged(j: Jaguar, r: number): Dog[] {
    return this.list.filter((d) => (d.state === 'chase' || d.state === 'intercept' || d.state === 'alert' || d.state === 'fight') && d.jaguar === j.id && Math.hypot(d.x - j.x, d.z - j.z) < r);
  }

  /** The jaguar swipes at a dog: it gets away, is hurt, or is killed. */
  lungedAt(d: Dog, j: { x: number; z: number }, intercepting = false, by = 'the jaguar'): 'escape' | 'injured' | 'killed' {
    const h = this.hooks!;
    const r = this.rng.next();
    // Throwing itself in the way of a pounce is riskier than snapping at the jaguar's heels.
    const esc = intercepting ? JAGUARS.dogEscape - 0.15 : JAGUARS.dogEscape;
    const out: 'escape' | 'injured' | 'killed' = r < esc ? 'escape' : r < esc + JAGUARS.dogInjured ? 'injured' : 'killed';
    h.sfx('yelp', d.x, d.z);
    // Thrown back from the jaguar.
    const a = Math.atan2(d.x - j.x, d.z - j.z);
    d.x += Math.sin(a) * 0.5;
    d.z += Math.cos(a) * 0.5;
    if (out === 'killed') {
      d.state = 'dead';
      d.timer = 8;
      d.lie = 1;
      h.notify(by === 'the jaguar' ? `${d.name} the dog was killed by the jaguar while protecting the village.` : `${d.name} the dog was killed by ${by}.`, 'warn');
    } else if (out === 'injured') {
      d.injured = DOGS.injuredTime;
      d.state = 'yelp';
      d.timer = 1.2;
      h.notify(by === 'the jaguar' ? `${d.name} the dog was hurt fighting off the jaguar.` : `${d.name} the dog was bitten by ${by}.`, 'warn');
    } else {
      d.state = 'yelp';
      d.timer = 0.8;
    }
    return out;
  }

  // ---------------- Update ----------------

  update(dt: number, night: boolean): void {
    this.time += dt;
    if (dt > 0 && this.hooks) {
      this.breeding(dt);
      this.feeding(dt);
      for (const d of this.list) this.think(d, dt, night);
      // The dead are carried off after a while.
      this.list = this.list.filter((d) => d.state !== 'dead' || d.timer > 0);
    }
    this.draw(dt);
  }

  private breeding(dt: number): void {
    for (const k of this.kennels()) {
      if (k.breedCool > 0) k.breedCool = Math.max(0, k.breedCool - dt);
      if (k.breedT > 0) {
        k.breedT -= dt;
        if (k.breedT <= 0) {
          k.breedT = 0;
          k.breedCool = DOGS.breedCooldown;
          const p = this.spawn(k, true);
          this.hooks!.notify(`A puppy, ${p.name}, was born at the kennel.`);
        }
      }
    }
    for (const d of this.list) {
      if (!d.puppy || d.state === 'dead') continue;
      d.age += dt;
      if (d.age >= DOGS.puppyGrow) {
        d.puppy = false;
        this.maybeAttach(d);
      }
    }
  }

  /** Dogs eat a little from the stores each minute; go hungry long enough and one leaves. */
  private feeding(dt: number): void {
    this.foodTimer -= dt;
    if (this.foodTimer > 0) return;
    this.foodTimer = 60;
    const dogs = this.alive;
    if (!dogs.length) return;
    const need = dogs.reduce((s, d) => s + (d.puppy ? 0.5 : 1), 0) * DOGS.foodPerMinute;
    const got = this.takeFood(need);
    const fed = need > 0 ? got / need : 1;
    for (const d of dogs) d.hunger = Math.max(0, Math.min(1, d.hunger + (fed - 0.6) * 0.5));
    if (fed < 0.5) {
      this.starving += 60;
      if (this.starving >= DOGS.starveLeave) {
        this.starving = 0;
        const d = dogs.filter((x) => !x.puppy).sort((a, b) => a.hunger - b.hunger)[0] ?? dogs[0];
        this.list = this.list.filter((x) => x !== d);
        this.hooks!.notify(`${d.name} the dog went off into the jungle looking for food. Keep food in the stores to feed your dogs.`, 'warn');
      }
    } else this.starving = 0;
  }

  private jaguarNear(d: Dog): Jaguar | null {
    const J = this.jaguars;
    if (!J) return null;
    let best: Jaguar | null = null, bd = DOGS.detect * (d.state === 'sleep' ? 0.6 : 1);
    for (const j of J.list) {
      if (j.state === 'rest' || j.state === 'prowl') continue;
      const dd = Math.hypot(j.x - d.x, j.z - d.z);
      if (dd < bd) {
        bd = dd;
        best = j;
      }
    }
    return best;
  }

  private goTo(d: Dog, x: number, z: number, state: DState, timer: number): void {
    d.state = state;
    d.tx = x;
    d.tz = z;
    d.timer = timer;
    d.route = null;
    d.routeIdx = 0;
    // Long way home: take a proper path around coasts and buildings.
    if ((state === 'return' || state === 'hide') && Math.hypot(x - d.x, z - d.z) > 8 && this.hooks) {
      const p = this.hooks.path(d.x, d.z, x, z);
      if (p && p.length) {
        d.route = p;
        d.timer = Math.max(timer, p.length * 1.5);
      }
    }
  }

  /** Walk home along the route if there is one, else straight; true on arrival (near enough). */
  private walkHome(d: Dog, speed: number, dt: number): boolean {
    if (d.route && d.routeIdx < d.route.length) {
      const wp = d.route[d.routeIdx];
      if (steer(this.world, d, wp.x, wp.z, speed, dt, false, 0.35)) d.routeIdx++;
      return false;
    }
    // The door is right against the building: close is close enough.
    return steer(this.world, d, d.tx, d.tz, speed, dt, !d.route, 0.4) || Math.hypot(d.tx - d.x, d.tz - d.z) < 0.9;
  }

  private think(d: Dog, dt: number, night: boolean): void {
    const h = this.hooks!;
    const w = this.world;
    d.phase += dt;
    d.bark = Math.max(0, d.bark - dt);
    d.barkCool = Math.max(0, d.barkCool - dt);
    d.lunge = Math.max(0, d.lunge - dt * 2.5);
    if (d.injured > 0) d.injured = Math.max(0, d.injured - dt);
    let speed = 0;
    const walk = DOGS.walkSpeed * (d.puppy ? 0.8 : 1) * (d.injured > 0 ? 0.55 : 1);
    const run = DOGS.runSpeed * (d.puppy ? 0.7 : 1) * (d.injured > 0 ? 0.45 : 1);

    if (d.state === 'dead') {
      d.timer -= dt;
      d.speed = 0;
      return;
    }

    // ---- Danger first ----
    const jag = this.jaguarNear(d);
    const threat = d.state === 'alert' || d.state === 'chase' || d.state === 'intercept' || d.state === 'fight';
    if (jag && d.state !== 'yelp') {
      d.calm = 0;
      d.jaguar = jag.id;
      if (d.puppy) {
        // Puppies whimper and bolt for the kennel.
        if (d.state !== 'hide') {
          const k = this.bld.byId(d.kennel);
          this.goTo(d, k ? k.x : d.x, k ? k.z : d.z, 'hide', 20);
        }
      } else if (d.injured > 0) {
        if (d.state !== 'return') {
          const hm = this.home(d);
          this.goTo(d, hm.x, hm.z, 'return', 20);
        }
      } else if (!threat) {
        d.state = 'alert';
        d.timer = this.rng.range(0.7, 1.4);
        d.raised = false;
      }
    } else if (threat) {
      // Out of range: settle back down after a little while.
      d.calm += dt;
      if (d.calm > 3) {
        d.state = 'stand';
        d.timer = this.rng.range(2, 4);
        d.jaguar = -1;
      }
    }

    switch (d.state) {
      case 'alert': {
        const j = this.jaguars?.list.find((x) => x.id === d.jaguar);
        if (!j) break;
        turnTo(d, Math.atan2(j.x - d.x, j.z - d.z), dt, 8);
        this.barkNow(d);
        if (!d.raised) {
          d.raised = true;
          // Rally: nearby dogs hear the barking and join in; the village is warned.
          for (const o of this.list) {
            if (o === d || o.puppy || o.state === 'dead' || o.injured > 0) continue;
            if (Math.hypot(o.x - d.x, o.z - d.z) > DOGS.rally) continue;
            if (o.state === 'alert' || o.state === 'chase' || o.state === 'intercept' || o.state === 'fight') continue;
            o.state = 'alert';
            o.jaguar = j.id;
            o.timer = this.rng.range(0.6, 1.6);
            o.raised = true;
          }
          h.danger(j, 'dogs');
          h.alarm(j.x, j.z, 16);
        }
        d.timer -= dt;
        if (d.timer <= 0) {
          // Go between the jaguar and its prey if a villager is threatened nearby (their own person first).
          const prey = j.target >= 0 ? h.byId(j.target) : undefined;
          const own = d.owner >= 0 && prey && prey.id === d.owner;
          if (prey && !prey.hidden && Math.hypot(prey.x - d.x, prey.z - d.z) < (own ? 22 : 14) && this.rng.chance(own ? 0.95 : 0.7)) d.state = 'intercept';
          else d.state = 'chase';
          d.timer = 0;
        }
        break;
      }
      case 'intercept':
      case 'chase': {
        const j = this.jaguars?.list.find((x) => x.id === d.jaguar);
        if (!j) break;
        const dj = Math.hypot(j.x - d.x, j.z - d.z);
        let tx = j.x, tz = j.z;
        if (d.state === 'intercept') {
          const prey = j.target >= 0 ? h.byId(j.target) : undefined;
          if (prey && !prey.hidden) {
            // A point between the villager and the jaguar.
            tx = prey.x + (j.x - prey.x) * 0.4;
            tz = prey.z + (j.z - prey.z) * 0.4;
            if (Math.hypot(tx - d.x, tz - d.z) < 0.6) d.state = 'chase';
          } else d.state = 'chase';
        }
        if (d.state === 'chase' && dj < 1.5) {
          // Hold at snapping distance, dancing side to side and barking.
          const a = Math.atan2(d.x - j.x, d.z - j.z) + Math.sin(d.phase * 1.7 + d.id) * 0.9;
          tx = j.x + Math.sin(a) * 1.3;
          tz = j.z + Math.cos(a) * 1.3;
          if (this.rng.chance(dt * 0.8)) d.lunge = 1;
        }
        // Chased the jaguar far enough out of the village: let it go.
        const c = this.center();
        if (c && Math.hypot(d.x - c.x, d.z - c.z) > this.range(d) + 12 && j.state === 'retreat') {
          d.state = 'return';
          const hm = this.home(d);
          d.tx = hm.x;
          d.tz = hm.z;
          break;
        }
        steer(w, d, tx, tz, run, dt, false, 0.2);
        speed = Math.hypot(tx - d.x, tz - d.z) > 0.25 ? run : 0;
        if (speed === 0) turnTo(d, Math.atan2(j.x - d.x, j.z - d.z), dt, 8);
        if (dj < 4) this.barkNow(d);
        break;
      }
      case 'yelp': {
        d.timer -= dt;
        if (d.timer <= 0) {
          if (d.injured > 0) {
            const hm = this.home(d);
            this.goTo(d, hm.x, hm.z, 'return', 30);
          } else d.state = d.jaguar >= 0 ? 'chase' : 'stand';
        }
        break;
      }
      case 'hide':
      case 'return': {
        d.timer -= dt;
        if (d.timer <= 0) {
          // Couldn't find a way: give up and settle wherever it is.
          d.state = 'stand';
          d.timer = this.rng.range(2, 5);
          break;
        }
        if (this.walkHome(d, d.state === 'hide' || d.injured > 0 ? run : walk * 1.3, dt)) {
          d.state = d.state === 'hide' ? 'lie' : 'sit';
          d.timer = this.rng.range(8, 16);
        } else speed = d.state === 'hide' ? run : walk * 1.3;
        break;
      }
      default:
        speed = this.everyday(d, dt, night, walk, run);
    }
    d.speed += (speed - d.speed) * Math.min(1, dt * 6);
    const sitT = d.state === 'sit' || (d.state === 'social' && d.timer < 2.5 && d.speed < 0.1) || (d.state === 'follow' && d.speed < 0.05) ? 1 : 0;
    const lieT = d.state === 'lie' || d.state === 'sleep' ? 1 : 0;
    const crouchT = d.state === 'alert' ? 0.35 : d.state === 'chase' && d.speed < 0.3 ? 0.45 : 0;
    d.sit += (sitT - d.sit) * Math.min(1, dt * 4);
    d.lie += (lieT - d.lie) * Math.min(1, dt * 2.5);
    d.crouch += (crouchT - d.crouch) * Math.min(1, dt * 5);
    const ci = w.cellIndexAt(d.x, d.z);
    d.y = ci >= 0 && w.bridge[ci] ? Math.max(w.heightAt(d.x, d.z), 0.3) : Math.max(-0.1, w.heightAt(d.x, d.z));
  }

  private barkNow(d: Dog): void {
    if (d.barkCool > 0) return;
    d.barkCool = this.rng.range(0.45, 1.1);
    d.bark = 0.22;
    this.hooks!.sfx('bark', d.x, d.z);
  }

  /** Ordinary dog life: mostly resting, some pottering, following people and meeting other dogs. */
  private everyday(d: Dog, dt: number, night: boolean, walk: number, run: number): number {
    const h = this.hooks!;
    const w = this.world;
    const c = this.center();
    // Strayed too far: head back.
    const r = this.range(d);
    if (c && d.state !== 'return' && Math.hypot(d.x - c.x, d.z - c.z) > r + (d.state === 'follow' ? 6 : 0)) {
      const hm = this.home(d);
      this.goTo(d, hm.x, hm.z, 'return', 40);
      return walk;
    }
    d.timer -= dt;
    switch (d.state) {
      case 'walk':
        if (steer(w, d, d.tx, d.tz, walk, dt, false, 0.3) || d.timer <= 0) this.choose(d, night);
        else return walk;
        return 0;
      case 'zoom': {
        // Tearing around in loops, as dogs (especially puppies) do.
        const a = d.phase * 2.1 + d.id;
        const tx = d.tx + Math.cos(a) * 2.2, tz = d.tz + Math.sin(a * 1.3) * 1.8;
        steer(w, d, tx, tz, run * 0.85, dt, false, 0.2);
        if (d.timer <= 0) this.choose(d, night);
        return run * 0.85;
      }
      case 'follow': {
        const v = h.byId(d.follow);
        if (!v || v.hidden || d.timer <= 0) {
          this.choose(d, night);
          return 0;
        }
        const dd = Math.hypot(v.x - d.x, v.z - d.z);
        if (dd > 1.6) {
          const back = v.heading + Math.PI + (d.id % 2 ? 0.5 : -0.5);
          const fast = dd > 5;
          steer(w, d, v.x + Math.sin(back) * 0.9, v.z + Math.cos(back) * 0.9, fast ? run * 0.7 : walk * 1.25, dt, false, 0.3);
          return fast ? run * 0.7 : walk * 1.25;
        }
        turnTo(d, Math.atan2(v.x - d.x, v.z - d.z), dt, 3);
        return 0;
      }
      case 'sniff': {
        const dd = Math.hypot(d.sniffX - d.x, d.sniffZ - d.z);
        if (dd > 1.1 && d.timer > 0) {
          steer(w, d, d.sniffX, d.sniffZ, walk, dt, false, 1.0);
          return walk;
        }
        turnTo(d, Math.atan2(d.sniffX - d.x, d.sniffZ - d.z), dt, 4);
        if (d.timer <= 0) this.choose(d, night);
        return 0;
      }
      case 'social': {
        const o = this.byId(d.buddy);
        if (!o || o.state === 'dead' || d.timer <= 0) {
          this.choose(d, night);
          return 0;
        }
        const dd = Math.hypot(o.x - d.x, o.z - d.z);
        if (dd > 0.55) {
          steer(w, d, o.x, o.z, walk * 1.3, dt, false, 0.5);
          return walk * 1.3;
        }
        turnTo(d, Math.atan2(o.x - d.x, o.z - d.z) + Math.sin(d.phase * 3) * 0.6, dt, 5);
        return 0;
      }
      default:
        // Sitting, lying, sleeping, standing: wait out the timer, glancing around.
        if (d.state === 'stand' || d.state === 'sit') d.headYaw = Math.sin(d.phase * 0.5 + d.id) * 0.6;
        if (d.timer <= 0) this.choose(d, night);
        return 0;
    }
  }

  private choose(d: Dog, night: boolean): void {
    const h = this.hooks!;
    const r = this.rng;
    const hm = this.home(d);
    d.headYaw = 0;
    const near = (x: number, z: number, rad: number) => {
      for (let k = 0; k < 8; k++) {
        const a = r.range(0, 6.28), rr = Math.sqrt(r.next()) * rad;
        const tx = x + Math.cos(a) * rr, tz = z + Math.sin(a) * rr;
        if (walkable(this.world, tx, tz, false)) return { x: tx, z: tz };
      }
      return { x, z };
    };
    // Night: curl up by home (outside the house, the kennel or the fire).
    if (night && !d.puppy && r.chance(0.8)) {
      if (Math.hypot(hm.x - d.x, hm.z - d.z) > 1.2) this.goTo(d, hm.x, hm.z, 'return', 40);
      else {
        d.state = 'sleep';
        d.timer = r.range(40, 90);
      }
      return;
    }
    const v = h.villagers().filter((i) => !i.hidden && !i.sleeping);
    const roam = this.role(d) === 'roam';
    // Now and then a dog spots a bird on the beach and dashes at it (it never catches one).
    const bird = !d.puppy && d.injured <= 0 ? h.birdNear(d.x, d.z, 10) : null;
    if (bird && r.chance(0.3)) {
      d.state = 'zoom';
      d.tx = bird.x;
      d.tz = bird.z;
      d.timer = r.range(2, 3.5);
      return;
    }
    const x = r.next();
    if (d.puppy) {
      // Puppies: play, tumble about and nap near the kennel, trailing after the grown dogs.
      const k = this.bld.byId(d.kennel);
      const kx = k ? k.x : hm.x, kz = k ? k.z : hm.z;
      if (x < 0.25) {
        d.state = 'zoom';
        d.tx = kx;
        d.tz = kz;
        d.timer = r.range(3, 6);
      } else if (x < 0.5) {
        d.state = 'lie';
        d.timer = r.range(10, 25);
      } else if (x < 0.7) {
        const adult = this.alive.filter((o) => !o.puppy && Math.hypot(o.x - kx, o.z - kz) < 8);
        if (adult.length) {
          d.state = 'social';
          d.buddy = adult[r.int(0, adult.length - 1)].id;
          d.timer = r.range(5, 10);
        } else this.goTo(d, near(kx, kz, 3).x, near(kx, kz, 3).z, 'walk', 10);
      } else {
        const p = near(kx, kz, 4);
        this.goTo(d, p.x, p.z, 'walk', 10);
      }
      return;
    }
    if (x < 0.22) {
      d.state = 'sit';
      d.timer = r.range(8, 22);
    } else if (x < 0.4) {
      d.state = 'lie';
      d.timer = r.range(14, 35);
    } else if (x < 0.56) {
      // Potter around the houses near home.
      const p = near(hm.x, hm.z, d.owner >= 0 ? 3 : 6);
      this.goTo(d, p.x, p.z, 'walk', 15);
    } else if (x < 0.72 && v.length) {
      // Follow someone for a while: its own villager usually; free-roamers like going out with hunters.
      const own = d.owner >= 0 ? v.find((i) => i.id === d.owner) : undefined;
      const hunters = roam ? v.filter((i) => i.task?.kind === 'capture' || i.task?.kind === 'chop' || i.role === 'woodcutter') : [];
      const close = v.filter((i) => Math.hypot(i.x - d.x, i.z - d.z) < 12);
      const who = own && r.chance(0.7) ? own : hunters.length && r.chance(0.5) ? hunters[r.int(0, hunters.length - 1)] : close[r.int(0, Math.max(0, close.length - 1))];
      if (who) {
        d.state = 'follow';
        d.follow = who.id;
        d.timer = r.range(15, 40);
      } else {
        d.state = 'stand';
        d.timer = r.range(3, 6);
      }
    } else if (x < 0.8) {
      const an = h.animals().filter((a) => Math.hypot(a.x - d.x, a.z - d.z) < 12);
      if (an.length) {
        const a = an[r.int(0, an.length - 1)];
        d.state = 'sniff';
        d.sniffX = a.x;
        d.sniffZ = a.z;
        d.timer = r.range(6, 12);
      } else {
        d.state = 'stand';
        d.timer = r.range(3, 6);
      }
    } else if (x < 0.88) {
      const o = this.alive.filter((o) => o !== d && !o.puppy && Math.hypot(o.x - d.x, o.z - d.z) < 10 && (o.state === 'sit' || o.state === 'stand' || o.state === 'walk'));
      if (o.length) {
        const b = o[r.int(0, o.length - 1)];
        d.state = 'social';
        d.buddy = b.id;
        d.timer = r.range(4, 8);
        b.state = 'social';
        b.buddy = d.id;
        b.timer = d.timer;
      } else {
        d.state = 'sit';
        d.timer = r.range(6, 14);
      }
    } else if (x < 0.92) {
      d.state = 'zoom';
      d.tx = d.x;
      d.tz = d.z;
      d.timer = r.range(2.5, 5);
    } else {
      d.state = 'stand';
      d.timer = r.range(3, 8);
    }
  }

  // ---------------- Picking / info ----------------

  pick(camera: THREE.Camera, sx: number, sy: number, rect: DOMRect, radius = 16): Dog | null {
    const v = new THREE.Vector3();
    let best: Dog | null = null, bd = radius * radius;
    for (const d of this.list) {
      v.set(d.x, d.y + 0.15, d.z).project(camera);
      if (v.z > 1) continue;
      const px = (v.x * 0.5 + 0.5) * rect.width + rect.left, py = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      const dd = (px - sx) ** 2 + (py - sy) ** 2;
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return best;
  }

  describe(d: Dog): string {
    if (d.state === 'follow') {
      const v = this.hooks?.byId(d.follow);
      return v ? `Following ${v.name}` : STATE_TEXT.follow;
    }
    if (d.injured > 0 && (d.state === 'walk' || d.state === 'return' || d.state === 'stand')) return 'Limping (injured)';
    return STATE_TEXT[d.state];
  }

  // ---------------- Save ----------------

  serialize(): number[][] {
    return this.alive.map((d) => [d.x, d.z, d.puppy ? 1 : 0, d.age, d.coat, d.tri ? 1 : 0, d.ears === 'prick' ? 1 : 0, d.scale, d.kennel, d.owner, d.hunger, d.injured, NAMES.indexOf(d.name)]);
  }

  restore(data: number[][], idMap: Map<number, number>, founded: boolean): void {
    this.founded = founded;
    this.list = [];
    for (const r of data) {
      const [x, z, puppy, age, coat, tri, prick, scale, kennel, owner, hunger, injured, ni] = r;
      const k = this.bld.byId(idMap.get(kennel) ?? -1);
      const d: Dog = {
        id: this.nextId++, name: NAMES[ni] ?? NAMES[this.nextId % NAMES.length], x, z, y: Math.max(-0.1, this.world.heightAt(x, z)), heading: 0, speed: 0, state: 'sit', timer: this.rng.range(2, 8), tx: x, tz: z,
        coat, color: new THREE.Color(COATS[coat] ?? COATS[0]), tri: !!tri, ears: prick ? 'prick' : 'floppy', scale, puppy: !!puppy, age, kennel: k ? k.id : -1,
        owner, hunger, injured, follow: -1, buddy: -1, sniffX: 0, sniffZ: 0, jaguar: -1, bark: 0, barkCool: 0, raised: false, calm: 0,
        gait: 0, prevHeading: 0, turn: 0, sit: 1, lie: 0, crouch: 0, lunge: 0, headYaw: 0, phase: this.rng.range(0, 10), pant: 0, route: null, routeIdx: 0,
      };
      this.list.push(d);
    }
  }

  // ---------------- Drawing ----------------

  private pose = blankPose();
  private keys: Record<'prick' | 'floppy', QuadKeys> = {
    prick: DOG_KEYS('prick'),
    floppy: DOG_KEYS('floppy'),
  };

  private draw(dt: number): void {
    const m = this.meshes;
    m.begin();
    const p = this.pose;
    for (const d of this.list) {
      if (!View.sees(d.x, d.y + 0.15, d.z, 0.4)) continue;
      const a = (d.anim ??= { dyn: new QuadDyn(), frame: -10, prevLie: d.lie, stretch: 0, shake: 0, shakePh: 0 });
      // Back on screen after a while: let the springs settle from rest rather than whip.
      if (View.frame - a.frame > 2) a.dyn.ready = false;
      a.frame = View.frame;
      const dead = d.state === 'dead';
      const spd = dead ? 0 : d.speed;
      const s = d.scale * (d.puppy ? 0.5 + 0.3 * Math.min(1, d.age / DOGS.puppyGrow) : 1);
      let dh = d.heading - d.prevHeading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      d.prevHeading = d.heading;
      if (dt > 0) {
        d.turn += (THREE.MathUtils.clamp(dh / dt, -5, 5) - d.turn) * Math.min(1, dt * 6);
        d.pant = spd > 1.6 ? Math.min(1, d.pant + dt * 0.4) : Math.max(0, d.pant - dt * DOG_PANT_DECAY);
      }
      // Turning on the spot steps the feet round (not while sitting or lying).
      const yaw = dead || d.sit > 0.5 || d.lie > 0.5 ? 0 : d.turn;
      d.gait = stepGait(d.gait, spd, dt, DOG_DIMS, s, yaw);
      const t = d.phase;
      const G = d.gait * Math.PI * 2;
      const run = smooth(1.4, 2.4, spd);
      const alertish = d.state === 'alert' || d.state === 'chase' || d.state === 'intercept' || d.state === 'fight';
      const scared = !dead && (d.state === 'yelp' || d.state === 'hide' || d.injured > 0);
      const happy = d.state === 'social' || d.state === 'follow' || d.state === 'zoom';
      const sleep = d.state === 'sleep';
      // Tail carriage varies by dog (some carry a curled sickle tail): fixed by coat and size so it survives a reload.
      const sickle = idleHash(d.coat * 7 + 3, Math.round(d.scale * 1000)) < 0.35 ? 1 : 0;

      // Getting up from lying down: a long stretch (play bow), and often a shake-off after it.
      if (dt > 0 && !dead) {
        if (a.prevLie > 0.6 && d.lie < 0.35 && !sleep && d.state !== 'lie') {
          a.stretch = DOG_STRETCH_TIME;
          a.prevLie = 0;
        } else a.prevLie = d.lie;
        if (a.stretch > 0) {
          a.stretch = Math.max(0, a.stretch - dt);
          if (a.stretch === 0 && idleHash(Math.floor(t), d.id + 7) < 0.55) a.shake = DOG_SHAKE_TIME;
        } else if (a.shake > 0) a.shake = Math.max(0, a.shake - dt);
        a.shakePh += dt * DOG_SHAKE_RATE;
      }
      // Only while standing still: moving off cancels them.
      const idleOK = (1 - smooth(0.15, 0.4, spd)) * (1 - d.sit) * (1 - d.lie);
      let bow = a.stretch > 0 ? envelope(DOG_STRETCH_TIME - a.stretch, 0, DOG_STRETCH_TIME, 0.7) * idleOK : 0;
      let shake = a.shake > 0 ? envelope(DOG_SHAKE_TIME - a.shake, 0, DOG_SHAKE_TIME, 0.25) * idleOK : 0;

      p.x = d.x;
      p.y = d.y;
      p.z = d.z;
      p.heading = d.heading;
      p.scale = s;
      p.gait = d.gait;
      p.speed = spd;
      p.yaw = yaw;
      p.dt = dt;
      p.bend = THREE.MathUtils.clamp(d.turn * 0.1, -0.35, 0.35);
      p.sit = d.sit;
      p.lie = dead ? 1 : d.lie;
      p.curl = sleep ? d.lie : 0;
      p.flat = dead ? 1 : 0;
      p.crouch = d.crouch + (scared && spd < 0.3 ? 0.25 : 0);
      p.lunge = d.lunge;
      p.limp = d.injured > 0 && !dead ? 1 : 0;
      p.spine = 0;
      p.bob = 0;
      p.ovLeg = -1;
      p.ovW = 0;

      // ---- Head, neck and jaw ----
      let neck = (scared ? 0.3 : 0) + (alertish ? -0.15 : 0) + (sleep ? 0.5 : 0) + (d.state === 'lie' ? 0.1 : 0) + run * 0.3;
      let hp = (sleep ? 0.35 : d.state === 'lie' ? 0.08 : 0) + (alertish ? -0.12 : 0) + (scared ? 0.2 : 0) + run * 0.1;
      let hy = d.headYaw, hr = 0, jaw = 0;
      let earL = 0, earR = 0, earYaw = 0;
      let wagK = 1;
      if (d.state === 'sniff') {
        // Nose down, snuffling along the ground, the head sweeping side to side (the spine curves with it).
        const close = spd < 0.1 ? 1 : 0.45;
        neck += 0.85 * close;
        hp += (0.3 + Math.sin(t * 7) * 0.08) * close;
        hy += Math.sin(t * 1.3) * (spd < 0.1 ? 0.5 : 0.2);
        earL += 0.15;
        earR += 0.15;
      }
      if (d.bark > 0) {
        // Each bark: the head jerks up with the mouth snapping open, the chest thrusts, ears go forward.
        const b = Math.pow(Math.sin((d.bark / 0.22) * Math.PI), 0.7);
        hp -= b * 0.38;
        neck -= b * 0.14;
        jaw += b * 0.62;
        p.spine -= b * 0.08;
        p.bob += b * 0.004 * s;
        earL += b * 0.25;
        earR += b * 0.25;
        wagK = 0.4;
      }
      if (d.state === 'yelp') jaw += 0.3 + Math.sin(t * 20) * 0.08;
      // Panting after a run: mouth open, tongue lolling, quick shallow breaths.
      const pant = sleep || dead || spd > 1.2 ? 0 : d.pant;
      jaw += pant * (0.13 + Math.sin(t * 16) * 0.04);
      let tongue = sleep || dead || d.bark > 0 ? 0 : Math.min(1, pant * 1.3 + run * 0.7 + (happy && spd > 0.6 ? 0.45 : 0));
      p.breath = dead ? 0 : sleep ? Math.sin(t * 1.5) * 0.028 : pant > 0.05 ? Math.sin(t * 16) * 0.02 * pant : Math.sin(t * 2.4) * 0.012;

      // ---- Idle fidgets while standing, sitting or lying about ----
      const still = spd < 0.05 && !alertish && !scared && !dead && d.bark <= 0;
      if (still) {
        const wt = t + d.id * 2.3, wk = Math.floor(wt / DOG_IDLE_WINDOW), u = wt - wk * DOG_IDLE_WINDOW;
        const h = idleHash(wk, d.id), side = idleHash(wk, d.id + 50) < 0.5 ? 1 : -1;
        const standing = d.sit < 0.3 && d.lie < 0.3 && a.stretch <= 0 && a.shake <= 0;
        if (d.sit > 0.8 && h < 0.2) {
          // Scratching behind the ear with a hind leg, head tipped down toward it, eyes half shut.
          const e = envelope(u, 0.4, 3.2);
          const k = Math.sin(t * 30);
          p.ovLeg = 2;
          p.ovW = e * d.sit;
          p.ov[0] = -1.9 + k * 0.15;
          p.ov[1] = 0.7 + Math.sin(t * 30 + 1) * 0.25;
          p.ov[2] = -0.7 + k * 0.1;
          p.ov[3] = 0.5;
          p.ov[4] = 0.4;
          hy += 0.75 * e;
          hr += 0.5 * e;
          neck += 0.35 * e;
          hp += 0.25 * e;
          earL += k * 0.2 * e;
        } else if (h < 0.4 && d.lie < 0.5) {
          // Head tilt, ears pricked, as if listening.
          const e = envelope(u, 0.3, 2.6);
          hr += side * 0.38 * e;
          hy += side * 0.2 * e;
          earL += 0.2 * e;
          earR += 0.2 * e;
          earYaw -= 0.12 * e;
        } else if (h < 0.52 && !sleep) {
          // A big yawn, tongue curling out.
          const e = envelope(u, 0.5, 2.2, 0.5);
          jaw += 0.75 * e;
          hp -= 0.35 * e;
          neck -= 0.1 * e;
          earL -= 0.4 * e;
          earR -= 0.4 * e;
          tongue = Math.max(tongue, 0.4 * e);
        } else if (h < 0.66 && standing) {
          // Sniffing about on the ground, nose working side to side.
          const e = envelope(u, 0.3, 3.4);
          neck += 0.8 * e;
          hp += (0.3 + Math.sin(t * 8) * 0.06) * e;
          hy += Math.sin(t * 1.7 + d.id) * 0.45 * e;
        } else if (h < 0.74 && standing) {
          // Shaking off, head to tail.
          shake = Math.max(shake, envelope(u, 0.6, 0.6 + DOG_SHAKE_TIME, 0.25));
        } else if (h < 0.8 && standing) {
          // A play bow / stretch.
          bow = Math.max(bow, envelope(u, 0.4, 3.2, 0.6));
        } else if (h < 0.9 && d.lie > 0.5 && !sleep) {
          // Head up from the paws to look around.
          const e = envelope(u, 0.4, 3.6);
          neck -= 0.3 * e;
          hp -= 0.15 * e;
          hy += Math.sin(t * 0.8) * 0.6 * e;
        } else if (d.lie > 0.5 && !sleep) {
          // Chin down on the forepaws.
          const e = envelope(u, 0.5, 4.5, 0.8);
          neck += 0.4 * e;
          hp += 0.3 * e;
        }
      }
      // A playful dog greeting another sometimes drops into a bow.
      if (d.state === 'social' && spd < 0.1 && d.sit < 0.3) bow = Math.max(bow, envelope((t * 0.45 + d.id * 0.37) % 3, 0.3, 1.6, 0.35));
      if (bow > 0) {
        // Head up, ears forward, tail high and wagging (a stretch after lying holds a yawn in the middle).
        hp -= 0.15 * bow;
        earL += 0.15 * bow;
        earR += 0.15 * bow;
        if (a.stretch > 0) jaw += 0.5 * envelope(DOG_STRETCH_TIME - a.stretch, 0.8, 1.9, 0.4);
      }
      if (shake > 0) {
        // Eyes screwed up, mouth loose, the head leading the shake.
        jaw += 0.12 * shake;
        neck += 0.12 * shake;
        tongue = 0;
      }
      p.bow = bow;
      p.shake = shake;
      p.shakePh = a.shakePh;
      p.neck = neck;
      p.headPitch = hp;
      p.headYaw = hy;
      p.headRoll = hr;
      p.jaw = dead ? 0.15 : Math.min(0.85, jaw + tongue * 0.06);
      p.tongue = tongue;

      // ---- Ears: pricked when alert, pinned back when scared or running, with little flicks (springs add the bounce) ----
      if (d.ears === 'prick') {
        const base = alertish ? 0.25 : scared ? -0.9 : sleep ? -0.35 : d.lie > 0.5 ? -0.15 : 0;
        const wind = -0.45 * run;
        earL += base + wind + this.flick(t, d.id, 0) * -0.5;
        earR += base + wind + this.flick(t, d.id, 1) * -0.5;
        earYaw += scared ? 0.3 : 0;
      } else {
        // Drop ears stream back in the wind; they bounce and swing on their own springs.
        const base = scared ? 0.5 : alertish ? -0.12 : 0;
        earL += base + 0.7 * run + this.flick(t, d.id, 0) * 0.25 + p.bend * 0.8;
        earR += base + 0.7 * run + this.flick(t, d.id, 1) * 0.25 - p.bend * 0.8;
      }
      p.earL = earL;
      p.earR = earR;
      p.earYaw = earYaw;

      // ---- Tail: carriage and wag follow the dog's mood; the pieces follow through on springs ----
      // Carriage (base pitch, curve toward the tip), wag amplitude and rate (rad/s) per mood.
      let tp0 = -0.35, tp1 = 0.38, amp = 0.22, rate = 9;
      if (scared) {
        tp0 = -1.25;
        tp1 = -0.35;
        amp = 0.03;
        rate = 20;
      } else if (alertish) {
        tp0 = 1.0;
        tp1 = 0.25;
        amp = 0.08;
        rate = 22;
      } else if (happy || bow > 0.3) {
        tp0 = 0.55;
        amp = d.state === 'social' || bow > 0.3 ? 0.75 : 0.55;
        rate = d.state === 'social' ? 30 : 26;
      }
      // Sitting: the tail lies on the ground behind, sweeping; lying: flat out, a thump now and then.
      tp0 = THREE.MathUtils.lerp(tp0, -0.2, d.sit * (scared ? 0 : 1));
      if (d.lie > 0.01) {
        const thump = Math.max(0, Math.sin(t * 0.9 + d.id)) ** 12;
        tp0 = THREE.MathUtils.lerp(tp0, -0.4 + thump * 0.3, d.lie);
        tp1 = THREE.MathUtils.lerp(tp1, 0.1, d.lie);
        amp = THREE.MathUtils.lerp(amp, sleep ? 0.02 : 0.12, d.lie);
        rate = THREE.MathUtils.lerp(rate, 5, d.lie);
      }
      // Running: out behind, streaming with the stride.
      tp0 = THREE.MathUtils.lerp(tp0, 0.25, run * (scared ? 0.3 : 1));
      tp1 += run * 0.2 * Math.sin(G - 1);
      // Sickle-tailed dogs curl a raised tail up over the back.
      const curlUp = sickle * smooth(0.1, 0.6, tp0) * (1 - run);
      amp *= wagK;
      const w = t * rate + d.id;
      const trotSwing = smooth(0.1, 1, spd) * (1 - run) * 0.12 * Math.sin(G);
      const nT = DOG_DIMS.tailLen.length;
      for (let i = 0; i < nT; i++) {
        if (dead) {
          p.tailP[i] = i ? 0.02 : -0.5;
          p.tailY[i] = i ? 0 : 0.2;
          continue;
        }
        if (i === 0) {
          p.tailP[0] = tp0;
          p.tailY[0] = amp * Math.sin(w) + trotSwing + (sleep ? 0.7 * d.lie : 0);
        } else {
          p.tailP[i] = tp1 * DOG_TAIL_CURVE[i - 1] + curlUp * 0.32;
          p.tailY[i] = amp * 0.22 * Math.sin(w - i * 0.7) + (sleep ? 0.32 * d.lie : 0);
        }
      }
      // A hard greeting wag wiggles the whole back end.
      p.wiggle = d.state === 'social' && spd < 0.2 ? 0.08 * Math.sin(w + Math.PI) * (1 - d.sit) : 0;
      const mark = d.tri ? DOG_MARKS[d.coat] ?? DOG_MARKS[0] : d.color;
      drawQuad(m, this.keys[d.ears], DOG_DIMS, p, d.color, d.puppy ? 1.25 : 1, mark, a.dyn);
    }
    m.end();
  }

  /** A quick ear flick now and then (0..1 pulse), different for each ear. */
  private flick(t: number, id: number, ear: number): number {
    const x = t * 0.37 + id * 1.7 + ear * 0.9, k = Math.floor(x);
    return idleHash(k, id * 2 + ear) < 0.3 ? envelope((x - k) * 2.7, 0.2, 0.62, 0.18) : 0;
  }
}

/** Marking colours for tricolour dogs by coat: white on tan, cream on browns, tan points on black. */
const DOG_MARKS = [new THREE.Color(0xf2eadc), new THREE.Color(0xeee0c4), new THREE.Color(0xc0864c), new THREE.Color(0xb87a44), new THREE.Color(0xf2eadc)];
/** Seconds between idle fidget choices, and how fast panting fades after a run. */
const DOG_IDLE_WINDOW = 5;
const DOG_PANT_DECAY = 0.06;
/** Getting-up stretch and shake-off durations (s), and the shake's rate (rad/s, about 4 shakes a second). */
const DOG_STRETCH_TIME = 2.6;
const DOG_SHAKE_TIME = 1.2;
const DOG_SHAKE_RATE = 26;
/** How the tail's curve (tp1) is spread over the joints after the base. */
const DOG_TAIL_CURVE = [0.38, 0.32, 0.28, 0.24];

const DOG_LEG_KEYS = ['dog_scap', 'dog_legUF', 'dog_legLF', 'dog_pawF', 'dog_toeF', 'dog_legUH', 'dog_legLH', 'dog_pawH', 'dog_toeH'];

function DOG_KEYS(ears: 'prick' | 'floppy'): QuadKeys {
  return {
    F: 'dog_F', M: 'dog_M', R: 'dog_R', neck: 'dog_neck', neck2: 'dog_neck2', head: 'dog_head', jaw: 'dog_jaw', tongue: 'dog_tongue',
    ear: `dog_ear_${ears}`, earPos: DOG_EARS[ears].pos, earRest: DOG_EARS[ears].rest, earSoft: DOG_EARS[ears].soft,
    tail: DOG_DIMS.tailLen.map((_, i) => `dog_tail${i}`), scap: 'dog_scap',
    legUF: 'dog_legUF', legLF: 'dog_legLF', pawF: 'dog_pawF', toeF: 'dog_toeF', legUH: 'dog_legUH', legLH: 'dog_legLH', pawH: 'dog_pawH', toeH: 'dog_toeH',
  };
}
