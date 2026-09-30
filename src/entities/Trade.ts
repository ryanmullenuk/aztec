import * as THREE from 'three';
import type { Where } from '../ui/where';
import { ResourceKey, TRADE, TradeOffer } from '../config';
import { Building, BuildingSystem } from '../buildings/Buildings';
import { Economy } from '../economy/Economy';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { patchStylised } from '../render/materials';
import { Water } from '../water/Water';
import { World } from '../world/World';
import { BOAT_SCALE, BoatLook, Boats, boatGeometry, HULL_BEAM, HULL_HALF, newRide, Vessel } from './Boats';
import { Hull, traderHome, VisitorDeal, visitorDeals } from './fleet';

/** A trade boat: docks at its Trade Dock, sails away over the horizon with goods, returns with others. */
interface Ship extends Vessel {
  dock: number;
  mesh: THREE.Group;
  state: 'docked' | 'out' | 'away' | 'back';
  /** Home and backing onto the berth. */
  mooring: boolean;
  path: { x: number; z: number }[];
  idx: number;
  timer: number;
  cargo: Partial<Record<ResourceKey, number>>;
  sail: number;
}

/** A foreign trade boat visiting a Trade Dock with a few bargains. */
interface Visitor extends Vessel {
  dock: number;
  mesh: THREE.Group;
  state: 'in' | 'moored' | 'leave';
  mooring: boolean;
  path: { x: number; z: number }[];
  idx: number;
  /** Seconds left moored (then they sail home). */
  timer: number;
  from: string;
  deals: VisitorDeal[];
}

/** Trade boats are bigger than canoes; visiting traders' boats bigger still. */
const SHIP_SCALE = 1.35;
const VISITOR_SCALE = 1.45;
/** Visitors moor at the third berth, beside the dock's own two boats. */
const VISITOR_SLOT = 2;

/** Visiting traders: deep indigo hulls, blue sails with gold stripes and a teal band. */
const VISITOR_LOOK: BoatLook = { hull: 0x1f4f63, keel: 0x163746, inner: 0x3a2a1c, deck: 0x6e4a2c, rim: 0xe0b43c, sail: 0x1d3f8f, stripe: 0xe0b43c, band: 0x138a8a };

/** Cargo boxes and sacks lashed on deck. */
function cargoGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.rbox(0.26, 0.2, 0.26, 0.03), { color: 0xa87a4a }, M.t(0, 0.28, -0.25));
  b.add(P.rbox(0.2, 0.16, 0.2, 0.03), { color: 0x94663c }, M.t(0.02, 0.45, -0.24, 0, 0.4, 0));
  b.add(P.uvSphere(0.12, 7, 5), { color: 0xd8c08a }, M.t(0, 0.26, -0.62, 0, 0, 0, 1.1, 0.8, 1));
  // A long pennant up the mast.
  b.add(P.box(0.02, 0.08, 0.3), { color: 0xc8342c, sway: 0.5 }, M.t(0, 1.26, 0.2));
  return b.build();
}

/** The visitors' deck: clay jars and bright bales, and a forked gold-and-teal pennant. */
function visitorCargoGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const [x, z] of [[-0.09, -0.2], [0.09, -0.28], [0, -0.45]]) {
    b.add(P.uvSphere(0.1, 8, 6), { color: 0xb5653a }, M.t(x, 0.3, z, 0, 0, 0, 1, 1.3, 1));
    b.add(P.cyl(0.04, 0.05, 0.08, 6), { color: 0x9a5230 }, M.t(x, 0.45, z));
  }
  b.add(P.rbox(0.22, 0.16, 0.22, 0.03), { color: 0x138a8a }, M.t(0, 0.26, -0.66, 0, 0.3, 0));
  // Two pennant tails, gold over teal.
  b.add(P.box(0.02, 0.06, 0.38), { color: 0xe0b43c, sway: 0.6 }, M.t(0, 1.29, 0.16));
  b.add(P.box(0.02, 0.05, 0.3), { color: 0x138a8a, sway: 0.6 }, M.t(0, 1.2, 0.2));
  return b.build();
}

