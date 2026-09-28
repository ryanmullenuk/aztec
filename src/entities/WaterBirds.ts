import * as THREE from 'three';
import { WATERBIRDS } from '../config';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { FOLDED, flapPose, mixPose, pose, wingMatrices, wingParts } from './birdWings';
import { Islander } from './Islander';
import { QuadMeshes } from './quadRig';
import { RFish } from './ReefFish';
import { HER, HERON_WING, PEL, PELICAN_WING, heldFish, heronBody, heronHead, heronLegLower, heronLegUpper, heronNeck, pelicanBody, pelicanHead, pelicanLeg, pelicanNeck } from './waterBirdModels';

type Kind = 'pelican' | 'heron';
type BState =
  | 'stand' | 'rest' | 'oneleg' | 'walk' | 'preen' | 'stretch' | 'swim' | 'alert'
  | 'takeoff' | 'fly' | 'circle' | 'dive' | 'under' | 'swallow' | 'watch' | 'strike' | 'recover' | 'land';

/** Where a bird can be: on land (rock, beach, bank), wading, or floating on the sea. */
interface Spot {
  x: number;
  z: number;
  /** Floating on open water (pelicans) or standing on the ground / river bed. */
  water: boolean;
  /** A feeding place (shallows with fish for herons) rather than a resting one. */
  feed: boolean;
}

interface Bird {
  kind: Kind;
  id: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  state: BState;
  timer: number;
  tx: number;
  tz: number;
  /** What to do on arriving at the flight's end. */
  next: 'rest' | 'hunt' | 'swim';
  spot: Spot | null;
  /** 1 full … 0 starving. */
  hunger: number;
  group: number;
  scale: number;
  /** Pelican prey: a deep-school index (≥ 0) or a reef fish; heron prey is always a reef fish. */
  school: number;
  reef: RFish | null;
  preyX: number;
  preyZ: number;
  caught: boolean;
  hold: number;
  // Animation (smoothed).
  fold: number;
  flap: number;
  amp: number;
  n1: number;
  n2: number;
  hp: number;
  hy: number;
  legPh: number;
  oneLeg: number;
  sit: number;
  pitch: number;
  phase: number;
  react: number;
  vy: number;
}

const _m = new THREE.Matrix4(), _b = new THREE.Matrix4(), _n = new THREE.Matrix4(), _t = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _wm = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];
const _fp = pose(), _wp = pose();
const WHITE = new THREE.Color(1, 1, 1);

function compose(out: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
}

export interface WaterBirdHooks {
  /** Villagers nearby. */
  people: SpatialHash<Islander>;
  dogs: () => { x: number; z: number; speed: number }[];
  /** Deep-sea schools and reef fish. */
  schools: () => { x: number; z: number; stock: number }[];
  fishNear: (x: number, z: number, r: number) => { x: number; y: number; z: number; school: number } | null;
  takeFish: (school: number) => boolean;
  scatterDeep: (x: number, z: number, r: number) => void;
  reefNear: (x: number, z: number, r: number) => RFish | null;
  reefSchools: () => { x: number; z: number }[];
  reefFish: () => RFish[];
  takeReef: (f: RFish) => void;
  scatterReef: (x: number, z: number, r: number) => void;
  /** Canoes out netting (stirred-up fish draw pelicans). */
  canoes: () => { x: number; z: number }[];
  /** Buildings: busy ones scare birds off; jetties draw pelicans, chinampas and canals draw herons. */
  buildings: () => { x: number; z: number; key: string }[];
  splash: (x: number, z: number, n: number, speed: number, r: number) => void;
  sfx: (name: string, x: number, z: number) => void;
  seaLevel: number;
}

/**
 * Pelicans and herons. Pelicans loaf on beaches, rocks and the sea in loose groups, and when
 * hungry fly out over a real fish school (or a canoe stirring one up), circle, and plunge-dive,
 * sometimes surfacing with a fish to swallow. Herons stand patiently at the water's edge —
 * lagoon shallows, river banks, pools, chinampas — watching, then strike with a sudden thrust.
 * Both take off from villagers who come too close and bolt from dogs, and settle down at dusk.
 */
export class WaterBirds {
  readonly meshes = new QuadMeshes();
  list: Bird[] = [];
  private rng: RNG;
  private time = 0;
  private restSpots: Spot[] = [];
  private seaSpots: Spot[] = [];
  private wadeSpots: Spot[] = [];
  hooks: WaterBirdHooks | null = null;

  constructor(private world: World, rocks: { x: number; z: number }[]) {
    this.rng = new RNG(world.seed * 53 + 29);
    this.findSpots(rocks);
    this.spawn();
    const P = 12, H = 8;
    this.meshes.add('pBody', pelicanBody(), P);
    this.meshes.add('pNeck0', pelicanNeck(0), P);
    this.meshes.add('pNeck1', pelicanNeck(1), P);
    this.meshes.add('pHead', pelicanHead(), P);
    this.meshes.add('pLeg', pelicanLeg(), P * 2);
    wingParts(PELICAN_WING).forEach((g, k) => this.meshes.add(`pW${k}`, g, P));
    this.meshes.add('hBody', heronBody(), H);
    this.meshes.add('hNeck0', heronNeck(0), H);
    this.meshes.add('hNeck1', heronNeck(1), H);
    this.meshes.add('hHead', heronHead(), H);
    this.meshes.add('hLegU', heronLegUpper(), H * 2);
    this.meshes.add('hLegL', heronLegLower(), H * 2);
    wingParts(HERON_WING).forEach((g, k) => this.meshes.add(`hW${k}`, g, H));
    this.meshes.add('fish', heldFish(), P + H);
  }

