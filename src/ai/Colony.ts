import * as THREE from 'three';
import { ECONOMY, FARM, FOOD_KEYS, ISLANDER, JETTY, NAMES, ResourceKey, TEMPLE, WARRIOR, FARM_TYPES, isFarm, SMOKE, COMFORTS, PATHS } from '../config';
import { Building, BuildingSystem } from '../buildings/Buildings';
import { Economy } from '../economy/Economy';
import { Islander, Role, Task, makeIslander } from '../entities/Islander';
import { Plant, PlantState, Vegetation } from '../vegetation/Vegetation';
import { GameTime } from '../world/Time';
import { World } from '../world/World';
import { SpatialHash } from '../world/SpatialHash';
import { Pathfinder, PathOptions } from './Pathfinder';

/** Hooks into systems built later (wildlife, boats, audio) so the colony can use them if present. */
export interface ColonyHooks {
  /** Where the player is looking from: camera position, the point it looks at, and view radius. */
  viewer?: () => { x: number; y: number; z: number; tx: number; tz: number; r: number };
  /** Take an animal from a butcher's pen; returns true if one was available. */
  takePenAnimal?: (b: Building) => boolean;
  /** Fisher reached the jetty: board a boat. Returns true if a boat accepted the crew. */
  boardBoat?: (isl: Islander, jetty: Building) => boolean;
  sfx?: (name: string, x: number, z: number) => void;
  notify?: (text: string) => void;
  /** Animals kept in a building's pen. */
  penCount?: (b: Building) => number;
  /** Capture API (animals are only ever caught when the player orders it). */
  animalInfo?: (id: number) => { name: string; food: boolean; needsPen: boolean; mode: 'carry' | 'lead' | 'hunt'; meat: number } | null;
  animalPos?: (id: number) => { x: number; z: number; free: boolean } | null;
  canCapture?: (id: number) => boolean;
  beginChase?: (id: number, isl: Islander) => void;
  catchable?: (id: number, isl: Islander) => boolean;
  grab?: (id: number, isl: Islander) => 'carry' | 'lead' | 'hunt';
  releaseAnimal?: (id: number) => void;
  putInPen?: (id: number, b: Building) => void;
  consumeAnimal?: (id: number) => void;
}

interface PathReq {
  isl: Islander;
  x: number;
  z: number;
  opts: PathOptions;
}

const GENERAL_ROLES: Role[] = ['woodcutter', 'miner', 'gatherer'];

/**
 * All islanders: needs (hunger, rest, happiness), a utility AI choosing what to do next,
 * automatic job assignment with player overrides, housing, births and growing up.
 */
export class Colony {
  list: Islander[] = [];
  private nextId = 1;
  private queue: PathReq[] = [];
  private jobTimer = 0;
  private houseTimer = 0;
  private wearTimer = 0;
  wearDirty = false;
  private blacklist = new Map<number, number>();
  private usedNames = new Set<string>();
  readonly grid = new SpatialHash<Islander>(4);
  hooks: ColonyHooks = {};
  private lastDay = -1;
  /** Game-time clock for blacklist expiry. */
  private clock = 0;
  onBirth: (isl: Islander) => void = () => {};

  constructor(
    private world: World,
    private veg: Vegetation,
    private eco: Economy,
    private bld: BuildingSystem,
    private pf: Pathfinder,
    private time: GameTime,
    private rnd: () => number
  ) {}

  byId(id: number): Islander | undefined {
    return this.list.find((i) => i.id === id);
  }

  get adults(): Islander[] {
    return this.list.filter((i) => !i.child);
  }

  private pickName(g: 'm' | 'f'): string {
    const pool = g === 'm' ? NAMES.male : NAMES.female;
    const free = pool.filter((n) => !this.usedNames.has(n));
    const name = free.length ? free[Math.floor(this.rnd() * free.length)] : `${pool[Math.floor(this.rnd() * pool.length)]} ${['the Younger', 'II', 'of the Shore', 'of the Hill'][Math.floor(this.rnd() * 4)]}`;
    this.usedNames.add(name);
    return name;
  }

  spawn(gender: 'm' | 'f', x: number, z: number, child = false, name?: string): Islander {
    const isl = makeIslander(this.nextId++, name ?? this.pickName(gender), gender, x, z, this.rnd, child);
    isl.y = this.world.groundY(x, z);
    this.list.push(isl);
    return isl;
  }

  /** Restore an islander from a save. */
  restore(data: Partial<Islander> & { id: number; name: string; gender: 'm' | 'f' }): Islander {
    const isl = makeIslander(data.id, data.name, data.gender, data.x ?? 0, data.z ?? 0, this.rnd, data.child);
    Object.assign(isl, data, { task: null, path: null, pathPending: false, hidden: false, carry: null, sleeping: false });
    isl.y = this.world.groundY(isl.x, isl.z);
    this.usedNames.add(isl.name);
    this.nextId = Math.max(this.nextId, isl.id + 1);
    this.list.push(isl);
    return isl;
  }

  // ---------------- Movement ----------------

  private requestPath(isl: Islander, x: number, z: number, opts: PathOptions = {}): void {
    isl.pathPending = true;
    isl.path = null;
    isl.pathIdx = 0;
    this.queue = this.queue.filter((q) => q.isl !== isl);
    this.queue.push({ isl, x, z, opts });
  }

  /** Drives walking for the current task. Returns 'arrived', 'walking' or 'failed'. */
  private travel(isl: Islander, dt: number, x: number, z: number, opts: PathOptions = {}, run = false): 'arrived' | 'walking' | 'failed' {
    const t = isl.task!;
    if (Math.hypot(isl.x - x, isl.z - z) < 0.35 + (opts.goalRadius ?? 0) * 0.9 && !isl.pathPending && (!isl.path || isl.pathIdx >= isl.path.length)) {
      isl.path = null;
      return 'arrived';
    }
    if (t.stage === 0) {
      this.requestPath(isl, x, z, opts);
      t.stage = 1;
      return 'walking';
    }
    if (isl.pathPending) {
      isl.anim = isl.carry ? 'carry' : 'idle';
      return 'walking';
    }
    if (!isl.path) return 'failed';
    if (isl.pathIdx >= isl.path.length) {
      isl.path = null;
      return 'arrived';
    }
    const wp = isl.path[isl.pathIdx];
    const dx = wp.x - isl.x, dz = wp.z - isl.z;
    const d = Math.hypot(dx, dz);
    let speed = (run ? ISLANDER.runSpeed : ISLANDER.walkSpeed) * (isl.child ? 0.8 : 1);
    if (isl.hunger <= 0.02) speed *= 0.7;
    const cell = this.world.cellIndexAt(isl.x, isl.z);
    if (cell >= 0) {
      speed *= 1 - this.world.forest[cell] * 0.35;
      if (!Number.isNaN(this.world.riverY[cell])) speed *= 0.5;
      const pv = this.world.path[cell];
      if (pv) speed *= pv === 1 ? ISLANDER.pathSpeed : 1 + (ISLANDER.pathSpeed - 1) * PATHS.dirtSpeedShare;
    }
    const step = speed * dt;
    if (d <= step || d < 0.05) {
      isl.x = wp.x;
      isl.z = wp.z;
      isl.pathIdx++;
    } else {
      isl.x += (dx / d) * step;
      isl.z += (dz / d) * step;
      this.faceTo(isl, dx, dz, dt);
    }
    isl.anim = isl.carry ? 'carry' : run ? 'run' : 'walk';
    isl.speed = speed;
    // Wear paths into the grass.
    if (cell >= 0 && cell !== isl.lastCell) {
      isl.lastCell = cell;
      this.world.wear[cell] = Math.min(1, this.world.wear[cell] + ISLANDER.wearPerStep);
      this.wearDirty = true;
    }
    return 'walking';
  }

  /**
   * Standing about with nothing to do: now and then, when the player is looking their way,
   * an islander turns, looks up at the camera and waves.
   */
  private idle(isl: Islander, dt: number): void {
    if (isl.waveT > 0) {
      isl.waveT -= dt;
      isl.anim = 'wave';
      const v = this.hooks.viewer?.();
      if (v) this.faceTo(isl, v.x - isl.x, v.z - isl.z, dt * 0.6);
      return;
    }
    isl.anim = 'idle';
    isl.waveCool -= dt;
    if (isl.waveCool > 0 || isl.carry || isl.hidden || isl.sleeping) return;
    isl.waveCool = 5 + this.rnd() * 12;
    const v = this.hooks.viewer?.();
    // Only when they're in view and the camera is close enough to see them.
    if (v && Math.hypot(v.tx - isl.x, v.tz - isl.z) < v.r * 0.9 && v.r < 45 && this.rnd() < 0.5) isl.waveT = 1.8 + this.rnd() * 1.6;
  }