const goodsText = (r: Partial<Record<ResourceKey, number>>) => (Object.entries(r) as [ResourceKey, number][]).map(([k, n]) => `${n} ${k}`).join(' and ');
const between = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0]);

/**
 * Trade Docks and their trade boats. Goods are loaded when a trade is chosen; the boat sails
 * out beyond the reef, is away for a while trading, and comes back with what was bargained for.
 * Now and then a foreign boat sails in to a finished dock with bargains of its own.
 */
export class TradeFleet {
  readonly group = new THREE.Group();
  ships: Ship[] = [];
  visitors: Visitor[] = [];
  private hull = boatGeometry(true);
  private cargoGeo = cargoGeometry();
  private visitorHull = boatGeometry(true, VISITOR_LOOK);
  private visitorCargo = visitorCargoGeometry();
  private mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
  /** Seconds to the next visit (counts only while there is a finished Trade Dock). */
  private visitIn = between(TRADE.visitors.every);
  /** Messages for the player (arrivals, departures). */
  notify: (msg: string, at?: Where) => void = () => {};

  constructor(private world: World, private water: Water, private bld: BuildingSystem, private eco: Economy, private boats: Boats) {
    void this.world;
    void this.water;
    boats.fleets.push(() => this.hulls());
  }

  /** Trade boats and visitors on the water, for other boats to keep clear of. */
  private hulls(): Hull[] {
    const out: Hull[] = [];
    this.ships.forEach((s, k) => {
      if (s.state !== 'away') out.push({ x: s.x, z: s.z, heading: s.heading, half: HULL_HALF * SHIP_SCALE, beam: HULL_BEAM * SHIP_SCALE, speed: s.speed, pri: 200 + k, moored: s.state === 'docked', ref: s });
    });
    for (const v of this.visitors) out.push({ x: v.x, z: v.z, heading: v.heading, half: HULL_HALF * VISITOR_SCALE, beam: HULL_BEAM * VISITOR_SCALE, speed: v.speed, pri: 5, moored: v.state === 'moored', ref: v });
    return out;
  }

  of(dock: Building): Ship[] {
    return this.ships.filter((s) => s.dock === dock.id);
  }

  docked(dock: Building): Ship[] {
    return this.of(dock).filter((s) => s.state === 'docked');
  }

  /** Start building a trade boat (paid now, launched after the build time). */
  orderBoat(dock: Building): string {
    if (!dock.complete) return 'The Trade Dock is not finished yet.';
    if (dock.boatBuild > 0) return 'A trade boat is already being built.';
    if (this.of(dock).length >= TRADE.maxBoats) return 'This dock already has all the boats it can moor.';
    if (!this.eco.spend(TRADE.boatCost)) return 'Not enough resources for a trade boat.';
    dock.boatBuild = 0.001;
    return 'Shipwrights start work on a trade boat.';
  }

  /** Launch a finished boat at its dock (also used when loading a save). */
  launch(dock: Building): void {
    const mesh = new THREE.Group();
    const hull = new THREE.Mesh(this.hull, this.mat);
    hull.castShadow = true;
    const cargo = new THREE.Mesh(this.cargoGeo, this.mat);
    cargo.castShadow = true;
    mesh.add(hull, cargo);
    mesh.scale.setScalar(BOAT_SCALE * SHIP_SCALE);
    this.group.add(mesh);
    const at = this.berth(dock, this.of(dock).length);
    this.ships.push({ dock: dock.id, mesh, state: 'docked', mooring: false, path: [], idx: 0, x: at.x, z: at.z, heading: at.out, speed: 0, ride: newRide(), wakeAcc: 0, timer: 0, cargo: {}, sail: Math.random() * 6 });
    dock.tradeBoats = this.of(dock).length;
  }

  /** Can this trade be made now (a boat free, and enough goods)? */
  canTrade(dock: Building, offer: TradeOffer, times = 1): { ok: boolean; reason: string } {
    if (!this.docked(dock).length) return { ok: false, reason: this.of(dock).length ? 'All trade boats are at sea' : 'Build a trade boat first' };
    for (const [k, n] of Object.entries(offer.give) as [ResourceKey, number][]) {
      if (this.eco.res[k] < n * times) return { ok: false, reason: `Not enough ${k}` };
    }
    return { ok: true, reason: '' };
  }

