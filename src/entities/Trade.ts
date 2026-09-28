import * as THREE from 'three';
import type { Where } from '../ui/where';
import { ResourceKey, TRADE, TradeOffer } from '../config';
import { Building, BuildingSystem } from '../buildings/Buildings';
import { Economy } from '../economy/Economy';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { patchStylised } from '../render/materials';
import { SEA_SURFACE, Water } from '../water/Water';
import { World } from '../world/World';
import { BOAT_SCALE, Boats, boatGeometry } from './Boats';

/** A trade boat: docks at its Trade Dock, sails away over the horizon with goods, returns with others. */
interface Ship {
  dock: number;
  mesh: THREE.Group;
  state: 'docked' | 'out' | 'away' | 'back';
  path: { x: number; z: number }[];
  idx: number;
  x: number;
  z: number;
  heading: number;
  timer: number;
  cargo: Partial<Record<ResourceKey, number>>;
  sail: number;
}

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

/**
 * Trade Docks and their trade boats. Goods are loaded when a trade is chosen; the boat sails
 * out beyond the reef, is away for a while trading, and comes back with what was bargained for.
 */
export class TradeFleet {
  readonly group = new THREE.Group();
  ships: Ship[] = [];
  private hull = boatGeometry(true);
  private cargoGeo = cargoGeometry();
  private mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
  /** Messages for the player (arrivals, departures). */
  notify: (msg: string, at?: Where) => void = () => {};

  constructor(private world: World, private water: Water, private bld: BuildingSystem, private eco: Economy, private boats: Boats) {}

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
    mesh.scale.setScalar(BOAT_SCALE * 1.35);
    this.group.add(mesh);
    const k = this.of(dock).length;
    const [dx, dz] = dock.dir;
    const x = dock.dockX + dz * (k - 0.5) * 1.3, z = dock.dockZ - dx * (k - 0.5) * 1.3;
    this.ships.push({ dock: dock.id, mesh, state: 'docked', path: [], idx: 0, x, z, heading: Math.atan2(dx, dz), timer: 0, cargo: {}, sail: Math.random() * 6 });
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
    // Out beyond the reef, straight away from the dock, then over the horizon.
    const [dx, dz] = dock.dir;
    const lim = this.world.half - 4;
    const tx = Math.max(-lim, Math.min(lim, ship.x + dx * 80)), tz = Math.max(-lim, Math.min(lim, ship.z + dz * 80));
    ship.path = this.boats.waterPath(ship.x, ship.z, tx, tz) ?? [{ x: tx, z: tz }];
    ship.idx = 0;
    ship.state = 'out';
    return `A trade boat sets sail. It will be back in about ${Math.round(TRADE.voyageSeconds + 20)} seconds.`;
  }

  /** A demolished dock takes its boats with it. */
  removeDock(dock: Building): void {
    for (const s of this.of(dock)) this.group.remove(s.mesh);
    this.ships = this.ships.filter((s) => s.dock !== dock.id);
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
    for (const s of this.ships) {
      const dock = this.bld.byId(s.dock);
      if (!dock) continue;
      if (s.state === 'out' || s.state === 'back') {
        const p = s.path[Math.min(s.idx, s.path.length - 1)];
        const dx = p.x - s.x, dz = p.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) {
          s.idx++;
          if (s.idx >= s.path.length) {
            if (s.state === 'out') {
              s.state = 'away';
              s.timer = TRADE.voyageSeconds;
              s.mesh.visible = false;
            } else {
              s.state = 'docked';
              const got = Object.entries(s.cargo).map(([k, n]) => {
                const stored = this.eco.add(k as ResourceKey, n!);
                return `${stored} ${k}`;
              });
              this.notify(`A trade boat is back with ${got.join(' and ')}.`, { x: dock.x, z: dock.z });
              s.cargo = {};
              const [ddx, ddz] = dock.dir;
              s.heading = Math.atan2(ddx, ddz);
            }
          }
        } else {
          const want = Math.atan2(dx, dz);
          let dh = want - s.heading;
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          s.heading += dh * Math.min(1, dt * 2);
          const sp = Math.min(3.2, 0.8 + d * 0.6);
          s.x += Math.sin(s.heading) * sp * dt;
          s.z += Math.cos(s.heading) * sp * dt;
        }
      } else if (s.state === 'away') {
        s.timer -= dt;
        if (s.timer <= 0) {
          s.state = 'back';
          s.mesh.visible = true;
          const home = this.berth(dock, s);
          s.path = this.boats.waterPath(s.x, s.z, home.x, home.z) ?? [home];
          s.path.push(home);
          s.idx = 0;
        }
      }
      const y = this.water.waveHeight(s.x, s.z, time);
      const yF = this.water.waveHeight(s.x + Math.sin(s.heading) * 0.8, s.z + Math.cos(s.heading) * 0.8, time);
      s.mesh.position.set(s.x, 0.03 + SEA_SURFACE + y * 0.12, s.z);
      s.mesh.rotation.set((y - yF) * 0.6, s.heading, Math.sin(time * 0.8 + s.sail) * 0.03, 'YXZ');
    }
  }

  /** Where a boat moors at its dock. */
  private berth(dock: Building, ship: Ship): { x: number; z: number } {
    const k = this.of(dock).indexOf(ship);
    const [dx, dz] = dock.dir;
    return { x: dock.dockX + dz * (k - 0.5) * 1.3, z: dock.dockZ - dx * (k - 0.5) * 1.3 };
  }
}

export type { TradeOffer };
