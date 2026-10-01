import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, M, P, tube } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { Particles } from '../render/Particles';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { leafGeometry } from './detail';
import { bushGeometry, fernGeometry } from './models';
import { Kind, LEAF, STEM, flowerHead, plantGeometry } from './Wildflowers';

/** The planting brushes (and the one that digs plants up again). */
export type GardenBrush = 'flowers' | 'bushes' | 'shrubs' | 'unplant';
export const GARDEN_BRUSHES: GardenBrush[] = ['flowers', 'bushes', 'shrubs', 'unplant'];

/** Tuning for the player's garden planting. */
export const GARDEN = {
  /** Brush radius (world units) for each brush. */
  radius: { flowers: 0.8, bushes: 1.0, shrubs: 0.9, unplant: 1.1 } as Record<GardenBrush, number>,
  /** Planting attempts per brush step (a step every ~0.4 units of drag). */
  tries: { flowers: 5, bushes: 1.4, shrubs: 2.2, unplant: 0 } as Record<GardenBrush, number>,
  /** Most plants on the island. */
  max: 5000,
  /** Seconds a plant takes to pop up (springing past full size and settling), or to shrink away. */
  pop: 0.8,
  shrink: 0.3,
};

interface Variant {
  brush: Exclude<GardenBrush, 'unplant'>;
  /** Plants of one group read as one kind (a stroke favours one or two groups). */
  group: string;
  geo: () => THREE.BufferGeometry;
  /** Scale range, and the ground it needs round it (radius at scale 1). */
  s: [number, number];
  r: number;
}

/** A flowering shrub: a small bush studded with big blooms of one colour. */
function bloomBush(seed: number, c0: number, c1: number, petals: number, size: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const bush = bushGeometry(false, false, seed);
  const b = new GeoBuilder();
  const col0 = new THREE.Color(c0), col1 = new THREE.Color(c1);
  for (let k = 0; k < 16; k++) {
    const th = rng.range(0, Math.PI * 2), ph = rng.range(0.15, 1.25);
    const r = 0.52;
    flowerHead(b, new THREE.Vector3(Math.cos(th) * Math.sin(ph) * r, 0.42 + Math.cos(ph) * r * 0.78, Math.sin(th) * Math.sin(ph) * r), size * rng.range(0.85, 1.15), col0, col1, rng, petals, 0.35);
  }
  const g = mergeGeometries([bush, b.build()])!;
  bush.dispose();
  return g;
}

/** An agave: a stiff rosette of thick, pointed blue-green leaves. */
function agave(seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const c0 = new THREE.Color(0x5f8f80), c1 = new THREE.Color(0x8fb8a4);
  for (let ring = 0; ring < 3; ring++) {
    const n = 7 - ring;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + ring * 0.45 + rng.range(-0.15, 0.15);
      const tilt = 0.35 + ring * 0.38 + rng.range(-0.08, 0.08);
      const len = (0.34 - ring * 0.07) * rng.range(0.9, 1.1);
      // A flattened cone, its tip outward and up.
      const m = new THREE.Matrix4().makeRotationY(-a).multiply(new THREE.Matrix4().makeRotationZ(-tilt)).multiply(M.t(0, len / 2, 0, 0, 0, 0, 1, 1, 0.35));
      b.add(P.cone(0.045, len, 4), { color: c0.clone().lerp(c1, rng.next()), sway: 0.05 }, m);
    }
  }
  return b.build();
}