  /** Load the goods and send a boat out to trade. */
  send(dock: Building, offer: TradeOffer, times = 1): string {
    const ok = this.canTrade(dock, offer, times);
    if (!ok.ok) return ok.reason;
    const ship = this.docked(dock)[0];
    for (const [k, n] of Object.entries(offer.give) as [ResourceKey, number][]) this.eco.res[k] -= n * times;
    ship.cargo = {};
    for (const [k, n] of Object.entries(offer.get) as [ResourceKey, number][]) ship.cargo[k] = n * times;
    // Straight out from the dock, beyond the reef, then over the horizon.
    const at = this.berth(dock, this.of(dock).indexOf(ship));
    const far = this.boats.openSea(at.approach.x, at.approach.z, at.out);
    ship.path = [at.approach, ...(this.boats.waterPath(at.approach.x, at.approach.z, far.x, far.z, true) ?? [])];
    ship.idx = 0;
    ship.state = 'out';
    return `A trade boat sets sail. It will be back in about ${Math.round(TRADE.voyageSeconds + 20)} seconds.`;
  }

  /** A demolished dock takes its boats (and any visitors) with it. */
  removeDock(dock: Building): void {
    for (const s of this.of(dock)) this.group.remove(s.mesh);
    this.ships = this.ships.filter((s) => s.dock !== dock.id);
    for (const v of this.visitors) if (v.dock === dock.id) this.group.remove(v.mesh);
    this.visitors = this.visitors.filter((v) => v.dock !== dock.id);
  }

  update(dt: number, time: number): void {
    for (const d of this.bld.of('tradedock')) {
      if (d.boatBuild > 0) {
        d.boatBuild += dt;
        if (d.boatBuild >= TRADE.boatBuildSeconds) {
          d.boatBuild = 0;
          this.launch(d);
          this.notify('A new trade boat is moored at the Trade Dock.', { x: d.x, z: d.z });
        }
      }
    }
    const traffic = this.boats.traffic();
    const half = HULL_HALF * SHIP_SCALE, beam = HULL_BEAM * SHIP_SCALE;
    for (const s of this.ships) {
      const dock = this.bld.byId(s.dock);
      if (!dock) continue;
      const me = traffic.find((h) => h.ref === s);
      let moving = false;
      if ((s.state === 'out' || s.state === 'back') && me) {
        if (s.mooring) {
          if (this.boats.berthStep(s, me, this.berth(dock, this.of(dock).indexOf(s)), dt, traffic)) {
            s.mooring = false;
            s.state = 'docked';
            const got = Object.entries(s.cargo).map(([k, n]) => {
              const stored = this.eco.add(k as ResourceKey, n!);
              return `${stored} ${k}`;
            });
            this.notify(`A trade boat is back with ${got.join(' and ')}.`, { x: dock.x, z: dock.z });
            s.cargo = {};
          }
        } else {
          s.idx = this.boats.sailPath(s, me, s.path, s.idx, TRADE.boatSpeed, dt, traffic);
          moving = true;
          if (s.idx >= s.path.length) {
            if (s.state === 'out') {
              s.state = 'away';
              s.timer = TRADE.voyageSeconds;
              s.speed = 0;
              s.mesh.visible = false;
            } else s.mooring = true;
          }
        }
      } else if (s.state === 'away') {
        s.timer -= dt;
        if (s.timer <= 0) {
          s.state = 'back';
          s.mesh.visible = true;
          const home = this.berth(dock, this.of(dock).indexOf(s));
          s.path = this.boats.waterPath(s.x, s.z, home.approach.x, home.approach.z, true) ?? [home.approach];
          s.idx = 0;
          s.ride.init = false;
        }
      } else if (s.state === 'docked') {
        // Moored (follows the berth if the dock is moved).
        const at = this.berth(dock, this.of(dock).indexOf(s));
        s.x = at.x;
        s.z = at.z;
        s.heading = at.out;
        s.speed = 0;
      }
      if (s.state === 'away') continue;
      if (moving) this.boats.fx.wake(s, dt, half, beam, TRADE.boatSpeed);
      this.boats.ride(s.mesh, s, time, dt, half, beam, s.state === 'docked' || s.mooring ? 0.55 : 1);
    }
    this.updateVisitors(dt, time, traffic);
  }

