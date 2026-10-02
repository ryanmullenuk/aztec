import * as THREE from 'three';
import type { Where } from '../ui/where';
import { GOODS, GOOD_KEYS, GoodKey, ResourceKey, TRADE, VOYAGE } from '../config';
import { Building, BuildingSystem } from '../buildings/Buildings';
import { Economy } from '../economy/Economy';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { patchStylised } from '../render/materials';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import type { Colony } from '../ai/Colony';
import type { Islander } from './Islander';
import { BOAT_SCALE, BoatLook, Boats, boatGeometry, HULL_BEAM, HULL_HALF, newRide, Vessel } from './Boats';
import { Hull } from './fleet';

/** What can go in the hold: stores (not Belief) and precious goods. */
export type CargoKey = Exclude<ResourceKey, 'belief'> | GoodKey;
export const CARGO_KEYS: CargoKey[] = ['wood', 'stone', 'grain', 'fruit', 'meat', 'fish', 'pearls', 'herbs', 'spices'];
export type Hold = Partial<Record<CargoKey, number>>;

/** What a voyage brings home. */
export interface Haul {
  res: Partial<Record<ResourceKey, number>>;
  goods: Partial<Record<GoodKey, number>>;
  chickens: number;
}

export type VoyEvent = 'storm' | 'raiders' | 'market' | 'winds' | 'becalmed' | 'isle';

/** The villagers aboard, kept as saved islander data while they're away. */
export type CrewData = Partial<Islander> & { id: number; name: string; gender: 'm' | 'f' };

const isGood = (k: CargoKey): k is GoodKey => (GOOD_KEYS as string[]).includes(k);

/** Worth of a hold abroad. */
export function holdValue(h: Hold): number {
  let v = 0;
  for (const [k, n] of Object.entries(h)) v += (n ?? 0) * (VOYAGE.values[k] ?? 1);
  return v;
}

