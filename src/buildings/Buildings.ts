import * as THREE from 'three';
import { BUILDINGS, BuildingDef, BuildingKey, ECONOMY, FARM, HOMES, JETTY, TEMPLE, FARM_TYPES, isFarm } from '../config';
import { Economy, Cost } from '../economy/Economy';
import { flameMaterial, stylisedMaterial, FX } from '../render/materials';
import { Terrain } from '../terrain/Terrain';
import { Vegetation } from '../vegetation/Vegetation';
import { World } from '../world/World';
import { RNG } from '../world/rng';
import * as models from './models';

/** Flame size per building, and the fires that burn day and night. */
const FLAME_SCALE: Partial<Record<BuildingKey, number>> = { campfire: 2.4, bonfire: 3.2, firepit: 1.7, torch: 1.25 };
const ALWAYS_LIT = new Set<BuildingKey>(['campfire', 'bonfire', 'firepit']);
import { Particles } from '../render/Particles';

/** Door direction per rotation (door faces +z at rot 0). */
export const ROT_DIR: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

export interface Torch {
  pos: THREE.Vector3;
  flame: THREE.Mesh;
  phase: number;
}

export class Building {
  id: number;
  key: BuildingKey;
  def: BuildingDef;
  cx: number;
  cz: number;
  /** Footprint in world cells after rotation. */
  w: number;
  d: number;
  rot: number;
  layer: number;
  x: number;
  z: number;
  y: number;
  complete = false;
  /** Construction (or upgrade) progress 0..1. */
  progress = 0;
  tier = 1;
  upgrading = false;
  builders = new Set<number>();
  workers = new Set<number>();
  residents: number[] = [];
  group = new THREE.Group();
  foundation!: THREE.Mesh;
  scaffold!: THREE.Mesh;
  finished!: THREE.Mesh;
  torches: Torch[] = [];
  /** Door / access point in world space (where islanders walk to). */
  door = { x: 0, z: 0 };
  // Farm
  growth = 0;
  stock = 0;
  tendTimer = 0;
  blessTimer = 0;
  crops: THREE.Mesh | null = null;
  // Stores
  fills: THREE.Mesh[] = [];
  // Jetty
  dockX = 0;
  dockZ = 0;
  boatBuild = 0;
  boatsWanted = 0;
  boats: number[] = [];
  /** Trade boats moored at a Trade Dock. */
  tradeBoats = 0;
  // Kennel: a litter on the way (seconds), rest before the next, and how its dogs behave.
  breedT = 0;
  breedCool = 0;
  dogRole: 'roam' | 'guard' = 'roam';
  // War room: queued trainees
  training: { id: number; t: number; type: 'jaguar' | 'eagle' }[] = [];
  // Butcher
  penX = 0;
  penZ = 0;
  meatStock = 0;

  constructor(id: number, key: BuildingKey, cx: number, cz: number, rot: number, layer: number, world: World) {
    this.id = id;
    this.key = key;
    this.def = BUILDINGS[key];
    this.cx = cx;
    this.cz = cz;
    this.rot = rot;
    const [sw, sd] = this.def.size;
    this.w = rot % 2 ? sd : sw;
    this.d = rot % 2 ? sw : sd;
    this.layer = layer;
    this.x = cx + this.w / 2 - world.half;
    this.z = cz + this.d / 2 - world.half;
    this.y = world.layerY(layer);
    const [dx, dz] = ROT_DIR[rot];
    const depth = sd / 2 + 0.55;
    this.door = { x: this.x + dx * depth, z: this.z + dz * depth };
  }

  get dir(): [number, number] {
    return ROT_DIR[this.rot];
  }

  /** Model-local (x, z) to world (x, z), matching the group's rotation. */
  local(lx: number, lz: number): [number, number] {
    const t = (this.rot * Math.PI) / 2;
    const c = Math.cos(t), s = Math.sin(t);
    return [this.x + lx * c + lz * s, this.z - lx * s + lz * c];
  }

  /** Builders still wanted on the construction site. */
  get needsBuilders(): number {
    if (this.complete && !this.upgrading) return 0;
    return Math.max(0, this.def.builders - this.builders.size);
  }

  get housing(): number {
    if (!this.complete) return 0;
    if (this.key === 'home') return HOMES.housing[Math.min(HOMES.housing.length, this.tier) - 1];
    return this.def.housing ?? 0;
  }

  /** House level shown to the player (hut = 1, home tiers = 2–5). */
  get houseLevel(): number {
    return this.key === 'hut' ? 1 : this.key === 'home' ? this.tier + 1 : 0;
  }