/** Ornamental grass: a fountain of fine arching blades with a few pale feathery plumes. */
function grassClump(seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const q = new THREE.Quaternion(), ax = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  const g0 = new THREE.Color(0x7c9a3c), g1 = new THREE.Color(0xb8b860);
  for (let k = 0; k < 26; k++) {
    const a = rng.range(0, Math.PI * 2);
    ax.set(Math.cos(a) * rng.range(0.15, 0.6), 1, Math.sin(a) * rng.range(0.15, 0.6)).normalize();
    q.setFromUnitVectors(z, ax);
    const l = rng.range(0.22, 0.36);
    b.add(leafGeometry(l, 0.012, 0.6), { color: g0.clone().lerp(g1, rng.next()), leaf: 1, sway: (p) => 0.4 + p.y * 2 }, new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0), q, new THREE.Vector3(1, 1, 1)));
  }
  for (let k = 0; k < 4; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0.02, 0.07);
    const top = new THREE.Vector3(Math.cos(a) * r * 2, rng.range(0.36, 0.46), Math.sin(a) * r * 2);
    b.add(tube([new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), top], () => 0.004, 3, 2), { color: new THREE.Color(0xa8a060), sway: (p) => p.y * 2.5 });
    // A soft, nodding plume: a few downy tufts along the tip.
    const lean = Math.atan2(top.x, top.z);
    for (let j = 0; j < 3; j++) {
      const y = top.y + 0.015 + j * 0.035;
      b.add(P.sphere(0.022 - j * 0.004, 1), { color: new THREE.Color(0xe9d29a).lerp(new THREE.Color(0xd8b48c), j / 3), sway: 1 }, M.t(top.x + Math.sin(lean) * j * 0.012, y, top.z + Math.cos(lean) * j * 0.012, 0, 0, 0, 0.9, 2.2, 0.9));
    }
  }
  return b.build();
}

/** Croton: glossy leaves splashed red, orange, yellow and green. */
function croton(seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const q = new THREE.Quaternion(), ax = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  const cols = [0xc23b22, 0xe0782a, 0xe8c23a, 0x4f7a2a, 0x8a2a2a].map((h) => new THREE.Color(h));
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 * 3.3 + rng.range(-0.3, 0.3);
    const h = 0.03 + (k / 24) * 0.16 + rng.range(-0.02, 0.02);
    ax.set(Math.cos(a), rng.range(0.2, 0.8) + h * 2, Math.sin(a)).normalize();
    q.setFromUnitVectors(z, ax);
    const l = rng.range(0.08, 0.12) * (1.15 - h * 2);
    b.add(leafGeometry(l, l * 0.3, 0.3), { color: rng.pick(cols).clone().lerp(LEAF, rng.next() * 0.25), leaf: 1, sway: 0.35 }, new THREE.Matrix4().compose(new THREE.Vector3(0, h, 0), q, new THREE.Vector3(1, 1, 1)));
  }
  b.add(tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.17, 0)], () => 0.008, 3, 2), { color: STEM });
  return b.build();
}

/** A fern scaled for a garden bed. */
function gardenFern(seed: number): THREE.BufferGeometry {
  const g = fernGeometry(false, seed).clone();
  g.scale(0.6, 0.6, 0.6);
  return g;
}

/** A small bush trimmed for a garden (green). */
function greenBush(seed: number): THREE.BufferGeometry {
  return bushGeometry(false, false, seed);
}

const FLOWER_KINDS: Kind[] = ['red', 'yellow', 'orange', 'purple', 'pink', 'white', 'blue', 'orchid'];

