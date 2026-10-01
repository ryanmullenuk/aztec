import * as THREE from 'three';
import { RENDER, VEG, PresetName } from '../config';
import { stylisedMaterial, stylisedMaterialDouble, treeMaterial, treeMaterialDouble } from '../render/materials';
import { RNG } from '../world/rng';
import { FINE } from './detail';
import { TREE_POP, springPop } from './pop';
import { Simplex2, clamp } from '../world/noise';
import { World } from '../world/World';
import {
  appleFruitGeometry,
  bananaBunchGeometry,
  bananaGeometry,
  treeGeometry,
  fruitTreeGeometry,
  orangeFruitGeometry,
  CANOPY,
  bushGeometry,
  contactTexture,
  fernGeometry,
  palmGeometry,
  rockGeometry, seaRockGeometry,
  stumpGeometry,
} from './models';

export type PlantKind = 'palm' | 'broadleaf' | 'fern' | 'bush' | 'flowerbush' | 'apple' | 'banana' | 'rock' | 'searock' | 'reef';

export const enum PlantState {
  Alive = 0,
  Stump = 1,
  Sapling = 2,
  Gone = 3,
}

export interface Plant {
  id: number;
  kind: PlantKind;
  variant: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  state: PlantState;
  /** Sapling growth 0..1. */
  growth: number;
  timer: number;
  /** Wood (trees) or stone (rocks) remaining. */
  amount: number;
  fruit: number;
  fruitMax: number;
  fruitTimer: number;
  /** Islander id that has claimed this plant for work, or -1. */
  reservedBy: number;
  /** Player marked for priority harvesting. */
  marked: boolean;
  cell: number;
  slots: Partial<Record<string, number>>;
  chunk: number;
}

interface BatchDef {
  key: string;
  hi: THREE.BufferGeometry;
  lo?: THREE.BufferGeometry;
  /** Mid-distance detail (full shapes, without leaves, roots and vines). */
  mid?: THREE.BufferGeometry;
  double: boolean;
  shadow: boolean;
  /** Hide entirely when the chunk is further than lodDist * cull. 0 = never. */
  cull: number;
}

interface ChunkMesh {
  mesh: THREE.InstancedMesh;
  ids: number[];
  dirty: boolean;
  center: THREE.Vector3;
  def: BatchDef;
  /** Recompute the culling bounds on the next write (a tree was planted in it, or is popping up). */
  bounds?: boolean;
}

/** Kinds the player can plant (index = saved code). */
const PLANTABLE: PlantKind[] = ['palm', 'broadleaf', 'banana', 'apple'];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const TREE_KINDS: PlantKind[] = ['palm', 'broadleaf', 'banana'];
/** Seconds a dug-up tree takes to shrink away. */
const TREE_SINK = 0.45;

/**
 * All plants and rocks: generated from the seed, rendered as instanced meshes split into
 * spatial chunks (frustum culling + LOD), with chopping, fruit harvesting, mining and regrowth.
 */
export class Vegetation {
  readonly group = new THREE.Group();
  plants: Plant[] = [];
  private byCell = new Map<number, number[]>();
  private defs = new Map<string, BatchDef>();
  private chunks = new Map<string, ChunkMesh>();
  /**
   * Full-detail layer: the nearest trees and bushes of each type (every leaf, root and vine)
   * are drawn from one small instanced mesh per type and left out of their chunk meshes,
   * which use the lighter mid-distance model.
   */
  private fine = new Map<string, { mesh: THREE.InstancedMesh; ids: number[] }>();
  private nearIds = new Set<number>();
  private fineDirty = false;
  private C = VEG.chunks;
  private lodTimer = 0;
  private contact!: THREE.InstancedMesh;
  private contactDirty = false;
  private density: number;

  /** Plants from the seed (and islets); any after these were planted by the player, in order. */
  private baseCount = 0;
  /** Planted trees popping up: seconds since each began (negative: still waiting its turn). */
  private popping = new Map<number, number>();
  /** Planted trees being dug up: seconds into shrinking away. */
  private sinking = new Map<number, number>();
  private plantRng = new RNG(977);

  constructor(private world: World, preset: PresetName) {
    this.density = RENDER.presets[preset].vegDensity;
    this.makeDefs();
    this.generate();
  }

  /** Build the meshes once every plant exists (after growIslets). */
  build(): void {
    this.baseCount = this.plants.length;
    this.buildMeshes();
    this.syncRockBlock();
  }

  /**
   * Boulders are solid: mark the cells under every standing rock (redone when one is mined out,
   * cleared for a building, drowned by sculpting, or a save is loaded).
   */
  syncRockBlock(): void {
    const w = this.world;
    w.blockRock.fill(0);
    for (const p of this.plants) {
      if (p.kind !== 'rock' || p.state === PlantState.Gone) continue;
      w.blockCircle(p.x, p.z, (0.45 + p.variant * 0.2) * p.scale, w.blockRock);
    }
  }