/** Things that will happen out there: when (seconds into the voyage) and what. */
export function rollEvents(rng: RNG, total: number): { at: number; kind: VoyEvent }[] {
  const n = rng.int(VOYAGE.events[0], VOYAGE.events[1]);
  const kinds = Object.keys(VOYAGE.odds) as VoyEvent[];
  const tot = kinds.reduce((s, k) => s + VOYAGE.odds[k], 0);
  const out: { at: number; kind: VoyEvent }[] = [];
  for (let i = 0; i < n; i++) {
    let r = rng.next() * tot, kind = kinds[0];
    for (const k of kinds) if ((r -= VOYAGE.odds[k]) <= 0) {
      kind = k;
      break;
    }
    out.push({ at: total * rng.range(0.12, 0.8), kind });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Lose a share of everything in the hold (storm damage, raiders). */
export function spoil(h: Hold, share: number): Hold {
  const lost: Hold = {};
  for (const [k, n] of Object.entries(h) as [CargoKey, number][]) {
    const l = Math.round(n * share);
    if (l > 0) {
      lost[k] = l;
      h[k] = n - l;
    }
  }
  return lost;
}

/**
 * What the hold is traded for abroad: chickens, herbs and spices, and the rest in the stores the
 * island is shortest of (by `stock`). Worth the hold's value times the voyage's luck.
 */
export function voyageHaul(hold: Hold, mult: number, rng: RNG, stock: Record<ResourceKey, number>, bonus?: Partial<Haul>): Haul {
  const V = holdValue(hold) * mult * rng.range(VOYAGE.rate[0], VOYAGE.rate[1]);
  const haul: Haul = { res: {}, goods: {}, chickens: 0 };
  if (V < 1) return haul;
  haul.chickens = Math.min(VOYAGE.maxChickens, Math.max(V > 30 ? 1 : 0, Math.round((V * 0.12) / VOYAGE.chickenValue)));
  const herbs = Math.max(V > 20 ? 1 : 0, Math.round((V * 0.22) / GOODS.herbs.value));
  const spices = Math.max(V > 25 ? 1 : 0, Math.round((V * 0.2) / GOODS.spices.value));
  if (herbs) haul.goods.herbs = herbs;
  if (spices) haul.goods.spices = spices;
  let rest = V - haul.chickens * VOYAGE.chickenValue - herbs * GOODS.herbs.value - spices * GOODS.spices.value;
  // The rest in what the village is shortest of (two kinds).
  const kinds = (['wood', 'stone', 'grain', 'fruit', 'meat', 'fish'] as ResourceKey[]).sort((a, b) => stock[a] - stock[b] + (rng.next() - 0.5) * 4);
  for (const k of kinds.slice(0, 2)) {
    const n = Math.round(Math.max(0, rest / 2) / (VOYAGE.values[k] ?? 1));
    if (n > 0) haul.res[k] = n;
  }
  rest = 0;
  if (bonus) {
    haul.chickens = Math.min(VOYAGE.maxChickens + 4, haul.chickens + (bonus.chickens ?? 0));
    for (const [k, n] of Object.entries(bonus.goods ?? {}) as [GoodKey, number][]) haul.goods[k] = (haul.goods[k] ?? 0) + n;
  }
  return haul;
}

export const haulText = (h: Haul): string => {
  const parts: string[] = [];
  if (h.chickens) parts.push(`${h.chickens} chicken${h.chickens === 1 ? '' : 's'}`);
  for (const [k, n] of Object.entries(h.goods) as [GoodKey, number][]) if (n) parts.push(`${n} ${GOODS[k].name.toLowerCase()}`);
  for (const [k, n] of Object.entries(h.res) as [ResourceKey, number][]) if (n) parts.push(`${n} ${k}`);
  return parts.join(', ') || 'nothing';
};

/** The voyage ship: a deep blue hull, a great crimson sail with a gold sun stripe. */
const VOYAGE_LOOK: BoatLook = { hull: 0x2a4a6a, keel: 0x1b3348, inner: 0x3a2a1c, deck: 0x7a5230, rim: 0xe0b43c, sail: 0xb3342a, stripe: 0xe9c050, band: 0x2a4a6a };
/** Much bigger than the canoes and trade boats. */
const SHIP_SCALE = 2.05;

/** On deck: a thatched shelter at the stern, chests and jars, coiled rope and a long pennant. */
function deckGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.box(0.4, 0.22, 0.34), { color: 0x7a5230 }, M.t(0, 0.3, -0.58));
  b.add(P.cone(0.34, 0.2, 4), { color: 0xd9a95b, leaf: 0.2 }, M.t(0, 0.5, -0.58, 0, Math.PI / 4, 0, 1, 1, 0.8));
  for (const [x, z, c] of [[-0.1, 0.32, 0xa87a4a], [0.1, 0.4, 0x94663c], [0, 0.58, 0xa87a4a]] as [number, number, number][]) b.add(P.rbox(0.16, 0.13, 0.16, 0.02), { color: c }, M.t(x, 0.25, z, 0, x * 3, 0));
  for (const x of [-0.12, 0.12]) b.add(P.uvSphere(0.07, 7, 5), { color: 0xb5653a }, M.t(x, 0.25, -0.18, 0, 0, 0, 1, 1.25, 1));
  b.add(new THREE.TorusGeometry(0.07, 0.025, 4, 10).rotateX(Math.PI / 2), { color: 0xc9a86a }, M.t(0.13, 0.2, 0.1));
  // A crimson foresail on a short bow mast, and a lantern at the stern.
  b.add(P.cyl(0.018, 0.022, 0.75, 5), { color: 0x5e3b22 }, M.t(0, 0.52, 0.66, 0.18, 0, 0));
  const jib = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.88, 0.72), new THREE.Vector3(0, 0.3, 0.98), new THREE.Vector3(0, 0.3, 0.6)]);
  jib.setIndex([0, 1, 2, 0, 2, 1]);
  jib.computeVertexNormals();
  b.add(jib, { color: 0xb3342a, sway: 0.4 });
  b.add(P.cyl(0.006, 0.006, 0.3, 3), { color: 0x5e3b22 }, M.t(0.16, 0.6, -0.78));
  b.add(P.box(0.06, 0.07, 0.06), { color: 0xf2c94c }, M.t(0.16, 0.76, -0.78));
  b.add(P.box(0.02, 0.07, 0.42), { color: 0xe9c050, sway: 0.6 }, M.t(0, 1.3, 0.22));
  b.add(P.box(0.02, 0.05, 0.3), { color: 0xb3342a, sway: 0.6 }, M.t(0, 1.22, 0.26));
  return b.build();
}

/** A soft round glow (for the orbs). */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface VoyageHooks {
  notify: (msg: string, kind?: 'info' | 'warn', at?: Where) => void;
  sfx: (name: string, x: number, z: number) => void;
  /** Put a chicken down near (x, z); false if no more can be kept. */
  addChicken: (x: number, z: number) => boolean;
  /** Moored visitors with bargains still on offer (for their orbs). */
  visitorOrbs: () => { x: number; z: number; dock: number }[];
}

interface Ship extends Vessel {
  mesh: THREE.Group;
}

/**
 * The village's voyage ship. Built at a Trade Dock (one on the island); the player loads it with
 * goods from the stores (pearls are worth most) and sends it off with a crew of villagers. It sails
 * out past the edge of the map and is away for a few minutes, while things happen out there:
 * storms (which can be calmed from afar with Belief, if the player acts on the news in time),
 * raiders, good markets, fair winds or flat calm, an island with chickens and herbs. Then it comes
 * home and waits at the dock, a green orb glowing over it, until the player unloads what it brought:
 * chickens, herbs and spices for healing, and stores. Sometimes it never comes back, and its crew
 * are lost. Visiting traders with bargains get a green orb over their boat too.
 */