  // ---------------- Habitat ----------------

  private findSpots(rocks: { x: number; z: number }[]): void {
    const w = this.world;
    const r = this.rng;
    // Sandy beach at the water's edge and rocks by the sea: resting places.
    for (let k = 0; k < 6000 && this.restSpots.length < 120; k++) {
      const cx = r.int(2, w.N - 3), cz = r.int(2, w.N - 3);
      const i = w.idx(cx, cz);
      const x = w.centerX(cx), z = w.centerZ(cz);
      const h = w.heightAt(x, z);
      if (w.isLandCell(i) && w.sandy[i] > 0.5 && w.distWater[i] <= 1.5 && h > 0.05 && h < 0.6) this.restSpots.push({ x, z, water: false, feed: false });
    }
    for (const p of rocks) this.restSpots.push({ x: p.x, z: p.z, water: false, feed: false });
    // Open sea for pelicans to float on.
    for (let k = 0; k < 4000 && this.seaSpots.length < 60; k++) {
      const x = r.range(-w.half * 0.85, w.half * 0.85), z = r.range(-w.half * 0.85, w.half * 0.85);
      const h = w.heightAt(x, z);
      if (h < -0.6 && h > -6) this.seaSpots.push({ x, z, water: true, feed: false });
    }
    // Wading shallows (for herons): ankle-deep sea, lagoon and river edges.
    for (let k = 0; k < 24000 && this.wadeSpots.length < 160; k++) {
      const cx = r.int(2, w.N - 3), cz = r.int(2, w.N - 3);
      const i = w.idx(cx, cz);
      const x = w.centerX(cx) + r.range(-0.4, 0.4), z = w.centerZ(cz) + r.range(-0.4, 0.4);
      const h = w.heightAt(x, z);
      const river = !Number.isNaN(w.riverY[i]);
      if ((h > -WATERBIRDS.wadeDepth && h < -0.03) || (river && w.riverY[i] - h < WATERBIRDS.wadeDepth + 0.06)) this.wadeSpots.push({ x, z, water: false, feed: true });
    }
  }

  private spawn(): void {
    const r = this.rng;
    const nP = Math.round(THREE.MathUtils.clamp(this.restSpots.length / 14, WATERBIRDS.pelicans[0], WATERBIRDS.pelicans[1]));
    const nH = Math.round(THREE.MathUtils.clamp(this.wadeSpots.length / 30, WATERBIRDS.herons[0], WATERBIRDS.herons[1]));
    // Pelicans in loose groups of 2–5 around a beach or rock.
    let g = 0;
    while (this.list.filter((b) => b.kind === 'pelican').length < nP && this.restSpots.length) {
      const home = this.restSpots[r.int(0, this.restSpots.length - 1)];
      const size = Math.min(nP - this.list.length, r.int(2, 5));
      for (let k = 0; k < size; k++) this.add('pelican', home.x + r.range(-1.2, 1.2), home.z + r.range(-1.2, 1.2), g, home);
      g++;
    }
    // Herons alone, well apart.
    for (let k = 0; k < 400 && this.list.filter((b) => b.kind === 'heron').length < nH && this.wadeSpots.length; k++) {
      const s = this.wadeSpots[r.int(0, this.wadeSpots.length - 1)];
      if (this.list.some((b) => b.kind === 'heron' && Math.hypot(b.x - s.x, b.z - s.z) < WATERBIRDS.heronSpacing)) continue;
      this.add('heron', s.x, s.z, -1, s);
    }
  }

  private add(kind: Kind, x: number, z: number, group: number, spot: Spot): void {
    const r = this.rng;
    const w = this.world;
    const b: Bird = {
      kind, id: this.list.length, x, y: Math.max(w.heightAt(x, z), 0), z, heading: r.range(0, 6.28), state: kind === 'heron' ? 'stand' : 'rest',
      timer: r.range(3, 20), tx: x, tz: z, next: 'rest', spot, hunger: r.range(0.4, 1), group, scale: kind === 'pelican' ? r.range(0.95, 1.12) : r.range(0.95, 1.08),
      school: -1, reef: null, preyX: 0, preyZ: 0, caught: false, hold: 0,
      fold: 1, flap: r.range(0, 6), amp: 0, n1: 0, n2: 1, hp: 0, hy: 0, legPh: 0, oneLeg: 0, sit: 0, pitch: 0, phase: r.range(0, 10), react: r.next(), vy: 0,
    };
    this.list.push(b);
  }

  /** How disturbed a place is: buildings and people nearby (docks draw pelicans; chinampas and canals draw herons). */
  private score(kind: Kind, s: Spot): number {
    const h = this.hooks!;
    let sc = this.rng.next();
    for (const bd of h.buildings()) {
      const d = Math.hypot(bd.x - s.x, bd.z - s.z);
      if (d > 12) continue;
      if (kind === 'pelican' && (bd.key === 'jetty' || bd.key === 'tradedock')) sc += 1.2;
      else if (kind === 'heron' && (bd.key === 'chinampa' || bd.key === 'canal')) sc += 1.5;
      else sc -= (12 - d) * 0.25;
    }
    h.people.query(s.x, s.z, 8, () => (sc -= 1.2));
    return sc;
  }