  private makeDefs(): void {
    const d = (key: string, hi: THREE.BufferGeometry, lo: THREE.BufferGeometry | undefined, double: boolean, shadow = true, cull = 0) =>
      this.defs.set(key, { key, hi, lo, double, shadow, cull });
    for (let v = 0; v < 3; v++) d(`palm${v}`, palmGeometry(v, false, 11 + v), palmGeometry(v, true, 11 + v), true);
    for (let v = 0; v < 8; v++) d(`broadleaf${v}`, treeGeometry(v, false, 21 + v), treeGeometry(v, true, 21 + v), false);
    d('apple1', fruitTreeGeometry(false, 45), fruitTreeGeometry(true, 45), false);
    d('fruit_orange', orangeFruitGeometry(46), undefined, false, false, 1.4);
    d('fern0', fernGeometry(false, 31), fernGeometry(true, 31), true, false, 1.1);
    d('bush0', bushGeometry(false, false, 41), bushGeometry(false, true, 41), false, true, 1.6);
    d('flowerbush0', bushGeometry(true, false, 42), bushGeometry(false, true, 42), false, true, 1.6);
    d('apple0', bushGeometry(false, false, 43, true), bushGeometry(false, true, 43, true), false);
    d('fruit_apple', appleFruitGeometry(44), undefined, false, false, 1.4);
    d('banana0', bananaGeometry(false, 51), bananaGeometry(true, 51), true);
    d('fruit_banana', bananaBunchGeometry(), undefined, false, false, 1.4);
    // Mid-distance versions: the same shapes without the fine leaves, roots, branches and vines.
    const mid = (key: string, build: () => THREE.BufferGeometry) => {
      FINE.on = false;
      this.defs.get(key)!.mid = build();
      FINE.on = true;
    };
    for (let v = 0; v < 3; v++) mid(`palm${v}`, () => palmGeometry(v, false, 11 + v));
    for (let v = 0; v < 8; v++) mid(`broadleaf${v}`, () => treeGeometry(v, false, 21 + v));
    mid('apple1', () => fruitTreeGeometry(false, 45));
    mid('bush0', () => bushGeometry(false, false, 41));
    mid('flowerbush0', () => bushGeometry(true, false, 42));
    mid('apple0', () => bushGeometry(false, false, 43, true));
    for (let v = 0; v < 3; v++) d(`rock${v}`, rockGeometry(v, 61 + v), undefined, false);
    d('searock0', seaRockGeometry(71), undefined, false);
    d('searock1', seaRockGeometry(72), undefined, false);
    d('reef0', rockGeometry(2, 81, true), undefined, false, false, 1.5);
    d('stump', stumpGeometry(), undefined, false, false, 1.4);
  }

  private add(kind: PlantKind, variant: number, x: number, z: number, rot: number, scale: number, rng: RNG): Plant {
    const w = this.world;
    const cell = w.cellIndexAt(x, z);
    const p: Plant = {
      id: this.plants.length,
      kind,
      variant,
      x,
      z,
      y: w.heightAt(x, z),
      rot,
      scale,
      state: PlantState.Alive,
      growth: 1,
      timer: 0,
      amount: kind === 'broadleaf' ? VEG.woodPerBroadleaf : kind === 'palm' ? VEG.woodPerPalm : kind === 'rock' ? VEG.stonePerRock * (1 + variant * 0.5) : kind === 'banana' ? 1 : 0,
      fruit: 0,
      fruitMax: kind === 'apple' ? VEG.fruitPerBush * (variant === 1 ? 2 : 1) : kind === 'banana' ? VEG.fruitPerBanana : 0,
      fruitTimer: 0,
      reservedBy: -1,
      marked: false,
      cell,
      slots: {},
      chunk: this.chunkOf(x, z),
    };
    p.fruit = p.fruitMax * (0.6 + rng.next() * 0.4);
    if (kind === 'reef') p.y = w.heightAt(x, z) - 0.05;
    // Sea rocks poke out of the water so foam can curl around them.
    if (kind === 'searock') p.y = Math.max(w.heightAt(x, z) - 0.05, -0.32);
    this.plants.push(p);
    const list = this.byCell.get(cell);
    if (list) list.push(p.id);
    else this.byCell.set(cell, [p.id]);
    return p;
  }

  private chunkOf(x: number, z: number): number {
    const w = this.world;
    const cx = clamp(Math.floor(((x + w.half) / w.N) * this.C), 0, this.C - 1);
    const cz = clamp(Math.floor(((z + w.half) / w.N) * this.C), 0, this.C - 1);
    return cz * this.C + cx;
  }

  /** Is the ground around (x,z) flat enough to stand a plant on? */
  private flatEnough(x: number, z: number, r: number, tol: number): boolean {
    const w = this.world;
    const h0 = w.heightAt(x, z);
    return (
      Math.abs(w.heightAt(x + r, z) - h0) < tol &&
      Math.abs(w.heightAt(x - r, z) - h0) < tol &&
      Math.abs(w.heightAt(x, z + r) - h0) < tol &&
      Math.abs(w.heightAt(x, z - r) - h0) < tol
    );
  }

  private generate(): void {
    const w = this.world;
    const rng = new RNG(w.seed * 31 + 101);
    const noise = new Simplex2(rng);
    const N = w.N;
    const dens = this.density;
    for (let cz = 1; cz < N - 1; cz++) {
      for (let cx = 1; cx < N - 1; cx++) this.populate(cx, cz, rng, noise, dens);
    }
  }

  /**
   * Plants for the grown islets' new land and shallows, from their own random stream and
   * appended after the original plants (whose order the saves rely on).
   */
  growIslets(cells: number[]): void {
    const w = this.world;
    const rng = new RNG(w.seed * 31 + 977);
    const noise = new Simplex2(rng);
    for (const i of cells) {
      const cx = i % w.N, cz = (i / w.N) | 0;
      if (cx > 0 && cz > 0 && cx < w.N - 1 && cz < w.N - 1) this.populate(cx, cz, rng, noise, this.density);
    }
    // Reefs and sea rocks the islets now stand on are gone.
    for (const p of this.plants) if ((p.kind === 'reef' || p.kind === 'searock') && w.layer[p.cell] >= 1) p.state = PlantState.Gone;
  }