export class Voyages {
  readonly group = new THREE.Group();
  /** Trade Dock the ship belongs to (-1: none built). */
  dock = -1;
  state: 'none' | 'building' | 'docked' | 'out' | 'away' | 'back' = 'none';
  /** Seconds of building done. */
  build = 0;
  hold: Hold = {};
  /** Brought home and waiting to be unloaded. */
  haul: Haul | null = null;
  /** Seconds left away, the voyage's length, where it went and how its luck runs. */
  timer = 0;
  total = 0;
  place = '';
  mult = 1;
  bonus: Partial<Haul> = {};
  events: { at: number; kind: VoyEvent; done: boolean }[] = [];
  /** A storm raging out there: seconds left to calm it (> 0), and whether it was calmed. */
  storm = 0;
  calmed = false;
  /** It will not come back (but nobody knows for sure until it's overdue). */
  doomed = '';
  crew: CrewData[] = [];
  /** News from the voyage, newest last. */
  log: string[] = [];
  voyages = 0;
  hooks: VoyageHooks | null = null;
  private ship: Ship | null = null;
  private path: { x: number; z: number }[] = [];
  private idx = 0;
  private mooring = false;
  /** Out past the map edge: where it vanishes and reappears. */
  private far = { x: 0, z: 0 };
  private rng = new RNG(Math.floor(Math.random() * 1e9));
  private hull = boatGeometry(true, VOYAGE_LOOK);
  private deck = deckGeometry();
  private mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
  private orbTex = glowTexture();
  private orbs: THREE.Sprite[] = [];
  private orbAt: { x: number; y: number; z: number; dock: number }[] = [];
  private time = 0;

  constructor(private world: World, private bld: BuildingSystem, private eco: Economy, private boats: Boats, private colony: Colony) {
    boats.fleets.push(() => this.hulls());
    this.group.name = 'voyage';
  }

  // ---------------- Queries ----------------

  get exists(): boolean {
    return this.state !== 'none';
  }

  private hulls(): Hull[] {
    const s = this.ship;
    if (!s || this.state === 'away' || this.state === 'building' || this.offMap()) return [];
    return [{ x: s.x, z: s.z, heading: s.heading, half: HULL_HALF * SHIP_SCALE, beam: HULL_BEAM * SHIP_SCALE, speed: s.speed, pri: 300, moored: this.state === 'docked', ref: s }];
  }

  private offMap(): boolean {
    const s = this.ship, H = this.world.half - 2;
    return !!s && (Math.abs(s.x) > H || Math.abs(s.z) > H);
  }

  /**
   * Where the ship moors: on the far side of the pier from the trade boats, or (where that's
   * shallow or ashore) further out off the pier end. The first spot in open, deep enough water.
   */
  private berth(dock: Building) {
    const o = TRADE.berthOut;
    let best = this.boats.berth(dock, 0.5, 1.3, 0.5, o + 3), deepest = Infinity;
    for (const out of [0.35, 1.6, 2.8, 4, 5.5, 7]) {
      for (const slot of [-1, 2, -2, 3, 0.5]) {
        const b = this.boats.berth(dock, slot, 1.3, 0.5, o + out);
        if (!this.boats.open(b.x, b.z)) continue;
        const h = this.world.heightAt(b.x, b.z);
        if (h < -0.45) return b;
        if (h < deepest) {
          deepest = h;
          best = b;
        }
      }
    }
    return best;
  }

  /** Why the ship can't be built here now (null: it can). */
  whyNotBuild(dock: Building): string | null {
    if (!dock.complete) return 'The Trade Dock is not finished yet';
    if (this.state !== 'none') return this.dock === dock.id ? 'This dock already has the voyage ship' : 'The island already has a voyage ship';
    if (!this.eco.canAfford(VOYAGE.shipCost)) return 'Not enough wood or stone';
    return null;
  }

  buildAt(dock: Building): string {
    const why = this.whyNotBuild(dock);
    if (why) return why + '.';
    this.eco.spend(VOYAGE.shipCost);
    this.dock = dock.id;
    this.state = 'building';
    this.build = 0;
    return 'Shipwrights start work on a great voyage ship.';
  }