  /** Where a boat moors at its dock (slot 0 and 1: the dock's own boats; 2: visitors). */
  private berth(dock: Building, k: number) {
    return this.boats.berth(dock, Math.max(0, k), 1.3, 0.5, TRADE.berthOut);
  }

  // ---------------- Visiting traders ----------------

  private updateVisitors(dt: number, time: number, traffic: Hull[]): void {
    const docks = this.bld.of('tradedock').filter((d) => d.complete);
    if (docks.length && !this.visitors.length) {
      this.visitIn -= dt;
      if (this.visitIn <= 0) this.visitIn = this.sendVisitor(docks[Math.floor(Math.random() * docks.length)]) ? between(TRADE.visitors.every) : TRADE.visitors.retry;
    }
    const half = HULL_HALF * VISITOR_SCALE, beam = HULL_BEAM * VISITOR_SCALE;
    for (const v of this.visitors.slice()) {
      const dock = this.bld.byId(v.dock);
      const me = traffic.find((h) => h.ref === v);
      if (!dock || !me) continue;
      let moving = false;
      if (v.state === 'in') {
        if (v.mooring) {
          if (this.boats.berthStep(v, me, this.berth(dock, VISITOR_SLOT), dt, traffic)) {
            // Moored: they lay out their wares.
            v.mooring = false;
            v.state = 'moored';
            v.timer = between(TRADE.visitors.stay);
            v.deals = visitorDeals(this.eco.res);
            this.notify(`Traders from ${v.from} have arrived at the Trade Dock with goods to trade.`, { x: dock.x, z: dock.z });
          }
        } else {
          v.idx = this.boats.sailPath(v, me, v.path, v.idx, TRADE.boatSpeed * 0.9, dt, traffic);
          moving = true;
          if (v.idx >= v.path.length) v.mooring = true;
        }
      } else if (v.state === 'moored') {
        const at = this.berth(dock, VISITOR_SLOT);
        v.x = at.x;
        v.z = at.z;
        v.heading = at.out;
        v.timer -= dt;
        if (v.timer <= 0) this.sendAway(v, dock);
      } else {
        v.idx = this.boats.sailPath(v, me, v.path, v.idx, TRADE.boatSpeed * 0.9, dt, traffic);
        moving = true;
        if (v.idx >= v.path.length) {
          // Over the horizon.
          this.group.remove(v.mesh);
          this.visitors = this.visitors.filter((x) => x !== v);
          continue;
        }
      }
      if (moving) this.boats.fx.wake(v, dt, half, beam, TRADE.boatSpeed);
      this.boats.ride(v.mesh, v, time, dt, half, beam, v.state === 'moored' || v.mooring ? 0.55 : 1);
    }
  }

  /** A foreign boat appears out at sea and makes for the dock. False if there's no way in. */
  private sendVisitor(dock: Building): boolean {
    const at = this.berth(dock, VISITOR_SLOT);
    if (!this.boats.open(at.x, at.z)) return false;
    const from = this.boats.openSea(at.approach.x, at.approach.z, at.out + (Math.random() - 0.5) * 1.4);
    const path = this.boats.waterPath(from.x, from.z, at.approach.x, at.approach.z);
    if (!path) return false;
    const mesh = new THREE.Group();
    const hull = new THREE.Mesh(this.visitorHull, this.mat);
    hull.castShadow = true;
    const cargo = new THREE.Mesh(this.visitorCargo, this.mat);
    cargo.castShadow = true;
    mesh.add(hull, cargo);
    mesh.scale.setScalar(BOAT_SCALE * VISITOR_SCALE);
    this.group.add(mesh);
    const first = path[0] ?? at.approach;
    this.visitors.push({
      dock: dock.id, mesh, state: 'in', mooring: false, path, idx: 0, x: from.x, z: from.z, heading: Math.atan2(first.x - from.x, first.z - from.z), speed: 0,
      ride: newRide(), wakeAcc: 0, timer: 0, from: traderHome(), deals: [],
    });
    return true;
  }