  /** Plants for one cell, by its biome (the order of random draws must never change). */
  private populate(cx: number, cz: number, rng: RNG, noise: Simplex2, dens: number): void {
    const w = this.world;
    const N = w.N;
    const i = cz * N + cx;
    const L = w.layer[i];
    const bx = w.centerX(cx), bz = w.centerZ(cz);
    if (L <= 0) {
      // Shallows: rocks off rocky coasts, reef clusters.
      if (L >= -2 && w.distWater[i] === 0) {
        const nearRocky = w.rocky[i - 1] + w.rocky[i + 1] + w.rocky[i - N] + w.rocky[i + N] > 0.5;
        if (nearRocky && rng.chance(VEG.rockShore * 2.5)) {
          const x = bx + rng.range(-0.3, 0.3), z = bz + rng.range(-0.3, 0.3);
          this.add('searock', rng.int(0, 1), x, z, rng.range(0, 6.28), rng.range(0.9, 1.6), rng);
          this.stampFoam(x, z, 1.4);
        } else if (L >= -1 && noise.noise(cx * 0.12, cz * 0.12) > 0.45 && rng.chance(0.18)) {
          this.add('reef', 0, bx + rng.range(-0.4, 0.4), bz + rng.range(-0.4, 0.4), rng.range(0, 6.28), rng.range(0.7, 1.3), rng);
        }
      }
      return;
    }
    if (!Number.isNaN(w.riverY[i]) || w.occ[i] !== 0) return;
    const dm = Math.hypot(bx - w.meadow.x, bz - w.meadow.z);
    if (dm < w.meadow.r - 1) return;
    const forest = w.forest[i];
    const sandy = w.sandy[i];
    const rocky = w.rocky[i];
    const edge = dm < w.meadow.r + 5;
    const jx = () => bx + rng.range(-0.4, 0.4);
    const jz = () => bz + rng.range(-0.4, 0.4);

    // Rocks.
    const rockChance = rocky > 0.5 ? VEG.rockHighland : L >= 5 ? VEG.rockHill : 0.004;
    if (rng.chance(rockChance)) {
      const x = jx(), z = jz();
      if (this.flatEnough(x, z, 0.4, 0.3)) this.add('rock', rng.int(0, 2), x, z, rng.range(0, 6.28), rng.range(0.7, 1.4), rng);
      return;
    }

    // One tree per cell at most, chosen by biome. Clustering noise groups trees naturally.
    const cluster = noise.noise(cx * 0.09 + 50, cz * 0.09 - 30) * 0.5 + 0.5;
    const river = this.nearRiverCell(cx, cz);
    const hills = L >= 8 || rocky > 0.4;
    type Pick = [PlantKind, number, number]; // kind, variant, weight
    let chance = 0;
    let table: Pick[] = [];
    if (sandy > 0.5) {
      chance = VEG.palmBeach * (0.5 + cluster);
      table = [['palm', -1, 20], ['broadleaf', 2, 1]];
    } else if (forest > 0.35) {
      chance = (0.46 * forest + (river ? 0.15 : 0)) * (0.7 + cluster * 0.6);
      // The wild island's jungle is rich in bananas and fruit trees.
      const fruitK = w.isle[i] === 2 ? 3.5 : 1;
      table = [['broadleaf', 0, 20], ['broadleaf', 1, 18], ['broadleaf', 5, river ? 30 : 14], ['broadleaf', 6, river ? 16 : 9], ['broadleaf', 3, 7], ['broadleaf', 4, 5], ['palm', -1, 14], ['banana', 0, 4 * fruitK], ['apple', 1, 3 * fruitK], ['apple', 0, fruitK > 1 ? 6 : 0]];
    } else if (hills) {
      chance = 0.07 * (0.3 + cluster);
      table = [['broadleaf', 3, 35], ['broadleaf', 2, 30], ['broadleaf', 4, 20], ['palm', -1, 15]];
    } else if (w.distWater[i] < 9) {
      chance = 0.05 * (0.3 + cluster);
      table = [['palm', -1, 45], ['broadleaf', 2, 25], ['broadleaf', 4, 20], ['apple', 1, 5], ['broadleaf', 7, 5]];
    } else {
      // Open grassland: mostly clear, with small clusters of trees.
      chance = cluster > 0.62 ? 0.14 : 0.006;
      table = [['broadleaf', 2, 35], ['broadleaf', 4, 25], ['broadleaf', 3, 15], ['apple', 1, 10], ['broadleaf', 7, 7], ['palm', -1, 8]];
    }
    if (edge) chance *= 0.3;
    if (rng.chance(chance)) {
      const tot = table.reduce((t, p) => t + p[2], 0);
      let r = rng.next() * tot;
      let pick = table[0];
      for (const p of table) if ((r -= p[2]) <= 0) {
        pick = p;
        break;
      }
      const [tree, v0] = pick;
      const x = jx(), z = jz();
      if (this.flatEnough(x, z, 0.3, 0.28)) {
        let rot = rng.range(0, Math.PI * 2);
        let variant = tree === 'palm' ? rng.int(0, 2) : v0;
        if (tree === 'palm' && sandy > 0.5) {
          // Beach palms lean out toward the sea.
          const gx = w.distWater[i - 1] - w.distWater[i + 1];
          const gz = w.distWater[i - N] - w.distWater[i + N];
          if (gx || gz) {
            rot = Math.atan2(-gz, gx);
            variant = rng.chance(0.7) ? 1 : 2;
          }
        }
        let sc = tree === 'broadleaf' ? rng.range(0.85, 1.3) : tree === 'palm' ? rng.range(0.75, 1.25) : rng.range(0.85, 1.1);
        if (river) sc *= 1.15;
        // Occasional young trees.
        if (tree === 'broadleaf' && rng.chance(0.08)) sc *= 0.55;
        this.add(tree, variant, x, z, rot, sc, rng);
      }
    }
    // Understory.
    if (forest > 0.35) {
      const ferns = Math.floor(VEG.fernPerJungleCell * forest * dens + rng.next());
      for (let k = 0; k < ferns; k++) {
        const x = jx(), z = jz();
        if (this.flatEnough(x, z, 0.2, 0.25)) this.add('fern', 0, x, z, rng.range(0, 6.28), rng.range(0.7, 1.3), rng);
      }
      if (rng.chance(VEG.bushJungle * forest * dens)) {
        const x = jx(), z = jz();
        if (this.flatEnough(x, z, 0.25, 0.25)) this.add(rng.chance(VEG.flowerBushChance) ? 'flowerbush' : 'bush', 0, x, z, rng.range(0, 6.28), rng.range(0.7, 1.2), rng);
      }
      if (rng.chance(VEG.appleJungle * forest)) {
        const x = jx(), z = jz();
        if (this.flatEnough(x, z, 0.25, 0.25)) this.add('apple', 0, x, z, rng.range(0, 6.28), rng.range(0.9, 1.15), rng);
      }
    } else if (sandy < 0.5) {
      const nearMeadow = edge ? 2.5 : 1;
      if (rng.chance(VEG.bushMeadow * dens * nearMeadow)) {
        const x = jx(), z = jz();
        if (this.flatEnough(x, z, 0.25, 0.25)) this.add(rng.chance(0.55) ? 'flowerbush' : 'bush', 0, x, z, rng.range(0, 6.28), rng.range(0.6, 1.1), rng);
      }
      if (rng.chance(VEG.appleMeadow * nearMeadow * 1.5)) {
        const x = jx(), z = jz();
        if (this.flatEnough(x, z, 0.25, 0.25)) this.add('apple', 0, x, z, rng.range(0, 6.28), rng.range(0.9, 1.15), rng);
      }
    }
  }