  /** Move goods between the stores and the hold (+: load, −: unload back to the stores). Returns a message or ''. */
  load(k: CargoKey, dir: 1 | -1): string {
    if (this.state !== 'docked' || this.haul) return 'The ship can only be loaded at the dock.';
    const step = VOYAGE.step[k] ?? 5;
    const have = isGood(k) ? this.eco.goods[k] : this.eco.res[k as ResourceKey];
    const inHold = this.hold[k] ?? 0;
    if (dir > 0) {
      const n = Math.min(step, Math.floor(have));
      if (n <= 0) return `No ${isGood(k) ? GOODS[k].name.toLowerCase() : k} to load.`;
      if (isGood(k)) this.eco.goods[k] -= n;
      else if (!this.eco.godMode) this.eco.res[k as ResourceKey] -= n;
      this.hold[k] = inHold + n;
    } else {
      const n = Math.min(step, inHold);
      if (n <= 0) return '';
      if (isGood(k)) this.eco.goods[k] += n;
      else {
        const back = this.eco.add(k as ResourceKey, n);
        if (back < n) {
          this.hold[k] = inHold - back;
          return 'No room in the stores to take it all back.';
        }
      }
      this.hold[k] = inHold - n;
      if (!this.hold[k]) delete this.hold[k];
    }
    return '';
  }

  /** Adults who'd sail (the most free first), or why not. */
  private pickCrew(dock: Building): Islander[] | string {
    const adults = this.colony.list.filter((i) => !i.child);
    const free = adults.filter((i) => i.condition === 'well' && !i.hidden && i.role !== 'warrior' && i.task?.kind !== 'fish' && i.task?.kind !== 'heal');
    if (adults.length - VOYAGE.crew < VOYAGE.minHome) return `Not enough villagers: ${VOYAGE.crew} sail and at least ${VOYAGE.minHome} must stay home`;
    if (free.length < VOYAGE.crew) return 'Not enough villagers free to crew the ship';
    const rank = (i: Islander) => (i.role === 'idle' ? 0 : i.role === 'gatherer' || i.role === 'woodcutter' ? 1 : 2) * 1000 + Math.hypot(i.x - dock.x, i.z - dock.z);
    return free.sort((a, b) => rank(a) - rank(b)).slice(0, VOYAGE.crew);
  }

  whyNotSail(): string | null {
    if (this.state !== 'docked') return 'The ship is not at the dock';
    if (this.haul) return 'Unload what it brought home first';
    if (holdValue(this.hold) < VOYAGE.minValue) return 'Load more goods first';
    const dock = this.bld.byId(this.dock);
    if (!dock) return 'The Trade Dock is gone';
    const c = this.pickCrew(dock);
    return typeof c === 'string' ? c : null;
  }

  /** Crew the ship and send it off beyond the horizon. */
  sail(): string {
    const why = this.whyNotSail();
    if (why) return why + '.';
    const dock = this.bld.byId(this.dock)!;
    const crew = this.pickCrew(dock) as Islander[];
    this.crew = crew.map((i) => crewData(i));
    for (const i of crew) this.colony.remove(i);
    this.place = this.rng.pick(VOYAGE.places);
    this.total = this.rng.range(VOYAGE.seconds[0], VOYAGE.seconds[1]);
    this.timer = this.total;
    this.mult = 1;
    this.bonus = {};
    this.storm = 0;
    this.calmed = false;
    this.doomed = '';
    this.events = rollEvents(this.rng, this.total).map((e) => ({ ...e, done: false }));
    this.log = [`Set sail for ${this.place} with ${this.crew.map((c) => c.name).join(' and ')} aboard.`];
    // Straight out from the dock, across to open sea, then on over the edge of the map.
    const at = this.berth(dock);
    const sea = this.boats.openSea(at.approach.x, at.approach.z, at.out, 120);
    this.far = this.beyond(sea.x, sea.z, at.out);
    this.path = [at.approach, ...(this.boats.waterPath(at.approach.x, at.approach.z, sea.x, sea.z, true) ?? []), sea];
    this.idx = 0;
    this.state = 'out';
    this.voyages++;
    this.hooks?.sfx('splash', dock.x, dock.z);
    return `The voyage ship sets sail for ${this.place} with ${this.crew.map((c) => c.name).join(' and ')}. It will be away for a few minutes.`;
  }

  /** Spend Belief to calm a storm raging around the voyage. */
  calm(): string {
    if (this.storm <= 0) return 'There is no storm to calm.';
    if (!this.eco.spend({ wood: 0, stone: 0, belief: VOYAGE.calmCost })) return `Not enough Belief (${VOYAGE.calmCost}).`;
    this.storm = 0;
    this.calmed = true;
    this.log.push('The gods heard the village: the storm around the ship fell calm.');
    return 'Your Belief reaches out over the sea: the storm around the voyage ship dies away.';
  }