  /** Time to go: straight out from the dock, then away over the horizon. */
  private sendAway(v: Visitor, dock: Building): void {
    const at = this.berth(dock, VISITOR_SLOT);
    const far = this.boats.openSea(at.approach.x, at.approach.z, at.out + (Math.random() - 0.5) * 1.4);
    v.path = [at.approach, ...(this.boats.waterPath(at.approach.x, at.approach.z, far.x, far.z, true) ?? [])];
    v.idx = 0;
    v.state = 'leave';
    this.notify(`The traders from ${v.from} are setting sail for home.`);
  }

  /** Visitors moored at this dock and their bargains (for the dock's card). */
  visiting(dock: Building): { from: string; deals: VisitorDeal[]; timer: number } | null {
    const v = this.visitors.find((x) => x.dock === dock.id && x.state === 'moored');
    return v ? { from: v.from, deals: v.deals, timer: v.timer } : null;
  }

  /** Can the village pay for this bargain? */
  canAccept(deal: VisitorDeal): boolean {
    return !this.whyNot(deal);
  }

  /**
   * Why a bargain can't be struck right now (null if it can): not enough to give, or no room in the
   * stores for what comes back (counting the room the goods given away free up).
   */
  whyNot(deal: VisitorDeal): string | null {
    if (deal.taken) return 'Already traded';
    const give = Object.entries(deal.give) as [ResourceKey, number][];
    const lacking = give.filter(([k, n]) => this.eco.res[k] < n).map(([k]) => k);
    if (lacking.length) return `Not enough ${lacking.join(' or ')}`;
    if (this.eco.godMode) return null;
    const e = this.eco;
    const freed = (pred: (k: ResourceKey) => boolean) => give.filter(([k]) => pred(k)).reduce((s, [, n]) => s + n, 0);
    const isFood = (k: ResourceKey) => k !== 'wood' && k !== 'stone' && k !== 'belief';
    let food = e.food - freed(isFood);
    for (const [k, n] of Object.entries(deal.get) as [ResourceKey, number][]) {
      if (k === 'belief') {
        if (e.res.belief - freed((x) => x === 'belief') + n > e.beliefCap) return 'No room for more belief';
      } else if (k === 'wood' || k === 'stone') {
        if (e.res[k] - freed((x) => x === k) + n > e.woodCap) return `No room in your stores for ${n} ${k}`;
      } else {
        food += n;
        if (food > e.foodCap) return `No room in your food stores for ${n} ${k}`;
      }
    }
    return null;
  }

  /** Take visiting traders up on bargain k. Returns a message for the player. */
  accept(dock: Building, k: number): string {
    const v = this.visitors.find((x) => x.dock === dock.id && x.state === 'moored');
    const deal = v?.deals[k];
    if (!v || !deal) return 'The traders have gone.';
    if (deal.taken) return 'That bargain has already been struck.';
    const why = this.whyNot(deal);
    if (why) return `${why}: build more stores or use up some goods first.`;
    for (const [key, n] of Object.entries(deal.give) as [ResourceKey, number][]) this.eco.res[key] -= n;
    let short = false;
    for (const [key, n] of Object.entries(deal.get) as [ResourceKey, number][]) if (this.eco.add(key, n) < n) short = true;
    deal.taken = true;
    // Everything traded: they pack up and leave soon after.
    if (v.deals.every((d) => d.taken)) v.timer = Math.min(v.timer, TRADE.visitors.leaveAfterDeals);
    return `You traded ${goodsText(deal.give)} for ${goodsText(deal.get)}${short ? ' (your stores could not hold it all)' : ''}.`;
  }

  /** Changes whenever the dock card's visitor section should be redrawn. */
  visitKey(dock: Building): string {
    const v = this.visiting(dock);
    return v ? `${v.from}|${v.deals.map((d) => (d.taken ? 't' : this.canAccept(d) ? 'y' : 'n')).join('')}|${Math.ceil(v.timer / 30)}` : '';
  }
}

export type { TradeOffer };