  get label(): string {
    if (this.key === 'temple') return this.tier === 3 ? 'Great Pyramid' : `Temple (tier ${this.tier})`;
    if (this.key === 'home') return `Home (level ${this.tier + 1})`;
    if (this.key === 'hut') return 'Hut (level 1)';
    return this.def.name;
  }
}

/**
 * Placement rules, ghost previews, staged construction visuals (foundation → scaffolding → finished),
 * temple tiers, farm growth, storage fill visuals and night-time torches.
 */
export class BuildingSystem {
  readonly group = new THREE.Group();
  list: Building[] = [];
  private nextId = 1;
  private ghost: THREE.Group | null = null;
  private ghostKey: BuildingKey | null = null;
  private ghostRot = -1;
  private ghostMat = new THREE.MeshBasicMaterial({ color: 0x9df08a, transparent: true, opacity: 0.45, depthWrite: false });
  private ringGeo = new THREE.RingGeometry(0.5, 0.56, 4, 1).rotateX(-Math.PI / 2);
  private flameGeo = models.flameGeometry();
  private lights: THREE.PointLight[] = [];
  private lightTimer = 0;
  private cropGeos = new Map<string, THREE.BufferGeometry>();
  /** Chimney and rack smoke from smokehouses. */
  private smoke = new Particles(360, 0xc9c2ba, 0.6);
  private smokeAcc = 0;
  private logGeos = [models.logPileGeometry(1), models.logPileGeometry(2), models.logPileGeometry(3)];
  private stoneGeos = [models.stonePileGeometry(4), models.stonePileGeometry(5)];
  private basketGeos = [models.basketGeometry(0), models.basketGeometry(1), models.basketGeometry(2)];
  /** Called when a building completes (for milestones, sounds, AI). */
  onComplete: (b: Building) => void = () => {};
  /** Called when a building is removed (pens release animals, etc.). */
  onRemove: (b: Building) => void = () => {};