  private faceTo(isl: Islander, dx: number, dz: number, dt: number): void {
    const target = Math.atan2(dx, dz);
    let diff = target - isl.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    isl.heading += diff * Math.min(1, dt * 10);
  }

  private setTask(isl: Islander, kind: Task['kind'], target: number, x: number, z: number, res?: ResourceKey): void {
    this.releaseTask(isl);
    isl.task = { kind, stage: 0, target, timer: 0, x, z, res };
    isl.path = null;
    isl.pathPending = false;
  }

  /** Release any reservations held by the current task. */
  private releaseTask(isl: Islander): void {
    const t = isl.task;
    if (!t) return;
    if (t.kind === 'chop' || t.kind === 'mine' || t.kind === 'gather') {
      const p = this.veg.plants[t.target];
      if (p && p.reservedBy === isl.id) p.reservedBy = -1;
    }
    if (t.kind === 'build') this.bld.byId(t.target)?.builders.delete(isl.id);
    // Abandoned capture: the animal gets away (or is let go).
    if (t.kind === 'capture' && (t.phase ?? 0) < 2) {
      this.hooks.releaseAnimal?.(t.target);
      if (isl.carry?.kind === 'chicken') isl.carry = null;
    }
    isl.task = null;
  }

  cancelTask(isl: Islander): void {
    this.releaseTask(isl);
    if (isl.hidden && !isl.sleeping) isl.hidden = false;
    isl.path = null;
    isl.pathPending = false;
  }

  // ---------------- Jobs ----------------

  /** Player override: make this islander work at a building or on a resource. */
  assign(isl: Islander, b: Building | null, plant: Plant | null): string {
    if (isl.child) return `${isl.name} is too young to work.`;
    this.cancelTask(isl);
    isl.manualRole = true;
    if (plant) {
      isl.focusPlant = plant.id;
      isl.workplace = -1;
      if (plant.kind === 'rock') isl.role = 'miner';
      else if (plant.kind === 'apple' || (plant.kind === 'banana' && plant.fruit >= 1)) isl.role = 'gatherer';
      else isl.role = 'woodcutter';
      return `${isl.name} is now a ${isl.role === 'miner' ? 'stonecutter' : isl.role === 'gatherer' ? 'fruit gatherer' : 'woodcutter'}.`;
    }
    if (!b) return '';
    if (!b.complete || b.upgrading) {
      isl.role = 'builder';
      isl.workplace = b.id;
      return `${isl.name} will help build the ${b.label}.`;
    }
    const map: Partial<Record<string, Role>> = { farm: 'farmer', maizefarm: 'farmer', chinampa: 'farmer', temple: 'priest', jetty: 'fisher', butcher: 'butcher', smokehouse: 'smoker', woodstore: 'woodcutter', grainstore: 'gatherer' };
    if (b.key === 'warroom') {
      isl.manualRole = false;
      return this.trainWarrior(b, this.rnd() < 0.5 ? 'jaguar' : 'eagle', isl) ? `${isl.name} is training as a warrior.` : 'Not enough resources to train a warrior.';
    }
    const role = map[b.key];
    if (!role) {
      isl.manualRole = false;
      return `Nothing to do at the ${b.label}.`;
    }
    isl.role = role;
    isl.workplace = isFarm(b.key) || ['temple', 'jetty', 'butcher', 'smokehouse'].includes(b.key) ? b.id : -1;
    return `${isl.name} now works as a ${role}.`;
  }

  /** Queue warrior training at a war room (pays the cost). */
  trainWarrior(b: Building, type: 'jaguar' | 'eagle', who?: Islander): boolean {
    if (!this.eco.canAfford(WARRIOR.cost)) return false;
    const cand = who ?? this.nearestFree(b.door.x, b.door.z);
    if (!cand) return false;
    this.eco.spend(WARRIOR.cost);
    this.cancelTask(cand);
    cand.manualRole = true;
    cand.role = 'warrior';
    cand.workplace = b.id;
    cand.warrior = null;
    this.setTask(cand, 'train', b.id, b.door.x, b.door.z);
    cand.task!.res = type === 'jaguar' ? 'meat' : 'fish'; // encode type in res field
    return true;
  }