  /** Take the haul ashore: stores, precious goods and chickens. Anything that doesn't fit stays aboard. */
  unload(): string {
    const h = this.haul;
    if (!h || this.state !== 'docked') return 'Nothing to unload.';
    const dock = this.bld.byId(this.dock);
    const got: string[] = [];
    let left = false;
    for (const [k, n] of Object.entries(h.res) as [ResourceKey, number][]) {
      const a = this.eco.add(k, n);
      if (a) got.push(`${a} ${k}`);
      if (a < n) {
        h.res[k] = n - a;
        left = true;
      } else delete h.res[k];
    }
    for (const [k, n] of Object.entries(h.goods) as [GoodKey, number][]) {
      this.eco.goods[k] += n;
      got.push(`${n} ${GOODS[k].name.toLowerCase()}`);
      delete h.goods[k];
    }
    if (h.chickens && dock) {
      let n = 0;
      while (h.chickens > 0 && this.hooks?.addChicken(dock.door.x + this.rng.range(-0.6, 0.6), dock.door.z + this.rng.range(-0.6, 0.6))) {
        h.chickens--;
        n++;
      }
      if (n) got.push(`${n} chicken${n === 1 ? '' : 's'}`);
      if (h.chickens) left = true;
    }
    if (!left) this.haul = null;
    this.hooks?.sfx('drop', dock?.x ?? 0, dock?.z ?? 0);
    return got.length ? `Unloaded ${got.join(', ')}${left ? ' (the rest stays aboard: no room ashore)' : ''}.` : 'No room ashore for any of it yet.';
  }

  /** A demolished dock: a moored ship is broken up (one at sea comes home to nothing and is lost). */
  removeDock(dock: Building): void {
    if (dock.id !== this.dock) return;
    if (this.ship) this.group.remove(this.ship.mesh);
    this.ship = null;
    if (this.state === 'docked' || this.state === 'building') {
      for (const [k, n] of Object.entries(this.hold) as [CargoKey, number][]) {
        if (isGood(k)) this.eco.goods[k] += n;
        else this.eco.add(k as ResourceKey, n);
      }
      this.hold = {};
      this.haul = null;
      this.state = 'none';
      this.dock = -1;
    } else this.doomed = this.doomed || 'its dock was gone';
  }

  // ---------------- The ship on the water ----------------

  private makeShip(dock: Building): Ship {
    const mesh = new THREE.Group();
    const hull = new THREE.Mesh(this.hull, this.mat);
    hull.castShadow = true;
    const deck = new THREE.Mesh(this.deck, this.mat);
    deck.castShadow = true;
    mesh.add(hull, deck);
    mesh.scale.setScalar(BOAT_SCALE * SHIP_SCALE);
    this.group.add(mesh);
    const at = this.berth(dock);
    return { mesh, x: at.x, z: at.z, heading: at.out, speed: 0, ride: newRide(), wakeAcc: 0 };
  }

  /** A point well out past the map edge, along the heading from (x, z). */
  private beyond(x: number, z: number, heading: number): { x: number; z: number } {
    const H = this.world.half + 10;
    let px = x, pz = z;
    for (let k = 0; k < 200 && Math.abs(px) < H && Math.abs(pz) < H; k++) {
      px += Math.sin(heading) * 2;
      pz += Math.cos(heading) * 2;
    }
    return { x: px, z: pz };
  }

  /** Sail straight for a point (out beyond the map there's nothing to steer round). */
  private straight(s: Ship, tx: number, tz: number, dt: number): boolean {
    const d = Math.hypot(tx - s.x, tz - s.z);
    if (d < 1) return true;
    const want = Math.atan2(tx - s.x, tz - s.z);
    let dh = want - s.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    s.heading += dh * Math.min(1, dt * 1.2);
    s.speed += (VOYAGE.speed - s.speed) * Math.min(1, dt);
    s.x += Math.sin(s.heading) * s.speed * dt;
    s.z += Math.cos(s.heading) * s.speed * dt;
    return false;
  }