  private pickSpot(b: Bird, list: Spot[], near: number, avoidX?: number, avoidZ?: number): Spot | null {
    let best: Spot | null = null, bs = -Infinity;
    for (let k = 0; k < 10 && list.length; k++) {
      const s = list[this.rng.int(0, list.length - 1)];
      const d = Math.hypot(s.x - b.x, s.z - b.z);
      if (d > near) continue;
      if (avoidX !== undefined && Math.hypot(s.x - avoidX, s.z - avoidZ!) < 8) continue;
      let sc = this.score(b.kind, s) - d * 0.02;
      if (b.kind === 'heron' && this.list.some((o) => o !== b && o.kind === 'heron' && o.spot && Math.hypot(o.spot.x - s.x, o.spot.z - s.z) < WATERBIRDS.heronSpacing)) sc -= 3;
      if (sc > bs) {
        bs = sc;
        best = s;
      }
    }
    return best;
  }

  private active(): boolean {
    return this.dayHour > WATERBIRDS.wake && this.dayHour < WATERBIRDS.settle;
  }

  private dayHour = 12;

  // ---------------- Update ----------------

  update(dt: number, hour: number): void {
    this.time += dt;
    this.dayHour = hour;
    if (dt > 0 && this.hooks) for (const b of this.list) this.think(b, dt);
    this.draw(dt);
  }

  private fly(b: Bird, x: number, z: number, next: Bird['next'], spot: Spot | null): void {
    b.tx = x;
    b.tz = z;
    b.next = next;
    b.spot = spot;
    b.state = b.state === 'fly' || b.state === 'circle' ? 'fly' : 'takeoff';
    b.timer = b.state === 'takeoff' ? (b.kind === 'pelican' && this.onWater(b) ? 1.1 : 0.7) : 0;
    if (b.state === 'takeoff') this.hooks!.sfx('flap', b.x, b.z);
  }

  private onWater(b: Bird): boolean {
    return this.world.heightAt(b.x, b.z) < -0.05 && b.kind === 'pelican' && b.y <= this.hooks!.seaLevel + 0.05;
  }

  /** Something alarming close by: take off and go somewhere quieter. */
  private flee(b: Bird, fx: number, fz: number): void {
    const list = b.kind === 'heron' ? this.wadeSpots : this.restSpots.concat(this.seaSpots);
    const s = this.pickSpot(b, list, WATERBIRDS.relocate, fx, fz) ?? this.pickSpot(b, list, 60, fx, fz);
    if (s) this.fly(b, s.x, s.z, s.water ? 'swim' : 'rest', s);
  }

  private grounded(b: Bird): boolean {
    return b.state !== 'fly' && b.state !== 'takeoff' && b.state !== 'circle' && b.state !== 'dive' && b.state !== 'land';
  }