  constructor(private world: World, private veg: Vegetation, private eco: Economy, private terrain: Terrain, private scene: THREE.Scene) {
    this.group.add(this.smoke.points);
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffa04a, 0, 8, 1.6);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
    }
  }

  byId(id: number): Building | undefined {
    return this.list.find((b) => b.id === id);
  }

  at(cellIndex: number): Building | undefined {
    const o = this.world.occ[cellIndex];
    return o ? this.byId(o - 1) : undefined;
  }

  of(key: BuildingKey, completeOnly = true): Building[] {
    return this.list.filter((b) => b.key === key && (!completeOnly || b.complete));
  }

  // ------------- Placement -------------

  /** Best jetty rotation at a position: the one whose deck runs over the most water. */
  jettyRot(cx: number, cz: number): number {
    let best = 0, bestN = -1;
    for (let r = 0; r < 4; r++) {
      const n = this.jettyWater(cx, cz, r);
      if (n > bestN) {
        bestN = n;
        best = r;
      }
    }
    return best;
  }

  private jettyWater(cx: number, cz: number, rot: number): number {
    const w = this.world;
    const [dx, dz] = ROT_DIR[rot];
    const s = BUILDINGS.jetty.size[0];
    // Centre of the front edge.
    const fx = cx + s / 2 - 0.5 + dx * (s / 2 + 0.5), fz = cz + s / 2 - 0.5 + dz * (s / 2 + 0.5);
    let n = 0;
    for (let k = 1; k <= JETTY.length; k++) {
      const x = Math.round(fx + dx * k), z = Math.round(fz + dz * k);
      if (w.inBounds(x, z) && w.layer[w.idx(x, z)] <= 0) n++;
    }
    return n;
  }

  /** Water cells (sea, river or pool) in the two-cell ring around a footprint. */
  private waterAround(cx: number, cz: number, w: number, d: number): number {
    const W = this.world;
    let n = 0;
    for (let z = cz - 2; z < cz + d + 2; z++) {
      for (let x = cx - 2; x < cx + w + 2; x++) {
        if (x >= cx && x < cx + w && z >= cz && z < cz + d) continue;
        if (!W.inBounds(x, z)) continue;
        const i = W.idx(x, z);
        if (W.layer[i] <= 0 || !Number.isNaN(W.riverY[i])) n++;
      }
    }
    return n;
  }

  get hasCampfire(): boolean {
    return this.list.some((b) => b.key === 'campfire');
  }

  /** Free beds across all finished homes and huts. */
  get freeBeds(): number {
    return this.list.reduce((s, b) => s + (b.complete ? Math.max(0, b.housing - b.residents.length) : 0), 0);
  }

  /** Finish a building at once (the founding campfire). */
  completeNow(b: Building): void {
    if (!b.complete) this.finish(b);
  }

  /**
   * Can this building go here? `moving` is a building being moved or rotated: its own cells count
   * as free and it costs nothing.
   */
  canPlace(key: BuildingKey, cx: number, cz: number, rot: number, moving?: Building): { ok: boolean; reason: string } {
    if (!moving) return this.siteCheck(key, cx, cz, rot, false);
    const cells: number[] = [];
    for (let z = moving.cz; z < moving.cz + moving.d; z++) for (let x = moving.cx; x < moving.cx + moving.w; x++) cells.push(this.world.idx(x, z));
    for (const i of cells) this.world.occ[i] = 0;
    const res = this.siteCheck(key, cx, cz, rot, true);
    for (const i of cells) this.world.occ[i] = moving.id + 1;
    return res;
  }

  private siteCheck(key: BuildingKey, cx: number, cz: number, rot: number, moving: boolean): { ok: boolean; reason: string } {
    const def = BUILDINGS[key];
    if (key === 'campfire' && this.hasCampfire && !moving) return { ok: false, reason: 'The village already has its fire' };
    if (key !== 'campfire' && !this.hasCampfire) return { ok: false, reason: 'Found your village first: place the campfire' };
    const [sw, sd] = def.size;
    const w = rot % 2 ? sd : sw, d = rot % 2 ? sw : sd;
    const f = this.world.isFlatFree(cx, cz, w, d);
    if (!f.ok) {
      // Distinguish "not flat" from "occupied".
      for (let z = cz; z < cz + d; z++) for (let x = cx; x < cx + w; x++) {
        if (!this.world.inBounds(x, z)) return { ok: false, reason: 'Out of bounds' };
        const i = this.world.idx(x, z);
        if (this.world.occ[i]) return { ok: false, reason: 'Something is already built here' };
        if (this.world.layer[i] < 1 || !Number.isNaN(this.world.riverY[i])) return { ok: false, reason: 'Needs dry land' };
      }
      return { ok: false, reason: 'Needs flat land: sculpt it level first' };
    }
    if ((key === 'jetty' || key === 'tradedock') && this.jettyWater(cx, cz, rot) < JETTY.length - 2) return { ok: false, reason: `A ${key === 'jetty' ? 'jetty' : 'trade dock'} must face open water at the shore` };
    if (key === 'chinampa' && this.waterAround(cx, cz, w, d) < 4) return { ok: false, reason: 'A chinampa must be built right beside water (river, pool or shore)' };
    if (!moving && !this.eco.canAfford(def.cost)) return { ok: false, reason: 'Not enough resources' };
    return { ok: true, reason: '' };
  }

  /** Buildings that can be turned or moved once placed (docks are tied to their shore). */
  canRelocate(b: Building): boolean {
    return b.key !== 'jetty' && b.key !== 'tradedock';
  }

  /** Called after a building is moved or rotated (pens, paths, grass). */
  onMoved: (b: Building) => void = () => {};

  /** Turn a building a quarter turn about its centre. */
  rotate(b: Building): { ok: boolean; reason: string } {
    if (!this.canRelocate(b)) return { ok: false, reason: 'Docks face the water and cannot be turned' };
    const rot = (b.rot + 1) % 4;
    const [sw, sd] = b.def.size;
    const w = rot % 2 ? sd : sw, d = rot % 2 ? sw : sd;
    const cx = Math.round(b.x + this.world.half - w / 2), cz = Math.round(b.z + this.world.half - d / 2);
    return this.relocate(b, cx, cz, rot);
  }

  /**
   * Move (and/or turn) an existing building, finished or not, keeping everything about it: its
   * residents, workers, progress, stock and animals.
   */
  relocate(b: Building, cx: number, cz: number, rot: number): { ok: boolean; reason: string } {
    if (!this.canRelocate(b)) return { ok: false, reason: 'Docks are tied to their shore and cannot be moved' };
    const chk = this.canPlace(b.key, cx, cz, rot, b);
    if (!chk.ok) return chk;
    const w = this.world;
    const farm = isFarm(b.key);
    for (let z = b.cz; z < b.cz + b.d; z++) for (let x = b.cx; x < b.cx + b.w; x++) {
      const i = w.idx(x, z);
      w.occ[i] = 0;
      if (farm) w.soil[i] = 0;
    }
    const [sw, sd] = b.def.size;
    b.cx = cx;
    b.cz = cz;
    b.rot = rot;
    b.w = rot % 2 ? sd : sw;
    b.d = rot % 2 ? sw : sd;
    b.layer = w.layer[w.idx(cx, cz)];
    b.x = cx + b.w / 2 - w.half;
    b.z = cz + b.d / 2 - w.half;
    b.y = w.layerY(b.layer);
    const [dx, dz] = ROT_DIR[rot];
    const depth = sd / 2 + 0.55;
    b.door = { x: b.x + dx * depth, z: b.z + dz * depth };
    for (let z = cz; z < cz + b.d; z++) for (let x = cx; x < cx + b.w; x++) {
      const i = w.idx(x, z);
      w.occ[i] = b.id + 1;
      if (w.path[i] && b.key !== 'torch') w.path[i] = 0;
      if (farm) w.soil[i] = 1;
    }
    this.eco.add('wood', this.veg.clearArea(cx, cz, b.w, b.d));
    if (b.key === 'butcher') [b.penX, b.penZ] = b.local(sw / 4 + 0.15, 0.1);
    b.group.position.set(b.x, b.y, b.z);
    b.group.rotation.y = (rot * Math.PI) / 2;
    const e = new THREE.Euler(0, (rot * Math.PI) / 2, 0);
    for (const t of b.torches) t.pos.copy(t.flame.position).applyEuler(e).add(b.group.position);
    this.terrain.updateWear();
    this.onMoved(b);
    return { ok: true, reason: '' };
  }

  place(key: BuildingKey, cx: number, cz: number, rot: number, instant = false): Building {
    const def = BUILDINGS[key];
    const b = new Building(this.nextId++, key, cx, cz, rot, this.world.layer[this.world.idx(cx, cz)], this.world);
    if (!instant) this.eco.spend(def.cost);
    let paved = false;
    for (let z = cz; z < cz + b.d; z++) for (let x = cx; x < cx + b.w; x++) {
      const i = this.world.idx(x, z);
      this.world.occ[i] = b.id + 1;
      // Buildings replace any stone path under them (torches stand beside the flagstones).
      if (this.world.path[i] && key !== 'torch') {
        this.world.path[i] = 0;
        paved = true;
      }
    }
    if (paved) this.terrain.updateWear();
    const wood = this.veg.clearArea(cx, cz, b.w, b.d);
    this.eco.add('wood', wood);
    if (key === 'torch') this.world.passableBuildings.add(b.id);
    if (isFarm(key)) {
      this.world.passableBuildings.add(b.id);
      for (let z = cz; z < cz + b.d; z++) for (let x = cx; x < cx + b.w; x++) this.world.soil[this.world.idx(x, z)] = 1;
      this.terrain.updateWear();
    }
    if (key === 'jetty' || key === 'tradedock') {
      // Boats dock at the T-end of the deck; islanders reach the jetty from the ramp on land.
      [b.dockX, b.dockZ] = b.local(0.5, 1.2 + JETTY.length + 1.0);
      const [rx, rz] = b.local(0.5, 0.4);
      b.door = { x: rx, z: rz };
    }
    if (key === 'butcher') {
      // The pen is on the local +x half.
      [b.penX, b.penZ] = b.local(def.size[0] / 4 + 0.15, 0.1);
    }
    this.buildVisuals(b);
    this.list.push(b);
    this.group.add(b.group);
    if (instant) this.finish(b);
    return b;
  }

  /** Upgrade a hut into a home, or a temple to the next tier. */
  canUpgrade(b: Building): { ok: boolean; reason: string; cost: Cost } {
    if (!b.complete || b.upgrading) return { ok: false, reason: 'Busy', cost: { wood: 0, stone: 0, belief: 0 } };
    if (b.key === 'temple') {
      if (b.tier >= (b.def.maxTier ?? 1)) return { ok: false, reason: 'Already the Great Pyramid', cost: { wood: 0, stone: 0, belief: 0 } };
      const cost = this.eco.templeUpgradeCost(b.tier + 1);
      return this.eco.canAfford(cost) ? { ok: true, reason: '', cost } : { ok: false, reason: 'Not enough resources', cost };
    }
    if (b.key === 'home') {
      if (b.tier >= (b.def.maxTier ?? 1)) return { ok: false, reason: 'Already the largest house', cost: { wood: 0, stone: 0, belief: 0 } };
      const cost = HOMES.upgradeCost[b.tier + 1];
      return this.eco.canAfford(cost) ? { ok: true, reason: '', cost } : { ok: false, reason: 'Not enough resources', cost };
    }
    if (b.key === 'hut') {
      const cost = BUILDINGS.home.cost;
      // The home needs a 3x3 flat area including the hut's cells.
      for (let z = b.cz; z < b.cz + 3; z++) for (let x = b.cx; x < b.cx + 3; x++) {
        if (!this.world.inBounds(x, z)) return { ok: false, reason: 'No room', cost };
        const i = this.world.idx(x, z);
        const o = this.world.occ[i];
        if ((o && o - 1 !== b.id) || this.world.layer[i] !== b.layer || !Number.isNaN(this.world.riverY[i])) return { ok: false, reason: 'Needs a flat 3×3 area', cost };
      }
      return this.eco.canAfford(cost) ? { ok: true, reason: '', cost } : { ok: false, reason: 'Not enough resources', cost };
    }
    return { ok: false, reason: 'No upgrade', cost: { wood: 0, stone: 0, belief: 0 } };
  }

  /** Performs an upgrade; for huts, returns the new Home building. */
  upgrade(b: Building): Building | null {
    const chk = this.canUpgrade(b);
    if (!chk.ok) return null;
    if (b.key === 'temple' || b.key === 'home') {
      this.eco.spend(chk.cost);
      b.upgrading = true;
      b.progress = 0;
      b.scaffold.visible = true;
      return b;
    }
    const residents = b.residents.slice();
    this.remove(b, false);
    const home = this.place('home', b.cx, b.cz, 0);
    home.residents = residents;
    return home;
  }

  /** Recreate a building from a save without paying or re-running completion effects. */
  restore(key: BuildingKey, cx: number, cz: number, rot: number, d: { complete: boolean; progress: number; tier: number; upgrading: boolean; growth: number; stock: number; bless: number }): Building {
    const hook = this.onComplete;
    this.onComplete = () => {};
    const b = this.place(key, cx, cz, rot, true);
    this.onComplete = hook;
    if (d.tier > 1) {
      b.tier = d.tier;
      const model = this.modelFor(b);
      b.finished.geometry.dispose();
      b.finished.geometry = model.finished;
      this.setTorches(b, model.torches);
    }
    b.growth = d.growth;
    b.stock = d.stock;
    b.blessTimer = d.bless;
    if (!d.complete || d.upgrading) {
      b.complete = !!d.upgrading;
      b.upgrading = d.upgrading;
      b.progress = d.progress;
      this.updateStageVisuals(b);
    }
    this.recomputeCaps();
    return b;
  }

  remove(b: Building, refund = true): void {
    this.onRemove(b);
    for (let z = b.cz; z < b.cz + b.d; z++) for (let x = b.cx; x < b.cx + b.w; x++) this.world.occ[this.world.idx(x, z)] = 0;
    if (b.key === 'torch') this.world.passableBuildings.delete(b.id);
    if (isFarm(b.key)) {
      this.world.passableBuildings.delete(b.id);
      for (let z = b.cz; z < b.cz + b.d; z++) for (let x = b.cx; x < b.cx + b.w; x++) this.world.soil[this.world.idx(x, z)] = 0;
      this.terrain.updateWear();
    }
    if (refund) this.eco.refund(b.def.cost, 0.5);
    this.group.remove(b.group);
    b.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry && !this.sharedGeo((o as THREE.Mesh).geometry)) (o as THREE.Mesh).geometry.dispose();
    });
    this.list = this.list.filter((x) => x !== b);
    this.recomputeCaps();
  }

  private sharedGeo(g: THREE.BufferGeometry): boolean {
    return g === this.flameGeo || this.logGeos.includes(g) || this.stoneGeos.includes(g) || this.basketGeos.includes(g) || [...this.cropGeos.values()].includes(g);
  }

  private modelFor(b: Building): models.BuildingModel {
    const [sw, sd] = b.def.size;
    switch (b.key) {
      case 'campfire': return models.campfireModel();
      case 'hut': return models.hutModel();
      case 'home': return models.homeModel(b.tier);
      case 'temple': return models.templeModel(b.tier);
      case 'farm': return models.farmModel(sw, sd, 'veg');
      case 'maizefarm': return models.farmModel(sw, sd, 'maize');
      case 'chinampa': return models.chinampaModel(sw, sd);
      case 'smokehouse': return models.smokehouseModel(sw, sd);
      case 'torch': return models.torchModel();
      case 'bonfire': return models.bonfireModel();
      case 'firepit': return models.firepitModel();
      case 'kennel': return models.kennelModel();
      case 'well': return models.wellModel();
      case 'butcher': return models.butcherModel(sw, sd);
      case 'woodstore': return models.woodstoreModel(sw, sd);
      case 'grainstore': return models.grainstoreModel();
      case 'warroom': return models.warroomModel();
      case 'jetty': return models.jettyModel(b.y, JETTY.length);
      case 'tradedock': return models.tradeDockModel(b.y, JETTY.length);
    }
  }

  private buildVisuals(b: Building): void {
    const mat = stylisedMaterial();
    const [sw, sd] = b.def.size;
    const model = this.modelFor(b);
    b.group.position.set(b.x, b.y, b.z);
    b.group.rotation.y = (b.rot * Math.PI) / 2;
    b.finished = new THREE.Mesh(model.finished, mat);
    b.finished.castShadow = true;
    b.finished.receiveShadow = true;
    b.foundation = new THREE.Mesh(models.foundationGeometry(sw, sd), mat);
    b.foundation.receiveShadow = true;
    b.scaffold = new THREE.Mesh(models.scaffoldGeometry(sw, sd, model.height), mat);
    b.scaffold.castShadow = true;
    b.group.add(b.foundation, b.scaffold, b.finished);
    this.setTorches(b, model.torches);

    if (isFarm(b.key)) {
      b.crops = new THREE.Mesh(this.cropGeo(sw, sd, false, FARM_TYPES[b.key]!.crop), mat);
      b.crops.castShadow = true;
      b.crops.receiveShadow = true;
      b.group.add(b.crops);
    }
    if (b.key === 'woodstore') {
      const rng = new RNG(b.id);
      for (let k = 0; k < 8; k++) {
        const stone = k >= 6;
        const m = new THREE.Mesh(stone ? this.stoneGeos[k % 2] : this.logGeos[k % 3], mat);
        const col = k % 3, row = Math.floor(k / 3);
        m.position.set(-0.85 + col * 0.85 + rng.range(-0.05, 0.05), row === 2 ? 0 : row * 0.36, -0.3 + (row === 2 ? 0.55 : 0));
        if (stone) m.position.set(-1.1 + (k - 6) * 2.2, 0, 0.55);
        m.rotation.y = rng.range(-0.1, 0.1);
        m.castShadow = true;
        m.visible = false;
        b.fills.push(m);
        b.group.add(m);
      }
    }
    if (b.key === 'grainstore' || b.key === 'campfire') {
      const rng = new RNG(b.id + 9);
      const n = b.key === 'campfire' ? 4 : 8;
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(this.basketGeos[k % 3], mat);
        const a = (k / n) * Math.PI * 2 + 0.3;
        const r = b.key === 'campfire' ? 1.25 : 0.82;
        m.position.set(Math.cos(a) * r + rng.range(-0.05, 0.05), 0, Math.sin(a) * r * 0.9);
        m.castShadow = true;
        m.visible = false;
        b.fills.push(m);
        b.group.add(m);
      }
    }
    this.updateStageVisuals(b);
  }

  private setTorches(b: Building, points: THREE.Vector3[]): void {
    for (const t of b.torches) b.group.remove(t.flame);
    b.torches = [];
    for (const p of points) {
      const flame = new THREE.Mesh(this.flameGeo, flameMaterial());
      flame.position.copy(p);
      flame.scale.setScalar(FLAME_SCALE[b.key] ?? 1);
      b.group.add(flame);
      const pos = p.clone().applyEuler(new THREE.Euler(0, (b.rot * Math.PI) / 2, 0)).add(b.group.position);
      b.torches.push({ pos, flame, phase: Math.random() * 10 });
    }
  }

  /** Smoke curling from the smokehouse chimney and racks; thicker while someone is at work. */
  private smokeFrom(b: Building, dt: number): void {
    if (b.upgrading) return;
    const busy = b.tendTimer > 0;
    this.smokeAcc += dt * (busy ? 9 : 2.5);
    while (this.smokeAcc > 1) {
      this.smokeAcc -= 1;
      const rack = Math.random() < (busy ? 0.55 : 0.2);
      const [x, z] = rack ? b.local(0.8 + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4) : b.local(-0.2, -0.45);
      const y = b.y + (rack ? 0.25 : 1.32);
      this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 0.12 + 0.08, 0.35 + Math.random() * 0.25, (Math.random() - 0.5) * 0.12 + 0.05, 3 + Math.random() * 2, 0.34 + Math.random() * 0.16, 0.45);
    }
  }

  private cropGeo(w: number, d: number, ripe: boolean, crop: 'veg' | 'maize' | 'chinampa'): THREE.BufferGeometry {
    const k = `${w}x${d}${ripe}${crop}`;
    let g = this.cropGeos.get(k);
    if (!g) {
      g = models.cropModel(w, d, ripe, crop);
      this.cropGeos.set(k, g);
    }
    return g;
  }

  private updateStageVisuals(b: Building): void {
    if (b.complete && !b.upgrading) {
      b.foundation.visible = false;
      b.scaffold.visible = false;
      b.finished.visible = true;
      b.finished.scale.y = 1;
      for (const t of b.torches) t.flame.visible = true;
      return;
    }
    if (b.upgrading) {
      b.foundation.visible = false;
      b.scaffold.visible = true;
      b.finished.visible = true;
      return;
    }
    const p = b.progress;
    b.foundation.visible = p < 0.35;
    b.scaffold.visible = p >= 0.12 && p < 1;
    b.finished.visible = p >= 0.3;
    b.finished.scale.y = Math.max(0.01, (p - 0.3) / 0.7);
    for (const t of b.torches) t.flame.visible = false;
    if (b.crops) b.crops.visible = false;
    for (const f of b.fills) f.visible = false;
  }

  /** Called by builders every frame they work. */
  addProgress(b: Building, dt: number): void {
    const time = b.upgrading ? (b.key === 'home' ? HOMES.upgradeTime[b.tier + 1] : TEMPLE.upgradeTime[b.tier + 1]) : b.def.buildTime;
    b.progress = Math.min(1, b.progress + dt / time);
    if (b.progress >= 1) this.finish(b);
    else this.updateStageVisuals(b);
  }

  private finish(b: Building): void {
    if (b.upgrading) {
      b.upgrading = false;
      b.tier++;
      const model = this.modelFor(b);
      b.finished.geometry.dispose();
      b.finished.geometry = model.finished;
      this.setTorches(b, model.torches);
      b.scaffold.geometry.dispose();
      b.scaffold.geometry = models.scaffoldGeometry(b.def.size[0], b.def.size[1], model.height + 1);
    }
    b.complete = true;
    b.progress = 1;
    b.builders.clear();
    this.updateStageVisuals(b);
    if (b.crops) b.crops.visible = true;
    this.recomputeCaps();
    this.onComplete(b);
  }

  recomputeCaps(): void {
    let wood = 0, food = 0, tiers = 0;
    for (const b of this.list) {
      if (!b.complete) continue;
      if (b.key === 'campfire') {
        wood += ECONOMY.baseWoodCap;
        food += ECONOMY.baseFoodCap;
      }
      wood += b.def.woodCap ?? 0;
      food += b.def.foodCap ?? 0;
      if (b.key === 'temple') tiers += b.tier;
    }
    this.eco.recomputeCaps(wood, food, tiers);
  }

  // ------------- Ghost preview -------------

  showGhost(key: BuildingKey | null, cx = 0, cz = 0, rot = 0, moving?: Building): { ok: boolean; reason: string } {
    if (!key) {
      if (this.ghost) this.scene.remove(this.ghost);
      this.ghost = null;
      this.ghostKey = null;
      return { ok: false, reason: '' };
    }
    if (key === 'jetty' || key === 'tradedock') rot = this.jettyRot(cx, cz);
    if (this.ghostKey !== key || this.ghostRot !== rot) {
      if (this.ghost) this.scene.remove(this.ghost);
      const tmp = new Building(0, key, 0, 0, rot, 1, this.world);
      const model = this.modelFor(tmp);
      this.ghost = new THREE.Group();
      const m = new THREE.Mesh(model.finished, this.ghostMat);
      m.renderOrder = 20;
      this.ghost.add(m);
      const [sw, sd] = BUILDINGS[key].size;
      const ring = new THREE.Mesh(this.ringGeo, this.ghostMat);
      ring.scale.set(sw * 1.41, 1, sd * 1.41);
      ring.rotation.y = Math.PI / 4;
      ring.position.y = 0.04;
      this.ghost.add(ring);
      this.scene.add(this.ghost);
      this.ghostKey = key;
      this.ghostRot = rot;
    }
    const def = BUILDINGS[key];
    const [sw, sd] = def.size;
    const w = rot % 2 ? sd : sw, d = rot % 2 ? sw : sd;
    const res = this.canPlace(key, cx, cz, rot, moving);
    const layer = this.world.layerAt(cx, cz);
    const y = key === 'jetty' ? this.world.layerY(Math.max(1, layer)) : this.world.layerY(Math.max(1, layer));
    this.ghost!.position.set(cx + w / 2 - this.world.half, y + 0.02, cz + d / 2 - this.world.half);
    this.ghost!.rotation.y = (rot * Math.PI) / 2;
    this.ghostMat.color.setHex(res.ok ? 0x9df08a : 0xff7a5a);
    return res;
  }

  get ghostRotation(): number {
    return this.ghostRot;
  }

  // ------------- Per-frame -------------

  update(dt: number, time: number, night: number, seasonIndex: number, raining: boolean, camTarget: THREE.Vector3): void {
    for (const b of this.list) {
      if (!b.complete) continue;
      if (b.key === 'smokehouse') {
        b.tendTimer = Math.max(0, b.tendTimer - dt);
        this.smokeFrom(b, dt);
      }
      const ft = FARM_TYPES[b.key];
      if (ft) {
        b.blessTimer = Math.max(0, b.blessTimer - dt);
        b.tendTimer = Math.max(0, b.tendTimer - dt);
        if (b.growth < 1 && b.stock <= 0) {
          const season = Math.max(ft.seasonFloor, FARM.seasonGrowth[seasonIndex]);
          let rate = ((season * ft.grow) / FARM.growSeconds) * (b.tendTimer > 0 ? FARM.tendBoost : 0.5);
          if (b.blessTimer > 0) rate *= FARM.blessMultiplier;
          if (raining) rate *= 1.3;
          b.growth = Math.min(1, b.growth + rate * dt);
        }
        if (b.crops) {
          const ripe = b.growth >= 0.85;
          const g = this.cropGeo(b.def.size[0], b.def.size[1], ripe, ft.crop);
          if (b.crops.geometry !== g) b.crops.geometry = g;
          b.crops.visible = b.growth > 0.02;
          b.crops.scale.y = 0.12 + 0.88 * b.growth;
        }
      }
    }
    this.updateFills();
    this.smoke.update(dt, -0.02);
    const day = 0.4 + 0.6 * (1 - night);
    ((this.smoke.points.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setRGB(0.79 * day, 0.76 * day, 0.73 * day);
    // Torches: flicker, visible from dusk; the few nearest the camera get real lights.
    const lit = night > 0.12;
    for (const b of this.list) {
      for (const t of b.torches) {
        const on = (b.complete && !b.upgrading && (lit || ALWAYS_LIT.has(b.key))) as boolean;
        t.flame.visible = on;
        if (on) {
          const f = 0.85 + Math.sin(time * 11 + t.phase) * 0.08 + Math.sin(time * 23 + t.phase * 2) * 0.06;
          const base = FLAME_SCALE[b.key] ?? 1;
          t.flame.scale.set(base * f, base * (0.9 + (1 - f) * 1.5), base * f);
        }
      }
    }
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.4;
      const all: Torch[] = [];
      for (const b of this.list) if (b.complete) for (const t of b.torches) all.push(t);
      all.sort((a, b2) => a.pos.distanceToSquared(camTarget) - b2.pos.distanceToSquared(camTarget));
      this.lights.forEach((l, i) => {
        const t = all[i];
        if (t) {
          l.position.copy(t.pos);
          l.position.y += 0.25;
        }
        l.userData.on = !!t;
      });
    }
    for (const l of this.lights) {
      l.intensity = l.userData.on ? night * (2.2 + Math.sin(time * 9 + l.position.x) * 0.3) : 0;
    }
    void FX;
  }

  private fillTimer = 0;
  private updateFills(): void {
    if (--this.fillTimer > 0) return;
    this.fillTimer = 20;
    const woodFrac = this.eco.woodCap > 0 ? this.eco.res.wood / this.eco.woodCap : 0;
    const stoneFrac = this.eco.woodCap > 0 ? this.eco.res.stone / this.eco.woodCap : 0;
    const foodFrac = this.eco.foodCap > 0 ? this.eco.food / this.eco.foodCap : 0;
    for (const b of this.list) {
      if (!b.complete || !b.fills.length) continue;
      if (b.key === 'woodstore') {
        b.fills.forEach((m, k) => {
          m.visible = k < 6 ? k < Math.ceil(woodFrac * 6) : k - 6 < Math.ceil(stoneFrac * 2);
        });
      } else {
        const n = b.fills.length;
        b.fills.forEach((m, k) => (m.visible = k < Math.ceil(foodFrac * n)));
      }
    }
  }

  /** Nearest completed store that accepts a resource. */
  nearestStore(x: number, z: number, food: boolean): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.list) {
      if (!b.complete) continue;
      const ok = b.key === 'campfire' || (food ? b.key === 'grainstore' || b.key === 'smokehouse' : b.key === 'woodstore');
      if (!ok) continue;
      const d = (b.door.x - x) ** 2 + (b.door.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }
}