  update(dt: number, time: number): void {
    this.time += dt;
    const dock = this.dock >= 0 ? this.bld.byId(this.dock) : undefined;
    if (this.state === 'building') {
      if (!dock) {
        this.state = 'none';
        this.dock = -1;
      } else {
        this.build += dt;
        if (this.build >= VOYAGE.buildSeconds) {
          this.state = 'docked';
          this.hooks?.notify('The great voyage ship is finished and moored at the Trade Dock. Tap it to load goods and send it off.', 'info', { x: dock.x, z: dock.z });
        }
      }
    }
    if (dock && !this.ship && (this.state === 'docked' || this.state === 'out' || this.state === 'back')) this.ship = this.makeShip(dock);
    const s = this.ship;
    if (s && dock) {
      const traffic = this.boats.traffic();
      const me = traffic.find((h) => h.ref === s);
      const half = HULL_HALF * SHIP_SCALE, beam = HULL_BEAM * SHIP_SCALE;
      let moving = false;
      if (this.state === 'docked') {
        const at = this.berth(dock);
        s.x = at.x;
        s.z = at.z;
        s.heading = at.out;
        s.speed = 0;
      } else if (this.state === 'out') {
        moving = true;
        if (this.idx < this.path.length && me) this.idx = this.boats.sailPath(s, me, this.path, this.idx, VOYAGE.speed, dt, traffic);
        else if (this.idx < this.path.length) this.idx++;
        else if (this.straight(s, this.far.x, this.far.z, dt)) {
          this.state = 'away';
          s.mesh.visible = false;
          s.speed = 0;
          this.hooks?.notify(`The voyage ship has sailed over the horizon, bound for ${this.place}.`);
        }
      } else if (this.state === 'back') {
        moving = true;
        if (this.mooring) {
          if (!me || this.boats.berthStep(s, me, this.berth(dock), dt, traffic)) this.arrive(dock);
        } else if (this.idx < 0) {
          // Still out past the edge: straight in to open water.
          const sea = this.path[0];
          if (this.straight(s, sea.x, sea.z, dt)) this.idx = 0;
        } else {
          this.idx = me ? this.boats.sailPath(s, me, this.path, this.idx, VOYAGE.speed, dt, traffic) : this.idx + 1;
          if (this.idx >= this.path.length) this.mooring = true;
        }
      }
      if (this.state !== 'away') {
        if (moving && !this.offMap()) this.boats.fx.wake(s, dt, half, beam, VOYAGE.speed);
        this.boats.ride(s.mesh, s, time, dt, half, beam, this.state === 'docked' || this.mooring ? 0.5 : 1);
      }
    }
    if (this.state === 'away') this.voyage(dt, dock);
    this.updateOrbs(dt);
  }

  /** Away out there: news arrives, storms rage, and in time it comes home (or doesn't). */
  private voyage(dt: number, dock: Building | undefined): void {
    this.timer -= dt;
    const done = this.total - this.timer;
    for (const e of this.events) {
      if (e.done || done < e.at) continue;
      e.done = true;
      this.happen(e.kind);
    }
    if (this.storm > 0) {
      this.storm -= dt;
      if (this.storm <= 0) this.stormPasses();
    }
    if (this.timer > 0) return;
    if (this.doomed || !dock) {
      this.lost(this.doomed || 'its dock was gone');
      return;
    }
    // Home: it appears out past the edge and sails in to the dock.
    const at = this.berth(dock);
    const sea = this.boats.openSea(at.approach.x, at.approach.z, at.out, 120);
    this.far = this.beyond(sea.x, sea.z, at.out + this.rng.range(-0.4, 0.4));
    this.path = [sea, ...(this.boats.waterPath(sea.x, sea.z, at.approach.x, at.approach.z) ?? [at.approach])];
    this.idx = -1;
    this.mooring = false;
    if (!this.ship) this.ship = this.makeShip(dock);
    const s = this.ship;
    s.x = this.far.x;
    s.z = this.far.z;
    s.heading = Math.atan2(sea.x - s.x, sea.z - s.z);
    s.speed = VOYAGE.speed;
    s.ride.init = false;
    s.mesh.visible = true;
    this.haul = voyageHaul(this.hold, this.mult, this.rng, this.eco.res, this.bonus);
    this.hold = {};
    this.state = 'back';
    this.hooks?.notify('A great sail on the horizon: the voyage ship is coming home!', 'info', { x: dock.x, z: dock.z });
  }

  private news(msg: string, kind: 'info' | 'warn' = 'info'): void {
    this.log.push(msg);
    this.hooks?.notify(`News from the voyage: ${msg}`, kind);
  }

  private happen(kind: VoyEvent): void {
    const r = this.rng;
    switch (kind) {
      case 'storm':
        this.storm = VOYAGE.calmWindow;
        this.news(`a great storm is raging around the ship! Calm it from the Trade Dock (${VOYAGE.calmCost} Belief) before it is too late.`, 'warn');
        break;
      case 'raiders': {
        if (r.next() < VOYAGE.raidLoss) {
          this.doomed = 'it was taken by raiders';
          this.log.push('Raiders were seen closing on the ship. Nothing more has been heard.');
          this.hooks?.notify('Fishermen saw raiders closing on the voyage ship far out at sea…', 'warn');
          break;
        }
        const lost = spoil(this.hold, r.range(0.2, 0.4));
        let msg = `raiders attacked the ship and made off with ${holdText(lost) || 'little'}.`;
        if (this.crew.length > 1 && r.next() < VOYAGE.raidCrew) {
          const c = this.crew.splice(r.int(0, this.crew.length - 1), 1)[0];
          msg += ` ${c.name} was carried off and will not come home.`;
        }
        this.news(msg, 'warn');
        break;
      }
      case 'market':
        this.mult *= r.range(1.25, 1.5);
        this.news(`prices are good at ${this.place}: the crew are striking fine bargains.`);
        break;
      case 'winds':
        this.timer *= 0.7;
        this.news('fair winds are carrying the ship along: it will be home early.');
        break;
      case 'becalmed':
        this.timer += this.total * 0.25;
        this.news('the ship lies becalmed on a flat sea: it will be late home.');
        break;
      case 'isle': {
        const ch = r.int(2, 4), hb = r.int(2, 3);
        this.bonus.chickens = (this.bonus.chickens ?? 0) + ch;
        this.bonus.goods = { ...(this.bonus.goods ?? {}), herbs: (this.bonus.goods?.herbs ?? 0) + hb };
        this.news(`the crew found a green island and are bringing back ${ch} chickens and ${hb} bundles of herbs.`);
        break;
      }
    }
  }