/** Every plant the garden brushes can set, by brush and colour group (two shapes of most). */
export const VARIANTS: Variant[] = [
  ...FLOWER_KINDS.flatMap((k, i) =>
    [0, 1].map((n) => ({ brush: 'flowers' as const, group: k, geo: () => plantGeometry(k, 3100 + i * 11 + n), s: [1.5, 1.9] as [number, number], r: 0.1 })),
  ),
  ...[0, 1].map((n) => ({ brush: 'bushes' as const, group: 'green', geo: () => greenBush(61 + n * 2), s: [0.42, 0.62] as [number, number], r: 0.55 })),
  ...[0, 1].map((n) => ({ brush: 'bushes' as const, group: 'hibiscus', geo: () => bloomBush(71 + n, 0xd8263a, 0xf0566a, 5, 0.09), s: [0.42, 0.6] as [number, number], r: 0.55 })),
  ...[0, 1].map((n) => ({ brush: 'bushes' as const, group: 'bougainvillea', geo: () => bloomBush(81 + n, 0xc8327e, 0xf06ab4, 4, 0.08), s: [0.45, 0.62] as [number, number], r: 0.55 })),
  { brush: 'bushes', group: 'allamanda', geo: () => bloomBush(91, 0xf2c21c, 0xffe57a, 5, 0.085), s: [0.42, 0.58], r: 0.55 },
  { brush: 'bushes', group: 'gardenia', geo: () => bloomBush(95, 0xf2eee4, 0xffffff, 6, 0.08), s: [0.42, 0.58], r: 0.55 },
  ...[0, 1].map((n) => ({ brush: 'shrubs' as const, group: 'fern', geo: () => gardenFern(141 + n), s: [1.1, 1.45] as [number, number], r: 0.22 })),
  ...[0, 1].map((n) => ({ brush: 'shrubs' as const, group: 'tropical', geo: () => plantGeometry('tropical', 151 + n), s: [1.1, 1.4] as [number, number], r: 0.18 })),
  ...[0, 1].map((n) => ({ brush: 'shrubs' as const, group: 'croton', geo: () => croton(161 + n), s: [1.3, 1.6] as [number, number], r: 0.14 })),
  ...[0, 1].map((n) => ({ brush: 'shrubs' as const, group: 'agave', geo: () => agave(171 + n), s: [1.1, 1.5] as [number, number], r: 0.2 })),
  ...[0, 1].map((n) => ({ brush: 'shrubs' as const, group: 'grass', geo: () => grassClump(181 + n), s: [0.9, 1.25] as [number, number], r: 0.16 })),
];

interface Plant {
  v: number;
  x: number;
  z: number;
  y: number;
  rot: number;
  s: number;
  /** Seconds into its pop (negative while it waits its turn), or into shrinking away. */
  t: number;
  /** 0 settled, 1 popping up, 2 shrinking away. */
  state: 0 | 1 | 2;
  /** Its instance in its variant's mesh. */
  slot: number;
  cell: number;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  plants: Plant[];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * The player's garden: flowers, flowering bushes, ferns, crotons, agaves and grasses planted by
 * dragging a brush over the ground, like laying a path. Each plant pops up out of the soil with a
 * springy bounce (overshooting, squashing and settling) and a puff of earth and leaves, in a quick
 * ripple along the stroke. A stroke favours one or two kinds so beds read as drifts of colour.
 * Plants keep their distance from each other (dragging over a bed again only fills its gaps), keep
 * off paths, water, fields and buildings (one built on top of them is cleared away), and are saved
 * with the island. Decoration only: nothing harvests them. One instanced mesh per plant shape.
 */
export class Garden {
  readonly group = new THREE.Group();
  private batches: Batch[];
  private plants: Plant[] = [];
  /** Plants by map cell, for spacing and digging up. */
  private grid = new Map<number, Plant[]>();
  private moving = new Set<Plant>();
  private rng: RNG;
  private stroke: { brush: GardenBrush; groups: string[] } | null = null;
  private dust = new Particles(260, 0xa88d66, 0.75);
  private flecks = new Particles(260, 0x86b850);
  private sweep = 0;
  private version = -1;
  private lastSound = 0;
  private clock = 0;
  sfx: ((name: string, x: number, z: number) => void) | null = null;

  constructor(private world: World) {
    this.rng = new RNG(world.seed * 97 + 31);
    const mat = stylisedMaterial();
    this.batches = VARIANTS.map((v) => {
      const mesh = new THREE.InstancedMesh(v.geo(), mat, 16);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return { mesh, plants: [] };
    });
    this.group.add(this.dust.points, this.flecks.points);
    this.group.name = 'garden';
    this.version = world.version;
  }