  private reactions(b: Bird): void {
    const h = this.hooks!;
    // Dogs: a running dog sends them up at once.
    for (const d of h.dogs()) {
      const dd = Math.hypot(d.x - b.x, d.z - b.z);
      if (dd < 3.5 || (dd < 7 && d.speed > 1.2)) {
        this.flee(b, d.x, d.z);
        return;
      }
    }
    let nearest = Infinity, nx = 0, nz = 0;
    h.people.query(b.x, b.z, WATERBIRDS.alertRange, (p) => {
      if (p.hidden) return;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < nearest) {
        nearest = d;
        nx = p.x;
        nz = p.z;
      }
    });
    if (nearest < WATERBIRDS.fleeRange) this.flee(b, nx, nz);
    else if (nearest < WATERBIRDS.alertRange && b.state !== 'alert' && b.state !== 'strike' && b.state !== 'swallow') {
      b.state = 'alert';
      b.timer = this.rng.range(1.2, 2.5);
      b.heading = Math.atan2(nx - b.x, nz - b.z) + Math.PI * 0.6 * (this.rng.next() - 0.5);
    }
  }

  private think(b: Bird, dt: number): void {
    const h = this.hooks!;
    const w = this.world;
    const r = this.rng;
    b.phase += dt;
    b.hunger = Math.max(0, b.hunger - dt / WATERBIRDS.hungerSeconds);
    b.hold = Math.max(0, b.hold - dt);
    // Reactions a few times a second (staggered), only while on the ground or water.
    b.react -= dt;
    if (b.react <= 0) {
      b.react = 0.3 + r.next() * 0.15;
      if (this.grounded(b)) this.reactions(b);
    }
    const sea = h.seaLevel;
    switch (b.state) {
      case 'takeoff': {
        // Running / pattering along the water, then lifting away with big wingbeats.
        b.timer -= dt;
        const a = Math.atan2(b.tx - b.x, b.tz - b.z);
        b.heading = turn(b.heading, a, dt * 3);
        const sp = b.kind === 'pelican' ? 1.6 : 1.1;
        b.x += Math.sin(b.heading) * sp * dt;
        b.z += Math.cos(b.heading) * sp * dt;
        b.y += (b.timer < 0.5 ? 1.8 : 0.5) * dt;
        if (b.timer <= 0) b.state = 'fly';
        break;
      }
      case 'fly': {
        const dx = b.tx - b.x, dz = b.tz - b.z;
        const d = Math.hypot(dx, dz);
        // On the final approach: slow down and turn tighter, so it never circles the spot.
        const sp = (b.kind === 'pelican' ? WATERBIRDS.pelicanSpeed : WATERBIRDS.heronSpeed) * THREE.MathUtils.clamp(d / 3, 0.35, 1);
        b.heading = turn(b.heading, Math.atan2(dx, dz), dt * (d < 4 ? 7 : 1.6));
        b.x += Math.sin(b.heading) * sp * dt;
        b.z += Math.cos(b.heading) * sp * dt;
        const ground = Math.max(w.heightAt(b.x, b.z), sea);
        const cruise = ground + (b.kind === 'pelican' ? 2.4 : 1.9) + Math.sin(b.phase * 0.3) * 0.3;
        const land = this.spotY(b.spot, b.tx, b.tz);
        const want = d < 6 ? land + (d / 6) * (cruise - land) : cruise;
        b.y += (want - b.y) * Math.min(1, dt * 1.2);
        if (b.next === 'hunt' && b.kind === 'pelican' && d < 5) {
          b.state = 'circle';
          b.timer = r.range(4, 11);
          break;
        }
        if (d < 0.45) {
          b.state = 'land';
          b.timer = 0.6;
        }
        break;
      }
      case 'land': {
        b.timer -= dt;
        const land = this.spotY(b.spot, b.x, b.z);
        b.y += (land - b.y) * Math.min(1, dt * 6);
        if (b.timer <= 0) {
          b.y = land;
          this.arrive(b);
        }
        break;
      }
      case 'circle': {
        // Wheeling over the fish, each at its own radius and speed, before picking one to dive on.
        const tgt = b.school >= 0 ? h.schools()[b.school] : null;
        if (tgt) {
          // Follow the school as it moves (or give up if it's gone far).
          b.tx += (tgt.x - b.tx) * Math.min(1, dt * 0.5);
          b.tz += (tgt.z - b.tz) * Math.min(1, dt * 0.5);
        }
        const rad = 2.5 + (b.id % 3) * 0.8;
        const ang = Math.atan2(b.z - b.tz, b.x - b.tx) + (dt * WATERBIRDS.pelicanSpeed) / rad * (b.id % 2 ? 1 : -1);
        const cx = b.tx + Math.cos(ang) * rad, cz = b.tz + Math.sin(ang) * rad;
        b.heading = turn(b.heading, Math.atan2(cx - b.x, cz - b.z), dt * 3);
        b.x += Math.sin(b.heading) * WATERBIRDS.pelicanSpeed * dt;
        b.z += Math.cos(b.heading) * WATERBIRDS.pelicanSpeed * dt;
        b.y += (sea + 3.2 + (b.id % 4) * 0.25 - b.y) * Math.min(1, dt);
        b.timer -= dt;
        if (b.timer <= 0) {
          const deep = h.fishNear(b.x, b.z, 7);
          const reef = deep ? null : h.reefNear(b.x, b.z, 7);
          if (deep) {
            b.school = deep.school;
            b.reef = null;
            b.preyX = deep.x;
            b.preyZ = deep.z;
          } else if (reef) {
            b.school = -1;
            b.reef = reef;
            b.preyX = reef.x;
            b.preyZ = reef.z;
          } else {
            // The fish have moved on: give up, or look again nearby.
            if (r.chance(0.5)) this.goHunt(b);
            else this.goRest(b);
            break;
          }
          b.state = 'dive';
        }
        break;
      }
      case 'dive': {
        // A steep plunge onto the fish, wings swept back.
        const dx = b.preyX - b.x, dz = b.preyZ - b.z, dy = sea - b.y;
        const d = Math.hypot(dx, dy, dz) || 1;
        const sp = 7;
        b.x += (dx / d) * sp * dt;
        b.z += (dz / d) * sp * dt;
        b.y += (dy / d) * sp * dt;
        b.heading = turn(b.heading, Math.atan2(dx, dz), dt * 6);
        if (b.y <= sea + 0.03) {
          b.y = sea - 0.06;
          h.splash(b.x, b.z, 45, 1.8, 0.25);
          h.sfx('splash', b.x, b.z);
          h.scatterDeep(b.x, b.z, 3);
          h.scatterReef(b.x, b.z, 2.5);
          b.caught = r.next() < WATERBIRDS.pelicanCatch && (b.school >= 0 ? h.takeFish(b.school) : !!b.reef && (h.takeReef(b.reef), true));
          b.state = 'under';
          b.timer = 0.55;
        }
        break;
      }
      case 'under':
        b.timer -= dt;
        if (b.timer <= 0) {
          b.y = sea;
          b.state = b.caught ? 'swallow' : 'swim';
          b.timer = b.caught ? 1.8 : r.range(3, 8);
          if (b.caught) b.hold = 1.1;
        }
        break;
      case 'swallow':
        b.timer -= dt;
        if (b.timer <= 0) {
          b.hunger = Math.min(1, b.hunger + (b.kind === 'pelican' ? 0.45 : 0.35));
          b.caught = false;
          if (b.kind === 'heron') {
            b.state = 'watch';
            b.timer = r.range(6, 14);
          } else if (b.hunger < 0.5 && this.active()) this.goHunt(b);
          else {
            b.state = 'swim';
            b.timer = r.range(8, 20);
          }
        }
        break;
      case 'watch': {
        // Heron: dead still, neck out, peering down; strike when a fish comes within reach.
        b.timer -= dt;
        const tipX = b.x + Math.sin(b.heading) * 0.22, tipZ = b.z + Math.cos(b.heading) * 0.22;
        const f = h.reefNear(tipX, tipZ, WATERBIRDS.strikeReach);
        if (!f && b.hold <= 0) {
          // A fish a little way off: stalk toward it, one slow step at a time.
          const far = h.reefNear(b.x, b.z, 2.2);
          if (far && r.chance(dt * 1.0)) {
            const a = Math.atan2(far.x - b.x, far.z - b.z);
            const x = b.x + Math.sin(a) * 0.45, z = b.z + Math.cos(a) * 0.45;
            if (this.wadeable(x, z)) {
              b.state = 'walk';
              b.tx = x;
              b.tz = z;
              b.timer = 6;
              b.next = 'hunt';
              break;
            }
          }
        }
        if (f && b.hold <= 0) {
          b.heading = turn(b.heading, Math.atan2(f.x - b.x, f.z - b.z), dt * 1.5);
          // Wait a beat, then strike.
          if (r.chance(dt * 1.4)) {
            b.state = 'strike';
            b.timer = 0.2;
            b.reef = f;
          }
        } else if (b.timer <= 0) {
          // Nothing coming: a few slow steps to a new position, or fly to another feeding place.
          if (r.chance(0.6)) {
            const a = b.heading + r.range(-1.2, 1.2), dd = r.range(0.4, 1.4);
            const x = b.x + Math.sin(a) * dd, z = b.z + Math.cos(a) * dd;
            if (this.wadeable(x, z)) {
              b.state = 'walk';
              b.tx = x;
              b.tz = z;
              b.timer = 10;
              b.next = 'hunt';
              break;
            }
          }
          // Patience: usually it just keeps standing there; only now and then does it fly elsewhere.
          if (!this.active()) this.idle(b);
          else if (r.chance(0.55)) {
            b.state = r.chance(0.5) ? 'stand' : 'watch';
            b.timer = r.range(12, 30);
          } else if (b.hunger > 0.75) this.goRest(b);
          else this.goHunt(b);
        }
        break;
      }
      case 'strike':
        b.timer -= dt;
        if (b.timer <= 0) {
          const f = b.reef;
          const tipX = b.x + Math.sin(b.heading) * 0.3, tipZ = b.z + Math.cos(b.heading) * 0.3;
          h.splash(tipX, tipZ, 10, 0.9, 0.08);
          h.scatterReef(tipX, tipZ, 1.4);
          b.caught = !!f && f.gone <= 0 && Math.hypot(f.x - tipX, f.z - tipZ) < WATERBIRDS.strikeReach + 0.2 && r.next() < WATERBIRDS.heronCatch;
          if (b.caught && f) h.takeReef(f);
          b.state = 'recover';
          b.timer = 0.45;
        }
        break;
      case 'recover':
        b.timer -= dt;
        if (b.timer <= 0) {
          if (b.caught) {
            b.state = 'swallow';
            b.timer = 1.4;
            b.hold = 0.9;
          } else {
            b.state = 'watch';
            b.timer = r.range(5, 12);
          }
        }
        break;
      case 'walk': {
        // Slow, deliberate steps.
        const sp = b.kind === 'heron' ? 0.16 : 0.3;
        const dx = b.tx - b.x, dz = b.tz - b.z;
        const d = Math.hypot(dx, dz);
        b.timer -= dt;
        if (d < 0.08 || b.timer <= 0) {
          if (b.next === 'hunt' && b.kind === 'heron') {
            b.state = 'watch';
            b.timer = r.range(15, 35);
          } else this.idle(b);
          break;
        }
        b.heading = turn(b.heading, Math.atan2(dx, dz), dt * 2);
        const step = Math.max(0, Math.sin(b.legPh * Math.PI * 2)) * 2;
        b.legPh += dt * (b.kind === 'heron' ? 0.7 : 1.4);
        b.x += Math.sin(b.heading) * sp * step * dt;
        b.z += Math.cos(b.heading) * sp * step * dt;
        b.y = this.spotY(null, b.x, b.z);
        break;
      }
      case 'swim': {
        // Floating: a slow paddle and drift.
        b.timer -= dt;
        b.heading += Math.sin(b.phase * 0.3 + b.id) * dt * 0.3;
        if (w.heightAt(b.x + Math.sin(b.heading) * 0.5, b.z + Math.cos(b.heading) * 0.5) < -0.2) {
          b.x += Math.sin(b.heading) * 0.12 * dt;
          b.z += Math.cos(b.heading) * 0.12 * dt;
        } else b.heading += dt * 1.5;
        b.y = sea;
        if (b.timer <= 0) this.idle(b);
        break;
      }
      default:
        b.timer -= dt;
        if (b.state === 'alert') {
          if (b.timer <= 0) this.idle(b);
          break;
        }
        if (b.timer <= 0) this.idle(b);
    }
  }

  private spotY(s: Spot | null, x: number, z: number): number {
    const w = this.world;
    const sea = this.hooks!.seaLevel;
    const i = w.cellIndexAt(x, z);
    if (s?.water) return sea;
    const h = w.heightAt(x, z);
    if (i >= 0 && !Number.isNaN(w.riverY[i])) return h;
    return h < sea - 0.02 && !(s && !s.water) ? sea : h;
  }

  private wadeable(x: number, z: number): boolean {
    const w = this.world;
    const h = w.heightAt(x, z);
    const i = w.cellIndexAt(x, z);
    if (i < 0 || w.occ[i]) return false;
    const river = !Number.isNaN(w.riverY[i]);
    return (h > -WATERBIRDS.wadeDepth && h < 0.5) || (river && w.riverY[i] - h < WATERBIRDS.wadeDepth + 0.06);
  }

  private arrive(b: Bird): void {
    if (b.next === 'swim' || (b.spot?.water ?? false)) {
      b.state = 'swim';
      b.timer = this.rng.range(10, 30);
      return;
    }
    if (b.next === 'hunt' && b.kind === 'heron') {
      b.state = 'watch';
      b.timer = this.rng.range(15, 35);
      return;
    }
    this.idle(b);
  }

  /** Pick the next thing to do at rest: hunting if hungry (by day), else loafing about. */
  private idle(b: Bird): void {
    const r = this.rng;
    if (this.active() && b.hunger < WATERBIRDS.hungry && r.chance(0.7)) {
      this.goHunt(b);
      return;
    }
    if (!this.active()) {
      // Evening: settle down for the night where they are (or at a quiet spot).
      b.state = b.kind === 'heron' ? 'oneleg' : this.onWater(b) ? 'swim' : 'rest';
      b.timer = r.range(40, 120);
      return;
    }
    const x = r.next();
    if (b.kind === 'pelican') {
      if (this.onWater(b)) {
        b.state = x < 0.2 ? 'preen' : 'swim';
        b.timer = r.range(6, 20);
        if (x > 0.85) this.goRest(b);
        return;
      }
      if (x < 0.3) (b.state = 'rest'), (b.timer = r.range(15, 45));
      else if (x < 0.55) (b.state = 'stand'), (b.timer = r.range(6, 20));
      else if (x < 0.72) (b.state = 'preen'), (b.timer = r.range(4, 9));
      else if (x < 0.8) (b.state = 'stretch'), (b.timer = 1.8);
      else if (x < 0.92) {
        const a = r.range(0, 6.28), d = r.range(0.4, 1.5);
        b.state = 'walk';
        b.tx = b.x + Math.cos(a) * d;
        b.tz = b.z + Math.sin(a) * d;
        b.timer = 8;
        b.next = 'rest';
      } else {
        // Off for a swim or to a different beach.
        const s = this.pickSpot(b, r.chance(0.5) ? this.seaSpots : this.restSpots, 30);
        if (s) this.fly(b, s.x, s.z, s.water ? 'swim' : 'rest', s);
        else (b.state = 'stand'), (b.timer = 8);
      }
    } else {
      if (x < 0.35) (b.state = 'stand'), (b.timer = r.range(12, 40));
      else if (x < 0.55) (b.state = 'oneleg'), (b.timer = r.range(20, 60));
      else if (x < 0.7) (b.state = 'preen'), (b.timer = r.range(4, 9));
      else if (x < 0.85) {
        const a = b.heading + r.range(-1.5, 1.5), d = r.range(0.3, 1.2);
        const tx = b.x + Math.sin(a) * d, tz = b.z + Math.cos(a) * d;
        if (this.wadeable(tx, tz)) {
          b.state = 'walk';
          b.tx = tx;
          b.tz = tz;
          b.timer = 12;
          b.next = 'rest';
        } else (b.state = 'stand'), (b.timer = 15);
      } else this.goHunt(b);
    }
  }

  private goRest(b: Bird): void {
    const list = b.kind === 'heron' ? this.wadeSpots.concat(this.restSpots) : this.restSpots.concat(this.seaSpots);
    const s = this.pickSpot(b, list, 45);
    if (s) this.fly(b, s.x, s.z, s.water ? 'swim' : 'rest', s);
    else this.idleStand(b);
  }

  private idleStand(b: Bird): void {
    b.state = 'stand';
    b.timer = this.rng.range(8, 20);
  }

  /** Head off to feed: pelicans to a fish school (or a canoe netting), herons to fishy shallows. */
  private goHunt(b: Bird): void {
    const h = this.hooks!;
    const r = this.rng;
    if (b.kind === 'pelican') {
      const canoes = h.canoes();
      if (canoes.length && r.chance(WATERBIRDS.followCanoe)) {
        const c = canoes[r.int(0, canoes.length - 1)];
        if (Math.hypot(c.x - b.x, c.z - b.z) < 70) {
          b.school = -1;
          this.fly(b, c.x + r.range(-3, 3), c.z + r.range(-3, 3), 'hunt', null);
          return;
        }
      }
      // The nearest school with fish in it (deep water), or a reef school near the shore.
      let best = -1, bd = 80;
      h.schools().forEach((s, i) => {
        if (s.stock < 3) return;
        const d = Math.hypot(s.x - b.x, s.z - b.z) + r.range(0, 12);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      const reefs = h.reefSchools();
      const rs = reefs.length ? reefs[r.int(0, reefs.length - 1)] : null;
      if (best >= 0 && (!rs || r.chance(0.6))) {
        const s = h.schools()[best];
        b.school = best;
        this.fly(b, s.x, s.z, 'hunt', null);
      } else if (rs && Math.hypot(rs.x - b.x, rs.z - b.z) < 60) {
        b.school = -1;
        this.fly(b, rs.x, rs.z, 'hunt', null);
      } else this.idleStand(b);
      return;
    }
    // Heron: start from a few real fish in shallow water and find the wading spot nearest each
    // (herons go where the fish are), traded off against distance and disturbance.
    const fish = h.reefFish();
    let best: Spot | null = null, bs = -Infinity;
    for (let k = 0; k < 12 && fish.length; k++) {
      const f = fish[r.int(0, fish.length - 1)];
      if (f.gone > 0 || this.world.heightAt(f.x, f.z) < -0.7) continue;
      let spot: Spot | null = null, sd = 3;
      for (const s2 of this.wadeSpots) {
        const d = Math.hypot(s2.x - f.x, s2.z - f.z);
        if (d < sd) {
          sd = d;
          spot = s2;
        }
      }
      if (!spot) continue;
      const sc = this.score('heron', spot) - sd * 0.8 - Math.hypot(spot.x - b.x, spot.z - b.z) * 0.02;
      if (sc > bs) {
        bs = sc;
        best = spot;
      }
    }
    // No fish near any shallows right now: wait at a quiet wading spot anyway.
    if (!best) best = this.pickSpot(b, this.wadeSpots, 40);
    if (!best) return this.idleStand(b);
    if (Math.hypot(best.x - b.x, best.z - b.z) < 3) {
      b.state = 'walk';
      b.tx = best.x;
      b.tz = best.z;
      b.timer = 20;
      b.next = 'hunt';
    } else this.fly(b, best.x, best.z, 'hunt', best);
  }

  // ---------------- Drawing ----------------

  private draw(dt: number): void {
    const m = this.meshes;
    m.begin();
    const k = Math.min(1, dt * 5);
    for (const b of this.list) {
      if (!View.sees(b.x, b.y + 0.15, b.z, 0.5)) continue;
      const air = b.state === 'fly' || b.state === 'takeoff' || b.state === 'circle' || b.state === 'dive' || b.state === 'land';
      const t = b.phase;
      // ---- Wings ----
      let foldT = air ? 0 : 1, ampT = 0;
      if (b.state === 'takeoff') ampT = 1;
      else if (b.state === 'fly') ampT = Math.sin(t * 0.45 + b.id) > 0.25 ? 0.06 : b.kind === 'heron' ? 0.55 : 0.5;
      else if (b.state === 'circle') ampT = Math.sin(t * 0.6 + b.id) > 0.6 ? 0.4 : 0.05;
      else if (b.state === 'land') ampT = 0.7;
      else if (b.state === 'stretch') {
        foldT = 0.15;
        ampT = 0.25;
      } else if (b.state === 'dive') foldT = 0.75;
      b.fold += (foldT - b.fold) * Math.min(1, dt * (foldT > b.fold ? 5 : 9));
      b.amp += (ampT - b.amp) * k;
      b.flap += dt * (b.kind === 'heron' ? 5.2 : 6) * (b.state === 'takeoff' ? 1.6 : 1);
      // ---- Neck and head (body frame): n1 base tilt, n2 bend, hp head pitch ----
      let n1 = 0, n2 = 0, hp = 0, hy = 0, pitch = 0, sit = 0, one = 0;
      if (b.kind === 'pelican') {
        // Pelicans fly with the head drawn back onto the shoulders; dive with the neck stretched out.
        if (air) [n1, n2, hp] = b.state === 'dive' ? [1.5, 0, 0] : [0.35, -0.95, 0.1];
        else if (b.state === 'swallow') [n1, n2, hp] = [-0.2, 0.2, -1.1 + Math.sin(t * 9) * 0.15];
        else if (b.state === 'preen') [n1, n2, hp, hy] = [-0.1, 1.8, 1.2, Math.sin(t * 1.3) * 1.2];
        else if (b.state === 'alert') [n1, n2, hp] = [-0.15, 0.1, 0.05];
        else [n1, n2, hp] = [-0.1, 0.45, 0.65 + Math.sin(t * 0.3) * 0.08];
        if (b.state === 'rest') sit = 1;
        if (b.state === 'dive') pitch = 1.25;
        else if (air) pitch = -0.05;
        else pitch = this.onWater(b) || b.state === 'swim' ? 0.05 : -0.18;
      } else {
        // Herons fly and rest with the neck folded into an S; hunt with it stretched out, bill down.
        if (air) [n1, n2, hp] = [0.95, -2.1, 0];
        else if (b.state === 'watch') [n1, n2, hp] = [0.95, -0.15, 0.95];
        else if (b.state === 'strike') [n1, n2, hp] = [1.4, 0.35, 0.95];
        else if (b.state === 'recover') [n1, n2, hp] = [0.7, -0.2, 0.5];
        else if (b.state === 'swallow') [n1, n2, hp] = [0.1, -0.1, -0.9 + Math.sin(t * 8) * 0.12];
        else if (b.state === 'preen') [n1, n2, hp, hy] = [0.3, 1.6, 1.1, Math.sin(t * 1.2) * 1.2];
        else if (b.state === 'alert') [n1, n2, hp] = [0.1, -0.1, 0.0];
        else [n1, n2, hp] = [0.5, -1.05, 0.05];
        if (b.state === 'oneleg') one = 1;
        pitch = air ? 0.1 : b.state === 'watch' || b.state === 'strike' ? 0.25 : -0.3;
      }
      const nk = b.state === 'strike' ? Math.min(1, dt * 28) : k;
      b.n1 += (n1 - b.n1) * nk;
      b.n2 += (n2 - b.n2) * nk;
      b.hp += (hp - b.hp) * nk;
      b.hy += (hy - b.hy) * k;
      b.pitch += (pitch - b.pitch) * Math.min(1, dt * 4);
      b.sit += (sit - b.sit) * Math.min(1, dt * 2.5);
      b.oneLeg += (one - b.oneLeg) * Math.min(1, dt * 2);
      if (b.kind === 'pelican') this.drawPelican(b, air);
      else this.drawHeron(b, air);
    }
    m.end();
  }

  private wings(prefix: string, root: [number, number, number], spec: typeof PELICAN_WING, b: Bird): void {
    flapPose(b.flap, b.amp, _fp, b.kind === 'pelican' ? 0.05 : 0.15, 0.22);
    if (b.state === 'land') _fp.f1 += 0.5;
    mixPose(_fp, FOLDED, b.fold, _wp);
    for (const side of [1, -1] as const) {
      wingMatrices(_b, side, root, spec, _wp, _wm);
      for (let k = 0; k < 3; k++) this.meshes.put(`${prefix}${side === 1 ? k : k + 3}`, _wm[k], WHITE);
    }
  }

  private neckHead(prefix: string, base: [number, number, number], lens: [number, number], b: Bird): void {
    _n.multiplyMatrices(_b, compose(_t, base[0], base[1], base[2], b.n1, 0, 0));
    this.meshes.put(`${prefix}Neck0`, _n, WHITE);
    _n.multiply(compose(_t, 0, lens[0], 0, b.n2, 0, 0));
    this.meshes.put(`${prefix}Neck1`, _n, WHITE);
    // Head: bill along +z; its pitch is relative to the body, so undo the neck's bend.
    _n.multiply(compose(_t, 0, lens[1], 0, b.hp - b.n1 - b.n2, b.hy, 0));
    this.meshes.put(`${prefix}Head`, _n, WHITE);
    if (b.hold > 0) {
      _m.multiplyMatrices(_n, compose(_t, 0, -0.01, b.kind === 'pelican' ? 0.12 : 0.1, 0, Math.PI / 2, 0));
      this.meshes.put('fish', _m, WHITE);
    }
  }

  private drawPelican(b: Bird, air: boolean): void {
    const s = b.scale;
    const legH = PEL.leg - PEL.hip[1];
    const swim = b.state === 'swim' || b.state === 'swallow' || b.state === 'preen' && this.onWater(b) || b.state === 'under';
    const yOff = air ? 0 : swim ? 0.035 : legH * (1 - b.sit * 0.7);
    const bob = swim ? Math.sin(b.phase * 1.6 + b.id) * 0.008 : 0;
    compose(_b, b.x, b.y + (yOff + bob) * s, b.z, b.pitch, b.heading, 0, s);
    this.meshes.put('pBody', _b, WHITE);
    this.neckHead('p', PEL.neckBase, PEL.neck, b);
    this.wings('pW', PEL.wingRoot, PELICAN_WING, b);
    // Legs: down to stand and waddle, folded back in flight, tucked while floating or sitting.
    if (!swim) {
      const walk = b.state === 'walk' ? Math.sin(b.legPh * Math.PI * 2) * 0.45 : 0;
      for (const side of [1, -1]) {
        const a = air ? 1.35 : b.sit > 0.5 ? 1.2 : walk * side;
        _m.multiplyMatrices(_b, compose(_t, side * 0.025, PEL.hip[1], PEL.hip[2], a, 0, 0));
        this.meshes.put('pLeg', _m, WHITE);
      }
    }
  }

  private drawHeron(b: Bird, air: boolean): void {
    const s = b.scale;
    // Legs straight down when standing (a step swings one forward), trailing straight back in flight.
    const legs: [number, number][] = [];
    for (const side of [1, -1]) {
      let u = 0.2, l = -0.4;
      if (air) {
        // Legs trailing straight out behind (positive swings a leg back).
        u = 1.45;
        l = 0.05;
        if (b.state === 'land') {
          u = -0.3;
          l = 0.2;
        }
      } else if (b.state === 'walk') {
        const ph = b.legPh * Math.PI * 2 + (side > 0 ? 0 : Math.PI);
        const sw = Math.sin(ph);
        u = 0.2 + sw * 0.35;
        l = -0.4 - Math.max(0, Math.cos(ph)) * 0.9;
      }
      if (side > 0 && b.oneLeg > 0) {
        // Resting on one leg: the other drawn up under the belly, folded back at the ankle.
        u = u + (-0.55 - u) * b.oneLeg;
        l = l + (2.5 - l) * b.oneLeg;
      }
      legs.push([u, l]);
    }
    const [u0, l0] = legs[1];
    const stand = HER.legU * Math.cos(u0) + HER.legL * Math.cos(u0 + l0) - HER.hip[1];
    compose(_b, b.x, b.y + (air ? 0 : stand) * s, b.z, b.pitch, b.heading, 0, s);
    this.meshes.put('hBody', _b, WHITE);
    this.neckHead('h', HER.neckBase, HER.neck, b);
    this.wings('hW', HER.wingRoot, HERON_WING, b);
    legs.forEach(([u, l], i) => {
      const side = i === 0 ? 1 : -1;
      _m.multiplyMatrices(_b, compose(_t, side * HER.hip[0], HER.hip[1], HER.hip[2], u - b.pitch * (air ? 0 : 1), 0, 0));
      this.meshes.put('hLegU', _m, WHITE);
      _m.multiply(compose(_t, 0, -HER.legU, 0, l, 0, 0));
      this.meshes.put('hLegL', _m, WHITE);
    });
  }

  /** Grounded birds near a point (for dogs to chase). */
  groundedNear(x: number, z: number, r: number): { x: number; z: number } | null {
    for (const b of this.list) if (this.grounded(b) && Math.hypot(b.x - x, b.z - z) < r) return b;
    return null;
  }

  describe(b: Bird): string {
    return b.state;
  }
}

function turn(h: number, a: number, k: number): number {
  let d = a - h;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return h + d * Math.min(1, k);
}