  private stormPasses(): void {
    if (this.calmed) return;
    if (this.rng.next() < VOYAGE.stormLoss) {
      this.doomed = 'it was lost in the storm';
      this.log.push('The storm blew itself out. There is no word of the ship.');
      this.hooks?.notify('The storm at sea has passed, but there is no word of the voyage ship…', 'warn');
      return;
    }
    const lost = spoil(this.hold, this.rng.range(0.25, 0.45));
    this.news(`the ship weathered the storm, but ${holdText(lost) || 'some goods'} went over the side.`, 'warn');
  }

  private lost(why: string): void {
    const names = this.crew.map((c) => c.name);
    this.log.push(`The ship never came home: ${why}.`);
    this.hooks?.notify(`The voyage ship never came home: ${why}. ${names.length ? `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} lost at sea.` : ''} A new ship can be built at the Trade Dock.`, 'warn');
    if (this.ship) this.group.remove(this.ship.mesh);
    this.ship = null;
    this.crew = [];
    this.hold = {};
    this.haul = null;
    this.state = 'none';
    this.dock = -1;
    this.storm = 0;
  }

  /** Moored back home: the crew come ashore, the goods wait aboard to be unloaded. */
  private arrive(dock: Building): void {
    this.mooring = false;
    this.state = 'docked';
    const back = this.crew.map((c) => {
      const isl = this.colony.restore({ ...c, x: dock.door.x + this.rng.range(-0.4, 0.4), z: dock.door.z + this.rng.range(-0.4, 0.4), home: -1, workplace: -1, role: 'idle', manualRole: false } as CrewData);
      return isl.name;
    });
    this.crew = [];
    this.log.push(`Home from ${this.place}.`);
    this.hooks?.notify(`The voyage ship is home from ${this.place}${back.length ? ` with ${back.join(' and ')}` : ''}, carrying ${this.haul ? haulText(this.haul) : 'nothing'}. Tap the ship (the green orb) to unload.`, 'info', { x: dock.x, z: dock.z });
    this.hooks?.sfx('complete', dock.x, dock.z);
  }

  // ---------------- Orbs: goods or bargains waiting ----------------

  private updateOrbs(dt: number): void {
    void dt;
    this.orbAt = [];
    const s = this.ship;
    if (s && this.state === 'docked' && this.haul) this.orbAt.push({ x: s.x, y: 2.05, z: s.z, dock: this.dock });
    for (const v of this.hooks?.visitorOrbs() ?? []) this.orbAt.push({ x: v.x, y: 1.75, z: v.z, dock: v.dock });
    while (this.orbs.length < this.orbAt.length) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.orbTex, color: new THREE.Color(0.12, 1.15, 0.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      sp.renderOrder = 20;
      this.group.add(sp);
      this.orbs.push(sp);
    }
    this.orbs.forEach((sp, i) => {
      const o = this.orbAt[i];
      sp.visible = !!o;
      if (!o) return;
      const t = this.time * 2.2 + i;
      sp.position.set(o.x, o.y + Math.sin(t) * 0.12, o.z);
      sp.scale.setScalar(0.62 + Math.sin(t * 1.7) * 0.08);
      (sp.material as THREE.SpriteMaterial).opacity = 0.8 + Math.sin(t * 1.3) * 0.2;
    });
  }

  /** The ship or an orb under the pointer: the Trade Dock it belongs to. */
  pick(camera: THREE.Camera, sx: number, sy: number, rect: DOMRect): Building | null {
    const v = new THREE.Vector3();
    const near = (x: number, y: number, z: number, r: number) => {
      v.set(x, y, z).project(camera);
      if (v.z > 1) return false;
      const px = (v.x * 0.5 + 0.5) * rect.width + rect.left, py = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      return (px - sx) ** 2 + (py - sy) ** 2 < r * r;
    };
    for (const o of this.orbAt) if (near(o.x, o.y, o.z, 30)) return this.bld.byId(o.dock) ?? null;
    const s = this.ship;
    if (s && s.mesh.visible && this.state === 'docked' && (near(s.x, 0.4, s.z, 34) || near(s.x, 1.4, s.z, 30))) return this.bld.byId(this.dock) ?? null;
    return null;
  }

  // ---------------- Save ----------------

  serialize(): Record<string, unknown> | null {
    if (this.state === 'none') return null;
    return {
      dock: this.dock, state: this.state, build: this.build, hold: this.hold, haul: this.haul, timer: this.timer, total: this.total, place: this.place,
      mult: this.mult, bonus: this.bonus, events: this.events, storm: this.storm, calmed: this.calmed, doomed: this.doomed, crew: this.crew, log: this.log.slice(-8), voyages: this.voyages,
    };
  }

  /** Back from a save (a ship sailing in or out is put back at sea, away). */
  restore(d: Record<string, any> | null | undefined, idMap: Map<number, number>): void {
    if (!d || typeof d !== 'object') return;
    const dock = idMap.get(d.dock) ?? -1;
    if (dock < 0 || !this.bld.byId(dock)) return;
    this.dock = dock;
    const st = String(d.state);
    this.state = st === 'out' || st === 'back' ? 'away' : (['building', 'docked', 'away'].includes(st) ? st : 'docked') as typeof this.state;
    this.build = Number(d.build) || 0;
    this.hold = cleanHold(d.hold);
    this.haul = d.haul && typeof d.haul === 'object' ? { res: cleanHold(d.haul.res) as Haul['res'], goods: cleanHold(d.haul.goods) as Haul['goods'], chickens: Math.max(0, Number(d.haul.chickens) || 0) } : null;
    this.timer = st === 'out' || st === 'back' ? 20 : Number(d.timer) || 0;
    this.total = Number(d.total) || 200;
    this.place = String(d.place ?? '');
    this.mult = Number(d.mult) || 1;
    this.bonus = d.bonus && typeof d.bonus === 'object' ? d.bonus : {};
    this.events = Array.isArray(d.events) ? d.events.filter((e: any) => e && typeof e.kind === 'string').map((e: any) => ({ at: Number(e.at) || 0, kind: e.kind, done: !!e.done })) : [];
    this.storm = Number(d.storm) || 0;
    this.calmed = !!d.calmed;
    this.doomed = String(d.doomed ?? '');
    this.crew = Array.isArray(d.crew) ? d.crew.map(cleanCrew).filter((c: CrewData | null): c is CrewData => !!c).slice(0, VOYAGE.crew) : [];
    this.log = Array.isArray(d.log) ? d.log.map(String) : [];
    this.voyages = Number(d.voyages) || 0;
  }

  /** Changes whenever the dock card's voyage section should be redrawn. */
  key(): string {
    return `${this.state}|${Math.floor(this.build / 3)}|${JSON.stringify(this.hold)}|${this.haul ? haulText(this.haul) : ''}|${Math.ceil(this.timer / 10)}|${Math.ceil(this.storm)}|${this.log.length}|${Math.floor(this.eco.res.belief / 5)}`;
  }
}