  get count(): number {
    return this.plants.length;
  }

  /** Can a garden plant grow here (open, level land: no water, path, field, building or rock)? */
  canGrow(x: number, z: number): boolean {
    const w = this.world;
    const i = w.cellIndexAt(x, z);
    if (i < 0 || !w.isLandCell(i) || w.occ[i] || w.path[i] || w.canal[i] || w.bridge[i] || w.blocked(i) || w.soil[i] > 0.05) return false;
    if (!Number.isNaN(w.riverY[i])) return false;
    const y = w.heightAt(x, z);
    if (y < 0.05) return false;
    const sw = w.swampWaterY(x, z);
    if (!Number.isNaN(sw) && sw - y > 0.02) return false;
    return Math.abs(w.heightAt(x + 0.2, z) - y) < 0.1 && Math.abs(w.heightAt(x, z + 0.2) - y) < 0.1;
  }

  /** Is there room for a plant of this variant and size here (clear of its neighbours)? */
  private roomFor(v: number, x: number, z: number, s: number): boolean {
    const w = this.world;
    const r = VARIANTS[v].r * s;
    const [cx, cz] = w.cellOf(x, z);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) continue;
        const list = this.grid.get(w.idx(cx + dx, cz + dz));
        if (!list) continue;
        for (const p of list) {
          if (p.state === 2) continue;
          const need = (r + VARIANTS[p.v].r * p.s) * 0.9;
          if ((p.x - x) ** 2 + (p.z - z) ** 2 < need * need) return false;
        }
      }
    }
    return true;
  }

  /** Choose this stroke's kinds: one or two favourites, the odd one of any other. */
  private pickVariant(brush: Exclude<GardenBrush, 'unplant'>): number {
    const all = VARIANTS.map((v, i) => i).filter((i) => VARIANTS[i].brush === brush);
    const st = this.stroke!;
    if (!st.groups.length) {
      const groups = [...new Set(all.map((i) => VARIANTS[i].group))];
      st.groups.push(this.rng.pick(groups));
      if (this.rng.chance(0.55)) st.groups.push(this.rng.pick(groups));
    }
    const r = this.rng.next();
    const want = r < 0.68 ? st.groups[0] : r < 0.9 ? st.groups[st.groups.length - 1] : null;
    const pool = want ? all.filter((i) => VARIANTS[i].group === want) : all;
    return this.rng.pick(pool);
  }

  /**
   * One step of a brush stroke at (x, z): plants a few things round it (or digs them up). `start`
   * begins a new stroke, which picks its own favourite kinds. Returns how many plants changed.
   */
  paint(x: number, z: number, brush: GardenBrush, start: boolean): number {
    if (start || !this.stroke || this.stroke.brush !== brush) this.stroke = { brush, groups: [] };
    const R = GARDEN.radius[brush];
    if (brush === 'unplant') {
      let n = 0;
      for (const p of this.near(x, z, R)) {
        if (p.state === 2) continue;
        this.dig(p, this.rng.range(0, 0.12));
        n++;
      }
      if (n) this.sound('unplant', x, z);
      return n;
    }
    let tries = Math.floor(GARDEN.tries[brush]) + (this.rng.chance(GARDEN.tries[brush] % 1) ? 1 : 0);
    let n = 0;
    while (tries-- > 0 && this.plants.length < GARDEN.max) {
      const a = this.rng.range(0, Math.PI * 2), d = Math.sqrt(this.rng.next()) * R;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const v = this.pickVariant(brush);
      const s = this.rng.range(VARIANTS[v].s[0], VARIANTS[v].s[1]);
      if (!this.canGrow(px, pz) || !this.roomFor(v, px, pz, s)) continue;
      this.add(v, px, pz, this.rng.range(0, Math.PI * 2), s, -this.rng.range(0, 0.18));
      n++;
    }
    return n;
  }

  /** Garden full (the player is told). */
  get full(): boolean {
    return this.plants.length >= GARDEN.max;
  }

  private near(x: number, z: number, R: number): Plant[] {
    const w = this.world, out: Plant[] = [];
    const [cx, cz] = w.cellOf(x, z), n = Math.ceil(R) + 1;
    for (let dz = -n; dz <= n; dz++) {
      for (let dx = -n; dx <= n; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) continue;
        for (const p of this.grid.get(w.idx(cx + dx, cz + dz)) ?? []) if ((p.x - x) ** 2 + (p.z - z) ** 2 < R * R) out.push(p);
      }
    }
    return out;
  }

  /** Set a plant in the ground: `t` < 0 pops it up after that delay, NaN places it fully grown. */
  private add(v: number, x: number, z: number, rot: number, s: number, t: number): Plant {
    const w = this.world;
    const cell = w.cellIndexAt(x, z);
    const p: Plant = { v, x, z, y: w.heightAt(x, z), rot, s, t: Number.isNaN(t) ? 0 : t, state: Number.isNaN(t) ? 0 : 1, slot: -1, cell };
    const b = this.batches[v];
    if (b.plants.length >= b.mesh.instanceMatrix.count) this.grow(v);
    p.slot = b.plants.length;
    b.plants.push(p);
    b.mesh.count = b.plants.length;
    this.plants.push(p);
    let list = this.grid.get(cell);
    if (!list) this.grid.set(cell, (list = []));
    list.push(p);
    if (p.state === 1) this.moving.add(p);
    this.place(p);
    return p;
  }

  /** Double a variant's instance capacity. */
  private grow(v: number): void {
    const b = this.batches[v];
    const old = b.mesh;
    const mesh = new THREE.InstancedMesh(old.geometry, old.material, old.instanceMatrix.count * 2);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array as Float32Array);
    mesh.count = old.count;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.remove(old);
    old.dispose();
    this.group.add(mesh);
    b.mesh = mesh;
  }

  /** Start shrinking a plant away (removed once gone). */
  private dig(p: Plant, delay = 0): void {
    p.state = 2;
    p.t = -delay;
    this.moving.add(p);
  }

  private remove(p: Plant): void {
    const b = this.batches[p.v];
    const last = b.plants.pop()!;
    if (last !== p) {
      b.plants[p.slot] = last;
      last.slot = p.slot;
      this.place(last);
    }
    b.mesh.count = b.plants.length;
    b.mesh.instanceMatrix.needsUpdate = true;
    const i = this.plants.indexOf(p);
    if (i >= 0) {
      this.plants[i] = this.plants[this.plants.length - 1];
      this.plants.pop();
    }
    const list = this.grid.get(p.cell);
    if (list) {
      list.splice(list.indexOf(p), 1);
      if (!list.length) this.grid.delete(p.cell);
    }
    this.moving.delete(p);
  }

  /** The plant's size now: springing up past full size and settling, or shrinking away. */
  static popScale(state: number, t: number): { s: number; sy: number } {
    if (state === 1) {
      if (t <= 0) return { s: 0, sy: 0 };
      if (t >= GARDEN.pop) return { s: 1, sy: 1 };
      const e = Math.exp(-6.5 * t), osc = Math.cos(13 * t), wob = Math.sin(13 * t) * e;
      const s = 1 - e * osc;
      // Squash and stretch: tall and thin shooting up, short and wide as it lands.
      return { s: s * (1 - 0.14 * wob), sy: s * (1 + 0.3 * wob) };
    }
    if (state === 2) {
      const u = Math.max(0, Math.min(1, t / GARDEN.shrink));
      const s = (1 - u) * (1 - u);
      return { s, sy: s };
    }
    return { s: 1, sy: 1 };
  }

  private place(p: Plant): void {
    const b = this.batches[p.v];
    const k = Garden.popScale(p.state, p.t);
    if (k.s <= 0.001) {
      b.mesh.setMatrixAt(p.slot, ZERO);
    } else {
      _q.setFromAxisAngle(UP, p.rot + (p.state === 2 ? p.t * 6 : 0));
      _m.compose(_p.set(p.x, p.y - 0.01, p.z), _q, _s.set(k.s * p.s, k.sy * p.s, k.s * p.s));
      b.mesh.setMatrixAt(p.slot, _m);
    }
    b.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Earth and a few leaves thrown up as a plant pops out of the ground. */
  private puff(p: Plant): void {
    const big = VARIANTS[p.v].brush === 'bushes' ? 1.6 : 1;
    for (let k = 0; k < 4; k++) {
      const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(0.4, 0.9) * big;
      this.dust.spawn(p.x, p.y + 0.03, p.z, Math.cos(a) * sp, this.rng.range(0.5, 1.0), Math.sin(a) * sp, this.rng.range(0.35, 0.6), 0.08 * big, 0.2);
    }
    for (let k = 0; k < 3; k++) {
      const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(0.3, 0.8);
      this.flecks.spawn(p.x, p.y + 0.1 * big, p.z, Math.cos(a) * sp, this.rng.range(1.0, 1.8), Math.sin(a) * sp, this.rng.range(0.5, 0.8), 0.035, 0);
    }
  }

  private sound(name: string, x: number, z: number): void {
    if (this.clock - this.lastSound < 0.07) return;
    this.lastSound = this.clock;
    this.sfx?.(name, x, z);
  }

  update(dt: number): void {
    this.clock += dt;
    for (const p of [...this.moving]) {
      const before = p.t;
      p.t += dt;
      if (p.state === 1 && before <= 0 && p.t > 0) {
        this.puff(p);
        this.sound('plant', p.x, p.z);
      }
      if (p.state === 2 && p.t >= GARDEN.shrink) {
        this.remove(p);
        continue;
      }
      if (p.state === 1 && p.t >= GARDEN.pop) {
        p.state = 0;
        this.moving.delete(p);
      }
      this.place(p);
    }
    // The land changed (sculpting, paths, buildings, fields): follow the ground, clear what can't grow.
    this.sweep -= dt;
    if (this.world.version !== this.version || this.sweep <= 0) {
      const moved = this.world.version !== this.version;
      this.version = this.world.version;
      this.sweep = 1.5;
      for (const p of this.plants) {
        if (p.state === 2) continue;
        if (!this.canGrow(p.x, p.z)) this.dig(p, this.rng.range(0, 0.15));
        else if (moved) {
          p.y = this.world.heightAt(p.x, p.z);
          this.place(p);
        }
      }
    }
    this.dust.update(dt, 1.8);
    this.flecks.update(dt, 3.5);
  }

  /** Saved as [variant, x, z, rotation, scale] per plant (positions in hundredths). */
  serialize(): number[] {
    const out: number[] = [];
    for (const p of this.plants) {
      if (p.state === 2) continue;
      out.push(p.v, Math.round(p.x * 100), Math.round(p.z * 100), Math.round(p.rot * 100), Math.round(p.s * 100));
    }
    return out;
  }

  /** Replant a saved garden, fully grown (anything that no longer fits is left out). */
  restore(data: number[]): void {
    for (const p of [...this.plants]) this.remove(p);
    for (let i = 0; i + 4 < data.length && this.plants.length < GARDEN.max; i += 5) {
      const v = data[i];
      if (!Number.isInteger(v) || v < 0 || v >= VARIANTS.length) continue;
      const x = data[i + 1] / 100, z = data[i + 2] / 100, s = THREE.MathUtils.clamp(data[i + 4] / 100, 0.2, 3);
      if (!this.canGrow(x, z)) continue;
      this.add(v, x, z, data[i + 3] / 100, s, NaN);
    }
  }
}