  private nearRiverCell(cx: number, cz: number): boolean {
    const w = this.world;
    for (let dz = -3; dz <= 3; dz += 2) for (let dx = -3; dx <= 3; dx += 2) {
      if (w.inBounds(cx + dx, cz + dz) && !Number.isNaN(w.riverY[w.idx(cx + dx, cz + dz)])) return true;
    }
    return false;
  }

  private stampFoam(x: number, z: number, r: number): void {
    const w = this.world;
    const [cx, cz] = w.cellOf(x, z);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) continue;
        const d = Math.hypot(w.centerX(cx + dx) - x, w.centerZ(cz + dz) - z);
        const i = w.idx(cx + dx, cz + dz);
        w.foam[i] = Math.max(w.foam[i], clamp(1 - d / (r + 0.8), 0, 1));
      }
    }
  }

  /** Batch key for the main mesh of a plant. */
  private mainKey(p: Plant): string {
    return `${p.kind}${p.variant}`;
  }

  private buildMeshes(): void {
    // Collect instance ids per (batch key, chunk).
    const groups = new Map<string, number[]>();
    const push = (key: string, chunk: number, id: number) => {
      const k = `${key}|${chunk}`;
      const g = groups.get(k);
      if (g) g.push(id);
      else groups.set(k, [id]);
    };
    for (const p of this.plants) {
      push(this.mainKey(p), p.chunk, p.id);
      if (p.kind === 'apple') push(p.variant === 1 ? 'fruit_orange' : 'fruit_apple', p.chunk, p.id);
      if (p.kind === 'banana') push('fruit_banana', p.chunk, p.id);
      if (TREE_KINDS.includes(p.kind)) push('stump', p.chunk, p.id);
    }
    for (const [k, ids] of groups) {
      const [key, chunkS] = k.split('|');
      this.makeChunk(key, +chunkS, ids, ids.length);
    }

    for (const def of this.defs.values()) {
      if (!def.mid) continue;
      const tall = /^(palm|broadleaf|banana|apple1)/.test(def.key);
      const mat = tall ? (def.double ? treeMaterialDouble() : treeMaterial()) : def.double ? stylisedMaterialDouble() : stylisedMaterial();
      const mesh = new THREE.InstancedMesh(def.hi, mat, VEG.fineCap);
      mesh.castShadow = def.shadow;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.fine.set(def.key, { mesh, ids: [] });
      this.group.add(mesh);
    }

    // Contact shadows under trees and rocks.
    const contactGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const contactMat = new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: true });
    const withContact = this.plants.filter((p) => p.kind === 'broadleaf' || p.kind === 'palm' || p.kind === 'rock' || p.kind === 'banana' || p.kind === 'apple' || p.kind === 'bush' || p.kind === 'flowerbush');
    this.contact = new THREE.InstancedMesh(contactGeo, contactMat, withContact.length);
    this.contact.renderOrder = 1;
    withContact.forEach((p, i) => (p.slots['contact'] = i));
    this.contactIds = withContact.map((p) => p.id);
    this.writeContact();
    this.contact.computeBoundingSphere();
    this.group.add(this.contact);
    this.buildMarkers();
  }

  /** An instanced mesh for one plant shape in one map chunk, holding up to `cap` plants. */
  private makeChunk(key: string, chunk: number, ids: number[], cap: number): ChunkMesh {
    const w = this.world;
    const def = this.defs.get(key)!;
    // Tall trees get the see-through material (they fade when in the way at close zoom).
    const tall = /^(palm|broadleaf|banana|apple1)/.test(key);
    const mat = tall ? (def.double ? treeMaterialDouble() : treeMaterial()) : def.double ? stylisedMaterialDouble() : stylisedMaterial();
    const mesh = new THREE.InstancedMesh(def.hi, mat, Math.max(1, cap));
    mesh.castShadow = def.shadow;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const ccx = chunk % this.C, ccz = Math.floor(chunk / this.C);
    const size = w.N / this.C;
    const cm: ChunkMesh = {
      mesh,
      ids,
      dirty: true,
      center: new THREE.Vector3((ccx + 0.5) * size - w.half, 0, (ccz + 0.5) * size - w.half),
      def,
    };
    ids.forEach((id, slot) => (this.plants[id].slots[key] = slot));
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.chunks.set(`${key}|${chunk}`, cm);
    this.writeChunk(cm, key);
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    return cm;
  }

  /** Swap a chunk's mesh for a bigger one (same shape, material and LOD state). */
  private enlarge(cm: ChunkMesh, cap: number): void {
    const old = cm.mesh;
    const mesh = new THREE.InstancedMesh(old.geometry, old.material, cap);
    mesh.castShadow = old.castShadow;
    mesh.receiveShadow = old.receiveShadow;
    mesh.visible = old.visible;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.remove(old);
    old.dispose();
    this.group.add(mesh);
    cm.mesh = mesh;
    cm.dirty = true;
  }

  /** Give a newly added plant an instance in the mesh for one of its shapes. */
  private slotIn(p: Plant, key: string): void {
    let cm = this.chunks.get(`${key}|${p.chunk}`);
    if (!cm) cm = this.makeChunk(key, p.chunk, [], 8);
    else if (cm.ids.length >= cm.mesh.instanceMatrix.count) this.enlarge(cm, cm.ids.length * 2);
    p.slots[key] = cm.ids.length;
    cm.ids.push(p.id);
    cm.dirty = true;
    cm.bounds = true;
  }

  /**
   * Plant a tree (palm, broadleaf, banana, or orange tree as apple variant 1): a real tree from
   * then on, chopped for wood, picked for fruit, regrowing from its stump. `delay` seconds until
   * it pops up out of the ground with a springy bounce (null: there at once, as when loading).
   */
  plantTree(kind: PlantKind, variant: number, x: number, z: number, rot: number, scale: number, delay: number | null): Plant {
    const p = this.add(kind, variant, x, z, rot, scale, this.plantRng);
    if (delay !== null) {
      p.fruit = 0;
      this.popping.set(p.id, -delay);
    }
    this.slotIn(p, this.mainKey(p));
    if (kind === 'apple') this.slotIn(p, variant === 1 ? 'fruit_orange' : 'fruit_apple');
    if (kind === 'banana') this.slotIn(p, 'fruit_banana');
    if (TREE_KINDS.includes(kind)) this.slotIn(p, 'stump');
    // Contact shadow underneath.
    if (this.contactIds.length >= this.contact.instanceMatrix.count) {
      const old = this.contact;
      this.contact = new THREE.InstancedMesh(old.geometry, old.material, old.instanceMatrix.count * 2);
      this.contact.renderOrder = old.renderOrder;
      this.group.remove(old);
      old.dispose();
      this.group.add(this.contact);
    }
    p.slots['contact'] = this.contactIds.length;
    this.contactIds.push(p.id);
    this.contactDirty = true;
    this.contactBounds = true;
    return p;
  }

  /**
   * Is there room for a new tree of trunk-and-canopy radius `r` here, clear of standing trees,
   * stumps, saplings, rocks and bushes?
   */
  roomForTree(x: number, z: number, r: number): boolean {
    const w = this.world;
    const [cx, cz] = w.cellOf(x, z);
    const n = Math.ceil(r + 1.2);
    for (let dz = -n; dz <= n; dz++) {
      for (let dx = -n; dx <= n; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) continue;
        for (const id of this.byCell.get(w.idx(cx + dx, cz + dz)) ?? []) {
          const p = this.plants[id];
          if (p.state === PlantState.Gone || p.kind === 'fern' || p.kind === 'reef' || p.kind === 'searock') continue;
          const pr = (p.kind === 'broadleaf' ? CANOPY[p.variant].r * 0.55 : p.kind === 'palm' ? 0.7 : p.kind === 'rock' ? 0.6 : p.kind === 'bush' || p.kind === 'flowerbush' ? 0.4 : 0.55) * p.scale;
          if ((p.x - x) ** 2 + (p.z - z) ** 2 < (r + pr) ** 2) return false;
        }
      }
    }
    return true;
  }

  /**
   * Advance planted trees' pop-up bounce (real seconds, so it plays while paused). Returns the
   * trees that have just broken out of the ground (for a puff of earth and a sound).
   */
  updatePops(dt: number): Plant[] {
    const started: Plant[] = [];
    for (const [id, t] of this.sinking) {
      const p = this.plants[id];
      const t1 = t + dt;
      if (t1 >= TREE_SINK) {
        this.sinking.delete(id);
        p.state = PlantState.Gone;
      } else this.sinking.set(id, t1);
      this.touch(p);
      this.boundsOf(p);
    }
    for (const [id, t] of this.popping) {
      const p = this.plants[id];
      const t1 = t + dt;
      if (t <= 0 && t1 > 0) started.push(p);
      if (t1 >= TREE_POP.dur || p.state !== PlantState.Alive) this.popping.delete(id);
      else this.popping.set(id, t1);
      this.touch(p);
      this.boundsOf(p);
    }
    return started;
  }

  private boundsOf(p: Plant): void {
    for (const key of Object.keys(p.slots)) {
      const cm = this.chunks.get(`${key}|${p.chunk}`);
      if (cm) cm.bounds = true;
    }
    this.contactBounds = true;
  }

  /**
   * Dig up trees the player planted within `r` of (x, z) (never the island's own forest): they
   * shrink back into the ground and are gone. Returns how many.
   */
  digPlanted(x: number, z: number, r: number): number {
    let n = 0;
    for (let i = this.baseCount; i < this.plants.length; i++) {
      const p = this.plants[i];
      if (p.state === PlantState.Gone || this.sinking.has(p.id)) continue;
      if ((p.x - x) ** 2 + (p.z - z) ** 2 > r * r) continue;
      this.popping.delete(p.id);
      this.sinking.set(p.id, 0);
      p.reservedBy = -1;
      n++;
    }
    return n;
  }

  /** Trees still popping up. */
  get poppingCount(): number {
    return this.popping.size;
  }

  /** The player's planted trees, for saving: [kind, variant, x, z, rotation, scale] each (hundredths). */
  serializePlanted(): number[] {
    const out: number[] = [];
    for (let i = this.baseCount; i < this.plants.length; i++) {
      const p = this.plants[i];
      out.push(PLANTABLE.indexOf(p.kind), p.variant, Math.round(p.x * 100), Math.round(p.z * 100), Math.round(p.rot * 100), Math.round(p.scale * 100));
    }
    return out;
  }

  /** Replant the player's trees from a save, in order (before their states are restored). */
  restorePlanted(data: number[]): void {
    for (let i = 0; i + 5 < data.length; i += 6) {
      const kind = PLANTABLE[data[i]];
      if (!kind) continue;
      const variant = Math.max(0, Math.min(kind === 'broadleaf' ? 7 : kind === 'palm' ? 2 : kind === 'apple' ? 1 : 0, data[i + 1] | 0));
      this.plantTree(kind, variant, data[i + 2] / 100, data[i + 3] / 100, data[i + 4] / 100, clamp(data[i + 5] / 100, 0.3, 2), null);
    }
  }

  private contactBounds = false;
  private contactIds: number[] = [];
  private markers!: THREE.InstancedMesh;
  private markedIds: number[] = [];
  private markersDirty = true;

  private buildMarkers(): void {
    const g = new THREE.OctahedronGeometry(0.16, 0);
    g.scale(1, 1.6, 1);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.5), fog: true });
    this.markers = new THREE.InstancedMesh(g, m, 400);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.group.add(this.markers);
  }

  /** Toggle priority-harvest marks for plants near a point. Returns how many changed. */
  markArea(x: number, z: number, r: number, on: boolean): number {
    let n = 0;
    const w = this.world;
    const [cx, cz] = w.cellOf(x, z);
    const R = Math.ceil(r);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (!w.inBounds(cx + dx, cz + dz)) continue;
      for (const p of this.plantsInCell(w.idx(cx + dx, cz + dz))) {
        if (Math.hypot(p.x - x, p.z - z) > r) continue;
        const ok = (p.kind === 'broadleaf' || p.kind === 'palm') ? p.state === PlantState.Alive : p.kind === 'rock' ? p.amount > 0 && p.state === PlantState.Alive : (p.kind === 'apple' || p.kind === 'banana') && p.fruit >= 1;
        if (!ok || p.marked === on) continue;
        if (on && this.markedIds.length >= 400) break;
        p.marked = on;
        n++;
      }
    }
    if (n) this.markersDirty = true;
    return n;
  }

  get markedCount(): number {
    return this.markedIds.length;
  }

  private updateMarkers(time: number): void {
    if (this.markersDirty) {
      this.markedIds = this.plants.filter((p) => p.marked).map((p) => p.id).slice(0, 400);
      this.markersDirty = false;
    }
    const n = this.markedIds.length;
    this.markers.count = n;
    for (let k = 0; k < n; k++) {
      const p = this.plants[this.markedIds[k]];
      if (!p.marked) {
        this.markersDirty = true;
        continue;
      }
      const h = p.kind === 'broadleaf' ? CANOPY[p.variant].top + 0.5 : p.kind === 'palm' ? 3.9 : p.kind === 'rock' ? 1.1 : p.kind === 'banana' ? 2.1 : p.kind === 'apple' && p.variant === 1 ? 2.9 : 1.3;
      _p.set(p.x, p.y + h * p.scale + Math.sin(time * 2.5 + p.id) * 0.12, p.z);
      _e.set(0, time * 1.5 + p.id, 0);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      this.markers.setMatrixAt(k, _m.compose(_p, _q, _s));
    }
    this.markers.instanceMatrix.needsUpdate = true;
  }

  private plantMatrix(p: Plant, key: string, out: THREE.Matrix4): THREE.Matrix4 {
    const isStump = key === 'stump';
    const isFruit = key.startsWith('fruit_');
    let s = p.scale;
    if (p.state === PlantState.Gone) return out.copy(ZERO);
    if (isStump) {
      if (p.state !== PlantState.Stump) return out.copy(ZERO);
    } else {
      if (p.state === PlantState.Stump) return out.copy(ZERO);
      if (p.state === PlantState.Sapling) s *= 0.18 + 0.82 * p.growth;
      if (p.kind === 'rock') s *= 0.45 + 0.55 * clamp(p.amount / (VEG.stonePerRock * (1 + p.variant * 0.5)), 0, 1);
    }
    if (isFruit) {
      if (p.state !== PlantState.Alive || p.fruitMax === 0) return out.copy(ZERO);
      const f = p.fruit / p.fruitMax;
      if (f < 0.05) return out.copy(ZERO);
      // Apples shrink as picked; banana bunch keeps its shape.
      s *= p.kind === 'apple' ? 0.5 + 0.5 * f : 1;
    }
    _p.set(p.x, p.y, p.z);
    _e.set(0, p.rot, 0);
    _q.setFromEuler(_e);
    _s.set(s, s, s);
    // Planted trees spring up out of the ground.
    const pop = this.popping.get(p.id);
    if (pop !== undefined && !isStump) {
      const k = springPop(pop, TREE_POP.dur, TREE_POP.freq, TREE_POP.damp);
      if (k.s <= 0.001) return out.copy(ZERO);
      _s.set(s * k.s, s * k.sy, s * k.s);
    }
    // Being dug up: shrinking back into the ground.
    const sink = this.sinking.get(p.id);
    if (sink !== undefined) {
      const u = 1 - Math.min(1, sink / TREE_SINK);
      if (u <= 0.001) return out.copy(ZERO);
      _s.multiplyScalar(u * u);
    }
    return out.compose(_p, _q, _s);
  }

  /** Per-plant brightness / hue variation (deterministic). */
  private tint(p: Plant, key: string, out: THREE.Color): THREE.Color {
    if (key === 'reef0') return out.setRGB(1, 1, 1);
    const h = Math.sin(p.id * 12.9898 + 78.233) * 43758.5453;
    const r = h - Math.floor(h);
    const v = 0.86 + r * 0.24;
    return out.setRGB(v * (0.97 + r * 0.05), v, v * (0.95 + (1 - r) * 0.05));
  }

  /** Upload a chunk, packing visible instances to the front so hidden ones cost nothing. */
  private writeChunk(cm: ChunkMesh, key: string): void {
    let n = 0;
    const col = new THREE.Color();
    for (let slot = 0; slot < cm.ids.length; slot++) {
      const p = this.plants[cm.ids[slot]];
      if (cm.def.mid && this.nearIds.has(p.id)) continue;
      this.plantMatrix(p, key, _m);
      if (_m.elements[0] === 0 && _m.elements[5] === 0) continue;
      cm.mesh.setMatrixAt(n, _m);
      cm.mesh.setColorAt(n, this.tint(p, key, col));
      n++;
    }
    cm.mesh.count = n;
    cm.mesh.instanceMatrix.needsUpdate = true;
    if (cm.mesh.instanceColor) cm.mesh.instanceColor.needsUpdate = true;
    cm.dirty = false;
    if (cm.bounds) {
      cm.mesh.computeBoundingSphere();
      cm.bounds = false;
    }
  }

  /** Choose the nearest plants of each detailed type for the full-detail layer. */
  private pickNear(camPos: THREE.Vector3, range: number): void {
    const per = new Map<string, { id: number; d: number }[]>();
    const r2 = range * range;
    for (const p of this.plants) {
      if (p.state === PlantState.Gone || p.state === PlantState.Stump) continue;
      const dx = p.x - camPos.x, dy = p.y - camPos.y, dz = p.z - camPos.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > r2) continue;
      const key = this.mainKey(p);
      if (!this.fine.has(key)) continue;
      let list = per.get(key);
      if (!list) per.set(key, (list = []));
      list.push({ id: p.id, d });
    }
    const next = new Set<number>();
    for (const [key, list] of per) {
      list.sort((a, b) => a.d - b.d);
      const ids = list.slice(0, VEG.fineCap).map((e) => e.id);
      ids.forEach((id) => next.add(id));
      this.fine.get(key)!.ids = ids;
    }
    for (const [key, f] of this.fine) if (!per.has(key)) f.ids = [];
    // Plants that joined or left the layer: their chunk meshes need rewriting.
    let changed = false;
    for (const id of next) if (!this.nearIds.has(id)) { this.touchMain(this.plants[id]); changed = true; }
    for (const id of this.nearIds) if (!next.has(id)) { this.touchMain(this.plants[id]); changed = true; }
    this.nearIds = next;
    if (changed || this.fineDirty) this.fineDirty = true;
  }

  private touchMain(p: Plant): void {
    const cm = this.chunks.get(`${this.mainKey(p)}|${p.chunk}`);
    if (cm) cm.dirty = true;
  }

  private writeFine(): void {
    const col = new THREE.Color();
    for (const [key, f] of this.fine) {
      let n = 0;
      for (const id of f.ids) {
        const p = this.plants[id];
        this.plantMatrix(p, key, _m);
        if (_m.elements[0] === 0 && _m.elements[5] === 0) continue;
        f.mesh.setMatrixAt(n, _m);
        f.mesh.setColorAt(n, this.tint(p, key, col));
        n++;
      }
      f.mesh.count = n;
      f.mesh.instanceMatrix.needsUpdate = true;
      if (f.mesh.instanceColor) f.mesh.instanceColor.needsUpdate = true;
      // Bounds of the instances actually drawn, so the layer is culled when off screen.
      f.mesh.computeBoundingSphere();
    }
    this.fineDirty = false;
  }

  private writeContact(): void {
    for (let i = 0; i < this.contactIds.length; i++) {
      const p = this.plants[this.contactIds[i]];
      if (p.state === PlantState.Gone || (p.state === PlantState.Stump && p.kind !== 'broadleaf')) {
        this.contact.setMatrixAt(i, ZERO);
        continue;
      }
      let r = p.kind === 'broadleaf' ? CANOPY[p.variant].r * 2.1 : p.kind === 'palm' ? 1.6 : p.kind === 'rock' ? 1.7 : p.kind === 'apple' && p.variant === 1 ? 2 : 1.2;
      r *= p.scale * (p.state === PlantState.Sapling ? 0.3 + 0.7 * p.growth : p.state === PlantState.Stump ? 0.25 : 1);
      const pop = this.popping.get(p.id);
      if (pop !== undefined) r *= Math.max(0.001, springPop(pop, TREE_POP.dur, TREE_POP.freq, TREE_POP.damp).s);
      _p.set(p.x, p.y + 0.03, p.z);
      _q.identity();
      _s.set(r, 1, r);
      this.contact.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.contact.instanceMatrix.needsUpdate = true;
    this.contactDirty = false;
    if (this.contactBounds) {
      this.contact.computeBoundingSphere();
      this.contactBounds = false;
    }
  }

  /** Mark all meshes containing this plant for re-upload. */
  touch(p: Plant): void {
    for (const key of Object.keys(p.slots)) {
      if (key === 'contact') {
        this.contactDirty = true;
        continue;
      }
      const cm = this.chunks.get(`${key}|${p.chunk}`);
      if (cm) cm.dirty = true;
      if (this.nearIds.has(p.id)) this.fineDirty = true;
    }
  }

  // ---------------- Queries & actions ----------------

  /** Nearest plant (by spiral cell search) matching a predicate. */
  findNearest(x: number, z: number, maxR: number, pred: (p: Plant) => boolean): Plant | null {
    const w = this.world;
    const [cx, cz] = w.cellOf(x, z);
    let best: Plant | null = null, bestD = Infinity;
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!w.inBounds(cx + dx, cz + dz)) continue;
          const list = this.byCell.get(w.idx(cx + dx, cz + dz));
          if (!list) continue;
          for (const id of list) {
            const p = this.plants[id];
            if (!pred(p)) continue;
            const d = (p.x - x) ** 2 + (p.z - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = p;
            }
          }
        }
      }
      // Once found, finishing this ring and one more is enough.
      if (best && r > Math.sqrt(bestD) + 1) break;
    }
    return best;
  }

  plantsInCell(cell: number): Plant[] {
    return (this.byCell.get(cell) ?? []).map((id) => this.plants[id]);
  }

  isChoppable(p: Plant): boolean {
    return (p.kind === 'broadleaf' || p.kind === 'palm') && p.state === PlantState.Alive && p.reservedBy < 0;
  }
  isMineable(p: Plant): boolean {
    return p.kind === 'rock' && p.state === PlantState.Alive && p.amount > 0 && p.reservedBy < 0;
  }
  hasFruit(p: Plant): boolean {
    return (p.kind === 'apple' || p.kind === 'banana') && p.state === PlantState.Alive && p.fruit >= 1 && p.reservedBy < 0;
  }

  /** Fell a tree. Returns wood gained. */
  chop(p: Plant): number {
    if (p.state !== PlantState.Alive) return 0;
    const wood = p.kind === 'broadleaf' ? VEG.woodPerBroadleaf : VEG.woodPerPalm;
    p.state = PlantState.Stump;
    p.timer = VEG.stumpToSaplingSeconds * (0.7 + Math.random() * 0.6);
    p.marked = false;
    this.touch(p);
    return Math.round(wood * p.scale);
  }

  /** Pick fruit. Returns fruit gained. */
  harvest(p: Plant, max: number): number {
    const n = Math.min(max, Math.floor(p.fruit));
    p.fruit -= n;
    p.fruitTimer = 0;
    p.marked = false;
    this.touch(p);
    return n;
  }

  /** Mine stone from a rock. Returns stone gained. */
  mine(p: Plant, max: number): number {
    const n = Math.min(max, Math.ceil(p.amount));
    p.amount -= n;
    if (p.amount <= 0) {
      p.state = PlantState.Gone;
      p.marked = false;
      if (p.kind === 'rock') this.syncRockBlock();
    }
    this.touch(p);
    return n;
  }

  /** Remove all plants from a rectangle of cells (building placement). Returns wood recovered. */
  clearArea(cx: number, cz: number, w: number, d: number): number {
    let wood = 0;
    for (let z = cz - 1; z < cz + d + 1; z++) {
      for (let x = cx - 1; x < cx + w + 1; x++) {
        if (!this.world.inBounds(x, z)) continue;
        const inside = x >= cx && x < cx + w && z >= cz && z < cz + d;
        for (const p of this.plantsInCell(this.world.idx(x, z))) {
          if (p.state === PlantState.Gone) continue;
          if (!inside && p.kind !== 'broadleaf' && p.kind !== 'palm') continue;
          if (!inside) {
            // Big canopies on the border would clip into buildings.
            if (p.kind !== 'broadleaf') continue;
          }
          if ((p.kind === 'broadleaf' || p.kind === 'palm') && p.state === PlantState.Alive) wood += Math.round((p.kind === 'broadleaf' ? VEG.woodPerBroadleaf : VEG.woodPerPalm) * 0.5);
          p.state = PlantState.Gone;
          this.touch(p);
        }
      }
    }
    this.syncRockBlock();
    return wood;
  }

  /** Recompute plant heights after terrain sculpting. */
  refreshHeights(cx0: number, cz0: number, cx1: number, cz1: number): void {
    for (let z = cz0 - 1; z <= cz1 + 1; z++) {
      for (let x = cx0 - 1; x <= cx1 + 1; x++) {
        if (!this.world.inBounds(x, z)) continue;
        const i = this.world.idx(x, z);
        for (const p of this.plantsInCell(i)) {
          p.y = this.world.heightAt(p.x, p.z) - (p.kind === 'reef' ? 0.05 : 0);
          if (p.kind === 'searock') p.y = Math.max(p.y - 0.05, -0.32);
          // Plants drowned by lowering or lifted into the sea are removed.
          if (this.world.layer[i] <= 0 && p.kind !== 'reef' && p.kind !== 'searock') p.state = PlantState.Gone;
          // Reefs and sea rocks left high and dry go too.
          else if (this.world.layer[i] >= 1 && (p.kind === 'reef' || p.kind === 'searock')) p.state = PlantState.Gone;
          this.touch(p);
        }
      }
    }
    this.syncRockBlock();
  }

  /** Tree tops that parrots can perch on. */
  canopyPoints(max: number, rng: RNG): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const trees = this.plants.filter((p) => (p.kind === 'broadleaf' || p.kind === 'palm') && p.state === PlantState.Alive);
    for (let k = 0; k < max && trees.length; k++) {
      const p = trees[Math.floor(rng.next() * trees.length)];
      const h = p.kind === 'broadleaf' ? CANOPY[p.variant].top - 0.1 : 3.1;
      out.push(new THREE.Vector3(p.x, p.y + h * p.scale, p.z));
    }
    return out;
  }

  // ---------------- Update ----------------

  /**
   * @param growthMul season / rain multiplier on regrowth
   */
  update(dt: number, camPos: THREE.Vector3, camTarget: THREE.Vector3, lodDist: number, growthMul: number, time = 0): void {
    this.updateMarkers(time);
    // Regrowth timers (spread over frames for cheapness: only every ~0.5 s of game time per plant group).
    this.growAcc += dt;
    if (this.growAcc > 0.5) {
      const step = this.growAcc * growthMul;
      this.growAcc = 0;
      for (const p of this.plants) {
        if (p.state === PlantState.Stump) {
          p.timer -= step;
          if (p.timer <= 0) {
            p.state = PlantState.Sapling;
            p.growth = 0;
            this.touch(p);
          }
        } else if (p.state === PlantState.Sapling) {
          const g = p.growth;
          p.growth = Math.min(1, p.growth + step / VEG.saplingGrowSeconds);
          if (Math.floor(g * 20) !== Math.floor(p.growth * 20)) this.touch(p);
          if (p.growth >= 1) {
            p.state = PlantState.Alive;
            p.fruit = 0;
            this.touch(p);
          }
        } else if (p.state === PlantState.Alive && p.fruitMax > 0 && p.fruit < p.fruitMax) {
          const before = Math.floor(p.fruit);
          p.fruit = Math.min(p.fruitMax, p.fruit + (step / VEG.fruitRegrowSeconds) * p.fruitMax);
          if (Math.floor(p.fruit) !== before) this.touch(p);
        }
      }
    }

    // LOD: swap to low-detail geometry and hide small plants in distant chunks.
    this.lodTimer -= dt;
    if (this.lodTimer <= 0) {
      this.lodTimer = 0.25;
      const size = this.world.N / this.C;
      for (const cm of this.chunks.values()) {
        // Distance from the camera to the nearest point of the chunk.
        const dx = Math.max(0, Math.abs(cm.center.x - camPos.x) - size / 2);
        const dz = Math.max(0, Math.abs(cm.center.z - camPos.z) - size / 2);
        const d = Math.hypot(dx, dz, camPos.y - camTarget.y);
        const far = d > lodDist;
        if (cm.def.lo) {
          const g = far ? cm.def.lo : cm.def.mid ?? cm.def.hi;
          if (cm.mesh.geometry !== g) cm.mesh.geometry = g;
        }
        cm.mesh.visible = cm.def.cull === 0 || d < lodDist * cm.def.cull;
        if (cm.def.shadow) cm.mesh.castShadow = d < lodDist * 1.4;
      }
      this.pickNear(camPos, lodDist * VEG.fineDetail);
    }

    for (const [k, cm] of this.chunks) {
      if (cm.dirty) this.writeChunk(cm, k.split('|')[0]);
    }
    if (this.fineDirty) this.writeFine();
    if (this.contactDirty) this.writeContact();
  }
  private growAcc = 0;

  /** Big canopy trees for monkeys: position, canopy height and radius (world units). */
  canopyTrees(): { id: number; x: number; y: number; z: number; mid: number; top: number; r: number }[] {
    return this.plants
      .filter((p) => p.kind === 'broadleaf' && p.state === PlantState.Alive && [0, 1, 4, 5, 6].includes(p.variant) && p.scale > 0.75)
      .map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, mid: CANOPY[p.variant].mid * p.scale, top: CANOPY[p.variant].top * p.scale, r: CANOPY[p.variant].r * p.scale }));
  }

  get treeCount(): number {
    return this.plants.filter((p) => p.state === PlantState.Alive && (p.kind === 'broadleaf' || p.kind === 'palm')).length;
  }
}