function holdText(h: Hold): string {
  return (Object.entries(h) as [CargoKey, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${isGood(k) ? GOODS[k].name.toLowerCase() : k}`).join(', ');
}

function cleanHold(h: any): Hold {
  const out: Hold = {};
  if (!h || typeof h !== 'object') return out;
  for (const k of [...CARGO_KEYS, 'belief']) {
    const n = Number(h[k]);
    if (Number.isFinite(n) && n > 0) (out as Record<string, number>)[k] = Math.round(n);
  }
  return out;
}

/** Crew from a save or a shared island file: only the fields an islander keeps, of the right types. */
function cleanCrew(c: any): CrewData | null {
  if (!c || typeof c !== 'object' || !Number.isInteger(c.id) || typeof c.name !== 'string' || c.name.length > 32 || (c.gender !== 'm' && c.gender !== 'f')) return null;
  const out: CrewData = { id: c.id, name: c.name, gender: c.gender };
  for (const k of ['age', 'hunger', 'rest', 'happy', 'skin', 'cloth', 'cloth2', 'headdress', 'heading'] as const) if (typeof c[k] === 'number' && Number.isFinite(c[k])) (out as Record<string, unknown>)[k] = c[k];
  if (typeof c.jewel === 'boolean') out.jewel = c.jewel;
  if (c.warrior === null || c.warrior === 'jaguar' || c.warrior === 'eagle') out.warrior = c.warrior;
  out.child = false;
  return out;
}

/** An islander's lasting state, kept while they're away at sea. */
function crewData(i: Islander): CrewData {
  return {
    id: i.id, name: i.name, gender: i.gender, child: i.child, age: i.age, hunger: i.hunger, rest: i.rest, happy: i.happy, skin: i.skin, cloth: i.cloth, cloth2: i.cloth2,
    headdress: i.headdress, jewel: i.jewel, warrior: i.warrior, heading: i.heading,
  };
}