  private nearestFree(x: number, z: number): Islander | null {
    let best: Islander | null = null, bd = Infinity;
    for (const i of this.list) {
      if (i.child || i.role === 'warrior' || i.manualRole) continue;
      const d = (i.x - x) ** 2 + (i.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  private assignJobs(): void {
    const workers = this.list.filter((i) => !i.child && i.role !== 'warrior');
    // Drop invalid workplaces.
    for (const i of workers) {
      if (i.workplace >= 0) {
        const b = this.bld.byId(i.workplace);
        const valid = b && (i.role === 'builder' ? !b.complete || b.upgrading : b.complete);
        if (!valid) {
          i.workplace = -1;
          if (i.manualRole && i.role === 'builder') i.manualRole = false;
          if (!i.manualRole) i.role = 'idle';
        }
      }
    }
    const free = () => workers.filter((i) => !i.manualRole);
    const counts = new Map<number, number>();
    for (const i of workers) if (i.workplace >= 0) counts.set(i.workplace, (counts.get(i.workplace) ?? 0) + 1);

    const slots: { b: Building; role: Role; n: number }[] = [];
    for (const b of this.bld.list) {
      if (!b.complete || b.upgrading) slots.push({ b, role: 'builder', n: b.def.builders });
      else if (isFarm(b.key)) slots.push({ b, role: 'farmer', n: b.def.workers });
      else if (b.key === 'smokehouse') slots.push({ b, role: 'smoker', n: b.def.workers });
      else if (b.key === 'temple') slots.push({ b, role: 'priest', n: b.def.workers });
      else if (b.key === 'butcher') slots.push({ b, role: 'butcher', n: b.def.workers });
      else if (b.key === 'jetty') slots.push({ b, role: 'fisher', n: Math.min(b.def.workers, b.boats.length) });
    }
    // Builders first, then food producers, then the temple.
    const prio: Record<string, number> = { builder: 0, farmer: 1, fisher: 2, butcher: 3, smoker: 3.5, priest: 4 };
    slots.sort((a, b) => prio[a.role] - prio[b.role]);
    // Priests only once the tribe can spare them.
    for (const s of slots) if (s.role === 'priest') s.n = Math.min(s.n, Math.max(0, Math.floor((workers.length - 4) / 3)));
    // Keep at least ~40% of the free workforce on general gathering while food is low.
    const pool = free();
    const lowFood = this.eco.food < this.list.length * 3;
    const maxSpecial = Math.max(1, Math.floor(pool.length * (lowFood ? 0.55 : 0.75)));
    let special = pool.filter((i) => i.workplace >= 0).length;
    for (const s of slots) {
      let have = counts.get(s.b.id) ?? 0;
      while (have < s.n && special < maxSpecial) {
        let best: Islander | null = null, bd = Infinity;
        for (const i of pool) {
          if (i.workplace >= 0) continue;
          const d = (i.x - s.b.x) ** 2 + (i.z - s.b.z) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        if (!best) break;
        best.role = s.role;
        best.workplace = s.b.id;
        have++;
        special++;
      }
      // Too many (e.g. fewer boats now): release extras.
      if (have > s.n) {
        for (const i of pool) {
          if (have <= s.n) break;
          if (i.workplace === s.b.id) {
            i.workplace = -1;
            i.role = 'idle';
            have--;
          }
        }
      }
    }
    // Split the rest among wood, stone and fruit by need.
    const general = pool.filter((i) => i.workplace < 0);
    if (!general.length) return;
    const pop = this.list.length;
    const foodNeed = Math.max(0, 1 - this.eco.food / Math.max(10, pop * 6));
    const woodNeed = Math.max(0.15, 1 - this.eco.res.wood / Math.max(1, this.eco.woodCap));
    const stoneNeed = Math.max(0.08, (1 - this.eco.res.stone / Math.max(1, this.eco.woodCap)) * 0.7);
    const w = { gatherer: 0.25 + foodNeed * 1.2, woodcutter: woodNeed, miner: stoneNeed };
    const total = w.gatherer + w.woodcutter + w.miner;
    const want: Record<string, number> = {
      gatherer: Math.round((w.gatherer / total) * general.length),
      woodcutter: Math.round((w.woodcutter / total) * general.length),
    };
    want.miner = general.length - want.gatherer - want.woodcutter;
    const have: Record<string, number> = { gatherer: 0, woodcutter: 0, miner: 0 };
    for (const i of general) if (GENERAL_ROLES.includes(i.role)) have[i.role]++;
    for (const i of general) {
      if (GENERAL_ROLES.includes(i.role) && have[i.role] <= want[i.role]) continue;
      // Reassign to the role with the largest shortfall.
      let pick: Role = 'gatherer', short = -Infinity;
      for (const r of GENERAL_ROLES) {
        const s = want[r] - have[r];
        if (s > short) {
          short = s;
          pick = r;
        }
      }
      if (GENERAL_ROLES.includes(i.role)) have[i.role]--;
      i.role = pick;
      have[pick]++;
    }
  }

  // ---------------- Housing & births ----------------

  private assignHousing(): void {
    for (const b of this.bld.list) b.residents = b.residents.filter((id) => this.byId(id)?.home === b.id);
    const homeless = () => this.list.filter((i) => i.home < 0 || !this.bld.byId(i.home)?.complete);
    for (const i of homeless()) i.home = -1;
    const move = (isl: Islander, b: Building) => {
      isl.home = b.id;
      b.residents.push(isl.id);
    };
    const nearest = (b: Building, pred: (i: Islander) => boolean) => {
      let best: Islander | null = null, bd = Infinity;
      for (const i of homeless()) {
        if (!pred(i)) continue;
        const d = (b.x - i.x) ** 2 + (b.z - i.z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    };
    // Larger homes house several couples (and leave room for their children).
    const couplesFor = (b: Building) => Math.max(1, Math.floor(b.housing / 3.5));
    // 0) Rebalance: a Home keeps its couples; extra adults move out once there is room elsewhere.
    const spare = (except: Building) => this.bld.list.reduce((s, b) => (b === except ? s : s + Math.max(0, b.housing - b.residents.length)), 0);
    for (const b of this.bld.of('home')) {
      const adults = b.residents.map((r) => this.byId(r)).filter((r): r is Islander => !!r && !r.child);
      const maxAdults = couplesFor(b) * 2;
      if (adults.length <= maxAdults || spare(b) <= 0) continue;
      let room = spare(b);
      const keep: Islander[] = [];
      const men = adults.filter((x) => x.gender === 'm'), women = adults.filter((x) => x.gender === 'f');
      for (let k = 0; k < couplesFor(b); k++) {
        if (men[k]) keep.push(men[k]);
        if (women[k]) keep.push(women[k]);
      }
      while (keep.length < maxAdults) keep.push(adults.find((x) => !keep.includes(x))!);
      for (const x of adults) {
        if (keep.includes(x) || room <= 0) continue;
        room--;
        x.home = -1;
        b.residents = b.residents.filter((id) => id !== x.id);
      }
    }
    // 1) Homes take couples (leaving room for children), and children follow their parents.
    for (const b of this.bld.of('home')) {
      const adults = () => b.residents.map((r) => this.byId(r)).filter((r): r is Islander => !!r && !r.child);
      while (adults().length < couplesFor(b) * 2 && b.residents.length < b.housing) {
        const have = adults();
        const nm = have.filter((x) => x.gender === 'm').length, nf = have.length - nm;
        const want = nm > nf ? 'f' : nf > nm ? 'm' : null;
        const pick = nearest(b, (i) => !i.child && (!want || i.gender === want));
        if (!pick) break;
        move(pick, b);
      }
    }
    // 2) Everyone else: huts first, then any spare room (nearest).
    for (const isl of homeless()) {
      let best: Building | null = null, bd = Infinity;
      for (const b of this.bld.list) {
        if (b.housing <= b.residents.length) continue;
        const d = (b.x - isl.x) ** 2 + (b.z - isl.z) ** 2 + (b.key === 'home' && !isl.child ? 2500 : 0);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (best) move(isl, best);
    }
  }

  private dawn(): void {
    for (const b of this.bld.of('home')) {
      if (this.list.length >= ISLANDER.max) return;
      const res = b.residents.map((id) => this.byId(id)).filter((i): i is Islander => !!i);
      const adults = res.filter((i) => !i.child);
      if (res.length >= b.housing) continue;
      if (!adults.some((i) => i.gender === 'm') || !adults.some((i) => i.gender === 'f')) continue;
      if (this.eco.food < ISLANDER.birthFoodMin) continue;
      if (this.rnd() > ISLANDER.birthChancePerDay) continue;
      const g = this.rnd() < 0.5 ? 'm' : 'f';
      const kid = this.spawn(g, b.door.x, b.door.z, true);
      kid.home = b.id;
      b.residents.push(kid.id);
      const parent = adults.find((a) => a.gender === 'f')!;
      kid.skin = parent.skin;
      this.hooks.notify?.(`${kid.name} was born to ${parent.name}!`);
      this.onBirth(kid);
    }
  }

  // ---------------- Decision making ----------------

  private think(isl: Islander): void {
    // Test mode: nobody tires or goes hungry, so orders are carried out day and night.
    const god = this.eco.godMode;
    if (god) {
      isl.rest = 1;
      isl.hunger = 1;
    }
    const night = this.time.isNight && !god;
    // Target happiness.
    const home = isl.home >= 0 ? this.bld.byId(isl.home) : undefined;
    let target = 0.3;
    if (home) target += home.key === 'home' ? 0.32 : 0.22;
    if (isl.hunger > 0.45) target += 0.2;
    if (this.bld.of('temple').length) target += 0.1 + Math.min(0.1, this.bld.of('temple').reduce((s, b) => s + b.tier, 0) * 0.03);
    if (FOOD_KEYS.filter((k) => this.eco.res[k] > 0).length >= 3) target += ECONOMY.varietyHappiness;
    // Fresh water close to home.
    const hx = home ? home.x : isl.x, hz = home ? home.z : isl.z;
    const r2 = COMFORTS.wellRadius * COMFORTS.wellRadius;
    if (this.bld.list.some((w) => w.key === 'well' && w.complete && (w.x - hx) ** 2 + (w.z - hz) ** 2 < r2)) target += COMFORTS.wellHappy;
    isl.happy += (Math.min(1, target) - isl.happy) * 0.08;

    if (isl.child) {
      if (night) return this.goSleep(isl);
      if (isl.age > ISLANDER.childGrowDays * 600 * 0.4 && this.rnd() < 0.4) {
        const parent = this.list.find((p) => !p.child && p.home === isl.home && p.home >= 0);
        if (parent) {
          this.setTask(isl, 'follow', parent.id, parent.x, parent.z);
          return;
        }
      }
      return this.wander(isl, home ? home.door.x : isl.x, home ? home.door.z : isl.z, 5);
    }
    if (isl.hunger < ISLANDER.eatThreshold && this.eco.food >= 1) {
      const store = this.bld.nearestStore(isl.x, isl.z, true);
      if (store) return this.setTask(isl, 'eat', store.id, store.door.x, store.door.z);
    }
    // Evenings: gather round a bonfire to sing and tell stories before bed.
    const hr = this.time.hour;
    if (!god && isl.role !== 'warrior' && isl.lastBonfire !== this.time.day && hr >= COMFORTS.bonfireHours[0] && hr < COMFORTS.bonfireHours[1] && isl.rest > 0.15) {
      let fire: Building | null = null, fd = Infinity;
      for (const b of this.bld.list) {
        if (b.key !== 'bonfire' || !b.complete) continue;
        const d = (b.x - isl.x) ** 2 + (b.z - isl.z) ** 2;
        if (d < fd) {
          fd = d;
          fire = b;
        }
      }
      if (fire && fd < 70 * 70) {
        isl.lastBonfire = this.time.day;
        const a = this.rnd() * Math.PI * 2;
        return this.setTask(isl, 'bonfire', fire.id, fire.x + Math.cos(a) * 1.25, fire.z + Math.sin(a) * 1.25);
      }
    }
    if ((night && isl.role !== 'warrior') || isl.rest < ISLANDER.sleepThreshold) return this.goSleep(isl);
    if (night && isl.role === 'warrior' && isl.rest < 0.5) return this.goSleep(isl);
    if (this.work(isl)) return;
    // Nothing to do in their own job (store full, nothing left nearby): decide for themselves.
    if (isl.role !== 'warrior' && isl.role !== 'builder' && this.selfDirected(isl)) return;
    this.wander(isl, isl.x, isl.z, 4);
  }

  /**
   * Autonomous choice when an islander's own job has nothing to do: pick whatever the tribe needs
   * most that they can actually do right now (food from fruit or the shore, wood, or stone).
   */
  private selfDirected(isl: Islander): boolean {
    const e = this.eco;
    const foodRoom = e.space('fruit') >= 2;
    const foodNeed = foodRoom ? 1 - e.food / Math.max(1, e.foodCap) + (e.food < this.list.length * 3 ? 0.4 : 0) : -1;
    const woodNeed = e.space('wood') >= 2 ? 1 - e.res.wood / Math.max(1, e.woodCap) : -1;
    const stoneNeed = e.space('stone') >= 2 ? (1 - e.res.stone / Math.max(1, e.woodCap)) * 0.75 : -1;
    const opts: [number, () => boolean][] = [
      [foodNeed + this.rnd() * 0.25, () => (this.rnd() < 0.5 ? this.startSpearfish(isl) || this.startGather(isl) : this.startGather(isl) || this.startSpearfish(isl))],
      [woodNeed + this.rnd() * 0.25, () => this.startChop(isl)],
      [stoneNeed + this.rnd() * 0.25, () => this.startMine(isl)],
    ];
    opts.sort((a, b) => b[0] - a[0]);
    for (const [score, go] of opts) if (score > 0.05 && go()) return true;
    return false;
  }

  private startChop(isl: Islander): boolean {
    if (!this.bld.nearestStore(isl.x, isl.z, false) || this.eco.space('wood') < 1) return false;
    const p = this.veg.findNearest(isl.x, isl.z, 40, (q) => q.marked && this.veg.isChoppable(q) && this.okPlant(q)) ?? this.veg.findNearest(isl.x, isl.z, 40, (q) => this.veg.isChoppable(q) && this.okPlant(q));
    if (!p) return false;
    p.reservedBy = isl.id;
    this.setTask(isl, 'chop', p.id, p.x, p.z);
    return true;
  }
  private startMine(isl: Islander): boolean {
    if (!this.bld.nearestStore(isl.x, isl.z, false) || this.eco.space('stone') < 1) return false;
    const p = this.veg.findNearest(isl.x, isl.z, 50, (q) => this.veg.isMineable(q) && this.okPlant(q));
    if (!p) return false;
    p.reservedBy = isl.id;
    this.setTask(isl, 'mine', p.id, p.x, p.z);
    return true;
  }
  private startGather(isl: Islander): boolean {
    if (!this.bld.nearestStore(isl.x, isl.z, true) || this.eco.space('fruit') < 1) return false;
    const p = this.veg.findNearest(isl.x, isl.z, 45, (q) => this.veg.hasFruit(q) && this.okPlant(q));
    if (!p) return false;
    p.reservedBy = isl.id;
    this.setTask(isl, 'gather', p.id, p.x, p.z);
    return true;
  }

  private shoreCache: { v: number; spots: { x: number; z: number; wx: number; wz: number }[] } | null = null;
  /** Beach and rock edges next to fishable shallow water. */
  private shoreSpots(): { x: number; z: number; wx: number; wz: number }[] {
    const w = this.world;
    if (this.shoreCache && this.shoreCache.v === w.version) return this.shoreCache.spots;
    const spots: { x: number; z: number; wx: number; wz: number }[] = [];
    const N = w.N;
    for (let cz = 2; cz < N - 2; cz++) {
      for (let cx = 2; cx < N - 2; cx++) {
        const i = cz * N + cx;
        if (!w.isLandCell(i) || w.distWater[i] !== 1 || w.occ[i] !== 0 || w.layer[i] > 2) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = i + dx + dz * N;
          if (w.layer[j] > 0) continue;
          const wx = w.centerX(cx + dx), wz = w.centerZ(cz + dz);
          if (w.heightAt(wx, wz) > -0.25) continue;
          spots.push({ x: w.centerX(cx) + dx * 0.35, z: w.centerZ(cz) + dz * 0.35, wx, wz });
          break;
        }
      }
    }
    this.shoreCache = { v: w.version, spots };
    return spots;
  }
  /** Wade to the water's edge and try to spear a fish. */
  private startSpearfish(isl: Islander): boolean {
    if (!this.bld.nearestStore(isl.x, isl.z, true) || this.eco.space('fish') < 1) return false;
    const spots = this.shoreSpots();
    let best: { x: number; z: number; wx: number; wz: number } | null = null, bd = 45 * 45;
    for (let k = 0; k < spots.length; k++) {
      const s = spots[k];
      const d = (s.x - isl.x) ** 2 + (s.z - isl.z) ** 2 + this.rnd() * 30;
      // Spread out along the shore.
      if (d < bd && !this.list.some((o) => o !== isl && o.task?.kind === 'spearfish' && Math.hypot(o.task.x - s.x, o.task.z - s.z) < 2.5)) {
        bd = d;
        best = s;
      }
    }
    if (!best) return false;
    this.setTask(isl, 'spearfish', -1, best.x, best.z);
    isl.task!.res = 'fish';
    isl.task!.building = Math.round(Math.atan2(best.wx - best.x, best.wz - best.z) * 1000);
    return true;
  }

  private goSleep(isl: Islander): void {
    const home = isl.home >= 0 ? this.bld.byId(isl.home) : undefined;
    const fire = this.bld.of('campfire')[0];
    if (home) return this.setTask(isl, 'sleep', home.id, home.door.x, home.door.z);
    if (fire) {
      const a = this.rnd() * Math.PI * 2;
      return this.setTask(isl, 'sleep', -1, fire.x + Math.cos(a) * 2.2, fire.z + Math.sin(a) * 2.2);
    }
    this.setTask(isl, 'sleep', -1, isl.x, isl.z);
  }

  private wander(isl: Islander, cx: number, cz: number, r: number): void {
    for (let k = 0; k < 6; k++) {
      const x = cx + (this.rnd() - 0.5) * 2 * r, z = cz + (this.rnd() - 0.5) * 2 * r;
      const i = this.world.cellIndexAt(x, z);
      if (i >= 0 && this.world.isLandCell(i) && this.world.occ[i] === 0) {
        this.setTask(isl, 'wander', -1, x, z);
        isl.task!.timer = 2 + this.rnd() * 5;
        return;
      }
    }
    this.setTask(isl, 'wander', -1, isl.x, isl.z);
    isl.task!.timer = 3;
  }

  private okPlant(p: Plant): boolean {
    const until = this.blacklist.get(p.id);
    return until === undefined || until < this.clock;
  }

  /** Start a job task for the islander's role. Returns false if nothing to do. */
  private work(isl: Islander): boolean {
    const fromX = isl.x, fromZ = isl.z;
    const store = (food: boolean) => this.bld.nearestStore(isl.x, isl.z, food);
    switch (isl.role) {
      case 'builder': {
        let site = isl.workplace >= 0 ? this.bld.byId(isl.workplace) : undefined;
        if (!site || (site.complete && !site.upgrading)) {
          site = this.bld.list.filter((b) => !b.complete || b.upgrading).sort((a, b) => (a.x - fromX) ** 2 + (a.z - fromZ) ** 2 - ((b.x - fromX) ** 2 + (b.z - fromZ) ** 2))[0];
        }
        if (!site) return false;
        // Stand around the edge of the site.
        const a = this.rnd() * Math.PI * 2;
        const r = Math.max(site.w, site.d) / 2 + 0.5;
        this.setTask(isl, 'build', site.id, site.x + Math.cos(a) * r, site.z + Math.sin(a) * r);
        site.builders.add(isl.id);
        return true;
      }
      case 'woodcutter': {
        if (!store(false) || this.eco.space('wood') < 1) return false;
        const focus = isl.focusPlant >= 0 ? this.veg.plants[isl.focusPlant] : null;
        let p = focus && this.veg.isChoppable(focus) ? focus : null;
        isl.focusPlant = -1;
        p = p ?? this.veg.findNearest(fromX, fromZ, 40, (q) => q.marked && this.veg.isChoppable(q) && this.okPlant(q));
        p = p ?? this.veg.findNearest(fromX, fromZ, 40, (q) => q.kind === 'broadleaf' && this.veg.isChoppable(q) && this.okPlant(q));
        p = p ?? this.veg.findNearest(fromX, fromZ, 40, (q) => this.veg.isChoppable(q) && this.okPlant(q));
        if (!p) return false;
        p.reservedBy = isl.id;
        this.setTask(isl, 'chop', p.id, p.x, p.z);
        return true;
      }
      case 'miner': {
        if (!store(false) || this.eco.space('stone') < 1) return false;
        const focus = isl.focusPlant >= 0 ? this.veg.plants[isl.focusPlant] : null;
        let p = focus && this.veg.isMineable(focus) ? focus : null;
        isl.focusPlant = -1;
        p = p ?? this.veg.findNearest(fromX, fromZ, 50, (q) => q.marked && this.veg.isMineable(q) && this.okPlant(q));
        p = p ?? this.veg.findNearest(fromX, fromZ, 50, (q) => this.veg.isMineable(q) && this.okPlant(q));
        if (!p) return false;
        p.reservedBy = isl.id;
        this.setTask(isl, 'mine', p.id, p.x, p.z);
        return true;
      }
      case 'gatherer': {
        if (!store(true) || this.eco.space('fruit') < 1) return false;
        // Gatherers also spear fish from the shore now and then, for variety at meals.
        if (this.rnd() < (this.eco.res.fish < 4 ? 0.35 : 0.15) && this.startSpearfish(isl)) return true;
        const focus = isl.focusPlant >= 0 ? this.veg.plants[isl.focusPlant] : null;
        let p = focus && this.veg.hasFruit(focus) ? focus : null;
        isl.focusPlant = -1;
        p = p ?? this.veg.findNearest(fromX, fromZ, 40, (q) => q.marked && this.veg.hasFruit(q) && this.okPlant(q));
        p = p ?? this.veg.findNearest(fromX, fromZ, 40, (q) => this.veg.hasFruit(q) && this.okPlant(q));
        if (!p) {
          // No fruit around: help with wood instead.
          if (!isl.manualRole) {
            isl.role = 'woodcutter';
            return this.work(isl);
          }
          return false;
        }
        p.reservedBy = isl.id;
        this.setTask(isl, 'gather', p.id, p.x, p.z);
        return true;
      }
      case 'farmer': {
        const farm = this.bld.byId(isl.workplace);
        if (!farm) return false;
        const hw = farm.w / 2 - 0.8, hd = farm.d / 2 - 0.8;
        const x = farm.x + (this.rnd() - 0.5) * 2 * hw, z = farm.z + (this.rnd() - 0.5) * 2 * hd;
        this.setTask(isl, 'farm', farm.id, x, z);
        return true;
      }
      case 'smoker': {
        const b = this.bld.byId(isl.workplace);
        if (!b) return false;
        // Only when there is raw fish or meat to smoke and a little firewood.
        if ((this.eco.res.fish < SMOKE.input && this.eco.res.meat < SMOKE.input) || this.eco.res.wood < SMOKE.wood) return false;
        const [rx, rz] = b.local(0.45, 0.0);
        this.setTask(isl, 'smoke', b.id, rx, rz);
        return true;
      }
      case 'priest': {
        const t = this.bld.byId(isl.workplace);
        if (!t) return false;
        const [dx, dz] = t.dir;
        this.setTask(isl, 'pray', t.id, t.door.x + dx * 0.4 + (this.rnd() - 0.5) * 1.2, t.door.z + dz * 0.4 + (this.rnd() - 0.5) * 1.2);
        return true;
      }
      case 'butcher': {
        const b = this.bld.byId(isl.workplace);
        if (!b) return false;
        // Only animals the player has had captured and penned are butchered.
        if ((this.hooks.penCount?.(b) ?? 0) === 0) return false;
        this.setTask(isl, 'butcher', b.id, b.penX, b.penZ);
        return true;
      }
      case 'fisher': {
        const j = this.bld.byId(isl.workplace);
        if (!j || !j.boats.length) return false;
        this.setTask(isl, 'fish', j.id, j.door.x, j.door.z);
        return true;
      }
      case 'warrior': {
        const fire = this.bld.of('campfire')[0];
        const cx = fire ? fire.x : isl.x, cz = fire ? fire.z : isl.z;
        for (let k = 0; k < 10; k++) {
          const a = this.rnd() * Math.PI * 2, r = 6 + this.rnd() * WARRIOR.patrolRadius;
          const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
          const i = this.world.cellIndexAt(x, z);
          if (i >= 0 && this.world.isLandCell(i) && this.world.occ[i] === 0) {
            this.setTask(isl, 'patrol', -1, x, z);
            return true;
          }
        }
        return false;
      }
      default:
        return false;
    }
  }

  /** The pen a captured animal should go to (butcher pens for livestock, farm pens for chickens). */
  private penFor(mode: 'carry' | 'lead', x: number, z: number): Building | null {
    const order = mode === 'carry' ? ['farm', 'butcher'] : ['butcher', 'farm'];
    for (const key of order) {
      let best: Building | null = null, bd = Infinity;
      for (const b of this.bld.of(key as 'farm', true)) {
        const d = Math.hypot(b.x - x, b.z - z);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Nearest adult who could go hunting (not a warrior on duty, not asleep). */
  nearestHunter(x: number, z: number): Islander | null {
    let best: Islander | null = null, bd = Infinity;
    for (const i of this.list) {
      if (i.child || i.sleeping || i.hidden || i.warrior || i.task?.kind === 'capture') continue;
      const d = (i.x - x) ** 2 + (i.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Player order: this islander tracks down, catches and brings home a specific animal. */
  orderCapture(isl: Islander | null, animalId: number): { ok: boolean; msg: string } {
    const info = this.hooks.animalInfo?.(animalId);
    if (!info) return { ok: false, msg: 'That animal cannot be found.' };
    if (!info.food) return { ok: false, msg: `The ${info.name.toLowerCase()} is wild and not for eating.` };
    if (!this.hooks.canCapture?.(animalId)) return { ok: false, msg: `That ${info.name.toLowerCase()} is already being dealt with.` };
    const pos = this.hooks.animalPos?.(animalId);
    if (!pos) return { ok: false, msg: 'That animal cannot be found.' };
    if (info.needsPen && !this.penFor('lead', pos.x, pos.z)) return { ok: false, msg: `Build a Butcher or Farm first: a ${info.name.toLowerCase()} needs a pen.` };
    const who = isl ?? this.nearestHunter(pos.x, pos.z);
    if (!who) return { ok: false, msg: this.list.some((i) => !i.child && i.sleeping) ? 'Everyone is asleep. Try again in the morning.' : 'Nobody is free to go hunting.' };
    if (who.child) return { ok: false, msg: `${who.name} is too young to hunt.` };
    this.setTask(who, 'capture', animalId, pos.x, pos.z);
    who.task!.phase = 0;
    this.hooks.beginChase?.(animalId, who);
    const verb = info.mode === 'hunt' ? 'hunt' : info.mode === 'carry' ? 'catch' : 'catch and pen';
    return { ok: true, msg: `${who.name} sets off to ${verb} the ${info.name.toLowerCase()}.` };
  }


  // ---------------- Task execution ----------------

  private deliver(isl: Islander): void {
    if (!isl.carry) return;
    const food = FOOD_KEYS.includes(isl.carry.res);
    const store = this.bld.nearestStore(isl.x, isl.z, food);
    if (!store) {
      isl.carry = null;
      return;
    }
    this.setTask(isl, 'deliver', store.id, store.door.x, store.door.z, isl.carry.res);
  }

  private fail(isl: Islander): void {
    const t = isl.task;
    if (t && (t.kind === 'chop' || t.kind === 'mine' || t.kind === 'gather')) this.blacklist.set(t.target, this.clock + 90);
    this.releaseTask(isl);
    isl.think = 0.5 + this.rnd();
  }

  private runTask(isl: Islander, dt: number): void {
    const t = isl.task!;
    const w = this.world;
    switch (t.kind) {
      case 'wander': {
        const r = this.travel(isl, dt, t.x, t.z);
        if (r === 'arrived') {
          this.idle(isl, dt);
          t.timer -= dt;
          if (t.timer <= 0) this.releaseTask(isl);
        } else if (r === 'failed') this.releaseTask(isl);
        break;
      }
      case 'follow': {
        const p = this.byId(t.target);
        if (!p || p.hidden) return this.releaseTask(isl);
        if (Math.hypot(p.x - isl.x, p.z - isl.z) > 1.5) {
          if (t.stage === 1 && !isl.pathPending && (!isl.path || isl.pathIdx >= isl.path.length)) t.stage = 0;
          const r = this.travel(isl, dt, p.x, p.z, { goalRadius: 1 }, true);
          if (r === 'failed') this.releaseTask(isl);
        } else {
          isl.anim = 'idle';
          t.timer += dt;
          if (t.timer > 6) this.releaseTask(isl);
        }
        break;
      }
      case 'patrol': {
        isl.tool = 'spear';
        const r = this.travel(isl, dt, t.x, t.z);
        if (r === 'arrived') {
          isl.anim = 'idle';
          t.timer += dt;
          if (t.timer > 4) this.releaseTask(isl);
        } else if (r === 'failed') this.fail(isl);
        break;
      }
      case 'chop':
      case 'mine':
      case 'gather': {
        const p = this.veg.plants[t.target];
        const valid = t.kind === 'chop' ? p.state === PlantState.Alive : t.kind === 'mine' ? p.state === PlantState.Alive && p.amount > 0 : p.fruit >= 1;
        if (!valid) return this.releaseTask(isl);
        isl.tool = t.kind === 'chop' ? 'axe' : t.kind === 'mine' ? 'pick' : 'none';
        if (t.stage < 2) {
          const r = this.travel(isl, dt, p.x, p.z, { goalRadius: 1 });
          if (r === 'failed') return this.fail(isl);
          if (r !== 'arrived') return;
          t.stage = 2;
          t.timer = t.kind === 'chop' ? ISLANDER.chopSeconds : t.kind === 'mine' ? ISLANDER.mineSeconds : ISLANDER.harvestSeconds;
        }
        this.faceTo(isl, p.x - isl.x, p.z - isl.z, dt);
        isl.anim = t.kind === 'chop' ? 'chop' : t.kind === 'mine' ? 'mine' : 'harvest';
        isl.reachHigh = p.kind === 'banana' || (p.kind === 'apple' && p.variant === 1);
        const before = t.timer;
        t.timer -= dt;
        // A chop / clink sound on each swing.
        if (t.kind !== 'gather' && Math.floor(before * 1.4) !== Math.floor(t.timer * 1.4)) this.hooks.sfx?.(t.kind === 'chop' ? 'chop' : 'mine', isl.x, isl.z);
        if (t.timer > 0) return;
        let n = 0;
        if (t.kind === 'chop') {
          n = this.veg.chop(p);
          this.hooks.sfx?.('treefall', p.x, p.z);
          isl.carry = { kind: 'log', res: 'wood', n };
        } else if (t.kind === 'mine') {
          n = this.veg.mine(p, ISLANDER.carryAmount);
          isl.carry = { kind: 'stone', res: 'stone', n };
        } else {
          n = this.veg.harvest(p, ISLANDER.carryAmount);
          isl.carry = { kind: 'fruit', res: 'fruit', n };
        }
        p.reservedBy = -1;
        this.releaseTask(isl);
        if (n > 0) this.deliver(isl);
        else isl.carry = null;
        break;
      }
      case 'deliver': {
        const b = this.bld.byId(t.target);
        if (!b || !isl.carry) {
          this.releaseTask(isl);
          if (isl.carry) this.deliver(isl);
          return;
        }
        const r = this.travel(isl, dt, t.x, t.z, { allowBuilding: b.id, goalRadius: 1 });
        if (r === 'failed') {
          isl.carry = null;
          return this.fail(isl);
        }
        if (r !== 'arrived') return;
        this.eco.add(isl.carry.res, isl.carry.n);
        this.hooks.sfx?.('drop', isl.x, isl.z);
        isl.carry = null;
        this.releaseTask(isl);
        break;
      }
      case 'build': {
        const b = this.bld.byId(t.target);
        if (!b || (b.complete && !b.upgrading)) return this.releaseTask(isl);
        isl.tool = 'hammer';
        if (t.stage < 2) {
          const r = this.travel(isl, dt, t.x, t.z, { goalRadius: 1 });
          if (r === 'failed') {
            // Try standing anywhere next to the site.
            t.stage = 0;
            t.timer += 1;
            if (t.timer > 3) return this.fail(isl);
            const a = this.rnd() * Math.PI * 2;
            t.x = b.x + Math.cos(a) * (Math.max(b.w, b.d) / 2 + 0.6);
            t.z = b.z + Math.sin(a) * (Math.max(b.w, b.d) / 2 + 0.6);
            return;
          }
          if (r !== 'arrived') return;
          t.stage = 2;
          t.timer = 8 + this.rnd() * 6;
        }
        this.faceTo(isl, b.x - isl.x, b.z - isl.z, dt);
        isl.anim = 'build';
        b.builders.add(isl.id);
        this.bld.addProgress(b, dt);
        const before = t.timer;
        t.timer -= dt;
        if (Math.floor(before * 1.5) !== Math.floor(t.timer * 1.5)) this.hooks.sfx?.('build', isl.x, isl.z);
        if (t.timer <= 0 || (b.complete && !b.upgrading)) this.releaseTask(isl);
        break;
      }
      case 'farm': {
        const f = this.bld.byId(t.target);
        if (!f || !f.complete) return this.releaseTask(isl);
        if (t.stage < 2) {
          isl.tool = 'hoe';
          const r = this.travel(isl, dt, t.x, t.z, { allowBuilding: f.id });
          if (r === 'failed') return this.fail(isl);
          if (r !== 'arrived') return;
          t.stage = 2;
          t.timer = f.growth >= 1 || f.stock > 0 ? FARM.harvestSeconds : 7 + this.rnd() * 4;
        }
        const harvesting = f.growth >= 1 || f.stock > 0;
        isl.anim = harvesting ? 'harvest' : 'farm';
        isl.tool = harvesting ? 'none' : 'hoe';
        if (!harvesting) f.tendTimer = 12;
        t.timer -= dt;
        if (t.timer > 0) return;
        if (harvesting) {
          if (f.growth >= 1) {
            f.stock += FARM_TYPES[f.key]?.yield ?? FARM.grainYield;
            f.growth = 0;
            this.hooks.sfx?.('harvest', isl.x, isl.z);
          }
          const n = Math.min(f.stock, ISLANDER.carryAmount * 2);
          f.stock -= n;
          isl.carry = { kind: 'grain', res: 'grain', n };
          this.releaseTask(isl);
          this.deliver(isl);
        } else this.releaseTask(isl);
        break;
      }
      case 'smoke': {
        const b = this.bld.byId(t.target);
        if (!b || !b.complete) return this.releaseTask(isl);
        isl.tool = 'none';
        if (t.stage < 2) {
          const r = this.travel(isl, dt, t.x, t.z, { allowBuilding: b.id, goalRadius: 0.6 });
          if (r === 'failed') return this.fail(isl);
          if (r !== 'arrived') return;
          t.stage = 2;
          t.timer = SMOKE.batchSeconds;
        }
        // Hanging fish and meat on the racks and tending the fire.
        const [fx, fz] = b.local(0.8, 0);
        this.faceTo(isl, fx - isl.x, fz - isl.z, dt);
        isl.anim = 'harvest';
        isl.reachHigh = Math.sin(t.timer * 0.9) > -0.2;
        b.tendTimer = 2;
        t.timer -= dt;
        if (t.timer > 0) return;
        const kind = this.eco.res.fish >= this.eco.res.meat ? 'fish' : 'meat';
        if (this.eco.res[kind] >= SMOKE.input && this.eco.res.wood >= SMOKE.wood) {
          this.eco.res[kind] -= SMOKE.input;
          this.eco.res.wood -= SMOKE.wood;
          this.eco.add(kind, SMOKE.output);
          this.hooks.sfx?.('harvest', isl.x, isl.z);
        }
        this.releaseTask(isl);
        break;
      }
      case 'pray': {
        const tp = this.bld.byId(t.target);
        if (!tp || !tp.complete) return this.releaseTask(isl);
        isl.tool = 'none';
        if (t.stage < 2) {
          const r = this.travel(isl, dt, t.x, t.z, { goalRadius: 1 });
          if (r === 'failed') return this.fail(isl);
          if (r !== 'arrived') return;
          t.stage = 2;
          t.timer = ISLANDER.praySeconds;
        }
        this.faceTo(isl, tp.x - isl.x, tp.z - isl.z, dt);
        isl.anim = 'pray';
        this.eco.add('belief', TEMPLE.prayBelief * tp.tier * dt);
        t.timer -= dt;
        if (t.timer <= 0) this.releaseTask(isl);
        break;
      }
      case 'butcher': {
        const b = this.bld.byId(t.target);
        if (!b || !b.complete) return this.releaseTask(isl);
        isl.tool = 'axe';
        if (t.stage < 2) {
          const r = this.travel(isl, dt, b.door.x, b.door.z, { allowBuilding: b.id, goalRadius: 1 });
          if (r === 'failed') return this.fail(isl);
          if (r !== 'arrived') return;
          const got = this.hooks.takePenAnimal?.(b) ?? false;
          if (!got) {
            isl.anim = 'idle';
            t.timer += dt;
            if (t.timer > 6) this.releaseTask(isl);
            t.stage = 1;
            isl.path = [];
            isl.pathIdx = 0;
            return;
          }
          t.stage = 2;
          t.timer = 8;
        }
        isl.anim = 'chop';
        const before = t.timer;
        t.timer -= dt;
        if (Math.floor(before * 1.4) !== Math.floor(t.timer * 1.4)) this.hooks.sfx?.('chop', isl.x, isl.z);
        if (t.timer <= 0) {
          isl.carry = { kind: 'meat', res: 'meat', n: 6 };
          this.releaseTask(isl);
          this.deliver(isl);
        }
        break;
      }
      case 'spearfish': {
        isl.tool = 'spear';
        if (t.stage < 2) {
          const r = this.travel(isl, dt, t.x, t.z, { goalRadius: 0.4 });
          if (r === 'failed') return this.fail(isl);
          if (r !== 'arrived') return;
          t.stage = 2;
          t.timer = 6 + this.rnd() * 6;
        }
        // Face the water, spear raised, and strike now and then.
        const face = (t.building ?? 0) / 1000;
        this.faceTo(isl, Math.sin(face), Math.cos(face), dt);
        isl.anim = 'fish';
        const before = t.timer;
        t.timer -= dt;
        if (Math.floor(before / 1.7) !== Math.floor(t.timer / 1.7)) this.hooks.sfx?.('splash', isl.x + Math.sin(face) * 0.6, isl.z + Math.cos(face) * 0.6);
        if (t.timer > 0) return;
        const caught = this.rnd() < 0.75;
        this.releaseTask(isl);
        if (caught) {
          isl.carry = { kind: 'fish', res: 'fish', n: 2 + (this.rnd() < 0.3 ? 1 : 0) };
          this.deliver(isl);
        }
        break;
      }
      case 'capture': {
        isl.tool = 'spear';
        const phase = t.phase ?? 0;
        if (phase === 0) {
          const pos = this.hooks.animalPos?.(t.target);
          if (!pos || !pos.free) return this.releaseTask(isl);
          const d = Math.hypot(pos.x - isl.x, pos.z - isl.z);
          t.timer += dt;
          // Give up after a long fruitless chase.
          if (t.timer > 90) {
            this.hooks.notify?.(`${isl.name} lost track of the animal.`);
            return this.releaseTask(isl);
          }
          if (this.hooks.catchable?.(t.target, isl)) {
            // Look it up before the grab: a hunted animal is gone afterwards.
            const info = this.hooks.animalInfo?.(t.target);
            const mode = this.hooks.grab!(t.target, isl);
            this.hooks.sfx?.('harvest', isl.x, isl.z);
            if (mode === 'hunt') {
              t.phase = 2;
              isl.carry = { kind: 'meat', res: 'meat', n: info?.meat ?? 10 };
              this.releaseTask(isl);
              this.deliver(isl);
              return;
            }
            const pen = this.penFor(mode, isl.x, isl.z);
            if (!pen) {
              // No pen for a chicken: it goes straight to the food store.
              this.hooks.consumeAnimal?.(t.target);
              t.phase = 2;
              isl.carry = { kind: 'meat', res: 'meat', n: info?.meat ?? 3 };
              this.releaseTask(isl);
              this.deliver(isl);
              return;
            }
            if (mode === 'carry') isl.carry = { kind: 'chicken', res: 'meat', n: 0 };
            t.phase = 1;
            t.building = pen.id;
            t.stage = 0;
            t.x = pen.key === 'farm' ? pen.x : pen.door.x;
            t.z = pen.key === 'farm' ? pen.z : pen.door.z;
            return;
          }
          if (d < 2.6) {
            // Close: run straight at it.
            isl.path = null;
            isl.pathPending = false;
            const dx = pos.x - isl.x, dz = pos.z - isl.z;
            const step = Math.min(d, ISLANDER.runSpeed * dt);
            const nx = isl.x + (dx / (d || 1)) * step, nz = isl.z + (dz / (d || 1)) * step;
            const ci = w.cellIndexAt(nx, nz);
            if (ci >= 0 && w.isLandCell(ci)) {
              isl.x = nx;
              isl.z = nz;
            }
            this.faceTo(isl, dx, dz, dt);
            isl.anim = d > 0.3 ? 'run' : 'harvest';
            isl.speed = ISLANDER.runSpeed;
            t.stage = 0;
            return;
          }
          // Far: path toward where it is now, re-aiming as it moves.
          if (Math.hypot(pos.x - t.x, pos.z - t.z) > 1.5 && !isl.pathPending) {
            t.x = pos.x;
            t.z = pos.z;
            t.stage = 0;
          }
          const r = this.travel(isl, dt, t.x, t.z, { goalRadius: 1 }, true);
          if (r === 'failed') return this.fail(isl);
          if (r === 'arrived') t.stage = 0;
          return;
        }
        // Bring it home to the pen (led on a leash, or carried).
        const b = this.bld.byId(t.building ?? -1);
        if (!b || !b.complete) return this.releaseTask(isl);
        isl.tool = 'none';
        const r = this.travel(isl, dt, t.x, t.z, { allowBuilding: b.id, goalRadius: 1 });
        if (r === 'failed') return this.fail(isl);
        if (r !== 'arrived') return;
        this.hooks.putInPen?.(t.target, b);
        if (isl.carry?.kind === 'chicken') isl.carry = null;
        t.phase = 2;
        this.hooks.notify?.(`${isl.name} penned an animal at the ${b.label}.`);
        this.releaseTask(isl);
        break;
      }
      case 'fish': {
        const j = this.bld.byId(t.target);
        if (!j || !j.complete) return this.releaseTask(isl);
        isl.tool = 'none';
        if (t.stage < 2) {
          const r = this.travel(isl, dt, t.x, t.z, { allowBuilding: j.id, goalRadius: 1 });
          if (r === 'failed') return this.fail(isl);
          if (r !== 'arrived') return;
          t.stage = 2;
        }
        if (t.stage === 2) {
          if (this.hooks.boardBoat?.(isl, j)) {
            isl.hidden = true;
            t.stage = 3;
          } else {
            isl.anim = 'fish';
            t.timer += dt;
            if (t.timer > 8) this.releaseTask(isl);
          }
        }
        // Stage 3: in the boat; the boat system ends the task by calling disembark().
        break;
      }
      case 'train': {
        const b = this.bld.byId(t.target);
        if (!b || !b.complete) {
          isl.role = 'idle';
          isl.manualRole = false;
          return this.releaseTask(isl);
        }
        if (t.stage < 2) {
          const r = this.travel(isl, dt, t.x, t.z, { allowBuilding: b.id, goalRadius: 1 });
          if (r === 'failed') return this.fail(isl);
          if (r !== 'arrived') return;
          t.stage = 2;
          t.timer = WARRIOR.trainSeconds;
          isl.hidden = true;
        }
        t.timer -= dt;
        if (t.timer <= 0) {
          isl.hidden = false;
          isl.warrior = t.res === 'meat' ? 'jaguar' : 'eagle';
          isl.role = 'warrior';
          isl.tool = 'spear';
          isl.x = b.door.x;
          isl.z = b.door.z;
          this.hooks.notify?.(`${isl.name} is now ${isl.warrior === 'jaguar' ? 'a Jaguar' : 'an Eagle'} warrior.`);
          this.onWarrior(isl);
          this.releaseTask(isl);
        }
        break;
      }
      case 'bonfire': {
        const b = this.bld.byId(t.target);
        if (!b || !b.complete) return this.releaseTask(isl);
        isl.tool = 'none';
        if (t.stage < 2) {
          const r = this.travel(isl, dt, t.x, t.z, { goalRadius: 0.6 });
          if (r === 'failed') return this.fail(isl);
          if (r !== 'arrived') return;
          t.stage = 2;
          t.timer = COMFORTS.bonfireSeconds[0] + this.rnd() * (COMFORTS.bonfireSeconds[1] - COMFORTS.bonfireSeconds[0]);
        }
        // Sit facing the fire; now and then someone stands to dance or pray.
        this.faceTo(isl, b.x - isl.x, b.z - isl.z, dt);
        isl.anim = Math.sin(t.timer * 0.7 + isl.id) > 0.85 ? 'pray' : 'eat';
        isl.happy = Math.min(1, isl.happy + COMFORTS.bonfireHappy * dt);
        this.eco.add('belief', COMFORTS.bonfireBelief * dt);
        t.timer -= dt;
        if (t.timer <= 0) this.releaseTask(isl);
        break;
      }
      case 'eat': {
        const b = this.bld.byId(t.target);
        if (!b) return this.releaseTask(isl);
        if (t.stage < 2) {
          const r = this.travel(isl, dt, t.x, t.z, { allowBuilding: b.id, goalRadius: 1 });
          if (r === 'failed') return this.fail(isl);
          if (r !== 'arrived') return;
          const meal = this.eco.takeMeal(isl.lastMeal);
          if (!meal) return this.releaseTask(isl);
          if (meal !== isl.lastMeal) isl.happy = Math.min(1, isl.happy + 0.03);
          // Meat roasted at a firepit: more filling, and a treat.
          if (meal === 'meat' && this.bld.list.some((f) => f.key === 'firepit' && f.complete)) {
            isl.hunger = Math.min(1, isl.hunger + COMFORTS.firepitMeal);
            isl.happy = Math.min(1, isl.happy + COMFORTS.firepitHappy);
          }
          isl.lastMeal = meal;
          t.stage = 2;
          t.timer = 3;
          isl.tool = 'none';
        }
        isl.anim = 'eat';
        t.timer -= dt;
        if (t.timer <= 0) {
          isl.hunger = Math.min(1, isl.hunger + ECONOMY.mealRestore);
          this.releaseTask(isl);
        }
        break;
      }
      case 'sleep': {
        const home = t.target >= 0 ? this.bld.byId(t.target) : undefined;
        if (t.stage < 2) {
          const r = this.travel(isl, dt, t.x, t.z, home ? { allowBuilding: home.id, goalRadius: 1 } : { goalRadius: 1 });
          if (r === 'failed') {
            t.stage = 2;
            t.target = -1;
          } else if (r !== 'arrived') return;
          t.stage = 2;
          isl.sleeping = true;
          isl.tool = 'none';
          if (home && t.target >= 0) isl.hidden = true;
        }
        isl.anim = 'sleep';
        isl.rest = Math.min(1, isl.rest + dt / 140);
        if (!this.time.isNight && isl.rest > 0.55) {
          isl.sleeping = false;
          isl.hidden = false;
          if (home) {
            isl.x = home.door.x;
            isl.z = home.door.z;
          }
          this.releaseTask(isl);
        }
        break;
      }
      case 'goto': {
        const r = this.travel(isl, dt, t.x, t.z);
        if (r !== 'walking') this.releaseTask(isl);
        break;
      }
    }
    void w;
  }

  onWarrior: (isl: Islander) => void = () => {};

  /**
   * The player calls for help on a building site: the nearest free adults drop what they're
   * doing and come to build it (back to their usual work once it's finished).
   */
  callHelpers(b: Building): Islander[] {
    const r2 = COMFORTS.helpersRadius * COMFORTS.helpersRadius;
    const cand = this.list
      .filter((i) => !i.child && i.role !== 'warrior' && !i.hidden && !(i.role === 'builder' && i.workplace === b.id))
      .map((i) => ({ i, d: (i.x - b.x) ** 2 + (i.z - b.z) ** 2 }))
      .filter((c) => c.d < r2)
      .sort((a, c) => a.d - c.d)
      .slice(0, COMFORTS.helpersMax)
      .map((c) => c.i);
    for (const i of cand) {
      if (i.task?.kind === 'fish' && i.task.stage >= 3) continue; // out in a boat
      this.releaseTask(i);
      i.role = 'builder';
      i.workplace = b.id;
      // Manual until the site is done; then assignJobs returns them to automatic work.
      i.manualRole = true;
      i.think = 0;
    }
    return cand;
  }

  /** Send an islander walking to a point (new settlers heading to the village). */
  walkTo(isl: Islander, x: number, z: number): void {
    this.releaseTask(isl);
    this.setTask(isl, 'goto', -1, x, z);
  }

  /** Called by the boat system when a fishing trip ends at the jetty. */
  disembark(isl: Islander, fish: number, x: number, z: number): void {
    isl.hidden = false;
    isl.x = x;
    isl.z = z;
    this.releaseTask(isl);
    if (fish > 0) {
      isl.carry = { kind: 'fish', res: 'fish', n: fish };
      this.deliver(isl);
    }
  }

  // ---------------- Update ----------------

  update(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt;
    // Path requests (limited per frame).
    for (let k = 0; k < ISLANDER.pathRequestsPerFrame && this.queue.length; k++) {
      const q = this.queue.shift()!;
      q.isl.path = this.pf.find(q.isl.x, q.isl.z, q.x, q.z, q.opts);
      q.isl.pathIdx = 0;
      q.isl.pathPending = false;
    }
    this.jobTimer -= dt;
    if (this.jobTimer <= 0) {
      this.jobTimer = 2.5;
      this.assignJobs();
    }
    this.houseTimer -= dt;
    if (this.houseTimer <= 0) {
      this.houseTimer = 3;
      this.assignHousing();
    }
    if (this.time.day !== this.lastDay) {
      if (this.lastDay >= 0) this.dawn();
      this.lastDay = this.time.day;
    }

    let happy = 0;
    this.grid.clear();
    for (const isl of this.list) {
      isl.animT += dt;
      isl.age += dt;
      isl.hunger = Math.max(0, isl.hunger - ISLANDER.hungerDrain * dt * (isl.child ? 0.6 : 1));
      if (!isl.sleeping) isl.rest = Math.max(0, isl.rest - ISLANDER.restDrain * dt);
      if (this.eco.godMode) {
        isl.hunger = 1;
        isl.rest = 1;
        // Anyone already in bed gets straight back up to work.
        if (isl.task?.kind === 'sleep') {
          this.releaseTask(isl);
          isl.sleeping = false;
          isl.hidden = false;
        }
      }
      if (isl.child && isl.age > ISLANDER.childGrowDays * 600) {
        isl.child = false;
        isl.role = 'idle';
        this.hooks.notify?.(`${isl.name} has grown up.`);
      }
      if (isl.happy > ISLANDER.happyThreshold) happy++;
      if (!isl.task) {
        isl.think -= dt;
        this.idle(isl, dt);
        if (isl.think <= 0) {
          isl.think = ISLANDER.aiThinkInterval * (0.7 + this.rnd() * 0.6);
          this.think(isl);
        }
      } else {
        // Night falls: stop heading to work and go to bed.
        const t = isl.task;
        if (this.time.isNight && !this.eco.godMode && !isl.child && isl.role !== 'warrior' && t.stage <= 1 && (t.kind === 'chop' || t.kind === 'mine' || t.kind === 'gather' || t.kind === 'farm' || t.kind === 'smoke' || t.kind === 'wander' || t.kind === 'pray' || t.kind === 'spearfish')) {
          this.releaseTask(isl);
          this.goSleep(isl);
        } else this.runTask(isl, dt);
      }
      if (!isl.hidden) {
        isl.y = this.world.groundY(isl.x, isl.z);
        this.grid.insert(isl);
      }
    }
    this.eco.add('belief', happy * ISLANDER.beliefPerHappyPerSecond * dt);
    void JETTY;
  }

  /** Screen-space pick (closest islander to the pointer within a radius in pixels). */
  pick(camera: THREE.Camera, sx: number, sy: number, rect: DOMRect, radius = 22): Islander | null {
    const v = new THREE.Vector3();
    let best: Islander | null = null, bd = radius * radius;
    for (const isl of this.list) {
      if (isl.hidden) continue;
      v.set(isl.x, isl.y + (isl.child ? 0.2 : 0.3), isl.z).project(camera);
      if (v.z > 1) continue;
      const px = (v.x * 0.5 + 0.5) * rect.width + rect.left, py = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      const d = (px - sx) ** 2 + (py - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = isl;
      }
    }
    return best;
  }

  /** Current activity text for the info panel. */
  activity(isl: Islander): string {
    const t = isl.task;
    if (isl.sleeping) return 'Sleeping';
    if (!t) return 'Thinking';
    const b = t.target >= 0 ? this.bld.byId(t.target) : undefined;
    switch (t.kind) {
      case 'chop': return t.stage < 2 ? 'Walking to a tree' : 'Chopping wood';
      case 'mine': return t.stage < 2 ? 'Walking to a rock' : 'Cutting stone';
      case 'gather': return t.stage < 2 ? 'Looking for fruit' : 'Picking fruit';
      case 'deliver': return `Carrying ${isl.carry?.n ?? 0} ${isl.carry?.res ?? ''} to the ${b?.label ?? 'store'}`;
      case 'build': return `Building the ${b?.label ?? 'site'}`;
      case 'farm': return b && (b.growth >= 1 || b.stock > 0) ? `Harvesting ${(FARM_TYPES[b.key]?.label ?? 'crops').toLowerCase()}` : b?.key === 'chinampa' ? 'Tending the chinampa beds' : 'Tending the fields';
      case 'smoke': return 'Smoking fish and meat';
      case 'pray': return 'Praying at the temple';
      case 'eat': return 'Eating';
      case 'bonfire': return 'Singing and telling stories at the bonfire';
      case 'sleep': return 'Going to bed';
      case 'wander': return 'Strolling';
      case 'spearfish': return (t.stage ?? 0) < 2 ? 'Heading to the shore to fish' : 'Spear fishing';
      case 'patrol': return 'Patrolling';
      case 'butcher': return 'Butchering';
      case 'fish': return t.stage >= 3 ? 'Out fishing' : 'Heading to the jetty';
      case 'capture': return (t.phase ?? 0) === 0 ? 'Hunting an animal' : isl.carry?.kind === 'chicken' ? 'Carrying a chicken to the pen' : 'Leading an animal to the pen';
      case 'train': return t.stage >= 2 ? 'Training at the War Room' : 'Going to train';
      case 'follow': return 'Following a parent';
      default: return 'Busy';
    }
  }
}
